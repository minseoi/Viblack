import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
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

let codexCommand = process.env.VIBLACK_CODEX_PATH || "codex";

function getCandidateCommands(): string[] {
  const candidates = [codexCommand, "codex"];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const userProfile = process.env.USERPROFILE;
    if (appData) {
      candidates.push(path.join(appData, "npm", "codex.cmd"));
      candidates.push(path.join(appData, "npm", "codex"));
    }
    if (userProfile) {
      candidates.push(path.join(userProfile, "AppData", "Roaming", "npm", "codex.cmd"));
      candidates.push(path.join(userProfile, "AppData", "Roaming", "npm", "codex"));
    }
  } else {
    candidates.push("/usr/local/bin/codex");
    candidates.push("/opt/homebrew/bin/codex");
  }

  const unique: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || unique.includes(candidate)) {
      continue;
    }
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) {
      continue;
    }
    unique.push(candidate);
  }
  return unique;
}

async function runCodexVersion(command: string, cwd: string): Promise<CodexStatus> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], { cwd });
    let output = "";
    let err = "";

    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", (spawnErr) => {
      resolve({ ok: false, command, error: spawnErr.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim(), command });
        return;
      }
      resolve({ ok: false, command, error: (err || output).trim() || "codex command failed" });
    });
  });
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
  const errors: string[] = [];
  for (const candidate of getCandidateCommands()) {
    const status = await runCodexVersion(candidate, cwd);
    if (status.ok) {
      codexCommand = candidate;
      return status;
    }
    errors.push(`${candidate}: ${status.error ?? "unknown"}`);
  }

  return {
    ok: false,
    error: errors.join(" | ") || "codex not found",
  };
}

export async function runCodex(params: CodexRunParams): Promise<CodexRunResult> {
  const prompt = buildPrompt(params.systemPrompt, params.prompt, Boolean(params.sessionId));
  const timeoutMs = params.timeoutMs ?? 120_000;

  const args = params.sessionId
    ? ["exec", "resume", "--skip-git-repo-check", "--json", params.sessionId, prompt]
    : ["exec", "--skip-git-repo-check", "--json", prompt];

  return new Promise((resolve) => {
    const child = spawn(codexCommand, args, { cwd: params.cwd });
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
