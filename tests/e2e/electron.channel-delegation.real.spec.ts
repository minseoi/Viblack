import { expect, test } from "@playwright/test";
import { runDelegationBasicEvaluation } from "../../tools/evaluator/src/scenarios/delegation-basic";

test("real codex channel delegation evaluation", async ({}, testInfo) => {
  test.skip(!process.env.VIBLACK_E2E_REAL_CODEX, "Set VIBLACK_E2E_REAL_CODEX=1 to run against real codex");
  test.setTimeout(18 * 60 * 1000);

  const minScoreRaw = process.env.VIBLACK_E2E_REAL_CODEX_MIN_SCORE?.trim();
  const minScore = minScoreRaw ? Number.parseInt(minScoreRaw, 10) : Number.NaN;
  const timeoutRaw = process.env.VIBLACK_E2E_REAL_CODEX_TIMEOUT_MS?.trim();
  const settleTimeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 6 * 60 * 1000;

  const { evaluation } = await runDelegationBasicEvaluation({
    codexKind: "real",
    outputDir: testInfo.outputPath("delegation-basic-real-eval"),
    runtime: process.env.VIBLACK_E2E_REAL_CODEX_RUNTIME?.trim() || "app-server",
    settleOptions: {
      timeoutMs: Number.isFinite(settleTimeoutMs) ? settleTimeoutMs : 12 * 60 * 1000,
      quietMs: 6_000,
      pollMs: 1_000,
      maxRunningMs: 630_000,
    },
  });

  testInfo.annotations.push({
    type: "delegation-score",
    description: `${evaluation.report.score}/${evaluation.report.maxScore}`,
  });
  testInfo.annotations.push({ type: "delegation-summary", description: evaluation.report.summary });

  if (Number.isFinite(minScore)) {
    expect(evaluation.report.score).toBeGreaterThanOrEqual(minScore);
  }
});
