import type { CodexStatus } from "../backend/types";

declare global {
  interface Window {
    viblackApi: {
      getBackendBaseUrl: () => Promise<string>;
      getBootCodexStatus: () => Promise<CodexStatus>;
      pickDirectory: (defaultPath?: string) => Promise<string | null>;
      openPath: (targetPath: string) => Promise<string>;
    };
  }
}

export {};
