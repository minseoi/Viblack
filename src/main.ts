import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { checkCodexAvailability } from "./backend/codex";
import { startServer, type StartedServer } from "./backend/server";
import type { CodexStatus } from "./backend/types";

let backendServer: StartedServer | null = null;
let backendBaseUrl = "";
let bootCodexStatus: CodexStatus = { ok: false, error: "not initialized" };

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 640,
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
  const dbPath = path.join(app.getPath("userData"), "viblack.sqlite");
  backendServer = await startServer({ dbPath, workspaceDir });
  backendBaseUrl = `http://127.0.0.1:${backendServer.port}`;

  bootCodexStatus = await checkCodexAvailability(workspaceDir);
  if (!bootCodexStatus.ok) {
    dialog.showErrorBox(
      "Codex CLI 확인 필요",
      [
        "Codex CLI를 실행할 수 없습니다.",
        "터미널에서 `codex --version` 명령이 동작하는지 확인해 주세요.",
        `오류: ${bootCodexStatus.error ?? "unknown"}`,
      ].join("\n"),
    );
  }

  createWindow();
}

ipcMain.handle("viblack:getBackendBaseUrl", async () => backendBaseUrl);
ipcMain.handle("viblack:getBootCodexStatus", async () => bootCodexStatus);

app.whenReady().then(() => {
  void boot();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  if (backendServer) {
    void backendServer.close();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
