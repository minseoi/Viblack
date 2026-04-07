import fs from "node:fs";
import { expect, test, type TestInfo } from "@playwright/test";
import {
  apiRequest,
  createWorkspaceDir,
  launchBackendHarness,
  resolveFakeCodexPath,
} from "./support/backend-harness";

async function launchIsolatedBackend(testInfo: TestInfo) {
  return launchBackendHarness(testInfo, {
    dbFileName: "viblack.channel-metadata.e2e.sqlite",
    workspaceDirName: "channel-metadata-backend-workspace",
    env: {
      VIBLACK_CODEX_PATH: resolveFakeCodexPath(),
    },
  });
}

async function createChannelViaApi(
  backendBaseUrl: string,
  testInfo: TestInfo,
  name: string,
  description: string,
): Promise<{ id: string; name: string; workspacePath: string }> {
  const workspacePath = createWorkspaceDir(testInfo, name);
  const channelCreate = await apiRequest<{ channel: { id: string; name: string; workspacePath: string } }>(
    backendBaseUrl,
    "/api/channels",
    {
      method: "POST",
      body: {
        name,
        description,
        workspacePath,
      },
    },
  );
  expect(channelCreate.status).toBe(201);
  return channelCreate.data.channel;
}

test("channel execution retries once when codex returns an empty successful response", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `RetryAlpha${suffix}`;
  const channelName = `retry-room-${suffix}`;
  const retryKey = `channel-empty-retry-${suffix}`;
  const finalToken = `channel-empty-retry-ok-${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const alphaCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: alphaName,
        role: "Planner",
        systemPrompt: "You are Alpha planner. Reply in concise Korean.",
      },
    });
    expect(alphaCreate.status).toBe(201);

    const channel = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "channel empty response retry verification");
    const channelId = channel.id;
    const alphaId = alphaCreate.data.agent.id;

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: alphaId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{ message: { id: number } }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
        }>(server.backendBaseUrl, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.targetAgentId}:${job.status}`);
      })
      .toEqual([`${alphaId}:succeeded`]);

    const messagesResponse = await apiRequest<{
      messages: Array<{
        senderType: string;
        content: string;
        messageKind: string;
      }>;
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`);
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
    await server.close();
  }
});

test("archived channel name can be reused by a new active channel", async ({}, testInfo) => {
  const suffix = Date.now();
  const channelName = `reusable-room-${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const firstCreate = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "first active channel");

    const archiveResponse = await apiRequest<{ ok: boolean }>(
      server.backendBaseUrl,
      `/api/channels/${firstCreate.id}`,
      { method: "DELETE" },
    );
    expect(archiveResponse.status).toBe(200);

    const secondCreate = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "recreated active channel");
    expect(secondCreate.name).toBe(channelName);
    expect(secondCreate.id).not.toBe(firstCreate.id);

    const listResponse = await apiRequest<{ channels: Array<{ id: string; name: string }> }>(
      server.backendBaseUrl,
      "/api/channels",
    );
    expect(listResponse.status).toBe(200);
    expect(listResponse.data.channels).toHaveLength(1);
    expect(listResponse.data.channels[0]).toMatchObject({
      id: secondCreate.id,
      name: channelName,
    });
  } finally {
    await server.close();
  }
});

test("delegated code task fails when worker replies with intent only and no artifact report", async ({}, testInfo) => {
  const suffix = Date.now();
  const leaderName = `영희${suffix}`;
  const workerName = `철수${suffix}`;
  const channelName = `code-intent-room-${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const leaderCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: leaderName,
        role: "Planner",
        systemPrompt: "You are Younghee planner. Reply in concise Korean.",
      },
    });
    expect(leaderCreate.status).toBe(201);

    const workerCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: workerName,
        role: "Programmer",
        systemPrompt: "You are Chulsoo programmer. Reply in concise Korean.",
      },
    });
    expect(workerCreate.status).toBe(201);

    const channel = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "code artifact intent-only validation");
    const channelId = channel.id;
    const leaderId = leaderCreate.data.agent.id;
    const workerId = workerCreate.data.agent.id;

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: leaderId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: workerId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{ message: { id: number } }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
        }>(server.backendBaseUrl, `/api/channels/${channelId}/executions`);
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
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`);
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
    await server.close();
  }
});

test("delegated code task continues only after worker reports an existing artifact path", async ({}, testInfo) => {
  const suffix = Date.now();
  const leaderName = `영희${suffix}`;
  const workerName = `철수${suffix}`;
  const channelName = `code-artifact-room-${suffix}`;
  const artifactKey = `code-artifact-${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const leaderCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: leaderName,
        role: "Planner",
        systemPrompt: "You are Younghee planner. Reply in concise Korean.",
      },
    });
    expect(leaderCreate.status).toBe(201);

    const workerCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: workerName,
        role: "Programmer",
        systemPrompt: "You are Chulsoo programmer. Reply in concise Korean.",
      },
    });
    expect(workerCreate.status).toBe(201);

    const channel = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "code artifact success validation");
    const channelId = channel.id;
    const leaderId = leaderCreate.data.agent.id;
    const workerId = workerCreate.data.agent.id;

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: leaderId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: workerId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{ message: { id: number } }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
        }>(server.backendBaseUrl, `/api/channels/${channelId}/executions`);
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
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`);
    expect(messagesResponse.status).toBe(200);
    const workerMessage = messagesResponse.data.messages.find((message) => message.senderId === workerId);
    const expectedChannelWorkspaceDir = channel.workspacePath;
    expect(workerMessage?.content).toContain("viblack-fake-code-artifact-");
    expect(workerMessage?.content).toContain("artifact_path=");
    expect(workerMessage?.content).toContain(expectedChannelWorkspaceDir);
    expect(messagesResponse.data.messages[messagesResponse.data.messages.length - 1]?.senderId).toBe(leaderId);
    expect(messagesResponse.data.messages[messagesResponse.data.messages.length - 1]?.content).toContain(
      "viblack-fake-code-artifact-",
    );
    expect(messagesResponse.data.messages[messagesResponse.data.messages.length - 1]?.content).toContain(
      expectedChannelWorkspaceDir,
    );
    expect(fs.existsSync(expectedChannelWorkspaceDir)).toBe(true);
  } finally {
    await server.close();
  }
});

test("channel workspaces are isolated per channel directory", async ({}, testInfo) => {
  const suffix = Date.now();
  const memberName = `ScopedWorker${suffix}`;
  const firstChannelName = `scoped-a-${suffix}`;
  const secondChannelName = `scoped-b-${suffix}`;
  const fileToken = `channel-file-${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const memberCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: memberName,
        role: "Programmer",
        systemPrompt: "You are a scoped worker. Reply in concise Korean.",
      },
    });
    expect(memberCreate.status).toBe(201);

    const firstChannelCreate = await createChannelViaApi(server.backendBaseUrl, testInfo, firstChannelName, "first isolated workspace");
    const secondChannelCreate = await createChannelViaApi(
      server.backendBaseUrl,
      testInfo,
      secondChannelName,
      "second isolated workspace",
    );

    const memberId = memberCreate.data.agent.id;
    const firstChannelId = firstChannelCreate.id;
    const secondChannelId = secondChannelCreate.id;
    const firstWorkspacePath = firstChannelCreate.workspacePath;
    const secondWorkspacePath = secondChannelCreate.workspacePath;

    expect(fs.existsSync(firstWorkspacePath)).toBe(true);
    expect(fs.existsSync(secondWorkspacePath)).toBe(true);
    expect(firstWorkspacePath).not.toBe(secondWorkspacePath);

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${firstChannelId}/members`, {
          method: "POST",
          body: { agentId: memberId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${secondChannelId}/members`, {
          method: "POST",
          body: { agentId: memberId },
        })
      ).status,
    ).toBe(201);

    const firstWrite = await apiRequest(server.backendBaseUrl, `/api/channels/${firstChannelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${memberName}} FORCE_CHANNEL_FILE_WRITE:${fileToken}`,
        messageKind: "general",
      },
    });
    expect(firstWrite.status).toBe(200);

    await expect
      .poll(async () => {
        const response = await apiRequest<{
          messages: Array<{ senderId: string | null; content: string }>;
        }>(server.backendBaseUrl, `/api/channels/${firstChannelId}/messages`);
        return response.data.messages.find((message) => message.senderId === memberId)?.content ?? "";
      })
      .toContain(`채널 파일 기록:${firstWorkspacePath}`);

    const firstRead = await apiRequest(server.backendBaseUrl, `/api/channels/${firstChannelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${memberName}} FORCE_CHANNEL_FILE_READ:${fileToken}`,
        messageKind: "general",
      },
    });
    expect(firstRead.status).toBe(200);

    await expect
      .poll(async () => {
        const response = await apiRequest<{
          messages: Array<{ senderId: string | null; content: string }>;
        }>(server.backendBaseUrl, `/api/channels/${firstChannelId}/messages`);
        return response.data.messages.some((message) => message.content.includes(`채널 파일 존재:${fileToken}`));
      })
      .toBe(true);

    const secondRead = await apiRequest(server.backendBaseUrl, `/api/channels/${secondChannelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${memberName}} FORCE_CHANNEL_FILE_READ:${fileToken}`,
        messageKind: "general",
      },
    });
    expect(secondRead.status).toBe(200);

    await expect
      .poll(async () => {
        const response = await apiRequest<{
          messages: Array<{ senderId: string | null; content: string }>;
        }>(server.backendBaseUrl, `/api/channels/${secondChannelId}/messages`);
        return response.data.messages.some((message) => message.content.includes(`채널 파일 없음:${fileToken}`));
      })
      .toBe(true);
  } finally {
    await server.close();
  }
});

test("channel execution jobs and member state metadata", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `MetaAlpha${suffix}`;
  const betaName = `MetaBeta${suffix}`;
  const channelName = `meta-room-${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const alphaCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: alphaName,
        role: "Planner",
        systemPrompt: "You are Alpha planner. Reply in concise Korean.",
      },
    });
    expect(alphaCreate.status).toBe(201);

    const betaCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: betaName,
        role: "Reviewer",
        systemPrompt: "You are Beta reviewer. Reply in concise Korean.",
      },
    });
    expect(betaCreate.status).toBe(201);

    const channel = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "channel metadata verification");
    const channelId = channel.id;
    const alphaId = alphaCreate.data.agent.id;
    const betaId = betaCreate.data.agent.id;

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: alphaId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: betaId },
        })
      ).status,
    ).toBe(201);

    const initialReadState = await apiRequest<{
      states: Array<{ agentId: string; isCoordinator: boolean; lastReadMessageId: number }>;
    }>(server.backendBaseUrl, `/api/channels/${channelId}/read-state`);
    expect(initialReadState.status).toBe(200);
    expect(initialReadState.data.states).toHaveLength(2);
    expect(initialReadState.data.states.find((state) => state.agentId === alphaId)?.isCoordinator).toBe(true);
    expect(initialReadState.data.states.find((state) => state.agentId === betaId)?.isCoordinator).toBe(false);

    const sendMessage = await apiRequest<{
      message: { id: number };
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
        }>(server.backendBaseUrl, `/api/channels/${channelId}/executions`);
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
    }>(server.backendBaseUrl, `/api/channels/${channelId}/executions`);
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
    }>(server.backendBaseUrl, `/api/channels/${channelId}/read-state`);
    expect(updatedReadState.status).toBe(200);
    expect(updatedReadState.data.states.find((state) => state.agentId === alphaId)?.lastReadMessageId).toBeGreaterThan(
      0,
    );
    expect(updatedReadState.data.states.find((state) => state.agentId === betaId)?.lastReadMessageId).toBeGreaterThan(
      0,
    );

    const promoteBeta = await apiRequest<{
      state: { agentId: string; isCoordinator: boolean };
    }>(server.backendBaseUrl, `/api/channels/${channelId}/read-state`, {
      method: "POST",
      body: { agentId: betaId, isCoordinator: true },
    });
    expect(promoteBeta.status).toBe(200);
    expect(promoteBeta.data.state).toMatchObject({ agentId: betaId, isCoordinator: true });

    const afterPromotionReadState = await apiRequest<{
      states: Array<{ agentId: string; isCoordinator: boolean }>;
    }>(server.backendBaseUrl, `/api/channels/${channelId}/read-state`);
    expect(afterPromotionReadState.status).toBe(200);
    expect(afterPromotionReadState.data.states.find((state) => state.agentId === alphaId)?.isCoordinator).toBe(false);
    expect(afterPromotionReadState.data.states.find((state) => state.agentId === betaId)?.isCoordinator).toBe(true);

    const removeBeta = await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members/${betaId}`, {
      method: "DELETE",
    });
    expect(removeBeta.status).toBe(200);

    const afterRemovalReadState = await apiRequest<{
      states: Array<{ agentId: string; isCoordinator: boolean }>;
    }>(server.backendBaseUrl, `/api/channels/${channelId}/read-state`);
    expect(afterRemovalReadState.status).toBe(200);
    expect(afterRemovalReadState.data.states.some((state) => state.agentId === betaId)).toBe(false);
    expect(afterRemovalReadState.data.states.find((state) => state.agentId === alphaId)?.isCoordinator).toBe(true);
  } finally {
    await server.close();
  }
});

test("channel execution prompt includes member roster and recent public history", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `CtxAlpha${suffix}`;
  const betaName = `CtxBeta${suffix}`;
  const channelName = `ctx-room-${suffix}`;
  const historyToken = `BETA_SHARED_${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const alphaCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: alphaName,
        role: "Planner",
        systemPrompt: "You are Alpha planner. Reply in concise Korean.",
      },
    });
    expect(alphaCreate.status).toBe(201);

    const betaCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: betaName,
        role: "Reviewer",
        systemPrompt: "You are Beta reviewer. Reply in concise Korean.",
      },
    });
    expect(betaCreate.status).toBe(201);

    const channel = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "channel prompt context verification");
    const channelId = channel.id;
    const alphaId = alphaCreate.data.agent.id;
    const betaId = betaCreate.data.agent.id;

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: alphaId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: betaId },
        })
      ).status,
    ).toBe(201);

    const betaShare = await apiRequest<{
      results: Array<{ reply: string }>;
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${alphaName}} FORCE_ASSERT_CHANNEL_MEMBERS:${alphaName}|${betaName} FORCE_ASSERT_CHANNEL_HISTORY:${historyToken}`,
        messageKind: "general",
      },
    });
    expect(alphaContextCheck.status).toBe(200);
    expect(alphaContextCheck.data.results[0]?.reply).toContain("채널 컨텍스트 확인:ok");
  } finally {
    await server.close();
  }
});

test("dm and channel use isolated runtime sessions for the same agent", async ({}, testInfo) => {
  const suffix = Date.now();
  const memberName = `ScopedMember${suffix}`;
  const channelName = `scoped-room-${suffix}`;
  const dmToken = `DM_SCOPE_${suffix}`;
  const channelToken = `CHANNEL_SCOPE_${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const memberCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: memberName,
        role: "Scoped tester",
        systemPrompt: "You are a scope isolation tester. Reply in concise Korean.",
      },
    });
    expect(memberCreate.status).toBe(201);

    const memberId = memberCreate.data.agent.id;
    const channel = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "runtime session scope verification");
    const channelId = channel.id;

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: memberId },
        })
      ).status,
    ).toBe(201);

    const dmWrite = await apiRequest<{ reply: string }>(server.backendBaseUrl, `/api/agents/${memberId}/messages`, {
      method: "POST",
      body: {
        content: `FORCE_SESSION_MEMORY_WRITE:${dmToken}`,
      },
    });
    expect(dmWrite.status).toBe(200);
    expect(dmWrite.data.reply).toContain(`세션 메모리 기록:${dmToken}`);

    const dmRead = await apiRequest<{ reply: string }>(server.backendBaseUrl, `/api/agents/${memberId}/messages`, {
      method: "POST",
      body: {
        content: `FORCE_SESSION_MEMORY_READ:${dmToken}`,
      },
    });
    expect(dmRead.status).toBe(200);
    expect(dmRead.data.reply).toContain(`세션 메모리 존재:${dmToken}`);

    const channelReadDmToken = await apiRequest<{
      results: Array<{ reply: string }>;
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
      method: "POST",
      body: {
        content: `@{${memberName}} FORCE_SESSION_MEMORY_READ:${channelToken}`,
        messageKind: "general",
      },
    });
    expect(channelRead.status).toBe(200);
    expect(channelRead.data.results[0]?.reply).toContain(`세션 메모리 존재:${channelToken}`);

    const dmReadChannelToken = await apiRequest<{ reply: string }>(server.backendBaseUrl, `/api/agents/${memberId}/messages`, {
      method: "POST",
      body: {
        content: `FORCE_SESSION_MEMORY_READ:${channelToken}`,
      },
    });
    expect(dmReadChannelToken.status).toBe(200);
    expect(dmReadChannelToken.data.reply).toContain(`세션 메모리 없음:${channelToken}`);
  } finally {
    await server.close();
  }
});

test("user-mentioned member becomes sole coordinator even when another member joined first", async ({}, testInfo) => {
  const suffix = Date.now();
  const leaderName = `영희${suffix}`;
  const delegateName = `존${suffix}`;
  const channelName = `mentioned-coordinator-room-${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const leaderCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: leaderName,
        role: "Planner",
        systemPrompt: "You are Younghee planner. Reply in concise Korean.",
      },
    });
    expect(leaderCreate.status).toBe(201);

    const delegateCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: delegateName,
        role: "Researcher",
        systemPrompt: "You are John researcher. Reply in concise Korean.",
      },
    });
    expect(delegateCreate.status).toBe(201);

    const channel = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "first mention should become sole coordinator");
    const channelId = channel.id;
    const leaderId = leaderCreate.data.agent.id;
    const delegateId = delegateCreate.data.agent.id;

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: delegateId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: leaderId },
        })
      ).status,
    ).toBe(201);

    const beforeMessageReadState = await apiRequest<{
      states: Array<{ agentId: string; isCoordinator: boolean }>;
    }>(server.backendBaseUrl, `/api/channels/${channelId}/read-state`);
    expect(beforeMessageReadState.status).toBe(200);
    expect(beforeMessageReadState.data.states.find((state) => state.agentId === delegateId)?.isCoordinator).toBe(true);
    expect(beforeMessageReadState.data.states.find((state) => state.agentId === leaderId)?.isCoordinator).toBe(false);

    const sendMessage = await apiRequest<{
      message: { id: number };
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
        }>(server.backendBaseUrl, `/api/channels/${channelId}/executions`);
        return response.data.jobs.map((job) => `${job.targetAgentId}:${job.executionKind}:${job.status}:${job.depth}`);
      })
      .toEqual([
        `${leaderId}:mention:succeeded:0`,
        `${delegateId}:remention:succeeded:1`,
        `${leaderId}:remention:succeeded:2`,
      ]);

    const afterMessageReadState = await apiRequest<{
      states: Array<{ agentId: string; isCoordinator: boolean; lastReadMessageId: number }>;
    }>(server.backendBaseUrl, `/api/channels/${channelId}/read-state`);
    expect(afterMessageReadState.status).toBe(200);
    expect(afterMessageReadState.data.states.find((state) => state.agentId === leaderId)?.isCoordinator).toBe(true);
    expect(afterMessageReadState.data.states.find((state) => state.agentId === delegateId)?.isCoordinator).toBe(
      false,
    );
    expect(
      afterMessageReadState.data.states.find((state) => state.agentId === leaderId)?.lastReadMessageId,
    ).toBeGreaterThan(0);
  } finally {
    await server.close();
  }
});

test("ambiguous delegated task triggers clarification mention back to requester", async ({}, testInfo) => {
  const suffix = Date.now();
  const leaderName = `영희${suffix}`;
  const workerName = `철수${suffix}`;
  const channelName = `clarify-room-${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const leaderCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: leaderName,
        role: "Planner",
        systemPrompt: "You are Younghee planner. Reply in concise Korean.",
      },
    });
    expect(leaderCreate.status).toBe(201);

    const workerCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: workerName,
        role: "Researcher",
        systemPrompt: "You are Chulsoo researcher. Reply in concise Korean.",
      },
    });
    expect(workerCreate.status).toBe(201);

    const channel = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "clarification mention verification");
    const channelId = channel.id;
    const leaderId = leaderCreate.data.agent.id;
    const workerId = workerCreate.data.agent.id;

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: leaderId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: workerId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{
      message: { id: number };
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
        }>(server.backendBaseUrl, `/api/channels/${channelId}/executions`);
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
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`);
    expect(messagesResponse.status).toBe(200);
    expect(messagesResponse.data.messages[1]?.content).toContain(`@{${workerName}}`);
    expect(messagesResponse.data.messages[2]).toMatchObject({
      senderId: workerId,
      messageKind: "remention",
    });
    expect(messagesResponse.data.messages[2]?.content).toContain(`@{${leaderName}}`);
    expect(messagesResponse.data.messages[2]?.content).toContain("확인 질문:");
  } finally {
    await server.close();
  }
});

test("channel mention chain continues beyond the former depth cap", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `ChainAlpha${suffix}`;
  const betaName = `ChainBeta${suffix}`;
  const channelName = `chain-room-${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const alphaCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: alphaName,
        role: "Planner",
        systemPrompt: "You are Alpha planner. Reply in concise Korean.",
      },
    });
    expect(alphaCreate.status).toBe(201);

    const betaCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: betaName,
        role: "Reviewer",
        systemPrompt: "You are Beta reviewer. Reply in concise Korean.",
      },
    });
    expect(betaCreate.status).toBe(201);

    const channel = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "deep mention chain verification");
    const channelId = channel.id;
    const alphaId = alphaCreate.data.agent.id;
    const betaId = betaCreate.data.agent.id;

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: alphaId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: betaId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{
      message: { id: number };
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
        }>(server.backendBaseUrl, `/api/channels/${channelId}/executions`);
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
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`);
    expect(messagesResponse.status).toBe(200);
    expect(messagesResponse.data.messages).toHaveLength(6);
    expect(messagesResponse.data.messages.some((message) => message.senderType === "system")).toBe(false);
    expect(messagesResponse.data.messages[5]).toMatchObject({
      senderId: alphaId,
      messageKind: "remention",
    });
    expect(messagesResponse.data.messages[5]?.content).toContain("체인 종료");
  } finally {
    await server.close();
  }
});

test("mention execution budget exhaustion skips remaining queued jobs", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `BudgetAlpha${suffix}`;
  const betaName = `BudgetBeta${suffix}`;
  const channelName = `budget-room-${suffix}`;

  const server = await launchIsolatedBackend(testInfo);

  try {
    const alphaCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: alphaName,
        role: "Planner",
        systemPrompt: "You are Alpha planner. Reply in concise Korean.",
      },
    });
    expect(alphaCreate.status).toBe(201);

    const betaCreate = await apiRequest<{ agent: { id: string } }>(server.backendBaseUrl, "/api/agents", {
      method: "POST",
      body: {
        name: betaName,
        role: "Reviewer",
        systemPrompt: "You are Beta reviewer. Reply in concise Korean.",
      },
    });
    expect(betaCreate.status).toBe(201);

    const channel = await createChannelViaApi(server.backendBaseUrl, testInfo, channelName, "mention execution budget verification");
    const channelId = channel.id;
    const alphaId = alphaCreate.data.agent.id;
    const betaId = betaCreate.data.agent.id;

    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: alphaId },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(server.backendBaseUrl, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: betaId },
        })
      ).status,
    ).toBe(201);

    const sendMessage = await apiRequest<{
      message: { id: number };
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`, {
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
        }>(server.backendBaseUrl, `/api/channels/${channelId}/executions`);
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
    }>(server.backendBaseUrl, `/api/channels/${channelId}/messages`);
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
    await server.close();
  }
});
