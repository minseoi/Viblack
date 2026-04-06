import fs from "node:fs";
import path from "node:path";
import { runCodex } from "../codex";
import { ChannelEventBus } from "../events/channel-event-bus";
import { getChannelRuntimeSessionScope } from "../runtime-session-scope";
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
  isCompletedAgentMessageStreamEvent,
} from "./agent-message-stream";
import {
  buildChannelPrompt,
  buildMemberExecutionSystemPrompt,
  isAgentMessageStreamType,
  type ChannelPromptTimelineEntry,
} from "./member-prompt";
import { parseChannelActions } from "./channel-action-protocol";
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
  private static readonly INTENT_ONLY_PATTERNS = [
    /구현하겠습니다/,
    /개발하겠습니다/,
    /작성하겠습니다/,
    /만들겠습니다/,
    /추가하겠습니다/,
    /적용하겠습니다/,
    /진행하겠습니다/,
    /하나만 추가\/생성합니다/,
    /바로 구현하겠습니다/,
    /이렇게 구현하겠습니다/,
    /i will implement/i,
    /i'll implement/i,
    /will add/i,
    /will create/i,
  ] as const;

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

    if (input.isCoordinator === true) {
      const state = this.assignChannelCoordinator({
        channelId: input.channelId,
        agentId: input.agentId,
        lastReadMessageId: input.lastReadMessageId,
        lastSeenAt: new Date().toISOString(),
      });
      return { state };
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

    if (mentions.length > 0) {
      this.assignChannelCoordinator({
        channelId,
        agentId: mentions[0].agentId,
        lastReadMessageId: userMessage.id,
        lastSeenAt: userMessage.createdAt,
      });
    } else {
      this.ensureChannelCoordinator(channelId);
    }

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

        const coordinator = this.resolveChannelCoordinator(channelId, members);
        const chainedMentions = this.resolveChainedMentions({
          reply: batchResult.reply,
          members,
          replyingAgentId: batchResult.agentId,
          sourceAgentId: task.sourceAgentId,
          coordinatorAgentId: coordinator?.id ?? null,
        });
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

  ensureChannelCoordinator(channelId: string, preferredAgentId?: string | null): string | null {
    const members = this.channelMemberRepository.listChannelMembers(channelId);
    if (members.length === 0) {
      return null;
    }

    const states = this.channelMemberStateRepository.listChannelMemberStates(channelId);
    const stateByAgentId = new Map(states.map((state) => [state.agentId, state]));
    const memberIds = new Set(members.map((member) => member.agentId));
    const activeCoordinators = states.filter((state) => state.isCoordinator && memberIds.has(state.agentId));

    if (preferredAgentId && memberIds.has(preferredAgentId)) {
      return this.assignChannelCoordinator({ channelId, agentId: preferredAgentId }).agentId;
    }

    if (activeCoordinators.length === 1) {
      const currentCoordinatorId = activeCoordinators[0]?.agentId ?? null;
      if (currentCoordinatorId) {
        return currentCoordinatorId;
      }
    }

    const fallbackAgentId = members[0]?.agentId ?? null;
    if (!fallbackAgentId) {
      return null;
    }

    if (
      activeCoordinators.length === 0 &&
      stateByAgentId.get(fallbackAgentId)?.isCoordinator
    ) {
      return fallbackAgentId;
    }

    return this.assignChannelCoordinator({ channelId, agentId: fallbackAgentId }).agentId;
  }

  private assignChannelCoordinator(input: {
    channelId: string;
    agentId: string;
    lastReadMessageId?: number;
    lastSeenAt?: string | null;
  }) {
    const members = this.channelMemberRepository.listChannelMembers(input.channelId);
    const memberIds = new Set(members.map((member) => member.agentId));
    if (!memberIds.has(input.agentId)) {
      throw new Error("channel member not found");
    }

    for (const member of members) {
      this.channelMemberStateRepository.upsertChannelMemberState({
        channelId: input.channelId,
        agentId: member.agentId,
        lastReadMessageId:
          member.agentId === input.agentId ? input.lastReadMessageId : undefined,
        lastSeenAt: member.agentId === input.agentId ? input.lastSeenAt : undefined,
        isCoordinator: member.agentId === input.agentId,
      });
    }

    const state = this.channelMemberStateRepository.getChannelMemberState(input.channelId, input.agentId);
    if (!state) {
      throw new Error("failed to assign channel coordinator");
    }
    return state;
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
        const runtimeSessionScope = getChannelRuntimeSessionScope(channelId);
        const runtimeSessionId = this.agentRepository.getRuntimeSession(targetAgent.id, runtimeSessionScope);
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
        let activeStreamMessageId: number | null = null;
        let lastCompletedStreamMessageId: number | null = null;
        let lastCompletedStreamContent = "";
        let lastStreamContent = "";
        const codexResult = await runCodex({
          prompt,
          systemPrompt: buildMemberExecutionSystemPrompt(targetAgent, "channel"),
          model: selectedModel,
          sessionId: runtimeSessionId,
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
            if (isCompletedAgentMessageStreamEvent(event.raw)) {
              if (activeStreamMessageId !== null) {
                this.updateChannelMessageAndNotify(
                  activeStreamMessageId,
                  "agent",
                  targetAgent.id,
                  streamedContent,
                  "progress",
                );
                lastCompletedStreamMessageId = activeStreamMessageId;
              } else {
                const message = this.appendChannelMessageAndNotify(
                  channelId,
                  "agent",
                  targetAgent.id,
                  streamedContent,
                  "progress",
                );
                lastCompletedStreamMessageId = message.id;
              }
              lastCompletedStreamContent = streamedContent;
              activeStreamMessageId = null;
              lastStreamContent = streamedContent;
              return;
            }
            if (activeStreamMessageId === null) {
              const message = this.appendChannelMessageAndNotify(
                channelId,
                "agent",
                targetAgent.id,
                streamedContent,
                "progress",
              );
              activeStreamMessageId = message.id;
              lastStreamContent = streamedContent;
              return;
            }
            this.updateChannelMessageAndNotify(
              activeStreamMessageId,
              "agent",
              targetAgent.id,
              streamedContent,
              "progress",
            );
            lastStreamContent = streamedContent;
          },
        });

        if (codexResult.sessionId && codexResult.sessionId !== runtimeSessionId) {
          this.agentRepository.upsertRuntimeSession(targetAgent.id, runtimeSessionScope, codexResult.sessionId);
        }

        const normalizedReply = codexResult.reply.trim();
        const hasRenderableReply = normalizedReply.length > 0 || lastStreamContent.length > 0;
        const initialExecutionOk = codexResult.ok && hasRenderableReply;
        const initialReplyText = initialExecutionOk
          ? normalizedReply || lastStreamContent
          : [
              "Codex 실행 실패:",
              codexResult.error ?? (codexResult.ok ? "empty response from codex" : "unknown error"),
              codexResult.reply ? `partial: ${codexResult.reply}` : "",
            ]
              .filter((line) => line.length > 0)
              .join("\n");
        const completionValidation = initialExecutionOk
          ? this.validateChannelCompletionReply({
              channelId,
              targetAgent,
              members,
              sourceAgentId,
              triggerContent,
              replyText: initialReplyText,
            })
          : { ok: false as const, errorText: initialReplyText };
        const executionOk = initialExecutionOk && completionValidation.ok;
        const replyText =
          executionOk || completionValidation.ok
            ? initialReplyText
            : completionValidation.errorText ?? initialReplyText;

        let message: ChannelMessage | null = null;
        if (executionOk && activeStreamMessageId !== null) {
          message = this.updateChannelMessageAndNotify(
            activeStreamMessageId,
            "agent",
            targetAgent.id,
            replyText,
            resultMessageKind,
          );
        } else if (
          executionOk &&
          lastCompletedStreamMessageId !== null &&
          replyText === lastCompletedStreamContent
        ) {
          message = this.updateChannelMessageAndNotify(
            lastCompletedStreamMessageId,
            "agent",
            targetAgent.id,
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
    const coordinator = this.resolveChannelCoordinator(input.channelId, input.members);
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

    const requiresArtifactReport = this.requiresArtifactReport({
      targetAgent: input.targetAgent,
      sourceAgentId: input.sourceAgentId,
      triggerContent: triggerMessage.content,
    });

    return buildChannelPrompt({
      channelName: input.channelName,
      channelDescription: input.channelDescription,
      workspaceRoot: this.workspaceDir,
      targetAgentName: input.targetAgent.name,
      coordinatorName: coordinator?.name ?? null,
      targetAgentMode: coordinator?.id === input.targetAgent.id ? "coordinator" : "worker",
      taskRequesterName: input.sourceAgentId ? memberNameById.get(input.sourceAgentId) ?? input.sourceAgentId : null,
      requiresArtifactReport,
      members: input.members.map((member) => ({
        name: member.name,
        role: member.role,
        roleProfile: member.roleProfile,
      })),
      recentMessages: timeline,
      triggerMessage,
    });
  }

  private validateChannelCompletionReply(input: {
    channelId: string;
    targetAgent: Agent;
    members: Agent[];
    sourceAgentId: string | null;
    triggerContent: string;
    replyText: string;
  }): { ok: true } | { ok: false; errorText: string } {
    if (
      !this.requiresArtifactReport({
        targetAgent: input.targetAgent,
        sourceAgentId: input.sourceAgentId,
        triggerContent: input.triggerContent,
      })
    ) {
      return { ok: true };
    }

    const actions = parseChannelActions(input.replyText);
    const reportAction = actions.find((action) => action.type === "report");
    const artifactPaths = this.collectArtifactPaths({
      replyText: input.replyText,
      actions,
    });
    const existingArtifactPath = artifactPaths.find((candidatePath) =>
      this.artifactPathExists(candidatePath),
    );
    const intentOnly = this.isIntentOnlyImplementationReply(input.replyText);
    const problems: string[] = [];

    if (input.sourceAgentId && !reportAction) {
      problems.push("코드 작업 worker 응답에는 type=report action이 필요합니다.");
    }
    if (!existingArtifactPath) {
      problems.push("실제로 존재하는 산출물 파일 경로가 필요합니다.");
    }
    if (intentOnly && !existingArtifactPath) {
      problems.push("구현 의도만 말하고 실제 완료 보고를 하지 않았습니다.");
    }

    if (problems.length === 0) {
      return { ok: true };
    }

    return {
      ok: false,
      errorText: [
        "채널 코드 작업 미완료:",
        ...problems.map((problem) => `- ${problem}`),
        `partial: ${input.replyText}`,
      ].join("\n"),
    };
  }

  private requiresArtifactReport(input: {
    targetAgent: Agent;
    sourceAgentId: string | null;
    triggerContent: string;
  }): boolean {
    if (!input.sourceAgentId) {
      return false;
    }

    const roleText = `${input.targetAgent.role} ${input.targetAgent.roleProfile ?? ""}`.toLowerCase();
    const roleLooksCodeRelated = ["프로그래머", "개발", "programmer", "developer", "coder", "engineer"].some(
      (needle) => roleText.includes(needle.toLowerCase()),
    );
    return roleLooksCodeRelated;
  }

  private collectArtifactPaths(input: {
    replyText: string;
    actions: ReturnType<typeof parseChannelActions>;
  }): string[] {
    const candidates = new Set<string>();

    for (const action of input.actions) {
      if (action.artifactPath?.trim()) {
        candidates.add(action.artifactPath.trim());
      }
    }

    const absolutePathMatches =
      input.replyText.match(/(?:[A-Za-z]:\\|\/)[^\s`"'<>]+/g) ?? [];
    for (const candidate of absolutePathMatches) {
      candidates.add(candidate.replace(/[),.:;!?]+$/g, ""));
    }

    const relativePathMatches =
      input.replyText.match(/\b(?:src|tests|codexdocs|dist|tmp|temp|scripts)\/[^\s`"'<>]+\.[A-Za-z0-9]+\b/g) ?? [];
    for (const candidate of relativePathMatches) {
      candidates.add(candidate.replace(/[),.:;!?]+$/g, ""));
    }

    return [...candidates];
  }

  private artifactPathExists(candidatePath: string): boolean {
    const trimmed = candidatePath.trim();
    if (!trimmed) {
      return false;
    }

    const resolvedPath = path.isAbsolute(trimmed)
      ? trimmed
      : path.resolve(this.workspaceDir, trimmed);
    try {
      return fs.existsSync(resolvedPath);
    } catch {
      return false;
    }
  }

  private isIntentOnlyImplementationReply(replyText: string): boolean {
    const normalized = replyText.replace(/\s+/g, " ").trim();
    if (!normalized) {
      return false;
    }

    return ChannelMessageService.INTENT_ONLY_PATTERNS.some((pattern) => pattern.test(normalized));
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

  private resolveChannelCoordinator(channelId: string, members: Agent[]): Agent | null {
    const coordinatorState = this.channelMemberStateRepository
      .listChannelMemberStates(channelId)
      .find((state) => state.isCoordinator);
    if (!coordinatorState) {
      return null;
    }
    return members.find((member) => member.id === coordinatorState.agentId) ?? null;
  }

  private resolveChainedMentions(input: {
    reply: string;
    members: Agent[];
    replyingAgentId: string;
    sourceAgentId: string | null;
    coordinatorAgentId: string | null;
  }): MentionedAgent[] {
    const actions = parseChannelActions(input.reply);
    if (actions.length === 0) {
      return extractMentionedAgents(input.reply, input.members).filter(
        (mention) => mention.agentId !== input.replyingAgentId,
      );
    }

    const mentions: MentionedAgent[] = [];
    const seen = new Set<string>();
    const pushMention = (mention: MentionedAgent | null): void => {
      if (!mention || mention.agentId === input.replyingAgentId || seen.has(mention.agentId)) {
        return;
      }
      seen.add(mention.agentId);
      mentions.push(mention);
    };

    for (const action of actions) {
      if (action.type === "delegate") {
        pushMention(this.findMemberMentionByName(action.targetName, input.members));
        continue;
      }

      if (action.type === "report") {
        pushMention(
          this.findMemberMentionByName(action.targetName, input.members) ??
            this.findMemberMentionById(input.sourceAgentId, input.members) ??
            this.findMemberMentionById(input.coordinatorAgentId, input.members),
        );
      }
    }

    return mentions;
  }

  private findMemberMentionByName(
    targetName: string | null | undefined,
    members: Agent[],
  ): MentionedAgent | null {
    if (!targetName) {
      return null;
    }

    const normalizedTargetName = targetName.trim().toLowerCase();
    if (!normalizedTargetName) {
      return null;
    }

    const member = members.find((candidate) => candidate.name.trim().toLowerCase() === normalizedTargetName);
    return member ? { agentId: member.id, mentionName: member.name } : null;
  }

  private findMemberMentionById(agentId: string | null | undefined, members: Agent[]): MentionedAgent | null {
    if (!agentId) {
      return null;
    }
    const member = members.find((candidate) => candidate.id === agentId);
    return member ? { agentId: member.id, mentionName: member.name } : null;
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
