import { runCodex } from "../codex";
import { ChannelEventBus } from "../events/channel-event-bus";
import { AgentRepository } from "../repositories/agent-repository";
import { ChannelExecutionRepository } from "../repositories/channel-execution-repository";
import { ChannelMemberRepository } from "../repositories/channel-member-repository";
import { ChannelMemberStateRepository } from "../repositories/channel-member-state-repository";
import { ChannelMessageRepository } from "../repositories/channel-message-repository";
import { ChannelRepository } from "../repositories/channel-repository";
import type { Agent, ChannelExecutionKind, ChannelMessage, ChannelMessageKind } from "../types";
import { AgentLockManager } from "./agent-lock-manager";
import { AppSettingsService } from "./app-settings-service";
import {
  buildChannelPrompt,
  buildMemberExecutionSystemPrompt,
  isAgentMessageStreamType,
  type ChannelPromptTimelineEntry,
} from "./member-prompt";
import { extractMentionedAgents, type MentionedAgent } from "./mention-router";

interface ChannelExecutionResult {
  agentId: string;
  agentName: string;
  ok: boolean;
  reply: string;
  sessionId?: string | null;
  message: ChannelMessage;
}

interface ChannelMessageListResult {
  channel: ReturnType<ChannelRepository["getChannel"]>;
  members: Agent[];
  messages: ChannelMessage[];
  mentionsByMessage: Record<number, MentionedAgent[]>;
}

export class ChannelMessageService {
  private static readonly MAX_MENTION_EXECUTIONS = 12;
  private static readonly CHANNEL_PROMPT_RECENT_MESSAGE_LIMIT = 12;

  constructor(
    private readonly agentRepository: AgentRepository,
    private readonly channelRepository: ChannelRepository,
    private readonly channelMemberRepository: ChannelMemberRepository,
    private readonly channelMemberStateRepository: ChannelMemberStateRepository,
    private readonly channelMessageRepository: ChannelMessageRepository,
    private readonly channelExecutionRepository: ChannelExecutionRepository,
    private readonly appSettingsService: AppSettingsService,
    private readonly workspaceDir: string,
    private readonly lockManager: AgentLockManager,
    private readonly eventBus: ChannelEventBus,
  ) {}

  listChannels() {
    return this.channelRepository.listChannels(false);
  }

  listChannelReadStates(channelId: string) {
    const channel = this.channelRepository.getChannel(channelId);
    if (!channel) {
      return null;
    }

    return {
      channel,
      states: this.channelMemberStateRepository.listChannelMemberStates(channelId),
    };
  }

  upsertChannelReadState(input: {
    channelId: string;
    agentId: string;
    lastReadMessageId?: number;
    isCoordinator?: boolean;
  }) {
    const channel = this.channelRepository.getChannel(input.channelId);
    if (!channel) {
      return { error: "channel not found" as const };
    }

    const agent = this.agentRepository.getAgent(input.agentId);
    if (!agent) {
      return { error: "agent not found" as const };
    }
    const isMember = this.channelMemberRepository
      .listChannelMembers(input.channelId)
      .some((member) => member.agentId === input.agentId);
    if (!isMember) {
      return { error: "channel member not found" as const };
    }

    const state = this.channelMemberStateRepository.upsertChannelMemberState({
      channelId: input.channelId,
      agentId: input.agentId,
      lastReadMessageId: input.lastReadMessageId,
      lastSeenAt: new Date().toISOString(),
      isCoordinator: input.isCoordinator,
    });
    return { state };
  }

  listChannelExecutionJobs(channelId: string, afterJobId?: number) {
    const channel = this.channelRepository.getChannel(channelId);
    if (!channel) {
      return null;
    }

    return {
      channel,
      jobs: this.channelExecutionRepository.listChannelExecutionJobs(channelId, afterJobId),
    };
  }

  deleteChannelReadState(channelId: string, agentId: string): boolean {
    return this.channelMemberStateRepository.deleteChannelMemberState(channelId, agentId);
  }

  listChannelMessages(channelId: string, afterMessageId?: number): ChannelMessageListResult | null {
    const channel = this.channelRepository.getChannel(channelId);
    if (!channel) {
      return null;
    }

    const members = this.channelMemberRepository.listChannelMemberAgents(channelId);
    const messages = this.channelMessageRepository.listChannelMessages(channelId, afterMessageId);
    const mentionsByMessage: Record<number, MentionedAgent[]> = {};
    for (const message of messages) {
      mentionsByMessage[message.id] = this.channelMessageRepository
        .listChannelMessageMentions(message.id)
        .map((mention) => ({ agentId: mention.agentId, mentionName: mention.mentionName }));
    }

    return { channel, members, messages, mentionsByMessage };
  }

  async postChannelMessage(channelId: string, content: string, messageKind: ChannelMessageKind) {
    const channel = this.channelRepository.getChannel(channelId);
    if (!channel) {
      return { error: "channel not found" as const };
    }
    if (channel.archivedAt) {
      return { error: "channel is archived" as const };
    }

    const members = this.channelMemberRepository.listChannelMemberAgents(channelId);
    const memberById = new Map<string, Agent>(members.map((member) => [member.id, member]));

    const userMessage = this.appendChannelMessageAndNotify(channelId, "user", null, content, messageKind);
    const mentions = extractMentionedAgents(content, members);
    const mentionRecords = this.channelMessageRepository.addChannelMessageMentions(userMessage.id, mentions);

    if (mentions.length === 0) {
      return {
        ok: true as const,
        executionMode: "log_only" as const,
        message: userMessage,
        mentions: mentionRecords,
        results: [],
      };
    }

    type MentionTask = {
      triggerMessageId: number;
      sourceMessageId: number;
      sourceAgentId: string | null;
      agentId: string;
      sourceContent: string;
      resultMessageKind: ChannelMessageKind;
      executionKind: ChannelExecutionKind;
      depth: number;
      jobId: number;
    };

    const queuedAgentIds = new Set<string>();
    const taskQueue: MentionTask[] = [];
    const results: ChannelExecutionResult[] = [];
    const skippedTasksByJobId = new Map<number, MentionTask>();

    const enqueueMentions = (
      nextMentions: MentionedAgent[],
      triggerMessageId: number,
      sourceMessageId: number,
      sourceAgentId: string | null,
      sourceContent: string,
      resultMessageKind: ChannelMessageKind,
      executionKind: ChannelExecutionKind,
      depth: number,
    ): void => {
      for (const mention of nextMentions) {
        if (queuedAgentIds.has(mention.agentId)) {
          continue;
        }
        if (!memberById.has(mention.agentId)) {
          continue;
        }
        const job = this.channelExecutionRepository.createExecutionJob({
          channelId,
          triggerMessageId,
          sourceMessageId,
          sourceAgentId,
          targetAgentId: mention.agentId,
          executionKind,
          depth,
        });
        taskQueue.push({
          triggerMessageId,
          sourceMessageId,
          sourceAgentId,
          agentId: mention.agentId,
          sourceContent,
          resultMessageKind,
          executionKind,
          depth,
          jobId: job.id,
        });
        queuedAgentIds.add(mention.agentId);
        this.channelMemberStateRepository.upsertChannelMemberState({
          channelId,
          agentId: mention.agentId,
          lastReadMessageId: sourceMessageId,
          lastSeenAt: new Date().toISOString(),
        });
      }
    };

    enqueueMentions(mentions, userMessage.id, userMessage.id, null, content, "result", "mention", 0);

    const recordSkippedTasks = (tasks: MentionTask[]): void => {
      for (const task of tasks) {
        skippedTasksByJobId.set(task.jobId, task);
      }
    };

    while (taskQueue.length > 0 && results.length < ChannelMessageService.MAX_MENTION_EXECUTIONS) {
      const currentBatch = taskQueue.splice(0, taskQueue.length);
      const availableSlots = ChannelMessageService.MAX_MENTION_EXECUTIONS - results.length;
      const runnableBatch = currentBatch.slice(0, availableSlots);
      const overflowBatch = currentBatch.slice(availableSlots);
      for (const task of currentBatch) {
        queuedAgentIds.delete(task.agentId);
      }
      recordSkippedTasks(overflowBatch);

      if (runnableBatch.length === 0) {
        break;
      }

      const batchResults = await Promise.all(
        runnableBatch.map(async (task) => {
          const targetAgent = memberById.get(task.agentId);
          if (!targetAgent) {
            this.channelExecutionRepository.markExecutionJobFinished(
              task.jobId,
              "skipped",
              "target agent missing",
            );
            const missingReply = "멘션 대상 에이전트를 찾지 못했습니다.";
            const systemMessage = this.appendChannelMessageAndNotify(
              channelId,
              "system",
              null,
              missingReply,
              "result",
            );
            return {
              task,
              result: {
                agentId: task.agentId,
                agentName: "unknown",
                ok: false,
                reply: missingReply,
                message: systemMessage,
              },
            };
          }

          this.channelExecutionRepository.markExecutionJobRunning(task.jobId);
          return {
            task,
            result: await this.executeMentionedAgent(
              channelId,
              channel.name,
              channel.description,
              targetAgent,
              members,
              task.sourceAgentId,
              task.sourceMessageId,
              task.sourceContent,
              task.resultMessageKind,
              task.jobId,
            ),
          };
        }),
      );

      results.push(...batchResults.map((entry) => entry.result));

      for (const { task, result: batchResult } of batchResults) {
        if (!batchResult.ok || batchResult.message.senderType !== "agent") {
          continue;
        }

        const chainedMentions = extractMentionedAgents(batchResult.reply, members).filter(
          (mention) => mention.agentId !== batchResult.agentId,
        );
        if (chainedMentions.length === 0) {
          continue;
        }

        this.channelMessageRepository.addChannelMessageMentions(batchResult.message.id, chainedMentions);
        enqueueMentions(
          chainedMentions,
          userMessage.id,
          batchResult.message.id,
          batchResult.agentId,
          batchResult.reply,
          "remention",
          "remention",
          task.depth + 1,
        );
      }
    }

    if (taskQueue.length > 0) {
      recordSkippedTasks(taskQueue.splice(0, taskQueue.length));
    }

    if (skippedTasksByJobId.size > 0) {
      const skippedTasks = [...skippedTasksByJobId.values()];
      const errorText = `mention execution budget exhausted (${ChannelMessageService.MAX_MENTION_EXECUTIONS})`;
      for (const task of skippedTasks) {
        queuedAgentIds.delete(task.agentId);
        this.channelExecutionRepository.markExecutionJobFinished(task.jobId, "skipped", errorText);
      }
      this.appendChannelMessageAndNotify(
        channelId,
        "system",
        null,
        this.buildMentionExecutionBudgetMessage(skippedTasks, memberById),
        "result",
      );
    }

    return {
      ok: true as const,
      executionMode: "mention_only" as const,
      message: userMessage,
      mentions: mentionRecords,
      results,
    };
  }

  private appendChannelMessageAndNotify(
    channelId: string,
    senderType: "user" | "agent" | "system",
    senderId: string | null,
    content: string,
    messageKind: ChannelMessageKind,
  ): ChannelMessage {
    const message = this.channelMessageRepository.appendChannelMessage(
      channelId,
      senderType,
      senderId,
      content,
      messageKind,
    );
    this.eventBus.broadcastChannelMessage(channelId, message.id);
    return message;
  }

  private updateChannelMessageAndNotify(
    messageId: number,
    senderType: "user" | "agent" | "system",
    senderId: string | null,
    content: string,
    messageKind: ChannelMessageKind,
  ): ChannelMessage | null {
    const message = this.channelMessageRepository.updateChannelMessage(
      messageId,
      senderType,
      senderId,
      content,
      messageKind,
    );
    if (!message) {
      return null;
    }
    this.eventBus.broadcastChannelMessage(message.channelId, message.id);
    return message;
  }

  private async executeMentionedAgent(
    channelId: string,
    channelName: string,
    channelDescription: string,
    targetAgent: Agent,
    members: Agent[],
    sourceAgentId: string | null,
    sourceMessageId: number,
    triggerContent: string,
    resultMessageKind: ChannelMessageKind,
    jobId: number,
  ): Promise<ChannelExecutionResult> {
    try {
      return await this.lockManager.withAgentLock(targetAgent.id, async () => {
        const selectedModel = this.appSettingsService.getSelectedModel();
        const prompt = this.buildChannelExecutionPrompt({
          channelId,
          channelName,
          channelDescription,
          targetAgent,
          members,
          sourceAgentId,
          sourceMessageId,
          fallbackTriggerContent: triggerContent,
        });
        let lastStreamMessageId: number | null = null;
        let lastStreamContent = "";
        const codexResult = await runCodex({
          prompt,
          systemPrompt: buildMemberExecutionSystemPrompt(targetAgent, "channel"),
          model: selectedModel,
          sessionId: targetAgent.sessionId,
          cwd: this.workspaceDir,
          timeoutMs: 120_000,
          onStream: (event) => {
            if (!isAgentMessageStreamType(event.rawType)) {
              return;
            }
            const streamedContent = event.content.trim();
            if (!streamedContent) {
              return;
            }
            if (lastStreamMessageId === null) {
              const message = this.appendChannelMessageAndNotify(
                channelId,
                "agent",
                targetAgent.id,
                streamedContent,
                "progress",
              );
              lastStreamMessageId = message.id;
              lastStreamContent = streamedContent;
              return;
            }
            this.updateChannelMessageAndNotify(
              lastStreamMessageId,
              "agent",
              targetAgent.id,
              streamedContent,
              "progress",
            );
            lastStreamContent = streamedContent;
          },
        });

        if (codexResult.sessionId && codexResult.sessionId !== targetAgent.sessionId) {
          this.agentRepository.updateAgentSession(targetAgent.id, codexResult.sessionId);
        }

        const normalizedReply = codexResult.reply.trim();
        const hasRenderableReply = normalizedReply.length > 0 || lastStreamContent.length > 0;
        const executionOk = codexResult.ok && hasRenderableReply;
        const replyText = executionOk
          ? normalizedReply || lastStreamContent
          : [
              "Codex 실행 실패:",
              codexResult.error ?? (codexResult.ok ? "empty response from codex" : "unknown error"),
              codexResult.reply ? `partial: ${codexResult.reply}` : "",
            ]
              .filter((line) => line.length > 0)
              .join("\n");

        let message: ChannelMessage | null = null;
        if (lastStreamMessageId !== null) {
          message = this.updateChannelMessageAndNotify(
            lastStreamMessageId,
            executionOk ? "agent" : "system",
            executionOk ? targetAgent.id : null,
            replyText,
            resultMessageKind,
          );
        }
        if (!message) {
          message = this.appendChannelMessageAndNotify(
            channelId,
            executionOk ? "agent" : "system",
            executionOk ? targetAgent.id : null,
            replyText,
            resultMessageKind,
          );
        }

        this.channelExecutionRepository.markExecutionJobFinished(
          jobId,
          executionOk ? "succeeded" : "failed",
          executionOk ? null : replyText,
        );
        this.channelMemberStateRepository.upsertChannelMemberState({
          channelId,
          agentId: targetAgent.id,
          lastReadMessageId: message.id,
          lastSeenAt: new Date().toISOString(),
        });

        return {
          agentId: targetAgent.id,
          agentName: targetAgent.name,
          ok: executionOk,
          reply: replyText,
          sessionId: codexResult.sessionId,
          message,
        };
      });
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "unknown error";
      const fallbackText = `에이전트 실행 중 예외 발생 (@${targetAgent.name}): ${messageText}`;
      const systemMessage = this.appendChannelMessageAndNotify(
        channelId,
        "system",
        null,
        fallbackText,
        "result",
      );
      this.channelExecutionRepository.markExecutionJobFinished(jobId, "failed", fallbackText);
      return {
        agentId: targetAgent.id,
        agentName: targetAgent.name,
        ok: false,
        reply: fallbackText,
        message: systemMessage,
      };
    }
  }

  private buildChannelExecutionPrompt(input: {
    channelId: string;
    channelName: string;
    channelDescription: string;
    targetAgent: Agent;
    members: Agent[];
    sourceAgentId: string | null;
    sourceMessageId: number;
    fallbackTriggerContent: string;
  }): string {
    const memberNameById = new Map(input.members.map((member) => [member.id, member.name]));
    const recentMessages = this.channelMessageRepository
      .listRecentChannelMessages(
        input.channelId,
        input.sourceMessageId,
        ChannelMessageService.CHANNEL_PROMPT_RECENT_MESSAGE_LIMIT,
      )
      .filter((message) => message.messageKind !== "progress");

    const timeline = recentMessages.map<ChannelPromptTimelineEntry>((message) => ({
      senderLabel: this.resolveChannelSenderLabel(message.senderType, message.senderId, memberNameById),
      senderType: message.senderType,
      messageKind: message.messageKind,
      content: message.content,
    }));

    const triggerMessage =
      timeline[timeline.length - 1] ??
      ({
        senderLabel: "Unknown",
        senderType: "user",
        messageKind: "general",
        content: input.fallbackTriggerContent,
      } satisfies ChannelPromptTimelineEntry);

    return buildChannelPrompt({
      channelName: input.channelName,
      channelDescription: input.channelDescription,
      targetAgentName: input.targetAgent.name,
      taskRequesterName: input.sourceAgentId ? memberNameById.get(input.sourceAgentId) ?? input.sourceAgentId : null,
      members: input.members.map((member) => ({
        name: member.name,
        role: member.role,
        roleProfile: member.roleProfile,
      })),
      recentMessages: timeline,
      triggerMessage,
    });
  }

  private resolveChannelSenderLabel(
    senderType: "user" | "agent" | "system",
    senderId: string | null,
    memberNameById: Map<string, string>,
  ): string {
    if (senderType === "user") {
      return "User";
    }
    if (senderType === "system") {
      return "System";
    }
    return senderId ? memberNameById.get(senderId) ?? senderId : "Unknown agent";
  }

  private buildMentionExecutionBudgetMessage(
    skippedTasks: Array<{ agentId: string }>,
    memberById: Map<string, Agent>,
  ): string {
    const targetNames = [...new Set(skippedTasks.map((task) => memberById.get(task.agentId)?.name ?? task.agentId))];
    const targetSuffix =
      targetNames.length > 0 ? ` 대상: ${targetNames.slice(0, 5).join(", ")}${targetNames.length > 5 ? " 외" : ""}.` : "";
    return `멘션 실행 한도(${ChannelMessageService.MAX_MENTION_EXECUTIONS}건)에 도달하여 남은 후속 멘션 ${skippedTasks.length}건을 실행하지 않았습니다.${targetSuffix}`;
  }
}
