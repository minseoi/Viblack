#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.resume();
  });
}

function parseArgValue(args, longName, shortName) {
  const longIndex = args.indexOf(longName);
  if (longIndex >= 0 && longIndex + 1 < args.length) {
    return args[longIndex + 1];
  }
  if (shortName) {
    const shortIndex = args.indexOf(shortName);
    if (shortIndex >= 0 && shortIndex + 1 < args.length) {
      return args[shortIndex + 1];
    }
  }
  return null;
}

function parseRequestedModel(args) {
  return parseArgValue(args, "--model", "-m");
}

function parseExecContext(args) {
  const resumeIndex = args.indexOf("resume");
  const jsonIndex = args.indexOf("--json");

  if (jsonIndex < 0) {
    return { sessionId: null, promptText: "" };
  }

  if (resumeIndex >= 0) {
    const sessionId = jsonIndex + 1 < args.length ? args[jsonIndex + 1] : null;
    const promptText = jsonIndex + 2 < args.length ? args.slice(jsonIndex + 2).join(" ") : "";
    return { sessionId, promptText };
  }

  const promptText = jsonIndex + 1 < args.length ? args.slice(jsonIndex + 1).join(" ") : "";
  return { sessionId: null, promptText };
}

function extractEmbeddedMemberPrompt(promptText) {
  const match = promptText.match(
    /\[USER_DEFINED_MEMBER_PROMPT_BEGIN\]\r?\n([\s\S]*?)\r?\n\[USER_DEFINED_MEMBER_PROMPT_END\]/,
  );
  return match ? match[1].trim() : "";
}

function extractPromptSection(promptText, sectionName) {
  const pattern = new RegExp(`\\[${sectionName}_BEGIN\\]\\r?\\n([\\s\\S]*?)\\r?\\n\\[${sectionName}_END\\]`);
  const match = promptText.match(pattern);
  return match ? match[1].trim() : "";
}

function getControlPromptText(promptText) {
  return extractPromptSection(promptText, "ACTIVE_TRIGGER_MESSAGE") || promptText;
}

function extractAgentName(promptText) {
  const match = promptText.match(/^- Name:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

function extractChannelMemberNames(promptText) {
  const membersSection = extractPromptSection(promptText, "CHANNEL_MEMBERS");
  if (!membersSection) {
    return [];
  }
  return membersSection
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => line.match(/^\d+\.\s+(.+?)(?:\s+\|.*)?$/))
    .map((match) => (match ? match[1].trim() : ""))
    .filter((name) => name.length > 0);
}

function extractActiveTaskRequester(promptText) {
  const requester = extractPromptSection(promptText, "ACTIVE_TASK_REQUESTER");
  if (!requester || requester === "(none)") {
    return "";
  }
  return requester;
}

function extractMentionedMemberNames(text, memberNames) {
  return memberNames.filter(
    (memberName) =>
      text.includes(`@{${memberName}}`) ||
      text.includes(`@${memberName}`),
  );
}

function hasExactMentionDelegationRules(promptText) {
  return (
    promptText.includes("your reply must include an exact channel mention to that member") &&
    promptText.includes("otherwise no execution occurs") &&
    promptText.includes("mention the delegating member back using their exact name")
  );
}

function findDelegationTarget(triggerText, currentAgentName, memberNames) {
  const delegationKeywords = ["시키", "조사", "부탁", "요청", "넘겨", "맡겨", "물어", "해봐"];
  const normalizedTrigger = triggerText.replace(/\s+/g, " ");
  if (!delegationKeywords.some((keyword) => normalizedTrigger.includes(keyword))) {
    return "";
  }

  for (const memberName of memberNames) {
    if (!memberName || memberName === currentAgentName) {
      continue;
    }
    if (
      normalizedTrigger.includes(`${memberName}한테`) ||
      normalizedTrigger.includes(`${memberName}에게`) ||
      normalizedTrigger.includes(`@{${memberName}}`) ||
      normalizedTrigger.includes(`@${memberName}`)
    ) {
      return memberName;
    }
  }

  return "";
}

function isAmbiguousDelegationPrompt(text) {
  return ["그거", "저거", "2번", "모호", "불명확", "방금 말한"].some((token) => text.includes(token));
}

function maybeBuildDelegationReply(promptText, controlPromptText) {
  if (!hasExactMentionDelegationRules(promptText)) {
    return "";
  }

  const currentAgentName = extractAgentName(promptText);
  const memberNames = extractChannelMemberNames(promptText);
  const activeTaskRequester = extractActiveTaskRequester(promptText);
  if (!currentAgentName || memberNames.length === 0) {
    return "";
  }

  const mentionedMembers = extractMentionedMemberNames(controlPromptText, memberNames);
  if (
    activeTaskRequester &&
    isAmbiguousDelegationPrompt(controlPromptText) &&
    !controlPromptText.includes("확인 질문:")
  ) {
    return `@{${activeTaskRequester}} 확인 질문: 방금 말한 "그거"가 정확히 어떤 범위인지 먼저 알려줘.`;
  }

  if (
    mentionedMembers.includes(currentAgentName) &&
    controlPromptText.includes("보고해줘")
  ) {
    const returnTarget = mentionedMembers.find((memberName) => memberName !== currentAgentName);
    if (returnTarget) {
      return `조사 결과 보고: 핵심 사실 3개를 정리했습니다. @{${returnTarget}} 이어서 사용자용으로 요약해줘.`;
    }
  }

  if (
    mentionedMembers.includes(currentAgentName) &&
    controlPromptText.includes("조사 결과 보고:")
  ) {
    return "최종 정리: 하위 리서치 결과를 바탕으로 사용자용 초안을 정리했습니다.";
  }

  const delegationTarget = findDelegationTarget(controlPromptText, currentAgentName, memberNames);
  if (delegationTarget) {
    if (isAmbiguousDelegationPrompt(controlPromptText)) {
      return `@{${delegationTarget}} 방금 말한 그거를 조사해줘. 범위가 불명확하면 @{${currentAgentName}} 에게 먼저 확인 질문해줘.`;
    }
    return `@{${delegationTarget}} 조사 부탁합니다. 공개 자료 기준 핵심 사실만 정리하고 결과는 @{${currentAgentName}} 에게 채널에서 보고해줘.`;
  }

  return "";
}

function parseForcedStreamMessage(promptText) {
  const match = promptText.match(/FORCE_STREAM_AGENT_MESSAGE:\s*([^\s\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

function parseForcedStreamSequence(promptText) {
  const match = promptText.match(/FORCE_STREAM_AGENT_MESSAGE_SEQ:\s*([^\s\r\n]+)/);
  if (!match) {
    return [];
  }
  return match[1]
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseForcedFinalReply(promptText) {
  const match = promptText.match(/FORCE_FINAL_REPLY:\s*([^\s\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

function shouldForceTurnFailed(promptText) {
  return promptText.includes("FORCE_TURN_FAILED");
}

function parseForcedItemCompletedMessage(promptText) {
  const match = promptText.match(/FORCE_ITEM_COMPLETED_AGENT_MESSAGE:\s*([^\s\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

function parseTransientFailOnceKey(promptText) {
  const match = promptText.match(/FORCE_TRANSIENT_FAIL_ONCE:\s*([^\s\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1].trim();
}

function shouldTransientFailOnce(promptText) {
  const key = parseTransientFailOnceKey(promptText);
  if (!key) {
    return false;
  }
  const markerPath = path.join(os.tmpdir(), `viblack-fake-codex-transient-${key}`);
  if (fs.existsSync(markerPath)) {
    try {
      fs.unlinkSync(markerPath);
    } catch {
      // Ignore cleanup failures and continue as success on this invocation.
    }
    return false;
  }
  try {
    fs.writeFileSync(markerPath, "1", "utf8");
  } catch {
    // If marker cannot be written, keep test deterministic by failing this invocation.
  }
  return true;
}

function buildReply(promptText, runtimeMode = "exec", requestedModel = null, controlPromptText = promptText) {
  if (promptText.includes("SYSTEM PROMPT를 작성하세요")) {
    return "당신은 테스트용 에이전트입니다. 한국어로 간결하고 정확하게 응답하세요.";
  }
  const delegatedReply = maybeBuildDelegationReply(promptText, controlPromptText);
  if (delegatedReply) {
    return delegatedReply;
  }
  const assertChannelMembersMatch = controlPromptText.match(
    /FORCE_ASSERT_CHANNEL_MEMBERS:\s*([^\s\r\n]+)/,
  );
  const assertChannelHistoryMatch = controlPromptText.match(
    /FORCE_ASSERT_CHANNEL_HISTORY:\s*([^\s\r\n]+)/,
  );
  if (assertChannelMembersMatch || assertChannelHistoryMatch) {
    const membersSection = extractPromptSection(promptText, "CHANNEL_MEMBERS");
    const historySection = extractPromptSection(promptText, "CHANNEL_RECENT_MESSAGES");

    if (!membersSection) {
      return "채널 멤버 섹션 누락";
    }
    if (!historySection) {
      return "채널 히스토리 섹션 누락";
    }

    if (assertChannelMembersMatch) {
      const expectedMembers = assertChannelMembersMatch[1]
        .split("|")
        .map((member) => member.trim())
        .filter((member) => member.length > 0);
      const missingMember = expectedMembers.find((member) => !membersSection.includes(member));
      if (missingMember) {
        return `채널 멤버 누락:${missingMember}`;
      }
    }

    if (assertChannelHistoryMatch) {
      const expectedHistoryToken = assertChannelHistoryMatch[1].trim();
      if (!historySection.includes(expectedHistoryToken)) {
        return `채널 히스토리 누락:${expectedHistoryToken}`;
      }
    }

    return "채널 컨텍스트 확인:ok";
  }
  const assertModelMatch = controlPromptText.match(/FORCE_ASSERT_MODEL:\s*([^\s\r\n]+)/);
  if (assertModelMatch) {
    const expectedModel = assertModelMatch[1].trim();
    const normalizedExpected = expectedModel.toLowerCase();
    const normalizedActual = typeof requestedModel === "string" ? requestedModel.trim().toLowerCase() : "";
    if (
      (normalizedExpected === "none" && !normalizedActual) ||
      normalizedExpected === normalizedActual
    ) {
      return `모델 확인:${expectedModel}`;
    }
    return `모델 불일치:${requestedModel || "none"}`;
  }
  if (promptText.includes("FORCE_REQUIRE_APP_SERVER")) {
    return runtimeMode === "app-server" ? "APP_SERVER_RUNTIME_OK" : "EXEC_RUNTIME_ONLY";
  }
  const assertMemberPromptMatch = controlPromptText.match(/FORCE_ASSERT_MEMBER_PROMPT:\s*([^\s\r\n]+)/);
  if (controlPromptText.includes("FORCE_ASSERT_MEMBER_TEMPLATE") && assertMemberPromptMatch) {
    const requiredSections = [
      "[IDENTITY]",
      "[CONTEXT]",
      "[EXECUTION_RULES]",
      "[VALIDATION_RULES]",
      "[SAFETY_GATES]",
      "[OUTPUT_FORMAT]",
      "[USER_DEFINED_MEMBER_PROMPT_BEGIN]",
      "[USER_DEFINED_MEMBER_PROMPT_END]",
    ];
    const missingSection = requiredSections.find((section) => !promptText.includes(section));
    if (missingSection) {
      return `멤버 템플릿 누락:${missingSection}`;
    }
    const expectedToken = assertMemberPromptMatch[1];
    const embeddedPrompt = extractEmbeddedMemberPrompt(promptText);
    if (!embeddedPrompt.includes(expectedToken)) {
      return `멤버 프롬프트 누락:${expectedToken}`;
    }
    return `멤버 템플릿/프롬프트 확인:${expectedToken}`;
  }
  if (controlPromptText.includes("FORCE_ASSERT_MEMBER_TEMPLATE")) {
    const requiredSections = [
      "[IDENTITY]",
      "[CONTEXT]",
      "[EXECUTION_RULES]",
      "[VALIDATION_RULES]",
      "[SAFETY_GATES]",
      "[OUTPUT_FORMAT]",
      "[USER_DEFINED_MEMBER_PROMPT_BEGIN]",
      "[USER_DEFINED_MEMBER_PROMPT_END]",
    ];
    const missingSection = requiredSections.find((section) => !promptText.includes(section));
    if (missingSection) {
      return `멤버 템플릿 누락:${missingSection}`;
    }
    return "멤버 템플릿 확인:ok";
  }
  if (assertMemberPromptMatch) {
    const expectedToken = assertMemberPromptMatch[1];
    const embeddedPrompt = extractEmbeddedMemberPrompt(promptText);
    if (embeddedPrompt.includes(expectedToken)) {
      return `멤버 프롬프트 확인:${expectedToken}`;
    }
    return `멤버 프롬프트 누락:${expectedToken}`;
  }
  const bounceSeedMatch = controlPromptText.match(
    /FORCE_BOUNCE_MENTIONS:\s*([^\s,\r\n]+)\s*,\s*([^\s,\r\n]+)/,
  );
  if (bounceSeedMatch) {
    const returnTarget = bounceSeedMatch[1];
    const nextTarget = bounceSeedMatch[2];
    return `테스트 바운스 1단계: @{${nextTarget}} FORCE_BOUNCE_RETURN:${returnTarget}`;
  }
  const bounceReturnMatch = controlPromptText.match(/FORCE_BOUNCE_RETURN:\s*([^\s\r\n]+)/);
  if (bounceReturnMatch) {
    return `테스트 바운스 2단계: @{${bounceReturnMatch[1]}} FORCE_BOUNCE_DONE`;
  }
  const forcedMentionMatch = controlPromptText.match(/FORCE_MENTION_NAME:\s*([^\s\r\n]+)/);
  if (forcedMentionMatch) {
    return `테스트 재멘션: @{${forcedMentionMatch[1]}} FORCE_DELAY_MS:1800 확인 부탁합니다.`;
  }
  const forcedFinalReply = parseForcedFinalReply(controlPromptText);
  if (forcedFinalReply) {
    return forcedFinalReply;
  }
  return "테스트 응답: 요청을 정상 처리했습니다.";
}

function parseForcedDelayMs(promptText) {
  const match = promptText.match(/FORCE_DELAY_MS:\s*(\d{1,5})/);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.min(parsed, 10000);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function extractTurnInputText(input) {
  if (!Array.isArray(input)) {
    return "";
  }
  return input
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }
      const value = item;
      if (value.type === "text" && typeof value.text === "string") {
        return value.text;
      }
      return "";
    })
    .filter((text) => text.length > 0)
    .join("\n");
}

function createThreadPayload(threadId, cwd) {
  const now = Math.floor(Date.now() / 1000);
  return {
    approvalPolicy: "never",
    cwd,
    model: "fake-model",
    modelProvider: "fake",
    sandbox: {
      mode: "workspace-write",
      writableRoots: [cwd],
    },
    thread: {
      id: threadId,
      cliVersion: "fake-codex-1.0.0",
      createdAt: now,
      cwd,
      modelProvider: "fake",
      preview: "fake thread",
      source: "codex_app_server",
      turns: [],
      updatedAt: now,
    },
  };
}

async function runAppServer() {
  process.stdin.setEncoding("utf8");
  process.stdin.resume();

  let buffer = "";

  const writeJson = (payload) => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  const respond = (id, result) => {
    writeJson({ jsonrpc: "2.0", id, result });
  };

  const respondError = (id, code, message) => {
    writeJson({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    });
  };

  const notify = (method, params) => {
    writeJson({
      jsonrpc: "2.0",
      method,
      params,
    });
  };

  const flush = async (flushAll) => {
    const lines = buffer.split(/\r?\n/);
    buffer = flushAll ? "" : (lines.pop() ?? "");

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      if (!message || typeof message !== "object") {
        continue;
      }

      const id = message.id;
      const method = typeof message.method === "string" ? message.method : "";
      const params = message.params && typeof message.params === "object" ? message.params : {};

      if (!method) {
        continue;
      }

      if (method === "initialize") {
        respond(id, { userAgent: "fake-codex-app-server/1.0.0" });
        continue;
      }

      if (method === "thread/start") {
        const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : process.cwd();
        const threadId = `fake-thread-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        respond(id, createThreadPayload(threadId, cwd));
        continue;
      }

      if (method === "thread/resume") {
        const cwd = typeof params.cwd === "string" && params.cwd ? params.cwd : process.cwd();
        const threadId =
          typeof params.threadId === "string" && params.threadId
            ? params.threadId
            : `fake-thread-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        respond(id, createThreadPayload(threadId, cwd));
        continue;
      }

      if (method === "turn/interrupt") {
        const turnId = typeof params.turnId === "string" ? params.turnId : `fake-turn-${Date.now()}`;
        respond(id, { turn: { id: turnId, status: "failed", items: [] } });
        continue;
      }

      if (method === "turn/start") {
        const threadId =
          typeof params.threadId === "string" && params.threadId
            ? params.threadId
            : `fake-thread-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const turnId = `fake-turn-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const promptText = extractTurnInputText(params.input);
        const controlPromptText = getControlPromptText(promptText);
        const forceTurnFailed = shouldForceTurnFailed(controlPromptText);
        const forceItemCompletedMessage = parseForcedItemCompletedMessage(controlPromptText);
        const streamMessage = parseForcedStreamMessage(controlPromptText);
        const streamSequence = parseForcedStreamSequence(controlPromptText);
        const forcedDelayMs = parseForcedDelayMs(controlPromptText);

        respond(id, { turn: { id: turnId, status: "started", items: [] } });
        notify("turn/started", { threadId, turn: { id: turnId, status: "started", items: [] } });

        if (forceTurnFailed) {
          notify("turn/completed", {
            threadId,
            turn: {
              id: turnId,
              status: "failed",
              items: [],
              error: { message: "forced turn failure" },
            },
          });
          continue;
        }

        if (streamMessage) {
          notify("item/agentMessage/delta", {
            threadId,
            turnId,
            itemId: `item-delta-${turnId}`,
            delta: streamMessage,
          });
        }
        for (const streamChunk of streamSequence) {
          notify("item/agentMessage/delta", {
            threadId,
            turnId,
            itemId: `item-delta-${turnId}`,
            delta: streamChunk,
          });
        }

        if (forcedDelayMs > 0) {
          await sleep(forcedDelayMs);
        }

        const reply =
          forceItemCompletedMessage ||
          buildReply(promptText, "app-server", null, controlPromptText);

        notify("item/completed", {
          threadId,
          turnId,
          item: {
            id: `item-message-${turnId}`,
            type: "agentMessage",
            text: reply,
          },
        });

        notify("turn/completed", {
          threadId,
          turn: {
            id: turnId,
            status: "completed",
            items: [],
          },
        });
        continue;
      }

      respondError(id, -32601, `Method not found: ${method}`);
    }
  };

  process.stdin.on("data", async (chunk) => {
    buffer += String(chunk);
    await flush(false);
  });

  process.stdin.on("end", async () => {
    await flush(true);
    process.exit(0);
  });
}

async function runExec(args) {
  const outputPath =
    parseArgValue(args, "--output-last-message", null) ?? parseArgValue(args, "-o", null);

  const requestedModel = parseRequestedModel(args);
  const { sessionId, promptText: promptFromArgs } = parseExecContext(args);
  const promptText = promptFromArgs || (await readStdin());
  const controlPromptText = getControlPromptText(promptText);
  const forceTurnFailed = shouldForceTurnFailed(controlPromptText);
  const forceTransientFailOnce = shouldTransientFailOnce(controlPromptText);
  const forceItemCompletedMessage = parseForcedItemCompletedMessage(controlPromptText);
  const streamMessage = parseForcedStreamMessage(controlPromptText);
  const streamSequence = parseForcedStreamSequence(controlPromptText);
  const forcedDelayMs = parseForcedDelayMs(controlPromptText);
  const reply = buildReply(promptText, "exec", requestedModel, controlPromptText);
  const effectiveSessionId = sessionId || `fake-session-${Date.now()}`;

  if (outputPath) {
    fs.writeFileSync(outputPath, reply, "utf8");
  }

  if (!sessionId) {
    process.stdout.write(
      `${JSON.stringify({ type: "thread.started", thread_id: effectiveSessionId })}\n`,
    );
  }

  if (forceTurnFailed) {
    process.stdout.write(
      `${JSON.stringify({ type: "turn.failed", error: { message: "forced turn failure" } })}\n`,
    );
    process.exit(0);
  }

  if (forceTransientFailOnce) {
    const transientError =
      "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)";
    process.stdout.write(`${JSON.stringify({ type: "error", message: transientError })}\n`);
    process.stderr.write(`${transientError}\n`);
    process.exit(1);
  }

  if (forceItemCompletedMessage) {
    process.stdout.write(
      `${JSON.stringify({
        type: "item.completed",
        item: {
          id: "item_1",
          type: "agent_message",
          text: forceItemCompletedMessage,
        },
      })}\n`,
    );
    process.stdout.write(
      `${JSON.stringify({ type: "turn.completed", usage: { output_tokens: 1 } })}\n`,
    );
    process.exit(0);
  }

  if (streamMessage) {
    process.stdout.write(`${JSON.stringify({ type: "agent_message", message: streamMessage })}\n`);
  }
  let aggregatedStream = "";
  for (const streamChunk of streamSequence) {
    aggregatedStream += streamChunk;
    process.stdout.write(
      `${JSON.stringify({ type: "agent_message", message: aggregatedStream })}\n`,
    );
  }

  if (forcedDelayMs > 0) {
    await sleep(forcedDelayMs);
  }

  process.stdout.write(`${JSON.stringify({ type: "response.completed", output_text: reply })}\n`);
  process.exit(0);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version")) {
    process.stdout.write("fake-codex 1.0.0\n");
    process.exit(0);
  }

  if (args[0] === "app-server") {
    await runAppServer();
    return;
  }

  if (args[0] !== "exec") {
    process.stderr.write("unsupported command\n");
    process.exit(1);
  }

  await runExec(args);
}

void main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
