import { shutdownCodexProcesses } from "./codex";
import { startServer, type StartedServer } from "./server";

let startedServer: StartedServer | null = null;
let shutdownPromise: Promise<void> | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function shutdown(exitCode: number): Promise<void> {
  if (shutdownPromise) {
    await shutdownPromise;
    return;
  }

  shutdownPromise = (async () => {
    try {
      await shutdownCodexProcesses();
    } catch (err) {
      const message = err instanceof Error ? err.stack || err.message : String(err);
      process.stderr.write(`[viblack-test-server] codex shutdown failed: ${message}\n`);
      exitCode = 1;
    }

    try {
      if (startedServer) {
        await startedServer.close();
        startedServer = null;
      }
    } catch (err) {
      const message = err instanceof Error ? err.stack || err.message : String(err);
      process.stderr.write(`[viblack-test-server] server shutdown failed: ${message}\n`);
      exitCode = 1;
    }

    process.exit(exitCode);
  })();

  await shutdownPromise;
}

async function main(): Promise<void> {
  const appDir = process.env.VIBLACK_APP_DIR?.trim() || process.cwd();
  const dbPath = getRequiredEnv("VIBLACK_DB_PATH");
  const workspaceDir = getRequiredEnv("VIBLACK_WORKSPACE_DIR");
  const preferredPortRaw = process.env.VIBLACK_PREFERRED_PORT?.trim();
  const preferredPort =
    preferredPortRaw && Number.isFinite(Number(preferredPortRaw))
      ? Number.parseInt(preferredPortRaw, 10)
      : undefined;

  startedServer = await startServer({ appDir, dbPath, workspaceDir, preferredPort });
  process.stdout.write(`VIBLACK_TEST_SERVER_READY http://127.0.0.1:${startedServer.port}\n`);
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

process.on("disconnect", () => {
  void shutdown(0);
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason);
  process.stderr.write(`[viblack-test-server] unhandled rejection: ${message}\n`);
  void shutdown(1);
});

process.on("uncaughtException", (error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[viblack-test-server] uncaught exception: ${message}\n`);
  void shutdown(1);
});

void main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[viblack-test-server] boot failed: ${message}\n`);
  process.exit(1);
});
