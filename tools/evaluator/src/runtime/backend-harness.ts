import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import { resolveBuiltTestServerEntry, resolveRepoRoot } from "./paths";

const READY_PREFIX = "VIBLACK_TEST_SERVER_READY ";

type BackendChildProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface BackendHarness {
  backendBaseUrl: string;
  dbPath: string;
  workspaceDir: string;
  close: () => Promise<void>;
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

export async function launchBackendHarness(options: {
  dbPath: string;
  workspaceDir: string;
  env?: Record<string, string | undefined>;
  appDir?: string;
  repoRoot?: string;
}): Promise<BackendHarness> {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const testServerEntry = resolveBuiltTestServerEntry(repoRoot);

  const child = spawn(process.execPath, [testServerEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...options.env,
      VIBLACK_APP_DIR: options.appDir ?? repoRoot,
      VIBLACK_DB_PATH: options.dbPath,
      VIBLACK_WORKSPACE_DIR: options.workspaceDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const backendBaseUrl = await waitForReady(child);

  return {
    backendBaseUrl,
    dbPath: options.dbPath,
    workspaceDir: options.workspaceDir,
    close: async () => {
      await closeChildProcess(child);
    },
  };
}

async function waitForReady(child: BackendChildProcess): Promise<string> {
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

async function closeChildProcess(child: BackendChildProcess): Promise<void> {
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
