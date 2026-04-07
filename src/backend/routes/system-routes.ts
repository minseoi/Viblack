import type { Express } from "express";
import { checkCodexAvailability, runCodex } from "../codex";
import { AppSettingsService } from "../services/app-settings-service";
import { PromptTemplateService } from "../services/prompt-template-service";
import { sanitizeText, unwrapCodeFence } from "../services/text-utils";

interface RegisterSystemRoutesOptions {
  workspaceDir: string;
  appSettingsService: AppSettingsService;
  promptTemplateService: PromptTemplateService;
}

export function registerSystemRoutes(app: Express, options: RegisterSystemRoutesOptions): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/system/codex-status", async (_req, res) => {
    const status = await checkCodexAvailability(options.workspaceDir);
    res.json(status);
  });

  app.get("/api/system/prompt-templates", (_req, res) => {
    res.json(options.promptTemplateService.getRendererPromptTemplates());
  });

  app.post("/api/system/generate-system-prompt", async (req, res) => {
    const role = sanitizeText(req.body?.role);
    const name = sanitizeText(req.body?.name);

    if (!role) {
      res.status(400).json({ error: "role is required" });
      return;
    }

    try {
      const status = await checkCodexAvailability(options.workspaceDir);
      if (!status.ok) {
        res.status(503).json({ error: status.error ?? "codex unavailable" });
        return;
      }

      const generationPrompt = options.promptTemplateService.buildSystemPromptGenerationUserPrompt({
        name,
        role,
      });

      const codexResult = await runCodex({
        prompt: generationPrompt,
        systemPrompt: options.promptTemplateService.getSystemPromptGenerationSystemPrompt(),
        model: options.appSettingsService.getSelectedModel(),
        sessionId: null,
        cwd: options.workspaceDir,
        timeoutMs: 90_000,
      });

      if (!codexResult.ok) {
        const details = [codexResult.error, codexResult.reply]
          .filter((item): item is string => Boolean(item && item.trim()))
          .join("\n");
        res.status(502).json({ error: details || "system prompt generation failed" });
        return;
      }

      const systemPrompt = unwrapCodeFence(codexResult.reply);
      if (!systemPrompt) {
        res.status(502).json({ error: "empty system prompt from codex" });
        return;
      }

      res.json({ systemPrompt });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      res.status(500).json({ error: message });
    }
  });
}
