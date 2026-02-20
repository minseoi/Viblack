import { contextBridge, ipcRenderer } from "electron";
import type { CodexStatus } from "./backend/types";

const api = {
  getBackendBaseUrl: async (): Promise<string> => ipcRenderer.invoke("viblack:getBackendBaseUrl"),
  getBootCodexStatus: async (): Promise<CodexStatus> =>
    ipcRenderer.invoke("viblack:getBootCodexStatus"),
};

contextBridge.exposeInMainWorld("viblackApi", api);
