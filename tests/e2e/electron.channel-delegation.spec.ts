import { expect, test } from "@playwright/test";
import { runDelegationBasicEvaluation } from "../../tools/evaluator/src/scenarios/delegation-basic";

test("channel delegation flow completes in coordinator -> researcher -> writer -> coordinator order", async ({}, testInfo) => {
  const { evaluation } = await runDelegationBasicEvaluation({
    codexKind: "fake",
    outputDir: testInfo.outputPath("delegation-basic-fake-eval"),
    runtime: "app-server",
    settleOptions: {
      timeoutMs: 30_000,
      quietMs: 1_500,
      pollMs: 300,
    },
  });

  expect(evaluation.report.score).toBeGreaterThanOrEqual(95);
  expect(evaluation.report.verdict).toBe("pass");
  expect(evaluation.report.jobs.map((job) => job.targetAgentName)).toEqual(["영희", "존", "영희", "매튜", "영희"]);
  expect(evaluation.report.transcript[evaluation.report.transcript.length - 1]?.senderName).toBe("영희");
  expect(
    evaluation.report.transcript[evaluation.report.transcript.length - 1]?.actions.some((action) => action.type === "final"),
  ).toBe(true);
});
