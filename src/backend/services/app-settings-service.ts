import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppSettingsRepository } from "../repositories/app-settings-repository";
import type { AppSettingsSnapshot } from "../types";

const SELECTED_MODEL_KEY = "selected_model";
const DEBUG_MODE_KEY = "debug_mode";

interface ModelsCacheSnapshot {
  availableModels: string[];
  modelsCachePath: string;
  cacheError: string | null;
}

export class AppSettingsService {
  constructor(private readonly appSettingsRepository: AppSettingsRepository) {}

  getSettings(): AppSettingsSnapshot {
    const selectedModel = this.getSelectedModel();
    const modelsSnapshot = this.readModelsCache();
    return {
      selectedModel,
      selectedModelAvailable:
        !selectedModel || modelsSnapshot.availableModels.includes(selectedModel),
      availableModels: modelsSnapshot.availableModels,
      modelsCachePath: modelsSnapshot.modelsCachePath,
      cacheError: modelsSnapshot.cacheError,
      debugMode: this.getDebugMode(),
    };
  }

  getSelectedModel(): string | null {
    const selectedModel = this.appSettingsRepository.getSetting(SELECTED_MODEL_KEY)?.value.trim() ?? "";
    return selectedModel.length > 0 ? selectedModel : null;
  }

  updateSelectedModel(selectedModel: string | null): AppSettingsSnapshot {
    this.persistSelectedModel(selectedModel);
    return this.getSettings();
  }

  getDebugMode(): boolean {
    const rawValue = this.appSettingsRepository.getSetting(DEBUG_MODE_KEY)?.value.trim().toLowerCase() ?? "";
    return rawValue === "1" || rawValue === "true" || rawValue === "on";
  }

  updateDebugMode(debugMode: boolean): AppSettingsSnapshot {
    if (debugMode) {
      this.appSettingsRepository.setSetting(DEBUG_MODE_KEY, "1");
    } else {
      this.appSettingsRepository.deleteSetting(DEBUG_MODE_KEY);
    }
    return this.getSettings();
  }

  updateSettings(input: { selectedModel?: string | null; debugMode?: boolean }): AppSettingsSnapshot {
    if (Object.prototype.hasOwnProperty.call(input, "selectedModel")) {
      this.persistSelectedModel(input.selectedModel ?? null);
    }
    if (Object.prototype.hasOwnProperty.call(input, "debugMode")) {
      if (input.debugMode) {
        this.appSettingsRepository.setSetting(DEBUG_MODE_KEY, "1");
      } else {
        this.appSettingsRepository.deleteSetting(DEBUG_MODE_KEY);
      }
    }
    return this.getSettings();
  }

  private persistSelectedModel(selectedModel: string | null): void {
    if (!selectedModel) {
      this.appSettingsRepository.deleteSetting(SELECTED_MODEL_KEY);
      return;
    }

    const modelsSnapshot = this.readModelsCache();
    if (modelsSnapshot.cacheError) {
      throw new Error(modelsSnapshot.cacheError);
    }
    if (!modelsSnapshot.availableModels.includes(selectedModel)) {
      throw new Error(`selected model is not available: ${selectedModel}`);
    }

    this.appSettingsRepository.setSetting(SELECTED_MODEL_KEY, selectedModel);
  }

  private readModelsCache(): ModelsCacheSnapshot {
    const modelsCachePath = this.resolveModelsCachePath();
    if (!fs.existsSync(modelsCachePath)) {
      return {
        availableModels: [],
        modelsCachePath,
        cacheError: `models cache not found: ${modelsCachePath}`,
      };
    }

    try {
      const raw = fs.readFileSync(modelsCachePath, "utf8");
      const parsed = JSON.parse(raw) as { models?: Array<{ slug?: unknown; display_name?: unknown }> };
      const seen = new Set<string>();
      const availableModels: string[] = [];

      for (const entry of parsed.models ?? []) {
        const candidate =
          typeof entry?.slug === "string"
            ? entry.slug.trim()
            : typeof entry?.display_name === "string"
              ? entry.display_name.trim()
              : "";
        if (!candidate || seen.has(candidate)) {
          continue;
        }
        seen.add(candidate);
        availableModels.push(candidate);
      }

      return {
        availableModels,
        modelsCachePath,
        cacheError: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        availableModels: [],
        modelsCachePath,
        cacheError: `failed to read models cache: ${message}`,
      };
    }
  }

  private resolveModelsCachePath(): string {
    const overridePath = process.env.VIBLACK_MODELS_CACHE_PATH?.trim();
    if (overridePath) {
      return path.isAbsolute(overridePath)
        ? overridePath
        : path.resolve(process.cwd(), overridePath);
    }
    return path.join(os.homedir(), ".codex", "models_cache.json");
  }
}
