import fs from "node:fs";
import path from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from "@playwright/test";

function resolveFakeCodexPath(): string {
  if (process.platform === "win32") {
    return path.resolve(__dirname, "fixtures", "fake-codex.cmd");
  }
  const unixPath = path.resolve(__dirname, "fixtures", "fake-codex");
  try {
    fs.chmodSync(unixPath, 0o755);
  } catch {
    // Best-effort for non-Windows environments.
  }
  return unixPath;
}

async function launchIsolatedApp(
  testInfo: TestInfo,
): Promise<{ electronApp: ElectronApplication; page: Page }> {
  const dbPath = testInfo.outputPath("viblack.channel-metadata.e2e.sqlite");
  const fakeCodexPath = resolveFakeCodexPath();
  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      VIBLACK_DB_PATH: dbPath,
      VIBLACK_CODEX_PATH: fakeCodexPath,
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect(page).toHaveTitle("Viblack");
  await expect(page.locator("#status")).not.toHaveText("Loading...");
  return { electronApp, page };
}

async function apiRequest<T>(
  page: Page,
  pathname: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; data: T }> {
  return page.evaluate(
    async ({ pathname: requestPath, init: requestInit }) => {
      const baseUrl = await window.viblackApi.getBackendBaseUrl();
      const response = await fetch(`${baseUrl}${requestPath}`, {
        method: requestInit?.method ?? "GET",
        headers: requestInit?.body ? { "Content-Type": "application/json" } : undefined,
        body: requestInit?.body ? JSON.stringify(requestInit.body) : undefined,
      });
      const text = await response.text();
      return {
        status: response.status,
        data: text ? JSON.parse(text) : null,
      };
    },
    { pathname, init },
  ) as Promise<{ status: number; data: T }>;
}

test("channel execution jobs and member state metadata", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `MetaAlpha${suffix}`;
  const betaName = `MetaBeta${suffix}`;
  const channelName = `meta-room-${suffix}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    const alphaCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: alphaName,
        role: "Planner",
        systemPrompt: "You are Alpha planner. Reply in concise Korean.",
      },
    });
    expect(alphaCreate.status).toBe(201);

    const betaCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: betaName,
        role: "Reviewer",
        systemPrompt: "You are Beta reviewer. Reply in concise Korean.",
      },
    });
    expect(betaCreate.status).toBe(201);

    const channelCreate = await apiRequest<{ channel: { id: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "channel metadata verification",
      },
    });
    expect(channelCreate.status).toBe(201);

    const channelId = channelCreate.data.channel.id;
    const alphaId = alphaCreate.data.agent.id;
    const betaId = betaCreate.data.agent.id;

    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: alphaId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: betaId },
        })
      ).status,
    ).toBe(201);

    const initialReadState = await apiRequest<{
      states: Array<{ agentId: string; isCoordinator: boolean; lastReadMessageId: number }>;
    }>(page, `/api/channels/${channelId}/read-state`);
    expect(initialReadState.status).toBe(200);
    expect(initialReadState.data.states).toHaveLength(2);
    expect(initialReadState.data.states.find((state) => state.agentId === alphaId)?.isCoordinator).toBe(true);
    expect(initialReadState.data.states.find((state) => state.agentId === betaId)?.isCoordinator).toBe(false);

    const sendMessage = await apiRequest<{
      message: { id: number };
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${alphaName}} FORCE_MENTION_NAME:${betaName}`,
        messageKind: "general",
      },
    });
    expect(sendMessage.status).toBe(200);

    await expect
      .poll(async () => {
        const response = await apiRequest<{
          jobs: Array<{
            targetAgentId: string;
            executionKind: string;
            status: string;
            depth: number;
            triggerMessageId: number;
          }>;
        }>(page, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.executionKind}:${job.status}:${job.depth}`).join("|");
      })
      .toBe("mention:succeeded:0|remention:succeeded:1");

    const executionResponse = await apiRequest<{
      jobs: Array<{
        targetAgentId: string;
        executionKind: string;
        status: string;
        depth: number;
        triggerMessageId: number;
      }>;
    }>(page, `/api/channels/${channelId}/executions`);
    expect(executionResponse.status).toBe(200);
    expect(executionResponse.data.jobs[0]).toMatchObject({
      targetAgentId: alphaId,
      executionKind: "mention",
      status: "succeeded",
      depth: 0,
      triggerMessageId: sendMessage.data.message.id,
    });
    expect(executionResponse.data.jobs[1]).toMatchObject({
      targetAgentId: betaId,
      executionKind: "remention",
      status: "succeeded",
      depth: 1,
      triggerMessageId: sendMessage.data.message.id,
    });

    const updatedReadState = await apiRequest<{
      states: Array<{ agentId: string; lastReadMessageId: number; isCoordinator: boolean }>;
    }>(page, `/api/channels/${channelId}/read-state`);
    expect(updatedReadState.status).toBe(200);
    expect(updatedReadState.data.states.find((state) => state.agentId === alphaId)?.lastReadMessageId).toBeGreaterThan(
      0,
    );
    expect(updatedReadState.data.states.find((state) => state.agentId === betaId)?.lastReadMessageId).toBeGreaterThan(
      0,
    );

    const promoteBeta = await apiRequest<{
      state: { agentId: string; isCoordinator: boolean };
    }>(page, `/api/channels/${channelId}/read-state`, {
      method: "POST",
      body: { agentId: betaId, isCoordinator: true },
    });
    expect(promoteBeta.status).toBe(200);
    expect(promoteBeta.data.state).toMatchObject({ agentId: betaId, isCoordinator: true });

    const removeBeta = await apiRequest(page, `/api/channels/${channelId}/members/${betaId}`, {
      method: "DELETE",
    });
    expect(removeBeta.status).toBe(200);

    const afterRemovalReadState = await apiRequest<{
      states: Array<{ agentId: string }>;
    }>(page, `/api/channels/${channelId}/read-state`);
    expect(afterRemovalReadState.status).toBe(200);
    expect(afterRemovalReadState.data.states.some((state) => state.agentId === betaId)).toBe(false);
  } finally {
    await electronApp.close();
  }
});
