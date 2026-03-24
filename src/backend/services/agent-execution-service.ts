import { runCodex } from "../codex";
import { AgentRepository } from "../repositories/agent-repository";
import { buildMemberExecutionSystemPrompt, isAgentMessageStreamType } from "./member-prompt";
import { AgentLockManager } from "./agent-lock-manager";
import { AppSettingsService } from "./app-settings-service";

export class AgentExecutionService {
  constructor(
    private readonly agentRepository: AgentRepository,
    private readonly appSettingsService: AppSettingsService,
    private readonly workspaceDir: string,
    private readonly lockManager: AgentLockManager,
  ) {}

  async sendDirectMessage(agentId: string, content: string): Promise<{
    ok: boolean;
    reply: string;
    sessionId: string | null;
  }> {
    const agent = this.agentRepository.getAgent(agentId);
    if (!agent) {
      throw new Error("agent not found");
    }

    return this.lockManager.withAgentLock(agentId, async () => {
      this.agentRepository.appendMessage(agentId, "user", content);

      let lastStreamReply = "";
      let lastStreamMessageId: number | null = null;
      const selectedModel = this.appSettingsService.getSelectedModel();
      const codexResult = await runCodex({
        prompt: content,
        systemPrompt: buildMemberExecutionSystemPrompt(agent, "dm"),
        model: selectedModel,
        sessionId: agent.sessionId,
        cwd: this.workspaceDir,
        onStream: (event) => {
          if (!isAgentMessageStreamType(event.rawType)) {
            return;
          }
          const streamedContent = event.content.trim();
          if (!streamedContent) {
            return;
          }
          lastStreamReply = streamedContent;
          if (lastStreamMessageId === null) {
            const message = this.agentRepository.appendMessage(agentId, "agent", streamedContent);
            lastStreamMessageId = message.id;
            return;
          }
          this.agentRepository.updateMessage(lastStreamMessageId, streamedContent);
        },
      });

      if (codexResult.sessionId && codexResult.sessionId !== agent.sessionId) {
        this.agentRepository.updateAgentSession(agentId, codexResult.sessionId);
      }

      const normalizedReply = codexResult.reply.trim();
      const hasRenderableReply = normalizedReply.length > 0 || lastStreamReply.length > 0;
      const executionOk = codexResult.ok && hasRenderableReply;
      const replyText = executionOk
        ? normalizedReply || lastStreamReply
        : [
            "Codex 실행 실패:",
            codexResult.error ?? (codexResult.ok ? "empty response from codex" : "unknown error"),
            codexResult.reply ? `partial: ${codexResult.reply}` : "",
          ]
            .filter((line) => line.length > 0)
            .join("\n");

      if (executionOk && lastStreamMessageId !== null) {
        this.agentRepository.updateMessage(lastStreamMessageId, replyText);
      } else {
        this.agentRepository.appendMessage(agentId, executionOk ? "agent" : "system", replyText);
      }

      return {
        ok: executionOk,
        reply: replyText,
        sessionId: codexResult.sessionId,
      };
    });
  }

  async clearMessages(agentId: string): Promise<boolean> {
    return this.lockManager.withAgentLock(agentId, async () => this.agentRepository.clearAgentMessages(agentId));
  }
}
