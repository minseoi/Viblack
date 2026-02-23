#!/usr/bin/env node
const fs = require("node:fs");

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

function buildReply(promptText) {
  if (promptText.includes("SYSTEM PROMPT를 작성하세요")) {
    return "당신은 테스트용 에이전트입니다. 한국어로 간결하고 정확하게 응답하세요.";
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
  const resumeIndex = args.indexOf("resume");
  let sessionId = null;
  if (resumeIndex >= 0) {
    const jsonIndex = args.indexOf("--json", resumeIndex);
    if (jsonIndex >= 0 && jsonIndex + 1 < args.length) {
      sessionId = args[jsonIndex + 1];
    }
  }

  const promptText = await readStdin();
  const forcedDelayMs = parseForcedDelayMs(promptText);
  if (forcedDelayMs > 0) {
    await sleep(forcedDelayMs);
  }
  const reply = buildReply(promptText);
  const effectiveSessionId = sessionId || `fake-session-${Date.now()}`;

  if (outputPath) {
    fs.writeFileSync(outputPath, reply, "utf8");
  }

  if (!sessionId) {
    process.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: effectiveSessionId })}\n`);
  }
  process.stdout.write(`${JSON.stringify({ type: "response.completed", output_text: reply })}\n`);
  process.exit(0);
}

void main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
