import { expect, test } from "@playwright/test";
import {
  collectDelegationReport,
  createDelegationScenario,
  launchDelegationEvalServer,
  runDelegationScenario,
  waitForChannelToSettle,
  writeDelegationArtifacts,
} from "./support/channel-delegation-eval";

test("channel delegation flow completes in coordinator -> researcher -> writer -> coordinator order", async ({}, testInfo) => {
  const server = await launchDelegationEvalServer(testInfo, {
    codexKind: "fake",
    dbFileName: "viblack.channel-delegation.e2e.sqlite",
    extraEnv: {
      VIBLACK_CODEX_RUNTIME: "exec",
    },
  });

  try {
    const scenario = await createDelegationScenario(server.backendBaseUrl);
    await runDelegationScenario(server.backendBaseUrl, scenario);
    await waitForChannelToSettle(server.backendBaseUrl, scenario.channelId, {
      timeoutMs: 30_000,
      quietMs: 1_500,
      pollMs: 300,
    });

    const report = await collectDelegationReport(server.backendBaseUrl, scenario);
    writeDelegationArtifacts(testInfo, report, "channel-delegation-fake-report");

    expect(report.score).toBeGreaterThanOrEqual(95);
    expect(report.verdict).toBe("pass");
    expect(report.jobs.map((job) => job.targetAgentName)).toEqual(["영희", "존", "영희", "매튜", "영희"]);
    expect(report.transcript[report.transcript.length - 1]?.senderName).toBe("영희");
    expect(report.transcript[report.transcript.length - 1]?.actions.some((action) => action.type === "final")).toBe(
      true,
    );
  } finally {
    await server.close();
  }
});
