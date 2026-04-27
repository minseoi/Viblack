import { expect, test } from "@playwright/test";
import { runDelegationBasicEvaluation } from "../../tools/evaluator/src/scenarios/delegation-basic";

test("channel delegation flow completes in coordinator -> researcher -> writer -> coordinator order", async ({}, testInfo) => {
  const { evaluation } = await runDelegationBasicEvaluation({
    codexKind: "fake",
    outputDir: testInfo.outputPath("delegation-basic-fake-eval"),
    runtime: "exec",
    settleOptions: {
      timeoutMs: 30_000,
      quietMs: 1_500,
      pollMs: 300,
    },
  });

  expect(evaluation.report.verdict).toBe("pass");
  expect(evaluation.report.hardGates.every((gate) => gate.passed)).toBe(true);
  expect(evaluation.feedback.improvementAreas).toEqual([]);
  expect(evaluation.report.jobs.map((job) => job.targetAgentName)).toEqual(["영희", "존", "영희", "매튜", "영희"]);
  expect(evaluation.report.transcript[evaluation.report.transcript.length - 1]?.senderName).toBe("영희");
  expect(
    evaluation.report.transcript[evaluation.report.transcript.length - 1]?.actions.some((action) => action.type === "final"),
  ).toBe(true);
});

test("channel delegation evaluation compares against a previous report qualitatively", async ({}, testInfo) => {
  const baselineOutputDir = testInfo.outputPath("delegation-basic-fake-previous");
  const baselineRun = await runDelegationBasicEvaluation({
    codexKind: "fake",
    outputDir: baselineOutputDir,
    runtime: "exec",
    settleOptions: {
      timeoutMs: 30_000,
      quietMs: 1_500,
      pollMs: 300,
    },
  });

  const candidateRun = await runDelegationBasicEvaluation({
    codexKind: "fake",
    outputDir: testInfo.outputPath("delegation-basic-fake-candidate"),
    previousReportPath: baselineRun.artifactPaths.jsonPath,
    runtime: "exec",
    settleOptions: {
      timeoutMs: 30_000,
      quietMs: 1_500,
      pollMs: 300,
    },
  });

  expect(candidateRun.evaluation.previousRunComparison).not.toBeNull();
  expect(candidateRun.evaluation.previousRunComparison?.verdict).toBe("same");
  expect(candidateRun.evaluation.previousRunComparison?.regressions).toEqual([]);
});
