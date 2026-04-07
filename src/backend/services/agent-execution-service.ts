import { runCodex } from "../codex";
import { DM_RUNTIME_SESSION_SCOPE } from "../runtime-session-scope";
import { AgentRepository } from "../repositories/agent-repository";
import {
  isCompletedAgentMessageStreamEvent,
} from "./agent-message-stream";
import { isAgentMessageStreamType } from "./member-prompt";
import { AgentLockManager } from "./agent-lock-manager";
import { AppSettingsService } from "./app-settings-service";
import { PromptTemplateService } from "./prompt-template-service";

export class AgentExecutionService {
  constructor(
    private readonly agentRepository: AgentRepository,
    private readonly appSettingsService: AppSettingsService,
    private readonly promptTemplateService: PromptTemplateService,
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
      const runtimeSessionId = this.agentRepository.getRuntimeSession(agentId, DM_RUNTIME_SESSION_SCOPE);

      let lastStreamReply = "";
      let activeStreamMessageId: number | null = null;
      let lastCompletedStreamMessageId: number | null = null;
      let lastCompletedStreamContent = "";
      const selectedModel = this.appSettingsService.getSelectedModel();
      const codexResult = await runCodex({
        prompt: content,
        systemPrompt: this.promptTemplateService.buildMemberExecutionSystemPrompt(agent, "dm"),
        model: selectedModel,
        sessionId: runtimeSessionId,
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
          if (isCompletedAgentMessageStreamEvent(event.raw)) {
            if (activeStreamMessageId !== null) {
              this.agentRepository.updateMessage(activeStreamMessageId, streamedContent);
              lastCompletedStreamMessageId = activeStreamMessageId;
            } else {
              const message = this.agentRepository.appendMessage(agentId, "agent", streamedContent);
              lastCompletedStreamMessageId = message.id;
            }
            lastCompletedStreamContent = streamedContent;
            activeStreamMessageId = null;
            return;
          }

          if (activeStreamMessageId === null) {
            const message = this.agentRepository.appendMessage(agentId, "agent", streamedContent);
            activeStreamMessageId = message.id;
            return;
          }

          this.agentRepository.updateMessage(activeStreamMessageId, streamedContent);
        },
      });

      if (codexResult.sessionId && codexResult.sessionId !== runtimeSessionId) {
        this.agentRepository.upsertRuntimeSession(agentId, DM_RUNTIME_SESSION_SCOPE, codexResult.sessionId);
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

      if (executionOk && activeStreamMessageId !== null) {
        this.agentRepository.updateMessage(activeStreamMessageId, replyText);
      } else if (
        executionOk &&
        lastCompletedStreamMessageId !== null &&
        replyText === lastCompletedStreamContent
      ) {
        this.agentRepository.updateMessage(lastCompletedStreamMessageId, replyText);
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
