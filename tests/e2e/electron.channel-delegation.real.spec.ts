import { expect, test } from "@playwright/test";
import { runDelegationBasicEvaluation } from "../../tools/evaluator/src/scenarios/delegation-basic";

test("real codex channel delegation evaluation", async ({}, testInfo) => {
  test.skip(!process.env.VIBLACK_E2E_REAL_CODEX, "Set VIBLACK_E2E_REAL_CODEX=1 to run against real codex");
  test.setTimeout(12 * 60 * 1000);

  const timeoutRaw = process.env.VIBLACK_E2E_REAL_CODEX_TIMEOUT_MS?.trim();
  const settleTimeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 6 * 60 * 1000;

  const { evaluation } = await runDelegationBasicEvaluation({
    codexKind: "real",
    outputDir: testInfo.outputPath("delegation-basic-real-eval"),
    runtime: process.env.VIBLACK_E2E_REAL_CODEX_RUNTIME?.trim() || "exec",
    settleOptions: {
      timeoutMs: Number.isFinite(settleTimeoutMs) ? settleTimeoutMs : 6 * 60 * 1000,
      quietMs: 6_000,
      pollMs: 1_000,
      maxRunningMs: 150_000,
    },
  });

  testInfo.annotations.push({
    type: "delegation-verdict",
    description: evaluation.report.verdict,
  });
  testInfo.annotations.push({ type: "delegation-summary", description: evaluation.report.summary });
  testInfo.annotations.push({
    type: "delegation-improvement-areas",
    description: `${evaluation.feedback.improvementAreas.length}`,
  });

  expect(evaluation.report.hardGates.length).toBeGreaterThan(0);
  expect(Array.isArray(evaluation.feedback.improvementAreas)).toBe(true);
});
