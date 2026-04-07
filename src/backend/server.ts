import http from "node:http";
import express from "express";
import { ViblackDb } from "./db";
import { ChannelEventBus } from "./events/channel-event-bus";
import { AgentRepository } from "./repositories/agent-repository";
import { AppSettingsRepository } from "./repositories/app-settings-repository";
import { ChannelExecutionRepository } from "./repositories/channel-execution-repository";
import { ChannelMemberRepository } from "./repositories/channel-member-repository";
import { ChannelMemberStateRepository } from "./repositories/channel-member-state-repository";
import { ChannelMessageRepository } from "./repositories/channel-message-repository";
import { ChannelRepository } from "./repositories/channel-repository";
import { registerAgentRoutes } from "./routes/agent-routes";
import { registerChannelRoutes } from "./routes/channel-routes";
import { registerSettingsRoutes } from "./routes/settings-routes";
import { registerSystemRoutes } from "./routes/system-routes";
import { AgentExecutionService } from "./services/agent-execution-service";
import { AgentLockManager } from "./services/agent-lock-manager";
import { AppSettingsService } from "./services/app-settings-service";
import { ChannelMessageService } from "./services/channel-message-service";
import { ChannelWorkspaceService } from "./services/channel-workspace-service";

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
  const agentRepository = new AgentRepository(db.connection);
  const appSettingsRepository = new AppSettingsRepository(db.connection);
  const channelRepository = new ChannelRepository(db.connection);
  const channelMemberRepository = new ChannelMemberRepository(db.connection);
  const channelMemberStateRepository = new ChannelMemberStateRepository(db.connection);
  const channelMessageRepository = new ChannelMessageRepository(db.connection);
  const channelExecutionRepository = new ChannelExecutionRepository(db.connection);
  const appSettingsService = new AppSettingsService(appSettingsRepository);
  const lockManager = new AgentLockManager();
  const channelEventBus = new ChannelEventBus();
  const channelWorkspaceService = new ChannelWorkspaceService();
  const agentExecutionService = new AgentExecutionService(
    agentRepository,
    appSettingsService,
    options.workspaceDir,
    lockManager,
  );
  const channelMessageService = new ChannelMessageService(
    agentRepository,
    channelRepository,
    channelMemberRepository,
    channelMemberStateRepository,
    channelMessageRepository,
    channelExecutionRepository,
    appSettingsService,
    channelWorkspaceService,
    lockManager,
    channelEventBus,
  );

  app.use(express.json({ limit: "1mb" }));

  registerSystemRoutes(app, {
    workspaceDir: options.workspaceDir,
    appSettingsService,
  });
  registerSettingsRoutes(app, { appSettingsService });
  registerAgentRoutes(app, { agentRepository, agentExecutionService });
  registerChannelRoutes(app, {
    agentRepository,
    channelRepository,
    channelMemberRepository,
    channelEventBus,
    channelMessageService,
    channelWorkspaceService,
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
          channelEventBus.closeAllClients();
          try {
            db.close();
          } catch {
            // Ignore db close errors during shutdown.
          }
          resolve();
        };

        const forceCloseTimer = setTimeout(() => {
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
