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

test("channel execution retries once when codex returns an empty successful response", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `RetryAlpha${suffix}`;
  const channelName = `retry-room-${suffix}`;
  const retryKey = `channel-empty-retry-${suffix}`;
  const finalToken = `channel-empty-retry-ok-${suffix}`;

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

    const channelCreate = await apiRequest<{ channel: { id: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "channel empty response retry verification",
      },
    });
    expect(channelCreate.status).toBe(201);

    const channelId = channelCreate.data.channel.id;
    const alphaId = alphaCreate.data.agent.id;

    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: alphaId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{ message: { id: number } }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${alphaName}} FORCE_EMPTY_SUCCESS_ONCE:${retryKey} FORCE_FINAL_REPLY:${finalToken}`,
        messageKind: "general",
      },
    });
    expect(sendMessage.status).toBe(200);

    await expect
      .poll(async () => {
        const response = await apiRequest<{
          jobs: Array<{
            targetAgentId: string;
            status: string;
          }>;
        }>(page, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.targetAgentId}:${job.status}`);
      })
      .toEqual([`${alphaId}:succeeded`]);

    const messagesResponse = await apiRequest<{
      messages: Array<{
        senderType: string;
        content: string;
        messageKind: string;
      }>;
    }>(page, `/api/channels/${channelId}/messages`);
    expect(messagesResponse.status).toBe(200);
    expect(messagesResponse.data.messages).toHaveLength(2);
    expect(messagesResponse.data.messages[1]).toMatchObject({
      senderType: "agent",
      messageKind: "result",
    });
    expect(messagesResponse.data.messages[1]?.content).toContain(finalToken);
    expect(messagesResponse.data.messages.some((message) => message.content.includes("empty response from codex"))).toBe(
      false,
    );
  } finally {
    await electronApp.close();
  }
});

test("archived channel name can be reused by a new active channel", async ({}, testInfo) => {
  const suffix = Date.now();
  const channelName = `reusable-room-${suffix}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    const firstCreate = await apiRequest<{ channel: { id: string; name: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "first active channel",
      },
    });
    expect(firstCreate.status).toBe(201);

    const archiveResponse = await apiRequest<{ ok: boolean }>(
      page,
      `/api/channels/${firstCreate.data.channel.id}`,
      { method: "DELETE" },
    );
    expect(archiveResponse.status).toBe(200);

    const secondCreate = await apiRequest<{ channel: { id: string; name: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "recreated active channel",
      },
    });
    expect(secondCreate.status).toBe(201);
    expect(secondCreate.data.channel.name).toBe(channelName);
    expect(secondCreate.data.channel.id).not.toBe(firstCreate.data.channel.id);

    const listResponse = await apiRequest<{ channels: Array<{ id: string; name: string }> }>(
      page,
      "/api/channels",
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.data.channels).toHaveLength(1);
    expect(listResponse.data.channels[0]).toMatchObject({
      id: secondCreate.data.channel.id,
      name: channelName,
    });
  } finally {
    await electronApp.close();
  }
});

test("delegated code task fails when worker replies with intent only and no artifact report", async ({}, testInfo) => {
  const suffix = Date.now();
  const leaderName = `영희${suffix}`;
  const workerName = `철수${suffix}`;
  const channelName = `code-intent-room-${suffix}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    const leaderCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: leaderName,
        role: "Planner",
        systemPrompt: "You are Younghee planner. Reply in concise Korean.",
      },
    });
    expect(leaderCreate.status).toBe(201);

    const workerCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: workerName,
        role: "Programmer",
        systemPrompt: "You are Chulsoo programmer. Reply in concise Korean.",
      },
    });
    expect(workerCreate.status).toBe(201);

    const channelCreate = await apiRequest<{ channel: { id: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "code artifact intent-only validation",
      },
    });
    expect(channelCreate.status).toBe(201);

    const channelId = channelCreate.data.channel.id;
    const leaderId = leaderCreate.data.agent.id;
    const workerId = workerCreate.data.agent.id;

    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: leaderId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: workerId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{ message: { id: number } }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${leaderName}} FORCE_CODE_ARTIFACT_INTENT_ONLY 철수한테 구현 시키고 파일 경로 보고받아`,
        messageKind: "general",
      },
    });
    expect(sendMessage.status).toBe(200);

    await expect
      .poll(async () => {
        const response = await apiRequest<{
          jobs: Array<{
            targetAgentId: string;
            status: string;
          }>;
        }>(page, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.targetAgentId}:${job.status}`);
      })
      .toEqual([`${leaderId}:succeeded`, `${workerId}:failed`]);

    const messagesResponse = await apiRequest<{
      messages: Array<{
        senderType: string;
        senderId: string | null;
        content: string;
        messageKind: string;
      }>;
    }>(page, `/api/channels/${channelId}/messages`);
    expect(messagesResponse.status).toBe(200);
    expect(messagesResponse.data.messages[messagesResponse.data.messages.length - 1]).toMatchObject({
      senderType: "system",
      messageKind: "remention",
    });
    expect(messagesResponse.data.messages[messagesResponse.data.messages.length - 1]?.content).toContain(
      "채널 코드 작업 미완료:",
    );
    expect(messagesResponse.data.messages[messagesResponse.data.messages.length - 1]?.content).toContain(
      "type=report action이 필요합니다.",
    );
  } finally {
    await electronApp.close();
  }
});

test("delegated code task continues only after worker reports an existing artifact path", async ({}, testInfo) => {
  const suffix = Date.now();
  const leaderName = `영희${suffix}`;
  const workerName = `철수${suffix}`;
  const channelName = `code-artifact-room-${suffix}`;
  const artifactKey = `code-artifact-${suffix}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    const leaderCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: leaderName,
        role: "Planner",
        systemPrompt: "You are Younghee planner. Reply in concise Korean.",
      },
    });
    expect(leaderCreate.status).toBe(201);

    const workerCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: workerName,
        role: "Programmer",
        systemPrompt: "You are Chulsoo programmer. Reply in concise Korean.",
      },
    });
    expect(workerCreate.status).toBe(201);

    const channelCreate = await apiRequest<{ channel: { id: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "code artifact success validation",
      },
    });
    expect(channelCreate.status).toBe(201);

    const channelId = channelCreate.data.channel.id;
    const leaderId = leaderCreate.data.agent.id;
    const workerId = workerCreate.data.agent.id;

    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: leaderId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: workerId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{ message: { id: number } }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${leaderName}} FORCE_CODE_ARTIFACT_SUCCESS:${artifactKey} 철수한테 구현 시키고 파일 경로 보고받아`,
        messageKind: "general",
      },
    });
    expect(sendMessage.status).toBe(200);

    await expect
      .poll(async () => {
        const response = await apiRequest<{
          jobs: Array<{
            targetAgentId: string;
            status: string;
          }>;
        }>(page, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.targetAgentId}:${job.status}`);
      })
      .toEqual([`${leaderId}:succeeded`, `${workerId}:succeeded`, `${leaderId}:succeeded`]);

    const messagesResponse = await apiRequest<{
      messages: Array<{
        senderType: string;
        senderId: string | null;
        content: string;
        messageKind: string;
      }>;
    }>(page, `/api/channels/${channelId}/messages`);
    expect(messagesResponse.status).toBe(200);
    const workerMessage = messagesResponse.data.messages.find((message) => message.senderId === workerId);
    expect(workerMessage?.content).toContain("viblack-fake-code-artifact-");
    expect(workerMessage?.content).toContain("artifact_path=");
    expect(messagesResponse.data.messages[messagesResponse.data.messages.length - 1]?.senderId).toBe(leaderId);
    expect(messagesResponse.data.messages[messagesResponse.data.messages.length - 1]?.content).toContain(
      "viblack-fake-code-artifact-",
    );
  } finally {
    await electronApp.close();
  }
});

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

    const afterPromotionReadState = await apiRequest<{
      states: Array<{ agentId: string; isCoordinator: boolean }>;
    }>(page, `/api/channels/${channelId}/read-state`);
    expect(afterPromotionReadState.status).toBe(200);
    expect(afterPromotionReadState.data.states.find((state) => state.agentId === alphaId)?.isCoordinator).toBe(false);
    expect(afterPromotionReadState.data.states.find((state) => state.agentId === betaId)?.isCoordinator).toBe(true);

    const removeBeta = await apiRequest(page, `/api/channels/${channelId}/members/${betaId}`, {
      method: "DELETE",
    });
    expect(removeBeta.status).toBe(200);

    const afterRemovalReadState = await apiRequest<{
      states: Array<{ agentId: string; isCoordinator: boolean }>;
    }>(page, `/api/channels/${channelId}/read-state`);
    expect(afterRemovalReadState.status).toBe(200);
    expect(afterRemovalReadState.data.states.some((state) => state.agentId === betaId)).toBe(false);
    expect(afterRemovalReadState.data.states.find((state) => state.agentId === alphaId)?.isCoordinator).toBe(true);
  } finally {
    await electronApp.close();
  }
});

test("channel execution prompt includes member roster and recent public history", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `CtxAlpha${suffix}`;
  const betaName = `CtxBeta${suffix}`;
  const channelName = `ctx-room-${suffix}`;
  const historyToken = `BETA_SHARED_${suffix}`;

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
        description: "channel prompt context verification",
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

    const betaShare = await apiRequest<{
      results: Array<{ reply: string }>;
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${betaName}} FORCE_FINAL_REPLY:${historyToken}`,
        messageKind: "general",
      },
    });
    expect(betaShare.status).toBe(200);
    expect(betaShare.data.results[0]?.reply).toContain(historyToken);

    const alphaContextCheck = await apiRequest<{
      results: Array<{ reply: string }>;
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${alphaName}} FORCE_ASSERT_CHANNEL_MEMBERS:${alphaName}|${betaName} FORCE_ASSERT_CHANNEL_HISTORY:${historyToken}`,
        messageKind: "general",
      },
    });
    expect(alphaContextCheck.status).toBe(200);
    expect(alphaContextCheck.data.results[0]?.reply).toContain("채널 컨텍스트 확인:ok");
  } finally {
    await electronApp.close();
  }
});

test("dm and channel use isolated runtime sessions for the same agent", async ({}, testInfo) => {
  const suffix = Date.now();
  const memberName = `ScopedMember${suffix}`;
  const channelName = `scoped-room-${suffix}`;
  const dmToken = `DM_SCOPE_${suffix}`;
  const channelToken = `CHANNEL_SCOPE_${suffix}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    const memberCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: memberName,
        role: "Scoped tester",
        systemPrompt: "You are a scope isolation tester. Reply in concise Korean.",
      },
    });
    expect(memberCreate.status).toBe(201);

    const channelCreate = await apiRequest<{ channel: { id: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "runtime session scope verification",
      },
    });
    expect(channelCreate.status).toBe(201);

    const memberId = memberCreate.data.agent.id;
    const channelId = channelCreate.data.channel.id;

    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: memberId },
        })
      ).status,
    ).toBe(201);

    const dmWrite = await apiRequest<{ reply: string }>(page, `/api/agents/${memberId}/messages`, {
      method: "POST",
      body: {
        content: `FORCE_SESSION_MEMORY_WRITE:${dmToken}`,
      },
    });
    expect(dmWrite.status).toBe(200);
    expect(dmWrite.data.reply).toContain(`세션 메모리 기록:${dmToken}`);

    const dmRead = await apiRequest<{ reply: string }>(page, `/api/agents/${memberId}/messages`, {
      method: "POST",
      body: {
        content: `FORCE_SESSION_MEMORY_READ:${dmToken}`,
      },
    });
    expect(dmRead.status).toBe(200);
    expect(dmRead.data.reply).toContain(`세션 메모리 존재:${dmToken}`);

    const channelReadDmToken = await apiRequest<{
      results: Array<{ reply: string }>;
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${memberName}} FORCE_SESSION_MEMORY_READ:${dmToken}`,
        messageKind: "general",
      },
    });
    expect(channelReadDmToken.status).toBe(200);
    expect(channelReadDmToken.data.results[0]?.reply).toContain(`세션 메모리 없음:${dmToken}`);

    const channelWrite = await apiRequest<{
      results: Array<{ reply: string }>;
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${memberName}} FORCE_SESSION_MEMORY_WRITE:${channelToken}`,
        messageKind: "general",
      },
    });
    expect(channelWrite.status).toBe(200);
    expect(channelWrite.data.results[0]?.reply).toContain(`세션 메모리 기록:${channelToken}`);

    const channelRead = await apiRequest<{
      results: Array<{ reply: string }>;
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${memberName}} FORCE_SESSION_MEMORY_READ:${channelToken}`,
        messageKind: "general",
      },
    });
    expect(channelRead.status).toBe(200);
    expect(channelRead.data.results[0]?.reply).toContain(`세션 메모리 존재:${channelToken}`);

    const dmReadChannelToken = await apiRequest<{ reply: string }>(page, `/api/agents/${memberId}/messages`, {
      method: "POST",
      body: {
        content: `FORCE_SESSION_MEMORY_READ:${channelToken}`,
      },
    });
    expect(dmReadChannelToken.status).toBe(200);
    expect(dmReadChannelToken.data.reply).toContain(`세션 메모리 없음:${channelToken}`);
  } finally {
    await electronApp.close();
  }
});

test("natural language delegation request becomes channel mention chain", async ({}, testInfo) => {
  const suffix = Date.now();
  const leaderName = `영희${suffix}`;
  const delegateName = `존${suffix}`;
  const channelName = `delegate-room-${suffix}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    const leaderCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: leaderName,
        role: "Planner",
        systemPrompt: "You are Younghee planner. Reply in concise Korean.",
      },
    });
    expect(leaderCreate.status).toBe(201);

    const delegateCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: delegateName,
        role: "Researcher",
        systemPrompt: "You are John researcher. Reply in concise Korean.",
      },
    });
    expect(delegateCreate.status).toBe(201);

    const channelCreate = await apiRequest<{ channel: { id: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "delegation mention chain verification",
      },
    });
    expect(channelCreate.status).toBe(201);

    const channelId = channelCreate.data.channel.id;
    const leaderId = leaderCreate.data.agent.id;
    const delegateId = delegateCreate.data.agent.id;

    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: leaderId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: delegateId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{
      message: { id: number };
      results: Array<{ agentId: string; reply: string }>;
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${leaderName}} ${delegateName}한테 조사 시키고 그 결과를 정리해서 나한테 줘`,
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
          }>;
        }>(page, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.targetAgentId}:${job.executionKind}:${job.status}:${job.depth}`);
      })
      .toEqual([
        `${leaderId}:mention:succeeded:0`,
        `${delegateId}:remention:succeeded:1`,
        `${leaderId}:remention:succeeded:2`,
      ]);

    const messagesResponse = await apiRequest<{
      messages: Array<{
        senderId: string | null;
        content: string;
        messageKind: string;
      }>;
    }>(page, `/api/channels/${channelId}/messages`);
    expect(messagesResponse.status).toBe(200);
    expect(messagesResponse.data.messages).toHaveLength(4);
    expect(messagesResponse.data.messages[1]).toMatchObject({
      senderId: leaderId,
      messageKind: "result",
    });
    expect(messagesResponse.data.messages[1]?.content).toContain(`@{${delegateName}}`);
    expect(messagesResponse.data.messages[2]).toMatchObject({
      senderId: delegateId,
      messageKind: "remention",
    });
    expect(messagesResponse.data.messages[2]?.content).toContain(`@{${leaderName}}`);
    expect(messagesResponse.data.messages[2]?.content).toContain("조사 결과 보고:");
    expect(messagesResponse.data.messages[3]).toMatchObject({
      senderId: leaderId,
      messageKind: "remention",
    });
    expect(messagesResponse.data.messages[3]?.content).toContain("최종 정리:");
  } finally {
    await electronApp.close();
  }
});

test("user-mentioned member becomes sole coordinator even when another member joined first", async ({}, testInfo) => {
  const suffix = Date.now();
  const leaderName = `영희${suffix}`;
  const delegateName = `존${suffix}`;
  const channelName = `mentioned-coordinator-room-${suffix}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    const leaderCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: leaderName,
        role: "Planner",
        systemPrompt: "You are Younghee planner. Reply in concise Korean.",
      },
    });
    expect(leaderCreate.status).toBe(201);

    const delegateCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: delegateName,
        role: "Researcher",
        systemPrompt: "You are John researcher. Reply in concise Korean.",
      },
    });
    expect(delegateCreate.status).toBe(201);

    const channelCreate = await apiRequest<{ channel: { id: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "first mention should become sole coordinator",
      },
    });
    expect(channelCreate.status).toBe(201);

    const channelId = channelCreate.data.channel.id;
    const leaderId = leaderCreate.data.agent.id;
    const delegateId = delegateCreate.data.agent.id;

    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: delegateId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: leaderId },
        })
      ).status,
    ).toBe(201);

    const beforeMessageReadState = await apiRequest<{
      states: Array<{ agentId: string; isCoordinator: boolean }>;
    }>(page, `/api/channels/${channelId}/read-state`);
    expect(beforeMessageReadState.status).toBe(200);
    expect(beforeMessageReadState.data.states.find((state) => state.agentId === delegateId)?.isCoordinator).toBe(true);
    expect(beforeMessageReadState.data.states.find((state) => state.agentId === leaderId)?.isCoordinator).toBe(false);

    const sendMessage = await apiRequest<{
      message: { id: number };
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${leaderName}} ${delegateName}한테 조사 시키고 그 결과를 정리해서 나한테 줘`,
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
          }>;
        }>(page, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.targetAgentId}:${job.executionKind}:${job.status}:${job.depth}`);
      })
      .toEqual([
        `${leaderId}:mention:succeeded:0`,
        `${delegateId}:remention:succeeded:1`,
        `${leaderId}:remention:succeeded:2`,
      ]);

    const afterMessageReadState = await apiRequest<{
      states: Array<{ agentId: string; isCoordinator: boolean; lastReadMessageId: number }>;
    }>(page, `/api/channels/${channelId}/read-state`);
    expect(afterMessageReadState.status).toBe(200);
    expect(afterMessageReadState.data.states.find((state) => state.agentId === leaderId)?.isCoordinator).toBe(true);
    expect(afterMessageReadState.data.states.find((state) => state.agentId === delegateId)?.isCoordinator).toBe(
      false,
    );
    expect(
      afterMessageReadState.data.states.find((state) => state.agentId === leaderId)?.lastReadMessageId,
    ).toBeGreaterThan(0);
  } finally {
    await electronApp.close();
  }
});

test("ambiguous delegated task triggers clarification mention back to requester", async ({}, testInfo) => {
  const suffix = Date.now();
  const leaderName = `영희${suffix}`;
  const workerName = `철수${suffix}`;
  const channelName = `clarify-room-${suffix}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    const leaderCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: leaderName,
        role: "Planner",
        systemPrompt: "You are Younghee planner. Reply in concise Korean.",
      },
    });
    expect(leaderCreate.status).toBe(201);

    const workerCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: workerName,
        role: "Researcher",
        systemPrompt: "You are Chulsoo researcher. Reply in concise Korean.",
      },
    });
    expect(workerCreate.status).toBe(201);

    const channelCreate = await apiRequest<{ channel: { id: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "clarification mention verification",
      },
    });
    expect(channelCreate.status).toBe(201);

    const channelId = channelCreate.data.channel.id;
    const leaderId = leaderCreate.data.agent.id;
    const workerId = workerCreate.data.agent.id;

    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: leaderId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: workerId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{
      message: { id: number };
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${leaderName}} ${workerName}한테 그거 조사 시키고 정리해서 줘`,
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
          }>;
        }>(page, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.targetAgentId}:${job.executionKind}:${job.status}:${job.depth}`);
      })
      .toEqual([
        `${leaderId}:mention:succeeded:0`,
        `${workerId}:remention:succeeded:1`,
        `${leaderId}:remention:succeeded:2`,
      ]);

    const messagesResponse = await apiRequest<{
      messages: Array<{
        senderId: string | null;
        content: string;
        messageKind: string;
      }>;
    }>(page, `/api/channels/${channelId}/messages`);
    expect(messagesResponse.status).toBe(200);
    expect(messagesResponse.data.messages[1]?.content).toContain(`@{${workerName}}`);
    expect(messagesResponse.data.messages[2]).toMatchObject({
      senderId: workerId,
      messageKind: "remention",
    });
    expect(messagesResponse.data.messages[2]?.content).toContain(`@{${leaderName}}`);
    expect(messagesResponse.data.messages[2]?.content).toContain("확인 질문:");
  } finally {
    await electronApp.close();
  }
});

test("channel mention chain continues beyond the former depth cap", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `ChainAlpha${suffix}`;
  const betaName = `ChainBeta${suffix}`;
  const channelName = `chain-room-${suffix}`;

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
        description: "deep mention chain verification",
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

    const sendMessage = await apiRequest<{
      message: { id: number };
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${alphaName}} FORCE_CHAIN_BOUNCE:${betaName},4`,
        messageKind: "general",
      },
    });
    expect(sendMessage.status).toBe(200);

    await expect
      .poll(async () => {
        const response = await apiRequest<{
          jobs: Array<{
            targetAgentId: string;
            status: string;
            depth: number;
          }>;
        }>(page, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.targetAgentId}:${job.status}:${job.depth}`);
      })
      .toEqual([
        `${alphaId}:succeeded:0`,
        `${betaId}:succeeded:1`,
        `${alphaId}:succeeded:2`,
        `${betaId}:succeeded:3`,
        `${alphaId}:succeeded:4`,
      ]);

    const messagesResponse = await apiRequest<{
      messages: Array<{
        senderType: string;
        senderId: string | null;
        content: string;
        messageKind: string;
      }>;
    }>(page, `/api/channels/${channelId}/messages`);
    expect(messagesResponse.status).toBe(200);
    expect(messagesResponse.data.messages).toHaveLength(6);
    expect(messagesResponse.data.messages.some((message) => message.senderType === "system")).toBe(false);
    expect(messagesResponse.data.messages[5]).toMatchObject({
      senderId: alphaId,
      messageKind: "remention",
    });
    expect(messagesResponse.data.messages[5]?.content).toContain("체인 종료");
  } finally {
    await electronApp.close();
  }
});

test("mention execution budget exhaustion skips remaining queued jobs", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `BudgetAlpha${suffix}`;
  const betaName = `BudgetBeta${suffix}`;
  const channelName = `budget-room-${suffix}`;

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
        description: "mention execution budget verification",
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

    const sendMessage = await apiRequest<{
      message: { id: number };
    }>(page, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${alphaName}} FORCE_CHAIN_BOUNCE:${betaName},12`,
        messageKind: "general",
      },
    });
    expect(sendMessage.status).toBe(200);

    const expectedJobStatuses = Array.from({ length: 12 }, (_, depth) => {
      const agentId = depth % 2 === 0 ? alphaId : betaId;
      return `${agentId}:succeeded:${depth}`;
    });
    expectedJobStatuses.push(`${alphaId}:skipped:12`);

    await expect
      .poll(async () => {
        const response = await apiRequest<{
          jobs: Array<{
            targetAgentId: string;
            status: string;
            depth: number;
          }>;
        }>(page, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.targetAgentId}:${job.status}:${job.depth}`);
      })
      .toEqual(expectedJobStatuses);

    const messagesResponse = await apiRequest<{
      messages: Array<{
        senderType: string;
        senderId: string | null;
        content: string;
        messageKind: string;
      }>;
    }>(page, `/api/channels/${channelId}/messages`);
    expect(messagesResponse.status).toBe(200);

    const systemMessages = messagesResponse.data.messages.filter((message) => message.senderType === "system");
    expect(systemMessages).toHaveLength(1);
    expect(systemMessages[0]?.messageKind).toBe("result");
    expect(systemMessages[0]?.content).toContain("멘션 실행 한도(12건)");
    expect(systemMessages[0]?.content).toContain("남은 후속 멘션 1건");
    expect(messagesResponse.data.messages.at(-1)).toMatchObject({
      senderType: "system",
      messageKind: "result",
    });
  } finally {
    await electronApp.close();
  }
});
