import path from "node:path";
import fs from "node:fs";
import { app, BrowserWindow, ipcMain } from "electron";
import { checkCodexAvailability, shutdownCodexProcesses } from "./backend/codex";
import { startServer, type StartedServer } from "./backend/server";
import type { CodexStatus } from "./backend/types";

let backendServer: StartedServer | null = null;
let backendBaseUrl = "";
let bootCodexStatus: CodexStatus = { ok: false, error: "not initialized" };
let shutdownInProgress = false;

function resolveDbPath(workspaceDir: string): string {
  const fromEnv = process.env.VIBLACK_DB_PATH?.trim();
  if (!fromEnv) {
    return path.join(app.getPath("userData"), "viblack.sqlite");
  }
  if (path.isAbsolute(fromEnv)) {
    return fromEnv;
  }
  return path.join(workspaceDir, fromEnv);
}

function resolveWindowIconPath(): string | undefined {
  const iconsDir = path.join(app.getAppPath(), "src", "assets", "icons");
  const iconFile = process.platform === "darwin" ? "icon.icns" : "icon.ico";
  const iconPath = path.join(iconsDir, iconFile);
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    icon: resolveWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const htmlPath = path.join(app.getAppPath(), "src", "renderer", "index.html");
  void win.loadFile(htmlPath);
  return win;
}

async function boot(): Promise<void> {
  const workspaceDir = app.getAppPath();
  const dbPath = resolveDbPath(workspaceDir);
  backendServer = await startServer({ dbPath, workspaceDir });
  backendBaseUrl = `http://127.0.0.1:${backendServer.port}`;

  try {
    bootCodexStatus = await checkCodexAvailability(workspaceDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    bootCodexStatus = { ok: false, error: `codex check failed: ${message}` };
  }

  createWindow();
}

ipcMain.handle("viblack:getBackendBaseUrl", async () => backendBaseUrl);
ipcMain.handle("viblack:getBootCodexStatus", async () => bootCodexStatus);

async function shutdownApp(): Promise<void> {
  if (shutdownInProgress) {
    return;
  }
  shutdownInProgress = true;

  try {
    await shutdownCodexProcesses();
    if (backendServer) {
      await backendServer.close();
      backendServer = null;
    }
  } catch {
    // Ignore shutdown errors and continue app termination.
  } finally {
    app.exit(0);
  }
}

app.whenReady().then(() => {
  void boot().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    bootCodexStatus = { ok: false, error: `boot failed: ${message}` };
    createWindow();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (shutdownInProgress) {
    return;
  }
  event.preventDefault();
  void shutdownApp();
});

app.on("window-all-closed", () => {
  void shutdownApp();
});
