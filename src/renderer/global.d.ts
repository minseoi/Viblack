import type { CodexStatus } from "../backend/types";

declare global {
  interface Window {
    viblackApi: {
      getBackendBaseUrl: () => Promise<string>;
      getBootCodexStatus: () => Promise<CodexStatus>;
    };
  }
}

export {};
