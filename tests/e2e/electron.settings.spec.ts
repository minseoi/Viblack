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
    // Best effort for non-Windows environments.
  }
  return unixPath;
}

function resolveModelsCachePath(): string {
  return path.resolve(__dirname, "fixtures", "models-cache.json");
}

async function launchIsolatedApp(
  testInfo: TestInfo,
): Promise<{ electronApp: ElectronApplication; page: Page }> {
  const dbPath = testInfo.outputPath("viblack.settings.sqlite");
  const fakeCodexPath = resolveFakeCodexPath();
  const modelsCachePath = resolveModelsCachePath();
  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      VIBLACK_DB_PATH: dbPath,
      VIBLACK_CODEX_PATH: fakeCodexPath,
      VIBLACK_MODELS_CACHE_PATH: modelsCachePath,
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

function createWorkspaceDir(testInfo: TestInfo, label: string): string {
  const safeLabel = label.replace(/[^a-z0-9_.-]+/gi, "-");
  const workspacePath = testInfo.outputPath(`workspace-${safeLabel}`);
  fs.mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}

async function openAddMemberModal(page: Page): Promise<void> {
  await page.locator('[data-section="members"] .section-header').hover();
  await page.locator("#add-member-btn").click({ force: true });
  await expect(page.locator("#member-modal[open]")).toHaveCount(1);
}

function memberRow(page: Page, name: string) {
  return page.locator("#member-list .member-item", { hasText: name });
}

function channelRow(page: Page, channelName: string) {
  return page.locator("#channel-list .section-item.channel", { hasText: `# ${channelName}` });
}

test("electron settings modal saves selected model and uses it for exec", async ({}, testInfo) => {
  const memberName = `ModelQA${Date.now()}`;
  const selectedModel = "gpt-5.4-mini";
  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    await expect(page.locator(".sidebar-footer #open-settings-btn")).toHaveCount(1);
    await expect(page.locator(".top-right #open-settings-btn")).toHaveCount(0);

    await page.locator("#open-settings-btn").click();
    await expect(page.locator("#settings-modal[open]")).toHaveCount(1);
    await expect(page.locator(".settings-workspace")).not.toContainText(
      "Slack 스타일 설정 화면에서 Codex 실행 모델을 관리합니다.",
    );
    await expect(page.locator("#settings-tab-model")).toHaveClass(/active/);
    await expect(page.locator("#settings-tab-debug")).not.toHaveClass(/active/);
    await expect(page.locator("#settings-panel-model")).toBeVisible();
    await expect(page.locator("#settings-panel-debug")).toBeHidden();

    const modelSelect = page.locator("#settings-model-select");
    await expect(modelSelect.locator("option")).toHaveCount(4);
    await expect(modelSelect.locator("option").nth(1)).toHaveText("gpt-5.4");
    await expect(modelSelect.locator("option").nth(2)).toHaveText("gpt-5.4-mini");
    await expect(modelSelect.locator("option").nth(3)).toHaveText("gpt-5-codex-mini");

    await modelSelect.selectOption(selectedModel);
    await page.locator("#settings-model-save-btn").click();
    await expect(page.locator("#settings-modal[open]")).toHaveCount(0);
    await expect(page.locator("#workspace-model-indicator")).toHaveText(`모델 · ${selectedModel}`);

    await page.locator("#open-settings-btn").click();
    await expect(page.locator("#settings-modal[open]")).toHaveCount(1);
    await expect(page.locator("#settings-current-model")).toHaveText(selectedModel);
    await expect(modelSelect).toHaveValue(selectedModel);
    await page.locator("#settings-model-cancel-btn").click();
    await expect(page.locator("#settings-modal[open]")).toHaveCount(0);

    await openAddMemberModal(page);
    await page.fill("#member-name-input", memberName);
    await page.fill("#member-role-input", "Model QA");
    await page.fill("#member-prompt-input", "You verify which model was used.");
    await page.click("#member-save-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);

    await memberRow(page, memberName).locator(".member-main").click();
    await expect(page.locator("#agent-title")).toHaveText(memberName);
    await page.fill("#chat-input", `FORCE_ASSERT_MODEL:${selectedModel}`);
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: `모델 확인:${selectedModel}`,
      }),
    ).toHaveCount(1);
  } finally {
    await electronApp.close();
  }
});

test("channel action blocks are visible only when debug mode is enabled", async ({}, testInfo) => {
  const suffix = Date.now();
  const leaderName = `영희${suffix}`;
  const researcherName = `존${suffix}`;
  const channelName = `debug-room-${suffix}`;
  const workspacePath = createWorkspaceDir(testInfo, channelName);
  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    const leaderCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: leaderName,
        role: "Coordinator",
        systemPrompt: "You are the coordinator. Reply in concise Korean.",
      },
    });
    expect(leaderCreate.status).toBe(201);

    const researcherCreate = await apiRequest<{ agent: { id: string } }>(page, "/api/agents", {
      method: "POST",
      body: {
        name: researcherName,
        role: "Researcher",
        systemPrompt: "You are the researcher. Reply in concise Korean.",
      },
    });
    expect(researcherCreate.status).toBe(201);

    const channelCreate = await apiRequest<{ channel: { id: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "debug mode channel action block visibility verification",
        workspacePath,
      },
    });
    expect(channelCreate.status).toBe(201);

    const channelId = channelCreate.data.channel.id;
    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: leaderCreate.data.agent.id },
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await apiRequest(page, `/api/channels/${channelId}/members`, {
          method: "POST",
          body: { agentId: researcherCreate.data.agent.id },
        })
      ).status,
    ).toBe(201);

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("#status")).not.toHaveText("Loading...");

    await expect(channelRow(page, channelName)).toHaveCount(1);
    await channelRow(page, channelName).click();
    await expect(page.locator("#agent-title")).toHaveText(`# ${channelName}`);

    await page.fill(
      "#chat-input",
      `@{${leaderName}} ${researcherName}한테 조사 시키고 그 결과를 정리해서 나한테 줘`,
    );
    await page.click("#send-btn");

    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: "최종 정리: 하위 리서치 결과를 바탕으로 사용자용 초안을 정리했습니다.",
      }),
    ).toHaveCount(1);
    await expect(page.locator("#messages")).not.toContainText("CHANNEL_ACTION_BEGIN");

    await page.locator("#open-settings-btn").click();
    await expect(page.locator("#settings-modal[open]")).toHaveCount(1);
    await page.locator("#settings-tab-debug").click();
    await expect(page.locator("#settings-tab-debug")).toHaveClass(/active/);
    await expect(page.locator("#settings-panel-debug")).toBeVisible();
    await expect(page.locator("#settings-panel-model")).toBeHidden();
    await expect(page.locator("#settings-debug-mode-input")).not.toBeChecked();
    await page.locator("#settings-debug-mode-input").check();
    await page.locator("#settings-model-save-btn").click();
    await expect(page.locator("#settings-modal[open]")).toHaveCount(0);

    await expect(page.locator("#messages")).toContainText("CHANNEL_ACTION_BEGIN");
    await expect(page.locator("#messages")).toContainText("type=delegate");

    await page.locator("#open-settings-btn").click();
    await expect(page.locator("#settings-modal[open]")).toHaveCount(1);
    await page.locator("#settings-tab-debug").click();
    await expect(page.locator("#settings-debug-mode-input")).toBeChecked();
    await page.locator("#settings-debug-mode-input").uncheck();
    await page.locator("#settings-model-save-btn").click();
    await expect(page.locator("#settings-modal[open]")).toHaveCount(0);

    await expect(page.locator("#messages")).not.toContainText("CHANNEL_ACTION_BEGIN");
  } finally {
    await electronApp.close();
  }
});
