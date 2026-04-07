import { expect, test } from "@playwright/test";
import {
  collectDelegationReport,
  createDelegationScenario,
  launchDelegationEvalServer,
  runDelegationScenario,
  waitForChannelToSettle,
  writeDelegationArtifacts,
} from "./support/channel-delegation-eval";

test("real codex channel delegation evaluation", async ({}, testInfo) => {
  test.skip(!process.env.VIBLACK_E2E_REAL_CODEX, "Set VIBLACK_E2E_REAL_CODEX=1 to run against real codex");
  test.setTimeout(12 * 60 * 1000);

  const minScoreRaw = process.env.VIBLACK_E2E_REAL_CODEX_MIN_SCORE?.trim();
  const minScore = minScoreRaw ? Number.parseInt(minScoreRaw, 10) : Number.NaN;
  const timeoutRaw = process.env.VIBLACK_E2E_REAL_CODEX_TIMEOUT_MS?.trim();
  const settleTimeoutMs = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : 6 * 60 * 1000;

  const server = await launchDelegationEvalServer(testInfo, {
    codexKind: "real",
    dbFileName: "viblack.channel-delegation.real.sqlite",
    extraEnv: {
      VIBLACK_CODEX_RUNTIME: process.env.VIBLACK_E2E_REAL_CODEX_RUNTIME?.trim() || "exec",
    },
  });

  try {
    const scenario = await createDelegationScenario(server.backendBaseUrl);
    await runDelegationScenario(server.backendBaseUrl, scenario);
    await waitForChannelToSettle(server.backendBaseUrl, scenario.channelId, {
      timeoutMs: Number.isFinite(settleTimeoutMs) ? settleTimeoutMs : 6 * 60 * 1000,
      quietMs: 6_000,
      pollMs: 1_000,
      maxRunningMs: 150_000,
    });

    const report = await collectDelegationReport(server.backendBaseUrl, scenario);
    writeDelegationArtifacts(testInfo, report, "channel-delegation-real-report");
    testInfo.annotations.push({ type: "delegation-score", description: `${report.score}/${report.maxScore}` });
    testInfo.annotations.push({ type: "delegation-summary", description: report.summary });

    if (Number.isFinite(minScore)) {
      expect(report.score).toBeGreaterThanOrEqual(minScore);
    }
  } finally {
    await server.close();
  }
});
