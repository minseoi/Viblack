import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from "@playwright/test";

async function launchRealCodexApp(
  testInfo: TestInfo,
): Promise<{ electronApp: ElectronApplication; page: Page }> {
  const dbPath = testInfo.outputPath("viblack.real-codex.e2e.sqlite");
  const electronApp = await electron.launch({
    args: ["."],
    env: {
      ...process.env,
      VIBLACK_DB_PATH: dbPath,
      VIBLACK_CODEX_PATH: "codex",
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

test("real codex DM smoke", async ({}, testInfo) => {
  test.skip(!process.env.VIBLACK_E2E_REAL_CODEX, "Set VIBLACK_E2E_REAL_CODEX=1 to run against real codex");
  test.setTimeout(180_000);

  const suffix = Date.now();
  const memberName = `RealCodex${suffix}`;

  const { electronApp, page } = await launchRealCodexApp(testInfo);

  try {
    await expect.poll(async () => page.locator("#member-list .member-item").count()).toBeGreaterThan(0);

    await openAddMemberModal(page);
    await page.fill("#member-name-input", memberName);
    await page.fill("#member-role-input", "Integration Tester");
    await page.fill(
      "#member-prompt-input",
      "너는 통합 테스트용 멤버다. 한국어로 짧고 명확하게 답하고, 한 문장으로 먼저 결론을 말해라.",
    );
    await page.click("#member-save-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);

    await page.locator("#member-list .member-item", { hasText: memberName }).locator(".member-main").click();
    await expect(page.locator("#agent-title")).toHaveText(memberName);

    const promptText = "실제 codex 연동 스모크 테스트야. 한 줄 한국어로만 답해줘.";
    await page.fill("#chat-input", promptText);
    await page.click("#send-btn");

    await expect(page.locator("#messages .msg-user .msg-content", { hasText: promptText })).toHaveCount(1);

    const assistantOrSystem = page
      .locator("#messages .msg-agent .msg-content, #messages .msg-system .msg-content")
      .filter({ hasNotText: "Codex 응답이 비어 있습니다. 다시 시도해 주세요" });
    await expect(assistantOrSystem.first()).toBeVisible({ timeout: 120_000 });
    await expect(assistantOrSystem.first()).not.toHaveText("", { timeout: 120_000 });
  } finally {
    await electronApp.close();
  }
});
