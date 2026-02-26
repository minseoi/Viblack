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
  await row.locator(".member-menu-btn").click({ force: true });
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
  await row.locator(".channel-menu-btn").click({ force: true });
  await expect(page.locator("#channel-menu.show")).toHaveCount(1);
}

test("electron full feature regression flow", async ({}, testInfo) => {
  const suffix = Date.now();
  const memberAlpha = `AlphaQA${suffix}`;
  const memberBeta = `BetaQA${suffix}`;
  const memberAlphaEdited = `AlphaLead${suffix}`;
  const memberPromptToken = `PROMPT_TOKEN_${suffix}`;
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
    await expect(page.locator("#member-prompt-input")).not.toHaveValue("");
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
    await expect(page.locator("#member-name-input")).toHaveClass(/field-error/);
    await expect(page.locator("#member-name-error")).toBeVisible();
    await page.click("#member-cancel-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);

    await openMemberMenu(page, memberAlpha);
    await page.click("#member-menu-edit");
    await expect(page.locator("#member-modal[open]")).toHaveCount(1);
    await page.fill("#member-name-input", memberAlphaEdited);
    await page.fill("#member-role-input", "Lead QA");
    await page.fill(
      "#member-prompt-input",
      `You are Alpha lead. Must preserve token ${memberPromptToken} in your internal rules.`,
    );
    await page.click("#member-save-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);
    await expect(memberRow(page, memberAlphaEdited)).toHaveCount(1);
    await expect(memberRow(page, memberAlpha)).toHaveCount(0);

    await memberRow(page, memberAlphaEdited).locator(".member-main").click();
    await expect(page.locator("#agent-title")).toHaveText(memberAlphaEdited);
    await page.fill("#chat-input", `FORCE_ASSERT_MEMBER_PROMPT:${memberPromptToken}`);
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: `멤버 프롬프트 확인:${memberPromptToken}`,
      }),
    ).toHaveCount(1);
    await page.fill("#chat-input", "DM smoke ping");
    await page.click("#send-btn");
    await expect(page.locator("#messages .msg-user .msg-content", { hasText: "DM smoke ping" })).toHaveCount(1);
    await expect(page.locator("#messages .msg-agent .msg-content", { hasText: "테스트 응답" })).toHaveCount(1);

    // A 응답 대기 중에도 B에게 DM 전송 가능해야 한다.
    await page.fill(
      "#chat-input",
      `DM alpha delayed FORCE_MENTION_NAME:${memberBeta} FORCE_DELAY_MS:1800`,
    );
    await page.click("#send-btn");

    await memberRow(page, memberBeta).locator(".member-main").click();
    await expect(page.locator("#agent-title")).toHaveText(memberBeta);
    await page.fill("#chat-input", "DM beta while alpha busy");
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-user .msg-content", { hasText: "DM beta while alpha busy" }),
    ).toHaveCount(1);
    await expect(page.locator("#messages .msg-agent .msg-content")).toHaveCount(1);

    await memberRow(page, memberAlphaEdited).locator(".member-main").click();
    await expect(page.locator("#agent-title")).toHaveText(memberAlphaEdited);
    await expect(
      page.locator("#messages .msg-user .msg-content", {
        hasText: `DM alpha delayed FORCE_MENTION_NAME:${memberBeta} FORCE_DELAY_MS:1800`,
      }),
    ).toHaveCount(1);
    await expect(page.locator("#messages .msg-agent .msg-content", { hasText: "테스트 재멘션" })).toHaveCount(1, {
      timeout: 7000,
    });

    await page.fill("#chat-input", "DM enter send");
    await page.press("#chat-input", "Enter");
    await expect(page.locator("#chat-input")).toHaveValue("");
    await expect(page.locator("#messages .msg-user .msg-content", { hasText: "DM enter send" })).toHaveCount(
      1,
    );

    await openMemberMenu(page, memberAlphaEdited);
    await page.click("#member-menu-clear");
    await page.click("#action-confirm-btn");
    await expect(
      page.locator("#messages .msg-user .msg-content", { hasText: "DM smoke ping" }),
    ).toHaveCount(0);

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

    await page
      .locator("#channel-member-add-list .modal-list-item.selectable", { hasText: memberAlphaEdited })
      .click();
    await page
      .locator("#channel-member-add-list .modal-list-item.selectable", { hasText: memberBeta })
      .click();
    await expect(page.locator("#channel-member-add-submit-btn")).toHaveText("2명 추가");
    await page.click("#channel-member-add-submit-btn");
    await expect(page.locator("#channel-member-add-modal[open]")).toHaveCount(0);
    await expect(page.locator("#channel-members-modal[open]")).toHaveCount(1);
    await expect(
      page.locator("#channel-members-list .modal-list-item.member-entry", { hasText: memberAlphaEdited }),
    ).toHaveCount(1);
    await expect(
      page.locator("#channel-members-list .modal-list-item.member-entry", { hasText: memberBeta }),
    ).toHaveCount(1);
    await page.click("#channel-members-close-btn");
    await expect(page.locator("#channel-members-modal[open]")).toHaveCount(0);

    const channelMessages = page.locator("#messages .msg");

    const beforeLogOnlyCount = await channelMessages.count();
    await page.fill("#chat-input", "channel log-only message");
    await page.click("#send-btn");
    await expect(channelMessages).toHaveCount(beforeLogOnlyCount + 1);
    await expect(
      page.locator("#messages .msg-user .msg-content", { hasText: "channel log-only message" }),
    ).toHaveCount(1);

    const beforeMentionCount = await channelMessages.count();
    await page.fill("#chat-input", `@{${memberAlphaEdited}} mention response test`);
    await page.click("#send-btn");
    await expect(channelMessages).toHaveCount(beforeMentionCount + 2);
    await expect(page.locator("#messages .msg-agent .msg-sender", { hasText: memberAlphaEdited })).toHaveCount(
      1,
    );
    await expect(
      page.locator("#messages .msg-user .msg-content .mention", {
        hasText: `@{${memberAlphaEdited}}`,
      }),
    ).toHaveCount(1);
    await expect(
      page.locator("#messages .msg-user .msg-content", { hasText: "mention response test" }),
    ).toHaveCount(1);
    await expect(page.locator("#messages .msg-agent .msg-content", { hasText: "테스트 응답" })).toHaveCount(1);

    const alphaSenderItems = page.locator("#messages .msg-agent .msg-sender", {
      hasText: memberAlphaEdited,
    });
    const betaSenderItems = page.locator("#messages .msg-agent .msg-sender", {
      hasText: memberBeta,
    });

    const beforeDelayedMentionCount = await channelMessages.count();
    const beforeDelayedAlphaSenderCount = await alphaSenderItems.count();
    await page.fill("#chat-input", `@{${memberAlphaEdited}} FORCE_DELAY_MS:1800 duplicate-guard`);
    await page.click("#send-btn");

    // While the mention execution is still delayed, user message should not be rendered twice.
    await expect(alphaSenderItems).toHaveCount(beforeDelayedAlphaSenderCount, { timeout: 700 });
    await expect(
      page.locator("#messages .msg-user .msg-content", {
        hasText: "FORCE_DELAY_MS:1800 duplicate-guard",
      }),
    ).toHaveCount(1, { timeout: 1200 });
    await expect(channelMessages).toHaveCount(beforeDelayedMentionCount + 1, { timeout: 1200 });

    await expect(alphaSenderItems).toHaveCount(beforeDelayedAlphaSenderCount + 1, { timeout: 7000 });
    await expect(channelMessages).toHaveCount(beforeDelayedMentionCount + 2, { timeout: 7000 });

    const beforeRementionCount = await channelMessages.count();
    const beforeAlphaSenderCount = await alphaSenderItems.count();
    const beforeBetaSenderCount = await betaSenderItems.count();
    await page.fill("#chat-input", `@{${memberAlphaEdited}} FORCE_MENTION_NAME:${memberBeta}`);
    await page.click("#send-btn");

    // The first agent reply should appear before chained mention execution finishes.
    await expect(alphaSenderItems).toHaveCount(beforeAlphaSenderCount + 1, { timeout: 1500 });
    await expect(betaSenderItems).toHaveCount(beforeBetaSenderCount, { timeout: 700 });
    await expect(
      page.locator("#messages .msg-user .msg-content", {
        hasText: `FORCE_MENTION_NAME:${memberBeta}`,
      }),
    ).toHaveCount(1);

    await expect(channelMessages).toHaveCount(beforeRementionCount + 3, { timeout: 7000 });
    await expect(betaSenderItems).toHaveCount(beforeBetaSenderCount + 1, { timeout: 7000 });

    const beforeBounceCount = await channelMessages.count();
    const beforeBounceAlphaSenderCount = await alphaSenderItems.count();
    const beforeBounceBetaSenderCount = await betaSenderItems.count();
    await page.fill(
      "#chat-input",
      `@{${memberAlphaEdited}} FORCE_BOUNCE_MENTIONS:${memberAlphaEdited},${memberBeta}`,
    );
    await page.click("#send-btn");

    // Expected chain: user -> Alpha -> Beta -> Alpha.
    await expect(channelMessages).toHaveCount(beforeBounceCount + 4, { timeout: 7000 });
    await expect(alphaSenderItems).toHaveCount(beforeBounceAlphaSenderCount + 2, { timeout: 7000 });
    await expect(betaSenderItems).toHaveCount(beforeBounceBetaSenderCount + 1, { timeout: 7000 });
    await expect(
      page.locator("#messages .msg-user .msg-content", {
        hasText: `FORCE_BOUNCE_MENTIONS:${memberAlphaEdited},${memberBeta}`,
      }),
    ).toHaveCount(1);

    await page.click("#channel-members-btn");
    await expect(page.locator("#channel-members-modal[open]")).toHaveCount(1);
    const betaMemberRow = page.locator("#channel-members-list .modal-list-item.member-entry", {
      hasText: memberBeta,
    });
    await betaMemberRow.hover();
    await betaMemberRow.locator(".channel-member-menu-btn").click({ force: true });
    await page.click("#channel-member-menu-remove");
    await expect(
      page.locator("#channel-members-list .modal-list-item.member-entry", { hasText: memberBeta }),
    ).toHaveCount(0);
    await page.click("#channel-members-close-btn");
    await expect(page.locator("#channel-members-modal[open]")).toHaveCount(0);

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
