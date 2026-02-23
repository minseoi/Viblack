import { _electron as electron, expect, test } from "@playwright/test";

test("electron app smoke flow", async () => {
  const electronApp = await electron.launch({
    args: ["."],
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    const channelName = `qa-room-${Date.now()}`;

    await expect(page).toHaveTitle("Viblack");
    await expect(page.locator("#status")).not.toHaveText("Loading...");

    await expect
      .poll(async () => page.locator("#member-list .member-item").count())
      .toBeGreaterThan(0);

    await page.locator('[data-section="members"] .section-header').hover();
    await page.locator("#add-member-btn").click({ force: true });
    await expect(page.locator("#member-modal[open]")).toHaveCount(1);
    await page.click("#member-cancel-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);

    await page.locator('[data-section="channels"] .section-header').hover();
    await page.locator("#add-channel-btn").click({ force: true });
    await expect(page.locator("#channel-modal[open]")).toHaveCount(1);
    await page.fill("#channel-name-input", channelName);
    await page.fill("#channel-desc-input", "playwright smoke");
    await page.click("#channel-submit-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(0);

    const createdChannel = page.locator("#channel-list .section-item.channel", {
      hasText: `# ${channelName}`,
    });
    await expect(createdChannel).toHaveCount(1);
    await createdChannel.click();

    await expect(page.locator("#agent-title")).toHaveText(`# ${channelName}`);
    await expect(page.locator("#send-btn")).toBeEnabled();

    await page.fill("#chat-input", "채널 스모크 테스트 메시지");
    await page.click("#send-btn");

    await expect(page.locator("#messages .msg-user .msg-content")).toContainText(
      "채널 스모크 테스트 메시지",
    );
  } finally {
    await electronApp.close();
  }
});
