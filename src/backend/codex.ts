import { spawn } from "node:child_process";
import type { CodexStatus } from "./types";

interface CodexRunParams {
  prompt: string;
  systemPrompt: string;
  sessionId: string | null;
  cwd: string;
  timeoutMs?: number;
}

export interface CodexRunResult {
  ok: boolean;
  reply: string;
  sessionId: string | null;
  error?: string;
}

function extractTextParts(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractTextParts(item));
  }

  const obj = value as Record<string, unknown>;
  const parts: string[] = [];
  const directKeys = ["text", "delta", "output_text", "message", "value"];
  for (const key of directKeys) {
    if (typeof obj[key] === "string") {
      parts.push(String(obj[key]));
    }
  }

  const nestedKeys = ["content", "message", "delta", "response", "output"];
  for (const key of nestedKeys) {
    if (obj[key]) {
      parts.push(...extractTextParts(obj[key]));
    }
  }
  return parts;
}

function buildPrompt(systemPrompt: string, userPrompt: string, hasSession: boolean): string {
  if (hasSession) {
    return userPrompt;
  }
  return [
    "System role:",
    systemPrompt,
    "",
    "User request:",
    userPrompt,
  ].join("\n");
}

export async function checkCodexAvailability(cwd: string): Promise<CodexStatus> {
  return new Promise((resolve) => {
    const child = spawn("codex", ["--version"], { cwd });
    let output = "";
    let err = "";

    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", (spawnErr) => {
      resolve({ ok: false, error: spawnErr.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim() });
        return;
      }
      resolve({ ok: false, error: (err || output).trim() || "codex command failed" });
    });
  });
}

export async function runCodex(params: CodexRunParams): Promise<CodexRunResult> {
  const prompt = buildPrompt(params.systemPrompt, params.prompt, Boolean(params.sessionId));
  const timeoutMs = params.timeoutMs ?? 120_000;

  const args = params.sessionId
    ? ["exec", "resume", "--skip-git-repo-check", "--json", params.sessionId, prompt]
    : ["exec", "--skip-git-repo-check", "--json", prompt];

  return new Promise((resolve) => {
    const child = spawn("codex", args, { cwd: params.cwd });
    let stdoutBuffer = "";
    let stderrOutput = "";
    let sessionId = params.sessionId;
    const deltaParts: string[] = [];
    const fullParts: string[] = [];

    const flushLines = (flushAll: boolean): void => {
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = flushAll ? "" : (lines.pop() ?? "");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          const type = typeof event.type === "string" ? event.type : "";

          if (type === "thread.started" && typeof event.thread_id === "string") {
            sessionId = event.thread_id;
          }

          if (type === "error") {
            continue;
          }

          const parts = extractTextParts(event)
            .map((part) => part.trim())
            .filter((part) => part.length > 0);

          if (parts.length > 0) {
            if (type.includes("delta")) {
              deltaParts.push(...parts);
            } else if (
              type.includes("assistant") ||
              type.includes("message") ||
              type.includes("output") ||
              type.includes("completed")
            ) {
              fullParts.push(...parts);
            }
          }
        } catch {
          // Ignore non-JSON noise lines.
        }
      }
    };

    const timeoutHandle = setTimeout(() => {
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      flushLines(false);
    });

    child.stderr.on("data", (chunk) => {
      stderrOutput += String(chunk);
    });

    child.on("error", (err) => {
      clearTimeout(timeoutHandle);
      resolve({
        ok: false,
        reply: "",
        sessionId,
        error: err.message,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      flushLines(true);

      const mergedReply = (fullParts[fullParts.length - 1] || deltaParts.join("")).trim();
      if (code === 0) {
        resolve({
          ok: true,
          reply: mergedReply || "응답 텍스트를 파싱하지 못했습니다.",
          sessionId,
        });
        return;
      }

      resolve({
        ok: false,
        reply: mergedReply,
        sessionId,
        error: stderrOutput.trim() || "codex execution failed",
      });
    });
  });
}
