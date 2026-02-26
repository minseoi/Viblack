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

function parseForcedStreamMessage(promptText) {
  const match = promptText.match(/FORCE_STREAM_AGENT_MESSAGE:\s*([^\s\r\n]+)/);
  if (!match) {
    return "";
  }
  return match[1].trim();
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

function buildReply(promptText) {
  if (promptText.includes("SYSTEM PROMPT를 작성하세요")) {
    return "당신은 테스트용 에이전트입니다. 한국어로 간결하고 정확하게 응답하세요.";
  }
  const assertMemberPromptMatch = promptText.match(/FORCE_ASSERT_MEMBER_PROMPT:\s*([^\s\r\n]+)/);
  if (promptText.includes("FORCE_ASSERT_MEMBER_TEMPLATE") && assertMemberPromptMatch) {
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
  if (promptText.includes("FORCE_ASSERT_MEMBER_TEMPLATE")) {
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
  const bounceSeedMatch = promptText.match(
    /FORCE_BOUNCE_MENTIONS:\s*([^\s,\r\n]+)\s*,\s*([^\s,\r\n]+)/,
  );
  if (bounceSeedMatch) {
    const returnTarget = bounceSeedMatch[1];
    const nextTarget = bounceSeedMatch[2];
    return `테스트 바운스 1단계: @{${nextTarget}} FORCE_BOUNCE_RETURN:${returnTarget}`;
  }
  const bounceReturnMatch = promptText.match(/FORCE_BOUNCE_RETURN:\s*([^\s\r\n]+)/);
  if (bounceReturnMatch) {
    return `테스트 바운스 2단계: @{${bounceReturnMatch[1]}} FORCE_BOUNCE_DONE`;
  }
  const forcedMentionMatch = promptText.match(/FORCE_MENTION_NAME:\s*([^\s\r\n]+)/);
  if (forcedMentionMatch) {
    return `테스트 재멘션: @{${forcedMentionMatch[1]}} FORCE_DELAY_MS:1800 확인 부탁합니다.`;
  }
  const forcedFinalReply = parseForcedFinalReply(promptText);
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

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version")) {
    process.stdout.write("fake-codex 1.0.0\n");
    process.exit(0);
  }

  if (args[0] !== "exec") {
    process.stderr.write("unsupported command\n");
    process.exit(1);
  }

  const outputPath =
    parseArgValue(args, "--output-last-message", null) ?? parseArgValue(args, "-o", null);

  const { sessionId, promptText: promptFromArgs } = parseExecContext(args);
  const promptText = promptFromArgs || (await readStdin());
  const forceTurnFailed = shouldForceTurnFailed(promptText);
  const forceTransientFailOnce = shouldTransientFailOnce(promptText);
  const forceItemCompletedMessage = parseForcedItemCompletedMessage(promptText);
  const streamMessage = parseForcedStreamMessage(promptText);
  const forcedDelayMs = parseForcedDelayMs(promptText);
  const reply = buildReply(promptText);
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
    process.stdout.write(`${JSON.stringify({ type: "turn.completed", usage: { output_tokens: 1 } })}\n`);
    process.exit(0);
  }

  if (streamMessage) {
    process.stdout.write(`${JSON.stringify({ type: "agent_message", message: streamMessage })}\n`);
  }

  if (forcedDelayMs > 0) {
    await sleep(forcedDelayMs);
  }

  process.stdout.write(`${JSON.stringify({ type: "response.completed", output_text: reply })}\n`);
  process.exit(0);
}

void main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
