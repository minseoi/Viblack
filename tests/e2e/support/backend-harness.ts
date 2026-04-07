import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { TestInfo } from "@playwright/test";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const TEST_SERVER_ENTRY = path.join(REPO_ROOT, "dist", "backend", "test-server-entry.js");
const READY_PREFIX = "VIBLACK_TEST_SERVER_READY ";

export interface BackendHarness {
  backendBaseUrl: string;
  dbPath: string;
  workspaceDir: string;
  close: () => Promise<void>;
}

export function resolveFakeCodexPath(): string {
  if (process.platform === "win32") {
    return path.resolve(__dirname, "..", "fixtures", "fake-codex.cmd");
  }
  const unixPath = path.resolve(__dirname, "..", "fixtures", "fake-codex");
  try {
    fs.chmodSync(unixPath, 0o755);
  } catch {
    // Best-effort for non-Windows environments.
  }
  return unixPath;
}

export function resolveModelsCachePath(): string {
  return path.resolve(__dirname, "..", "fixtures", "models-cache.json");
}

export function createWorkspaceDir(testInfo: TestInfo, label: string): string {
  const safeLabel = label.replace(/[^a-z0-9_.-]+/gi, "-");
  const workspacePath = testInfo.outputPath(`workspace-${safeLabel}`);
  fs.mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

export async function apiRequest<T>(
  backendBaseUrl: string,
  pathname: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; data: T }> {
  const response = await fetch(`${backendBaseUrl}${pathname}`, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    data: text ? (JSON.parse(text) as T) : (null as T),
  };
}

export async function launchBackendHarness(
  testInfo: TestInfo,
  options?: {
    dbFileName?: string;
    workspaceDirName?: string;
    env?: Record<string, string | undefined>;
  },
): Promise<BackendHarness> {
  const dbPath = testInfo.outputPath(options?.dbFileName ?? "viblack.backend.e2e.sqlite");
  const workspaceDir = testInfo.outputPath(options?.workspaceDirName ?? "backend-workspace");
  fs.mkdirSync(workspaceDir, { recursive: true });

  const child = spawn(process.execPath, [TEST_SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...options?.env,
      VIBLACK_DB_PATH: dbPath,
      VIBLACK_WORKSPACE_DIR: workspaceDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const backendBaseUrl = await waitForReady(child);

  return {
    backendBaseUrl,
    dbPath,
    workspaceDir,
    close: async () => {
      await closeChildProcess(child);
    },
  };
}

async function waitForReady(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrOutput = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      void closeChildProcess(child).finally(() => {
        reject(new Error(`backend test server did not become ready in time\n${stderrOutput.trim()}`.trim()));
      });
    }, 15_000);

    const finish = (result: { ok: true; baseUrl: string } | { ok: false; error: Error }): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.off("error", onError);
      child.off("exit", onExit);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      if (result.ok) {
        resolve(result.baseUrl);
      } else {
        reject(result.error);
      }
    };

    const onError = (error: Error): void => {
      finish({ ok: false, error });
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish({
        ok: false,
        error: new Error(
          `backend test server exited before ready (code=${code ?? "null"}, signal=${signal ?? "null"})\n${stderrOutput.trim()}`.trim(),
        ),
      });
    };

    const onStderr = (chunk: Buffer | string): void => {
      stderrOutput += String(chunk);
    };

    const onStdout = (chunk: Buffer | string): void => {
      stdoutBuffer += String(chunk);
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line.startsWith(READY_PREFIX)) {
          finish({ ok: true, baseUrl: line.slice(READY_PREFIX.length).trim() });
          return;
        }
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    };

    child.on("error", onError);
    child.on("exit", onExit);
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
  });
}

async function closeChildProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    let resolved = false;
    const finalize = (): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(forceKillTimer);
      child.off("exit", onExit);
      child.off("error", onError);
      resolve();
    };

    const onExit = (): void => {
      finalize();
    };

    const onError = (): void => {
      finalize();
    };

    const forceKillTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      finalize();
    }, 5_000);

    child.once("exit", onExit);
    child.once("error", onError);

    if (!child.kill("SIGTERM")) {
      finalize();
    }
  });
}
