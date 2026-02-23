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
  const dbPath = testInfo.outputPath("viblack.e2e.sqlite");
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

function memberRow(page: Page, name: string) {
  return page.locator("#member-list .member-item", { hasText: name });
}

function channelRow(page: Page, channelName: string) {
  return page.locator("#channel-list .section-item.channel", { hasText: `# ${channelName}` });
}

async function openAddMemberModal(page: Page): Promise<void> {
  await page.locator('[data-section="members"] .section-header').hover();
  await page.locator("#add-member-btn").click({ force: true });
  await expect(page.locator("#member-modal[open]")).toHaveCount(1);
}

async function openMemberMenu(page: Page, name: string): Promise<void> {
  const row = memberRow(page, name);
  await expect(row).toHaveCount(1);
  await row.hover();
  await page.getByLabel(`${name} 메뉴`).click({ force: true });
  await expect(page.locator("#member-menu.show")).toHaveCount(1);
}

async function openAddChannelModal(page: Page): Promise<void> {
  await page.locator('[data-section="channels"] .section-header').hover();
  await page.locator("#add-channel-btn").click({ force: true });
  await expect(page.locator("#channel-modal[open]")).toHaveCount(1);
}

async function openChannelMenu(page: Page, channelName: string): Promise<void> {
  const row = channelRow(page, channelName);
  await expect(row).toHaveCount(1);
  await row.hover();
  await page.getByLabel(`${channelName} 채널 메뉴`).click({ force: true });
  await expect(page.locator("#channel-menu.show")).toHaveCount(1);
}

test("electron full feature regression flow", async ({}, testInfo) => {
  const suffix = Date.now();
  const memberAlpha = `AlphaQA${suffix}`;
  const memberBeta = `BetaQA${suffix}`;
  const memberAlphaEdited = `AlphaLead${suffix}`;
  const channelName = `qa-room-${suffix}`;
  const editedChannelName = `qa-room-updated-${suffix}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    await expect
      .poll(async () => page.locator("#member-list .member-item").count())
      .toBeGreaterThan(0);

    await openAddMemberModal(page);
    await page.fill("#member-name-input", memberAlpha);
    await page.fill("#member-role-input", "QA Engineer");
    await page.click("#member-generate-prompt-btn");
    await expect(page.locator("#member-prompt-input")).toHaveValue(/테스트용 에이전트/);
    await page.click("#member-save-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);
    await expect(memberRow(page, memberAlpha)).toHaveCount(1);

    await openAddMemberModal(page);
    await page.fill("#member-name-input", memberBeta);
    await page.fill("#member-role-input", "Reviewer");
    await page.fill(
      "#member-prompt-input",
      "You are Beta reviewer. Reply in concise Korean unless asked otherwise.",
    );
    await page.click("#member-save-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);
    await expect(memberRow(page, memberBeta)).toHaveCount(1);

    await openAddMemberModal(page);
    await page.fill("#member-name-input", memberAlpha);
    await page.fill("#member-role-input", "Duplicated");
    await page.fill("#member-prompt-input", "duplicate prompt");
    await page.click("#member-save-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(1);
    await expect(page.locator("#member-name-error")).toContainText("이미 사용 중인 멤버 표시명");
    await page.click("#member-cancel-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);

    await openMemberMenu(page, memberAlpha);
    await page.click("#member-menu-edit");
    await expect(page.locator("#member-modal[open]")).toHaveCount(1);
    await page.fill("#member-name-input", memberAlphaEdited);
    await page.fill("#member-role-input", "Lead QA");
    await page.click("#member-save-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);
    await expect(memberRow(page, memberAlphaEdited)).toHaveCount(1);
    await expect(memberRow(page, memberAlpha)).toHaveCount(0);

    await memberRow(page, memberAlphaEdited).locator(".member-main").click();
    await expect(page.locator("#agent-title")).toHaveText(memberAlphaEdited);
    await page.fill("#chat-input", "DM 회귀 테스트");
    await page.click("#send-btn");
    await expect(page.locator("#messages .msg-user .msg-content")).toContainText("DM 회귀 테스트");
    await expect(page.locator("#messages .msg-agent .msg-content")).toContainText("테스트 응답");

    await openMemberMenu(page, memberAlphaEdited);
    await page.click("#member-menu-clear");
    await page.click("#action-confirm-btn");
    await expect(page.locator("#messages .msg-user .msg-content", { hasText: "DM 회귀 테스트" })).toHaveCount(
      0,
    );

    await openAddChannelModal(page);
    await page.fill("#channel-name-input", channelName);
    await page.fill("#channel-desc-input", "Playwright full feature regression");
    await page.click("#channel-submit-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(0);
    await expect(channelRow(page, channelName)).toHaveCount(1);

    await openChannelMenu(page, channelName);
    await page.click("#channel-menu-edit");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(1);
    await page.fill("#channel-name-input", editedChannelName);
    await page.fill("#channel-desc-input", "updated by e2e");
    await page.click("#channel-submit-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(0);
    await expect(channelRow(page, editedChannelName)).toHaveCount(1);
    await expect(channelRow(page, channelName)).toHaveCount(0);

    await channelRow(page, editedChannelName).click();
    await expect(page.locator("#agent-title")).toHaveText(`# ${editedChannelName}`);
    await expect(page.locator("#channel-members-btn")).toBeVisible();

    await page.click("#channel-members-btn");
    await expect(page.locator("#channel-members-modal[open]")).toHaveCount(1);
    await page.click("#channel-members-add-btn");
    await expect(page.locator("#channel-member-add-modal[open]")).toHaveCount(1);

    await page.locator("#channel-member-add-list .modal-list-item.selectable", { hasText: memberAlphaEdited }).click();
    await page.locator("#channel-member-add-list .modal-list-item.selectable", { hasText: memberBeta }).click();
    await expect(page.locator("#channel-member-add-submit-btn")).toHaveText("2명 추가");
    await page.click("#channel-member-add-submit-btn");
    await expect(page.locator("#channel-member-add-modal[open]")).toHaveCount(0);
    await expect(page.locator("#channel-members-modal[open]")).toHaveCount(1);
    await expect(page.locator("#channel-members-list .modal-list-item.member-entry", { hasText: memberAlphaEdited })).toHaveCount(1);
    await expect(page.locator("#channel-members-list .modal-list-item.member-entry", { hasText: memberBeta })).toHaveCount(1);

    const betaMemberRow = page.locator("#channel-members-list .modal-list-item.member-entry", {
      hasText: memberBeta,
    });
    await betaMemberRow.hover();
    await page.getByLabel(`${memberBeta} 멤버 메뉴`).click({ force: true });
    await page.click("#channel-member-menu-remove");
    await expect(page.locator("#channel-members-list .modal-list-item.member-entry", { hasText: memberBeta })).toHaveCount(0);
    await page.click("#channel-members-close-btn");
    await expect(page.locator("#channel-members-modal[open]")).toHaveCount(0);

    const channelMessages = page.locator("#messages .msg");
    const beforeLogOnlyCount = await channelMessages.count();
    await page.fill("#chat-input", "멘션 없는 채널 메시지");
    await page.click("#send-btn");
    await expect(channelMessages).toHaveCount(beforeLogOnlyCount + 1);

    const beforeMentionCount = await channelMessages.count();
    await page.fill("#chat-input", `@${memberAlphaEdited} 멘션 응답 테스트`);
    await page.click("#send-btn");
    await expect(channelMessages).toHaveCount(beforeMentionCount + 2);
    await expect(page.locator("#messages .msg-agent .msg-sender", { hasText: memberAlphaEdited })).toHaveCount(
      1,
    );
    await expect(page.locator("#messages .msg-agent .msg-content")).toContainText("테스트 응답");

    await openChannelMenu(page, editedChannelName);
    await page.click("#channel-menu-delete");
    await page.click("#action-confirm-btn");
    await expect(channelRow(page, editedChannelName)).toHaveCount(0);

    await openMemberMenu(page, memberBeta);
    await page.click("#member-menu-delete");
    await page.click("#action-confirm-btn");
    await expect(memberRow(page, memberBeta)).toHaveCount(0);

    await openMemberMenu(page, memberAlphaEdited);
    await page.click("#member-menu-delete");
    await page.click("#action-confirm-btn");
    await expect(memberRow(page, memberAlphaEdited)).toHaveCount(0);
  } finally {
    await electronApp.close();
  }
});
