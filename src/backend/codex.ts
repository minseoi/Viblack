import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
const activeCodexProcesses = new Set<ChildProcess>();

function trackProcess(child: ChildProcess): void {
  activeCodexProcesses.add(child);
  child.once("close", () => {
    activeCodexProcesses.delete(child);
  });
  child.once("error", () => {
    activeCodexProcesses.delete(child);
  });
}

function needsShellOnWindows(command: string): boolean {
  return process.platform === "win32" && command.toLowerCase().endsWith(".cmd");
}

function getCandidateCommands(): string[] {
  const candidates = [codexCommand, "codex"];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    const userProfile = process.env.USERPROFILE;
    if (appData) {
      candidates.push(path.join(appData, "npm", "codex"));
      candidates.push(path.join(appData, "npm", "codex.cmd"));
    }
    if (userProfile) {
      candidates.push(path.join(userProfile, "AppData", "Roaming", "npm", "codex"));
      candidates.push(path.join(userProfile, "AppData", "Roaming", "npm", "codex.cmd"));
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
    let child: ChildProcess;
    try {
      child = spawn(command, ["--version"], {
        cwd,
        windowsHide: true,
        shell: needsShellOnWindows(command),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({ ok: false, command, error: message });
      return;
    }
    let output = "";
    let err = "";

    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
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
  const outputFilePath = params.sessionId
    ? null
    : path.join(os.tmpdir(), `viblack-codex-last-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);

  const args = params.sessionId
    ? ["exec", "resume", "--skip-git-repo-check", "--json", params.sessionId, "-"]
    : ["exec", "--skip-git-repo-check", "--json", "--output-last-message", outputFilePath!, "-"];

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(codexCommand, args, {
        cwd: params.cwd,
        windowsHide: true,
        shell: needsShellOnWindows(codexCommand),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({
        ok: false,
        reply: "",
        sessionId: params.sessionId,
        error: message,
      });
      return;
    }
    trackProcess(child);
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let stderrOutput = "";
    let stdoutOutput = "";
    let sessionId = params.sessionId;
    const deltaParts: string[] = [];
    const fullParts: string[] = [];

    const processLine = (rawLine: string, source: "stdout" | "stderr"): void => {
      const line = rawLine.trim();
      if (!line) {
        return;
      }

      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const type = typeof event.type === "string" ? event.type : "";

        if (type === "thread.started" && typeof event.thread_id === "string") {
          sessionId = event.thread_id;
        }

        if (type === "error") {
          return;
        }

        const parts = extractTextParts(event)
          .map((part) => part.trim())
          .filter((part) => part.length > 0);

        if (parts.length > 0) {
          if (type.includes("delta")) {
            deltaParts.push(...parts);
          } else {
            fullParts.push(...parts);
          }
        }
      } catch {
        // Some Codex builds print warnings/non-JSON lines; keep them for fallback/error.
        if (source === "stderr") {
          stderrOutput += `${line}\n`;
        } else {
          stdoutOutput += `${line}\n`;
        }
      }
    };

    const flushLines = (source: "stdout" | "stderr", flushAll: boolean): void => {
      const buffer = source === "stdout" ? stdoutBuffer : stderrBuffer;
      const lines = buffer.split(/\r?\n/);
      const remain = flushAll ? "" : (lines.pop() ?? "");
      if (source === "stdout") {
        stdoutBuffer = remain;
      } else {
        stderrBuffer = remain;
      }

      for (const rawLine of lines) {
        processLine(rawLine, source);
      }
    };

    const timeoutHandle = setTimeout(() => {
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += String(chunk);
      flushLines("stdout", false);
    });

    child.stderr?.on("data", (chunk) => {
      stderrBuffer += String(chunk);
      flushLines("stderr", false);
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

    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }

    child.on("close", (code) => {
      clearTimeout(timeoutHandle);
      flushLines("stdout", true);
      flushLines("stderr", true);

      let fileReply = "";
      try {
        if (outputFilePath && fs.existsSync(outputFilePath)) {
          fileReply = fs.readFileSync(outputFilePath, "utf8").trim();
          fs.unlinkSync(outputFilePath);
        }
      } catch {
        // Ignore output file read/cleanup failures.
      }

      const bestFull = [...fullParts].sort((a, b) => b.length - a.length)[0] ?? "";
      const mergedReply = (
        fileReply ||
        bestFull ||
        deltaParts.join("") ||
        stdoutOutput.trim()
      ).trim();
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

export async function shutdownCodexProcesses(): Promise<void> {
  if (activeCodexProcesses.size === 0) {
    return;
  }

  const processes = Array.from(activeCodexProcesses);
  for (const child of processes) {
    try {
      child.kill();
    } catch {
      // Ignore and continue shutdown.
    }
  }

  await new Promise<void>((resolve) => {
    setTimeout(() => {
      const remaining = Array.from(activeCodexProcesses);
      for (const child of remaining) {
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore and continue shutdown.
        }
      }
      resolve();
    }, 500);
  });
}
