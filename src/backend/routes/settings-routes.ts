import type { Express } from "express";
import { AppSettingsService } from "../services/app-settings-service";
import { sanitizeText } from "../services/text-utils";

interface RegisterSettingsRoutesOptions {
  appSettingsService: AppSettingsService;
}

export function registerSettingsRoutes(app: Express, options: RegisterSettingsRoutesOptions): void {
  app.get("/api/settings", (_req, res) => {
    res.json(options.appSettingsService.getSettings());
  });

  app.patch("/api/settings/model", (req, res) => {
    const requestedModel =
      req.body?.selectedModel === null ? null : sanitizeText(req.body?.selectedModel);
    const selectedModel = requestedModel && requestedModel.length > 0 ? requestedModel : null;

    try {
      const settings = options.appSettingsService.updateSelectedModel(selectedModel);
      res.json(settings);
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(400).json({ error: message });
    }
  });
}
