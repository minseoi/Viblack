import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { expect, test } from "@playwright/test";

function runEvaluatorCli(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    delete childEnv.FORCE_COLOR;
    delete childEnv.NO_COLOR;
    const child = spawn(process.execPath, [path.join(cwd, "dist", "tools", "evaluator", "run.js"), ...args], {
      cwd,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("evaluate tool CLI rejects fake codex mode", async ({}, testInfo) => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const outputDir = testInfo.outputPath("evaluator-cli-fake-rejected");

  const run = await runEvaluatorCli(
    ["--scenario", "delegation-basic", "--codex", "fake", "--output-dir", outputDir],
    repoRoot,
  );
  expect(run.code).toBe(1);
  expect(run.stdout).toBe("");
  expect(run.stderr).toContain("fake codex mode is not supported by evaluate-tool CLI");
  expect(fs.existsSync(path.join(outputDir, "delegation-basic.report.json"))).toBe(false);
});

test("real evaluate tool CLI writes report artifacts", async ({}, testInfo) => {
  test.skip(!process.env.VIBLACK_E2E_REAL_CODEX, "Set VIBLACK_E2E_REAL_CODEX=1 to run evaluator CLI against real codex");
  test.setTimeout(12 * 60 * 1000);

  const repoRoot = path.resolve(__dirname, "..", "..");
  const outputDir = testInfo.outputPath("evaluator-cli-real");
  const runtime = process.env.VIBLACK_E2E_REAL_CODEX_RUNTIME?.trim() || "exec";
  const minScoreRaw = process.env.VIBLACK_E2E_REAL_CODEX_MIN_SCORE?.trim();
  const minScore = minScoreRaw ? Number.parseInt(minScoreRaw, 10) : Number.NaN;

  const run = await runEvaluatorCli(
    ["--scenario", "delegation-basic", "--codex", "real", "--runtime", runtime, "--output-dir", outputDir],
    repoRoot,
  );
  expect(run.code).toBe(0);

  const reportPath = path.join(outputDir, "delegation-basic.report.json");
  const markdownPath = path.join(outputDir, "delegation-basic.report.md");
  expect(fs.existsSync(reportPath)).toBe(true);
  expect(fs.existsSync(markdownPath)).toBe(true);

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    scenarioId: string;
    report: { score: number; maxScore: number; verdict: string };
    finalDecision: { decision: string };
  };
  expect(report.scenarioId).toBe("delegation-basic");
  expect(report.report.maxScore).toBe(100);
  if (Number.isFinite(minScore)) {
    expect(report.report.score).toBeGreaterThanOrEqual(minScore);
  }
  expect(["pass", "fail"]).toContain(report.report.verdict);
  expect(["promote", "hold", "reject", "investigate"]).toContain(report.finalDecision.decision);
});
