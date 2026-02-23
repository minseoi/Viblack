import { _electron as electron, expect, test } from "@playwright/test";

test("electron app smoke flow", async () => {
  const electronApp = await electron.launch({
    args: ["."],
  });

  try {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    await expect(page).toHaveTitle("Viblack");
    await expect(page.locator("#status")).not.toHaveText("Loading...");

    await expect
      .poll(async () => page.locator("#member-list .member-item").count())
      .toBeGreaterThan(0);

    await page.locator('[data-section="members"] .section-header').hover();
    await page.click("#add-member-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(1);
    await page.click("#member-cancel-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);

    await page.locator('[data-section="channels"] .section-header').hover();
    await page.click("#add-channel-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(1);
    await page.fill("#channel-name-input", "qa-room");
    await page.fill("#channel-desc-input", "playwright smoke");
    await page.click("#channel-submit-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(0);

    const createdChannel = page.locator("#channel-list .section-item.channel", {
      hasText: "# qa-room",
    });
    await expect(createdChannel).toHaveCount(1);
    await createdChannel.click();

    await expect(page.locator("#agent-title")).toHaveText("# qa-room");
    await expect(page.locator("#send-btn")).toBeDisabled();
  } finally {
    await electronApp.close();
  }
});
