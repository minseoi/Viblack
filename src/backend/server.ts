import http from "node:http";
import express from "express";
import { checkCodexAvailability, runCodex } from "./codex";
import { DuplicateAgentNameError, DuplicateChannelNameError, ViblackDb } from "./db";
import type { Agent, ChannelMessageKind } from "./types";

interface StartServerOptions {
  dbPath: string;
  workspaceDir: string;
  preferredPort?: number;
}

export interface StartedServer {
  port: number;
  close: () => Promise<void>;
}

export async function startServer(options: StartServerOptions): Promise<StartedServer> {
  const app = express();
  const db = new ViblackDb(options.dbPath);
  const locks = new Map<string, Promise<unknown>>();
  const channelEventClients = new Set<http.ServerResponse>();

  const withAgentLock = async <T>(agentId: string, task: () => Promise<T>): Promise<T> => {
    const previous = locks.get(agentId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => task()) as Promise<T>;
    locks.set(agentId, next);
    next.finally(() => {
      if (locks.get(agentId) === next) {
        locks.delete(agentId);
      }
    });
    return next;
  };

  app.use(express.json({ limit: "1mb" }));

  const writeSseEvent = (res: http.ServerResponse, event: string, payload: unknown): void => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const broadcastChannelMessageEvent = (channelId: string, messageId: number): void => {
    if (channelEventClients.size === 0) {
      return;
    }

    const payload = { channelId, messageId };
    for (const client of Array.from(channelEventClients)) {
      try {
        writeSseEvent(client, "channel_message", payload);
      } catch {
        channelEventClients.delete(client);
      }
    }
  };

  const appendChannelMessageAndNotify = (
    channelId: string,
    senderType: "user" | "agent" | "system",
    senderId: string | null,
    content: string,
    messageKind: ChannelMessageKind,
  ) => {
    const message = db.appendChannelMessage(channelId, senderType, senderId, content, messageKind);
    broadcastChannelMessageEvent(channelId, message.id);
    return message;
  };

  const sanitizeText = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";

  const allowedChannelMessageKinds: ReadonlySet<ChannelMessageKind> = new Set([
    "request",
    "progress",
    "result",
    "remention",
    "general",
  ]);

  const sanitizeChannelMessageKind = (value: unknown): ChannelMessageKind => {
    if (typeof value !== "string") {
      return "general";
    }
    return allowedChannelMessageKinds.has(value as ChannelMessageKind)
      ? (value as ChannelMessageKind)
      : "general";
  };

  const isMentionBoundaryChar = (char: string | undefined): boolean =>
    !char || /[\s.,!?;:()[\]{}<>"'`]/.test(char);

  const extractMentionedAgents = (
    content: string,
    candidateAgents: Agent[],
  ): Array<{ agentId: string; mentionName: string }> => {
    const normalizedContent = content.toLowerCase();
    const candidates = [...candidateAgents]
      .map((agent) => ({ id: agent.id, name: agent.name.trim() }))
      .filter((agent) => agent.name.length > 0)
      .sort((a, b) => b.name.length - a.name.length);

    const seenAgentIds = new Set<string>();
    const mentions: Array<{ agentId: string; mentionName: string }> = [];

    for (const candidate of candidates) {
      const normalizedName = candidate.name.toLowerCase();
      const mentionTokens = [`@${normalizedName}`, `@{${normalizedName}}`];

      for (const token of mentionTokens) {
        let index = normalizedContent.indexOf(token);
        while (index >= 0) {
          const before = index > 0 ? normalizedContent[index - 1] : undefined;
          const afterIndex = index + token.length;
          const after =
            afterIndex < normalizedContent.length ? normalizedContent[afterIndex] : undefined;

          if (isMentionBoundaryChar(before) && isMentionBoundaryChar(after)) {
            if (!seenAgentIds.has(candidate.id)) {
              seenAgentIds.add(candidate.id);
              mentions.push({ agentId: candidate.id, mentionName: candidate.name });
            }
            break;
          }
          index = normalizedContent.indexOf(token, index + 1);
        }
        if (seenAgentIds.has(candidate.id)) {
          break;
        }
      }
    }
    return mentions;
  };

  const buildChannelPrompt = (channelName: string, rawMessage: string): string =>
    [
      `채널 이름: #${channelName}`,
      "아래 채널 메시지에 응답하세요. 필요하면 가정하지 말고 확인 질문을 포함하세요.",
      "",
      rawMessage,
    ].join("\n");

  const unwrapCodeFence = (value: string): string => {
    const trimmed = value.trim();
    const match = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```$/);
    return match ? match[1].trim() : trimmed;
  };

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/system/codex-status", async (_req, res) => {
    const status = await checkCodexAvailability(options.workspaceDir);
    res.json(status);
  });

  app.post("/api/system/generate-system-prompt", async (req, res) => {
    const role = sanitizeText(req.body?.role);
    const name = sanitizeText(req.body?.name);

    if (!role) {
      res.status(400).json({ error: "role is required" });
      return;
    }

    try {
      const status = await checkCodexAvailability(options.workspaceDir);
      if (!status.ok) {
        res.status(503).json({ error: status.error ?? "codex unavailable" });
        return;
      }

      const generationPrompt = [
        "다음 정보를 바탕으로 AI 에이전트의 SYSTEM PROMPT를 작성하세요.",
        `- 에이전트 이름: ${name || "(미지정)"}`,
        `- 에이전트 역할: ${role}`,
        "",
        "요구사항:",
        "1) 출력은 '시스템 프롬프트 본문 텍스트'만 반환 (설명/코드펜스/머리말 금지)",
        "2) 한국어 기본 응답 원칙 포함, 사용자가 명시하면 해당 언어로 응답 허용",
        "3) 역할 정체성, 작업 방식, 정확성/불확실성 처리, 보안/안전 경계 포함",
        "4) 과장/추측 금지 및 모호한 요청 시 확인 질문 원칙 포함",
        "5) 실무에서 바로 붙여넣어 쓸 수 있게 간결하고 구체적으로 작성",
      ].join("\n");

      const codexResult = await runCodex({
        prompt: generationPrompt,
        systemPrompt:
          "You are an expert prompt engineer. Produce only the final system prompt text that the user can paste directly.",
        sessionId: null,
        cwd: options.workspaceDir,
        timeoutMs: 90_000,
      });

      if (!codexResult.ok) {
        const details = [codexResult.error, codexResult.reply]
          .filter((item): item is string => Boolean(item && item.trim()))
          .join("\n");
        res.status(502).json({ error: details || "system prompt generation failed" });
        return;
      }

      const systemPrompt = unwrapCodeFence(codexResult.reply);
      if (!systemPrompt) {
        res.status(502).json({ error: "empty system prompt from codex" });
        return;
      }

      res.json({ systemPrompt });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/agents", (_req, res) => {
    const agents = db.listAgents();
    res.json({ agents });
  });

  app.get("/api/channels", (_req, res) => {
    const channels = db.listChannels(false);
    res.json({ channels });
  });

  app.get("/api/channels/events", (req, res) => {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    channelEventClients.add(res);
    writeSseEvent(res, "ready", { ok: true });

    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        channelEventClients.delete(res);
        clearInterval(heartbeat);
      }
    }, 20_000);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      channelEventClients.delete(res);
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
  });

  app.post("/api/channels", (req, res) => {
    const name = sanitizeText(req.body?.name);
    const description = sanitizeText(req.body?.description);
    if (!name || !description) {
      res.status(400).json({ error: "name and description are required" });
      return;
    }

    try {
      const channel = db.createChannel(name, description);
      res.status(201).json({ channel });
    } catch (err) {
      if (err instanceof DuplicateChannelNameError) {
        res.status(409).json({ error: "channel name already exists" });
        return;
      }
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.patch("/api/channels/:channelId", (req, res) => {
    const { channelId } = req.params;
    const name = sanitizeText(req.body?.name);
    const description = sanitizeText(req.body?.description);
    if (!name || !description) {
      res.status(400).json({ error: "name and description are required" });
      return;
    }

    try {
      const channel = db.updateChannel(channelId, name, description);
      if (!channel) {
        res.status(404).json({ error: "channel not found" });
        return;
      }
      res.json({ channel });
    } catch (err) {
      if (err instanceof DuplicateChannelNameError) {
        res.status(409).json({ error: "channel name already exists" });
        return;
      }
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/channels/:channelId", (req, res) => {
    const { channelId } = req.params;
    const archived = db.archiveChannel(channelId);
    if (!archived) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/channels/:channelId/members", (req, res) => {
    const { channelId } = req.params;
    const channel = db.getChannel(channelId);
    if (!channel) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    const members = db.listChannelMemberAgents(channelId);
    res.json({ channel, members });
  });

  app.post("/api/channels/:channelId/members", (req, res) => {
    const { channelId } = req.params;
    const agentId = sanitizeText(req.body?.agentId);
    if (!agentId) {
      res.status(400).json({ error: "agentId is required" });
      return;
    }

    const channel = db.getChannel(channelId);
    if (!channel) {
      res.status(404).json({ error: "channel not found" });
      return;
    }

    const agent = db.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: "agent not found" });
      return;
    }

    const member = db.addChannelMember(channelId, agentId);
    if (!member) {
      res.status(500).json({ error: "failed to add channel member" });
      return;
    }
    const members = db.listChannelMemberAgents(channelId);
    res.status(201).json({ member, members });
  });

  app.delete("/api/channels/:channelId/members/:agentId", (req, res) => {
    const { channelId, agentId } = req.params;
    const channel = db.getChannel(channelId);
    if (!channel) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    const removed = db.removeChannelMember(channelId, agentId);
    if (!removed) {
      res.status(404).json({ error: "channel member not found" });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/channels/:channelId/messages", (req, res) => {
    const { channelId } = req.params;
    const channel = db.getChannel(channelId);
    if (!channel) {
      res.status(404).json({ error: "channel not found" });
      return;
    }

    const afterRaw = req.query.after;
    const afterValue = Array.isArray(afterRaw) ? afterRaw[0] : afterRaw;
    const parsedAfter =
      typeof afterValue === "string" ? Number.parseInt(afterValue, 10) : Number.NaN;
    const afterMessageId =
      Number.isInteger(parsedAfter) && parsedAfter > 0 ? parsedAfter : undefined;

    const members = db.listChannelMemberAgents(channelId);
    const messages = db.listChannelMessages(channelId, afterMessageId);
    const mentionsByMessage: Record<number, Array<{ agentId: string; mentionName: string }>> = {};
    for (const message of messages) {
      mentionsByMessage[message.id] = db
        .listChannelMessageMentions(message.id)
        .map((mention) => ({ agentId: mention.agentId, mentionName: mention.mentionName }));
    }
    res.json({ channel, members, messages, mentionsByMessage });
  });

  app.post("/api/channels/:channelId/messages", async (req, res) => {
    const MAX_MENTION_CHAIN_DEPTH = 4;
    const MAX_MENTION_EXECUTIONS = 12;
    const { channelId } = req.params;
    const content = sanitizeText(req.body?.content);
    const messageKind = sanitizeChannelMessageKind(req.body?.messageKind);
    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const channel = db.getChannel(channelId);
    if (!channel) {
      res.status(404).json({ error: "channel not found" });
      return;
    }
    if (channel.archivedAt) {
      res.status(409).json({ error: "channel is archived" });
      return;
    }

    const members = db.listChannelMemberAgents(channelId);
    const memberById = new Map<string, Agent>(members.map((member) => [member.id, member]));

    const executeMentionedAgent = async (
      targetAgent: Agent,
      triggerContent: string,
      resultMessageKind: ChannelMessageKind,
    ) => {
      try {
        return await withAgentLock(targetAgent.id, async () => {
          const codexResult = await runCodex({
            prompt: buildChannelPrompt(channel.name, triggerContent),
            systemPrompt: targetAgent.systemPrompt,
            sessionId: targetAgent.sessionId,
            cwd: options.workspaceDir,
            timeoutMs: 120_000,
          });

          if (codexResult.sessionId && codexResult.sessionId !== targetAgent.sessionId) {
            db.updateAgentSession(targetAgent.id, codexResult.sessionId);
          }

          const replyText = codexResult.ok
            ? codexResult.reply
            : [
                "Codex 실행 실패:",
                codexResult.error ?? "unknown error",
                codexResult.reply ? `partial: ${codexResult.reply}` : "",
              ]
                .filter((line) => line.length > 0)
                .join("\n");

          const message = appendChannelMessageAndNotify(
            channelId,
            codexResult.ok ? "agent" : "system",
            codexResult.ok ? targetAgent.id : null,
            replyText,
            resultMessageKind,
          );

          return {
            agentId: targetAgent.id,
            agentName: targetAgent.name,
            ok: codexResult.ok,
            reply: replyText,
            sessionId: codexResult.sessionId,
            message,
          };
        });
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "unknown error";
        const fallbackText = `에이전트 실행 중 예외 발생 (@${targetAgent.name}): ${messageText}`;
        const systemMessage = appendChannelMessageAndNotify(
          channelId,
          "system",
          null,
          fallbackText,
          "result",
        );
        return {
          agentId: targetAgent.id,
          agentName: targetAgent.name,
          ok: false,
          reply: fallbackText,
          message: systemMessage,
        };
      }
    };

    const userMessage = appendChannelMessageAndNotify(channelId, "user", null, content, messageKind);
    const mentions = extractMentionedAgents(content, members);
    const mentionRecords = db.addChannelMessageMentions(userMessage.id, mentions);

    if (mentions.length === 0) {
      res.json({
        ok: true,
        executionMode: "log_only",
        message: userMessage,
        mentions: mentionRecords,
        results: [],
      });
      return;
    }

    type MentionTask = {
      agentId: string;
      sourceContent: string;
      resultMessageKind: ChannelMessageKind;
    };

    const queuedAgentIds = new Set<string>();
    const executedAgentIds = new Set<string>();
    const taskQueue: MentionTask[] = [];
    const results: Array<Awaited<ReturnType<typeof executeMentionedAgent>>> = [];

    const enqueueMentions = (
      nextMentions: Array<{ agentId: string; mentionName: string }>,
      sourceContent: string,
      resultMessageKind: ChannelMessageKind,
    ): void => {
      for (const mention of nextMentions) {
        if (executedAgentIds.has(mention.agentId) || queuedAgentIds.has(mention.agentId)) {
          continue;
        }
        if (!memberById.has(mention.agentId)) {
          continue;
        }
        taskQueue.push({ agentId: mention.agentId, sourceContent, resultMessageKind });
        queuedAgentIds.add(mention.agentId);
      }
    };

    enqueueMentions(mentions, content, "result");

    let chainDepth = 0;
    while (
      taskQueue.length > 0 &&
      chainDepth < MAX_MENTION_CHAIN_DEPTH &&
      results.length < MAX_MENTION_EXECUTIONS
    ) {
      const currentBatch = taskQueue.splice(0, taskQueue.length);
      const availableSlots = MAX_MENTION_EXECUTIONS - results.length;
      const runnableBatch = currentBatch.slice(0, availableSlots);
      for (const task of currentBatch) {
        queuedAgentIds.delete(task.agentId);
      }

      const batchResults = await Promise.all(
        runnableBatch.map(async (task) => {
          const targetAgent = memberById.get(task.agentId);
          if (!targetAgent) {
            const missingReply = "멘션 대상 에이전트를 찾지 못했습니다.";
            const systemMessage = appendChannelMessageAndNotify(
              channelId,
              "system",
              null,
              missingReply,
              "result",
            );
            return {
              agentId: task.agentId,
              agentName: "unknown",
              ok: false,
              reply: missingReply,
              message: systemMessage,
            };
          }

          return executeMentionedAgent(targetAgent, task.sourceContent, task.resultMessageKind);
        }),
      );

      for (const batchResult of batchResults) {
        results.push(batchResult);
        executedAgentIds.add(batchResult.agentId);
      }

      for (const batchResult of batchResults) {
        if (!batchResult.ok || batchResult.message.senderType !== "agent") {
          continue;
        }

        const chainedMentions = extractMentionedAgents(batchResult.reply, members).filter(
          (mention) => mention.agentId !== batchResult.agentId,
        );
        if (chainedMentions.length === 0) {
          continue;
        }

        db.addChannelMessageMentions(batchResult.message.id, chainedMentions);
        enqueueMentions(chainedMentions, batchResult.reply, "remention");
      }

      chainDepth += 1;
    }

    res.json({
      ok: true,
      executionMode: "mention_only",
      message: userMessage,
      mentions: mentionRecords,
      results,
    });
  });

  app.post("/api/agents", (req, res) => {
    const name = sanitizeText(req.body?.name);
    const role = sanitizeText(req.body?.role);
    const systemPrompt = sanitizeText(req.body?.systemPrompt);

    if (!name || !role || !systemPrompt) {
      res.status(400).json({ error: "name, role, systemPrompt are required" });
      return;
    }

    try {
      const agent = db.createAgent(name, role, systemPrompt);
      res.status(201).json({ agent });
    } catch (err) {
      if (err instanceof DuplicateAgentNameError) {
        res.status(409).json({ error: "agent display name already exists" });
        return;
      }
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.patch("/api/agents/:agentId", (req, res) => {
    const { agentId } = req.params;
    const name = sanitizeText(req.body?.name);
    const role = sanitizeText(req.body?.role);
    const systemPrompt = sanitizeText(req.body?.systemPrompt);

    if (!name || !role || !systemPrompt) {
      res.status(400).json({ error: "name, role, systemPrompt are required" });
      return;
    }

    try {
      const agent = db.updateAgent(agentId, name, role, systemPrompt);
      if (!agent) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      res.json({ agent });
    } catch (err) {
      if (err instanceof DuplicateAgentNameError) {
        res.status(409).json({ error: "agent display name already exists" });
        return;
      }
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/agents/:agentId", (req, res) => {
    const { agentId } = req.params;
    try {
      const deleted = db.deleteAgent(agentId);
      if (!deleted) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.delete("/api/agents/:agentId/messages", async (req, res) => {
    const { agentId } = req.params;
    try {
      const cleared = await withAgentLock(agentId, async () => db.clearAgentMessages(agentId));
      if (!cleared) {
        res.status(404).json({ error: "agent not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/agents/:agentId/messages", (req, res) => {
    const { agentId } = req.params;
    const agent = db.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: "agent not found" });
      return;
    }
    const messages = db.listMessages(agentId);
    res.json({ agent, messages });
  });

  app.post("/api/agents/:agentId/messages", async (req, res) => {
    const { agentId } = req.params;
    const content = sanitizeText(req.body?.content);

    if (!content) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const agent = db.getAgent(agentId);
    if (!agent) {
      res.status(404).json({ error: "agent not found" });
      return;
    }

    try {
      const payload = await withAgentLock(agentId, async () => {
        db.appendMessage(agentId, "user", content);

        const codexResult = await runCodex({
          prompt: content,
          systemPrompt: agent.systemPrompt,
          sessionId: agent.sessionId,
          cwd: options.workspaceDir,
        });

        if (codexResult.sessionId && codexResult.sessionId !== agent.sessionId) {
          db.updateAgentSession(agentId, codexResult.sessionId);
        }

        const replyText = codexResult.ok
          ? codexResult.reply
          : [
              "Codex 실행 실패:",
              codexResult.error ?? "unknown error",
              codexResult.reply ? `partial: ${codexResult.reply}` : "",
            ]
              .filter((line) => line.length > 0)
              .join("\n");

        db.appendMessage(agentId, codexResult.ok ? "agent" : "system", replyText);

        return {
          ok: codexResult.ok,
          reply: replyText,
          sessionId: codexResult.sessionId,
        };
      });

      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      db.appendMessage(agentId, "system", `서버 오류: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  const server = http.createServer(app);

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.preferredPort ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to bind server port"));
        return;
      }
      resolve(addr.port);
    });
  });

  return {
    port,
    close: async () =>
      new Promise<void>((resolve) => {
        let done = false;
        const finalize = (): void => {
          if (done) {
            return;
          }
          done = true;
          for (const client of Array.from(channelEventClients)) {
            try {
              client.end();
            } catch {
              // Ignore SSE client close errors during shutdown.
            }
          }
          channelEventClients.clear();
          try {
            db.close();
          } catch {
            // Ignore db close errors during shutdown.
          }
          resolve();
        };

        const forceCloseTimer = setTimeout(() => {
          // Ensure keep-alive sockets do not block app termination.
          const closeAll = (server as http.Server & { closeAllConnections?: () => void })
            .closeAllConnections;
          if (closeAll) {
            closeAll.call(server);
          }
          finalize();
        }, 1500);

        server.close(() => {
          clearTimeout(forceCloseTimer);
          finalize();
        });
      }),
  };
}
