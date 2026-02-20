import http from "node:http";
import express from "express";
import { checkCodexAvailability, runCodex } from "./codex";
import { ViblackDb } from "./db";

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

  const sanitizeText = (value: unknown): string =>
    typeof value === "string" ? value.trim() : "";

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/system/codex-status", async (_req, res) => {
    const status = await checkCodexAvailability(options.workspaceDir);
    res.json(status);
  });

  app.get("/api/agents", (_req, res) => {
    const agents = db.listAgents();
    res.json({ agents });
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
