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

async function openAddMemberModal(page: Page): Promise<void> {
  await page.locator('[data-section="members"] .section-header').hover();
  await page.locator("#add-member-btn").click({ force: true });
  await expect(page.locator("#member-modal[open]")).toHaveCount(1);
}

function memberRow(page: Page, name: string) {
  return page.locator("#member-list .member-item", { hasText: name });
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
