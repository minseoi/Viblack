import type { Express } from "express";
import { checkCodexAvailability, runCodex } from "../codex";
import { sanitizeText, unwrapCodeFence } from "../services/text-utils";

interface RegisterSystemRoutesOptions {
  workspaceDir: string;
}

export function registerSystemRoutes(app: Express, options: RegisterSystemRoutesOptions): void {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/system/codex-status", async (_req, res) => {
    const status = await checkCodexAvailability(options.workspaceDir);
    res.json(status);
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

      const generationPrompt = [
        "다음 정보를 바탕으로 AI 에이전트의 SYSTEM PROMPT를 작성하세요.",
        `- 에이전트 이름: ${name || "(미지정)"}`,
        `- 에이전트 역할: ${role}`,
        "",
        "요구사항:",
        "1) 출력은 '시스템 프롬프트 본문 텍스트'만 반환 (설명/코드펜스/머리말 금지)",
        "2) 한국어 기본 응답 원칙 포함, 사용자가 명시하면 해당 언어로 응답 허용",
        "3) 역할 정체성, 작업 방식, 정확성/불확실성 처리, 보안/안전 경계 포함",
        "4) 과장/추측 금지 및 모호한 요청 시 확인 질문 원칙 포함",
        "5) 실무에서 바로 붙여넣어 쓸 수 있게 간결하고 구체적으로 작성",
      ].join("\n");

      const codexResult = await runCodex({
        prompt: generationPrompt,
        systemPrompt:
          "You are an expert prompt engineer. Produce only the final system prompt text that the user can paste directly.",
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
