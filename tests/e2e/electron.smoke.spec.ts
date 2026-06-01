import fs from "node:fs";
import path from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
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
      VIBLACK_E2E_DISABLE_OPEN_PATH: "1",
    },
  });

  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect(page).toHaveTitle("Viblack");
  await expect(page.locator("#member-list .member-item").first()).toBeVisible();
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

function memberRow(page: Page, name: string) {
  return page.locator("#member-list .member-item", { hasText: name });
}

function normalizeDisplayNameForLookup(value: string) {
  return value.trim().replace(/[,\s]+$/g, "");
}

function channelRow(page: Page, channelName: string) {
  return page.locator("#channel-list .section-item.channel", { hasText: `# ${channelName}` });
}

async function expectChatInputText(page: Page, expected: string): Promise<void> {
  await expect
    .poll(async () =>
      page.locator("#chat-input").evaluate((node) => (node.textContent ?? "").replace(/\u00a0/g, " ")),
    )
    .toBe(expected);
}

async function readAvatarTone(locator: Locator): Promise<{
  background: string;
  color: string;
  ring: string;
}> {
  return locator.evaluate((node) => {
    const element = node as HTMLElement;
    return {
      background: element.style.getPropertyValue("--avatar-bg"),
      color: element.style.getPropertyValue("--avatar-fg"),
      ring: element.style.getPropertyValue("--avatar-ring"),
    };
  });
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

test("new message indicator keeps scroll position until clicked", async ({}, testInfo) => {
  const suffix = Date.now();
  const memberName = `ScrollQA${suffix}`;
  const delayedFinalToken = `SCROLL_LIVE_${suffix}_${"z".repeat(280)}`;
  const clickFinalToken = `SCROLL_CLICK_${suffix}_${"y".repeat(240)}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    await openAddMemberModal(page);
    await page.fill("#member-name-input", memberName);
    await page.fill("#member-role-input", "Scroll Tester");
    await page.fill(
      "#member-prompt-input",
      "You are a scroll regression tester. Reply in concise Korean unless asked otherwise.",
    );
    await page.click("#member-save-btn");
    await expect(page.locator("#member-modal[open]")).toHaveCount(0);
    await expect(memberRow(page, memberName)).toHaveCount(1);

    let agentId: string | null = null;
    await expect
      .poll(async () => {
        const agentList = await apiRequest<{ agents: Array<{ id: string; name: string }> }>(
          page,
          "/api/agents",
        );
        agentId =
          agentList.data.agents.find(
            (agent) => normalizeDisplayNameForLookup(agent.name) === normalizeDisplayNameForLookup(memberName),
          )?.id ?? null;
        return agentId;
      })
      .not.toBeNull();
    if (!agentId) {
      throw new Error(`failed to resolve agent id for ${memberName}`);
    }

    for (let i = 0; i < 8; i += 1) {
      const historyReplyToken = `SCROLL_HISTORY_${suffix}_${i}_${"x".repeat(520)}`;
      const response = await apiRequest(page, `/api/agents/${agentId}/messages`, {
        method: "POST",
        body: {
          content: `history-${i} FORCE_FINAL_REPLY:${historyReplyToken}`,
        },
      });
      expect(response.status).toBe(200);
    }

    await memberRow(page, "Helper").locator(".member-main").click();
    await memberRow(page, memberName).locator(".member-main").click();

    const wrap = page.locator(".messages-wrap");
    await expect.poll(async () => page.locator("#messages .msg").count()).toBeGreaterThan(10);
    await expect
      .poll(async () =>
        wrap.evaluate((node) => {
          const element = node as HTMLElement;
          return element.scrollHeight - element.clientHeight;
        }),
      )
      .toBeGreaterThan(200);

    await page.fill(
      "#chat-input",
      `FORCE_DELAY_MS:1800 FORCE_FINAL_REPLY:${delayedFinalToken}`,
    );
    await page.click("#send-btn");
    await expect(page.locator("#typing-indicator")).toHaveClass(/show/, { timeout: 1200 });
    await wrap.hover();
    await page.mouse.wheel(0, -4000);
    await expect
      .poll(async () =>
        wrap.evaluate((node) => {
          const element = node as HTMLElement;
          return element.scrollHeight - element.clientHeight - element.scrollTop;
        }),
      )
      .toBeGreaterThan(200);

    await expect
      .poll(async () =>
        page.evaluate((token) => {
          return Array.from(document.querySelectorAll("#messages .msg-agent .msg-content")).some(
            (node) => (node.textContent ?? "").includes(token),
          );
        }, delayedFinalToken),
      )
      .toBe(true);
    await expect(page.locator("#new-messages-indicator")).toHaveClass(/show/);
    const newMessagesButtonSurface = await page.locator("#new-messages-btn").evaluate((node) => {
      const style = window.getComputedStyle(node as HTMLElement);
      return {
        backgroundColor: style.backgroundColor,
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow,
      };
    });
    const normalizedBackgroundColor = newMessagesButtonSurface.backgroundColor.replace(/\s+/g, "");
    const alphaMatch = normalizedBackgroundColor.match(
      /^rgba\(\d+,\d+,\d+,([0-9]*\.?[0-9]+)\)$/,
    );
    const isTransparentKeyword = normalizedBackgroundColor === "transparent";
    expect(isTransparentKeyword).toBe(false);
    expect(alphaMatch).not.toBeNull();
    expect(Number(alphaMatch?.[1] ?? "0")).toBeGreaterThan(0);
    expect(newMessagesButtonSurface.backdropFilter).not.toBe("none");
    expect(newMessagesButtonSurface.boxShadow).not.toBe("none");
    const indicatorOverlayState = await page.evaluate(() => {
      const wrap = document.querySelector(".messages-wrap") as HTMLElement | null;
      const indicator = document.getElementById("new-messages-indicator") as HTMLElement | null;
      if (!wrap || !indicator) {
        return null;
      }
      const wrapRect = wrap.getBoundingClientRect();
      const indicatorRect = indicator.getBoundingClientRect();
      return {
        indicatorTopInsideWrap: indicatorRect.top < wrapRect.bottom,
        indicatorBottomInsideWrap: indicatorRect.bottom <= wrapRect.bottom,
      };
    });
    expect(indicatorOverlayState).not.toBeNull();
    expect(indicatorOverlayState?.indicatorTopInsideWrap).toBe(true);
    expect(indicatorOverlayState?.indicatorBottomInsideWrap).toBe(true);

    const distanceFromBottomBeforeReveal = await wrap.evaluate((node) => {
      const element = node as HTMLElement;
      return element.scrollHeight - element.clientHeight - element.scrollTop;
    });
    expect(distanceFromBottomBeforeReveal).toBeGreaterThan(80);

    const revealState = await page.evaluate((token) => {
      const wrap = document.querySelector(".messages-wrap") as HTMLElement | null;
      const contentEl = Array.from(
        document.querySelectorAll<HTMLElement>("#messages .msg-agent .msg-content"),
      ).find((node) => (node.textContent ?? "").includes(token));
      const messageEl = contentEl?.closest(".msg") as HTMLElement | null;
      if (!wrap || !messageEl) {
        return null;
      }
      const maxScrollTop = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
      const targetScrollTop = Math.max(0, maxScrollTop - 12);
      wrap.scrollTop = targetScrollTop;
      wrap.dispatchEvent(new Event("scroll"));
      const wrapRect = wrap.getBoundingClientRect();
      const messageRect = messageEl.getBoundingClientRect();
      return {
        scrollTop: wrap.scrollTop,
        distanceFromBottom: maxScrollTop - wrap.scrollTop,
        messageVisible: messageRect.bottom > wrapRect.top && messageRect.top < wrapRect.bottom,
      };
    }, delayedFinalToken);
    expect(revealState).not.toBeNull();
    expect(revealState?.distanceFromBottom ?? 0).toBeGreaterThan(0);
    expect(revealState?.messageVisible).toBe(true);
    await expect(page.locator("#new-messages-indicator")).not.toHaveClass(/show/);

    await wrap.hover();
    await page.mouse.wheel(0, -1600);
    await expect
      .poll(async () =>
        wrap.evaluate((node) => {
          const element = node as HTMLElement;
          return element.scrollHeight - element.clientHeight - element.scrollTop;
        }),
      )
      .toBeGreaterThan(200);

    await page.fill(
      "#chat-input",
      `FORCE_DELAY_MS:1800 FORCE_FINAL_REPLY:${clickFinalToken}`,
    );
    await page.click("#send-btn");
    await expect(page.locator("#typing-indicator")).toHaveClass(/show/, { timeout: 1200 });
    await wrap.hover();
    await page.mouse.wheel(0, -2200);
    await expect
      .poll(async () =>
        wrap.evaluate((node) => {
          const element = node as HTMLElement;
          return element.scrollHeight - element.clientHeight - element.scrollTop;
        }),
      )
      .toBeGreaterThan(200);
    await expect
      .poll(async () =>
        page.evaluate((token) => {
          return Array.from(document.querySelectorAll("#messages .msg-agent .msg-content")).some(
            (node) => (node.textContent ?? "").includes(token),
          );
        }, clickFinalToken),
      )
      .toBe(true);
    await expect(page.locator("#new-messages-indicator")).toHaveClass(/show/);
    const pendingAnchorIndex = await page.evaluate(() => {
      const indicator = document.getElementById("new-messages-indicator") as HTMLElement | null;
      const storedAnchorIndex = indicator?.dataset.anchorMessageIndex ?? null;
      if (storedAnchorIndex) {
        return storedAnchorIndex;
      }
      const wrap = document.querySelector(".messages-wrap") as HTMLElement | null;
      if (!wrap) {
        return null;
      }
      const wrapRect = wrap.getBoundingClientRect();
      const messageEls = Array.from(wrap.querySelectorAll<HTMLElement>(".msg[data-message-index]"));
      for (const messageEl of messageEls) {
        const rect = messageEl.getBoundingClientRect();
        if (rect.bottom <= wrapRect.top) {
          continue;
        }
        if (rect.top >= wrapRect.bottom || rect.bottom > wrapRect.bottom) {
          return messageEl.dataset.messageIndex ?? null;
        }
      }
      return null;
    });
    expect(pendingAnchorIndex).not.toBeNull();

    await page.locator("#new-messages-btn").click();
    await expect(page.locator("#new-messages-indicator")).not.toHaveClass(/show/);
    const jumpedToAnchorState = await page.evaluate((anchorIndex) => {
      const wrap = document.querySelector(".messages-wrap") as HTMLElement | null;
      const anchorMessageEl = anchorIndex
        ? (document.querySelector(`#messages .msg[data-message-index="${anchorIndex}"]`) as HTMLElement | null)
        : null;
      if (!wrap || !anchorMessageEl) {
        return null;
      }
      const wrapRect = wrap.getBoundingClientRect();
      const anchorMessageRect = anchorMessageEl.getBoundingClientRect();
      return {
        anchorDistanceFromTop: anchorMessageRect.top - wrapRect.top,
        distanceFromBottom: wrap.scrollHeight - wrap.clientHeight - wrap.scrollTop,
        anchorMessageVisible:
          anchorMessageRect.bottom > wrapRect.top && anchorMessageRect.top < wrapRect.bottom,
        anchorMessageTopVisible:
          anchorMessageRect.top >= wrapRect.top && anchorMessageRect.top < wrapRect.bottom,
      };
    }, pendingAnchorIndex);
    expect(jumpedToAnchorState).not.toBeNull();
    expect(jumpedToAnchorState?.anchorMessageVisible).toBe(true);
    expect(jumpedToAnchorState?.anchorMessageTopVisible).toBe(true);
  } finally {
    await electronApp.close();
  }
});

test("channel composer filters member mention suggestions by name", async ({}, testInfo) => {
  const suffix = Date.now();
  const alphaName = `MentionAlpha${suffix}`;
  const betaName = `MentionBeta${suffix}`;
  const spacedName = `Space Member ${suffix}`;
  const roleOnlyNeedle = `RoleOnlyNeedle${suffix}`;
  const channelName = `mention-room-${suffix}`;
  const channelWorkspacePath = createWorkspaceDir(testInfo, channelName);

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    async function createAgent(name: string, role: string): Promise<{ id: string; name: string }> {
      const response = await apiRequest<{ agent: { id: string; name: string } }>(page, "/api/agents", {
        method: "POST",
        body: {
          name,
          role,
          systemPrompt: `You are ${name}. Reply briefly for mention autocomplete tests.`,
        },
      });
      expect(response.status).toBe(201);
      return response.data.agent;
    }

    const alpha = await createAgent(alphaName, "Planner");
    const beta = await createAgent(betaName, roleOnlyNeedle);
    const spaced = await createAgent(spacedName, "Writer");

    const channelResponse = await apiRequest<{ channel: { id: string; name: string } }>(page, "/api/channels", {
      method: "POST",
      body: {
        name: channelName,
        description: "mention autocomplete regression",
        workspacePath: channelWorkspacePath,
      },
    });
    expect(channelResponse.status).toBe(201);

    for (const member of [alpha, beta, spaced]) {
      const addResponse = await apiRequest(page, `/api/channels/${channelResponse.data.channel.id}/members`, {
        method: "POST",
        body: { agentId: member.id },
      });
      expect(addResponse.status).toBe(201);
    }

    await page.reload();
    await page.waitForLoadState("domcontentloaded");
    await expect(channelRow(page, channelName)).toHaveCount(1);
    await channelRow(page, channelName).click();
    await expect(page.locator("#agent-title")).toHaveText(`# ${channelName}`);

    const mentionMenu = page.locator("#mention-suggestions");
    const mentionItems = page.locator("#mention-suggestions .mention-suggestion-item");
    const typeChatInput = async (value: string): Promise<void> => {
      await page.fill("#chat-input", "");
      await page.click("#chat-input");
      await page.keyboard.type(value);
    };

    await typeChatInput("@");
    await expect(mentionMenu).toHaveClass(/show/);
    await expect(mentionItems).toHaveCount(3);
    await expect(mentionItems.filter({ hasText: alphaName })).toHaveCount(1);
    await expect(mentionItems.filter({ hasText: betaName })).toHaveCount(1);
    await expect(mentionItems.filter({ hasText: spacedName })).toHaveCount(1);

    await page.locator("#chat-input").evaluate((node, value) => {
      const input = node as HTMLElement;
      input.textContent = value;
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }, "@MentionA");
    await page.press("#chat-input", "Enter");
    await expectChatInputText(page, `@${alphaName} `);
    await expect(mentionMenu).not.toHaveClass(/show/);
    await expect(page.locator("#messages .msg-user .msg-content", { hasText: alphaName })).toHaveCount(0);

    await typeChatInput(`@${roleOnlyNeedle}`);
    await expect(page.locator("#mention-suggestions .mention-suggestion-empty")).toHaveText("멤버 없음");
    await expect(mentionItems).toHaveCount(0);

    await page.press("#chat-input", "Escape");
    await expect(mentionMenu).not.toHaveClass(/show/);

    await typeChatInput("@MentionA");
    await expect(mentionMenu).toHaveClass(/show/);
    await expect(mentionItems).toHaveCount(1);
    await expect(mentionItems.first()).toContainText(alphaName);
    await expect(page.locator("#chat-input .chat-input-mention")).toHaveCount(0);
    await mentionItems.first().click();
    await expectChatInputText(page, `@${alphaName} `);
    await expect(page.locator("#chat-input .chat-input-mention", { hasText: `@${alphaName}` })).toHaveCount(1);
    await expect(mentionMenu).not.toHaveClass(/show/);

    await typeChatInput("@MentionB");
    await expect(mentionMenu).toHaveClass(/show/);
    await expect(mentionItems).toHaveCount(1);
    await expect(mentionItems.first()).toContainText(betaName);
    await expect(page.locator("#chat-input .chat-input-mention")).toHaveCount(0);
    await page.press("#chat-input", "Tab");
    await expectChatInputText(page, `@${betaName} `);
    await expect(page.locator("#chat-input")).toBeFocused();
    await expect(page.locator("#chat-input .chat-input-mention", { hasText: `@${betaName}` })).toHaveCount(1);
    await expect(mentionMenu).not.toHaveClass(/show/);

    await typeChatInput("@Mention");
    await expect(mentionMenu).toHaveClass(/show/);
    await expect(mentionItems).toHaveCount(2);
    const composingTabPrevented = await page.locator("#chat-input").evaluate((node, value) => {
      const input = node as HTMLElement;
      input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
      const keydown = new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      });
      const defaultAllowed = input.dispatchEvent(keydown);
      input.textContent = value;
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "B" }));
      return !defaultAllowed || keydown.defaultPrevented;
    }, "@MentionB");
    expect(composingTabPrevented).toBe(true);
    await expectChatInputText(page, `@${betaName} `);
    await expect(page.locator("#chat-input .chat-input-mention", { hasText: `@${betaName}` })).toHaveCount(1);
    await expect(page.locator("#chat-input")).toBeFocused();

    await typeChatInput("Please ask @Space");
    await expect(mentionItems).toHaveCount(1);
    await expect(mentionItems.first()).toContainText(spacedName);
    await page.press("#chat-input", "Enter");
    await expectChatInputText(page, `Please ask @{${spacedName}} `);
  } finally {
    await electronApp.close();
  }
});

test("electron full feature regression flow", async ({}, testInfo) => {
  const suffix = Date.now();
  const memberAlpha = `AlphaQA${suffix}`;
  const memberBeta = `BetaQA${suffix}`;
  const memberAlphaEdited = `AlphaLead${suffix}`;
  const memberPromptToken = `PROMPT_TOKEN_${suffix}`;
  const dmRetryKey = `RETRY_${suffix}`;
  const dmRetryFinalToken = `RETRY_OK_${suffix}`;
  const dmItemCompletedToken = `ITEM_${suffix}`;
  const dmMultiCompletedFirstToken = `DM_MULTI_A_${suffix}`;
  const dmMultiCompletedSecondToken = `DM_MULTI_B_EXTENDED_${suffix}`;
  const dmStreamToken = `STREAM_${suffix}`;
  const dmFinalToken = `FINAL_${suffix}`;
  const dmStreamDedupFinalToken = `STREAM_DEDUP_${suffix}`;
  const dmAppServerRuntimeToken = "APP_SERVER_RUNTIME_OK";
  const channelName = `qa-room-${suffix}`;
  const duplicateWorkspaceChannelName = `qa-room-clone-${suffix}`;
  const editedChannelName = `qa-room-updated-${suffix}`;
  const channelWorkspacePath = createWorkspaceDir(testInfo, channelName);
  const editedChannelWorkspacePath = createWorkspaceDir(testInfo, editedChannelName);
  const channelStreamDedupFinalToken = `CHANNEL_STREAM_DEDUP_${suffix}`;

  const { electronApp, page } = await launchIsolatedApp(testInfo);

  try {
    await expect
      .poll(async () => page.locator("#member-list .member-item").count())
      .toBeGreaterThan(0);

    const promptTemplatesResponse = await apiRequest<{ defaultMemberSystemPrompt: string }>(
      page,
      "/api/system/prompt-templates",
    );
    expect(promptTemplatesResponse.status).toBe(200);

    await openAddMemberModal(page);
    await expect(page.locator("#member-prompt-input")).toHaveValue(
      promptTemplatesResponse.data.defaultMemberSystemPrompt,
    );
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
    await expect
      .poll(async () => page.locator("#member-list .member-avatar").count())
      .toBeGreaterThanOrEqual(2);
    const initialAlphaAvatarTone = await readAvatarTone(
      memberRow(page, memberAlpha).locator(".member-avatar"),
    );
    const initialBetaAvatarTone = await readAvatarTone(
      memberRow(page, memberBeta).locator(".member-avatar"),
    );
    expect(initialBetaAvatarTone.background).not.toBe(initialAlphaAvatarTone.background);

    await openAddMemberModal(page);
    await page.fill("#member-name-input", memberAlpha);
    await page.fill("#member-role-input", "Duplicated");
    await page.fill("#member-prompt-input", "duplicate prompt");
    await page.click("#member-save-btn");
    await expect.poll(async () => memberRow(page, memberAlpha).count()).toBe(1);
    if (await page.locator("#member-modal[open]").count()) {
      await expect(page.locator("#member-name-input")).toHaveClass(/field-error/);
      await expect(page.locator("#member-name-error")).toBeVisible();
      await page.click("#member-cancel-btn");
      await expect(page.locator("#member-modal[open]")).toHaveCount(0);
    }

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
    const editedAlphaAvatarTone = await readAvatarTone(
      memberRow(page, memberAlphaEdited).locator(".member-avatar"),
    );
    expect(editedAlphaAvatarTone.background).not.toBe(initialAlphaAvatarTone.background);

    await memberRow(page, memberAlphaEdited).locator(".member-main").click();
    await expect(page.locator("#agent-title")).toHaveText(memberAlphaEdited);
    await page.fill(
      "#chat-input",
      `FORCE_ASSERT_MEMBER_TEMPLATE FORCE_ASSERT_MEMBER_PROMPT:${memberPromptToken}`,
    );
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: `멤버 템플릿/프롬프트 확인:${memberPromptToken}`,
      }),
    ).toHaveCount(1);
    await page.fill("#chat-input", "DM smoke ping");
    await page.click("#send-btn");
    await expect(page.locator("#messages .msg-user .msg-content", { hasText: "DM smoke ping" })).toHaveCount(1);
    await expect(page.locator("#messages .msg-agent .msg-content", { hasText: "테스트 응답" })).toHaveCount(1);
    await expect(page.locator("#messages .msg-user .msg-avatar").first()).toBeVisible();
    await expect(page.locator("#messages .msg-agent .msg-avatar").first()).toBeVisible();
    await expect(page.locator("#header-avatar")).toBeVisible();
    await expect(page.locator("#messages .msg-kind")).toHaveCount(0);
    const dmMemberAvatarTone = await readAvatarTone(
      memberRow(page, memberAlphaEdited).locator(".member-avatar"),
    );
    const dmAgentAvatarTone = await readAvatarTone(
      page.locator("#messages .msg-agent").filter({ hasText: "테스트 응답" }).first().locator(".msg-avatar"),
    );
    expect(dmAgentAvatarTone).toEqual(dmMemberAvatarTone);
    const dmMessageRow = page.locator("#messages .msg-agent").filter({ hasText: "테스트 응답" }).first();
    const dmAgentBaseBorderColor = await dmMessageRow.evaluate((node) =>
      window.getComputedStyle(node).borderTopColor,
    );
    const dmMessageStyleBeforeHover = await dmMessageRow.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
      };
    });
    await dmMessageRow.hover();
    await expect.poll(async () =>
      dmMessageRow.evaluate((node) => {
        const style = window.getComputedStyle(node);
        return JSON.stringify({
          backgroundColor: style.backgroundColor,
          borderColor: style.borderColor,
          boxShadow: style.boxShadow,
        });
      }),
    ).toBe(JSON.stringify(dmMessageStyleBeforeHover));
    await page.fill("#chat-input", "FORCE_REQUIRE_APP_SERVER");
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: dmAppServerRuntimeToken,
      }),
    ).toHaveCount(1);
    await page.fill("#chat-input", `FORCE_ITEM_COMPLETED_AGENT_MESSAGE:${dmItemCompletedToken}`);
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: dmItemCompletedToken,
      }),
    ).toHaveCount(1);
    const dmAgentMessagesAfterSingleCompleted = page.locator("#messages .msg-agent .msg-content");
    const beforeDmMultiCompletedCount = await dmAgentMessagesAfterSingleCompleted.count();
    await page.fill(
      "#chat-input",
      `FORCE_ITEM_COMPLETED_AGENT_MESSAGE_SEQ:${dmMultiCompletedFirstToken}|${dmMultiCompletedSecondToken}`,
    );
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: dmMultiCompletedFirstToken,
      }),
    ).toHaveCount(1, { timeout: 7000 });
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: dmMultiCompletedSecondToken,
      }),
    ).toHaveCount(1, { timeout: 7000 });
    await expect(dmAgentMessagesAfterSingleCompleted).toHaveCount(beforeDmMultiCompletedCount + 2, {
      timeout: 7000,
    });
    await page.fill("#chat-input", "FORCE_TURN_FAILED");
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-system .msg-content", {
        hasText: "Codex 실행 실패:",
      }),
    ).toHaveCount(1);
    await expect(
      page.locator("#messages .msg-system .msg-content", {
        hasText: "forced turn failure",
      }),
    ).toHaveCount(1);
    await page.fill(
      "#chat-input",
      `FORCE_TRANSIENT_FAIL_ONCE:${dmRetryKey} FORCE_FINAL_REPLY:${dmRetryFinalToken}`,
    );
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: dmRetryFinalToken,
      }),
    ).toHaveCount(1, { timeout: 10000 });
    await expect(
      page.locator("#messages .msg-system .msg-content", {
        hasText: "empty response from codex",
      }),
    ).toHaveCount(0);

    await page.fill(
      "#chat-input",
      `DM stream check FORCE_STREAM_AGENT_MESSAGE:${dmStreamToken} FORCE_DELAY_MS:1800 FORCE_FINAL_REPLY:${dmFinalToken}`,
    );
    await page.click("#send-btn");
    await expect(page.locator("#typing-indicator")).toHaveClass(/show/, { timeout: 1200 });
    await expect(page.locator("#typing-label")).toContainText(memberAlphaEdited);
    const dmAgentMessagesBeforeFinalOnly = page.locator("#messages .msg-agent .msg-content");
    const beforeDmFinalOnlyCount = await dmAgentMessagesBeforeFinalOnly.count();
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: dmStreamToken,
      }),
    ).toHaveCount(0, { timeout: 1200 });
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: dmFinalToken,
      }),
    ).toHaveCount(0, { timeout: 900 });
    await expect(dmAgentMessagesBeforeFinalOnly).toHaveCount(beforeDmFinalOnlyCount, { timeout: 1200 });
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: dmFinalToken,
      }),
    ).toHaveCount(1, { timeout: 7000 });
    const dmStreamMessageRow = page.locator("#messages .msg-agent").filter({ hasText: dmFinalToken }).first();
    await expect
      .poll(async () =>
        dmStreamMessageRow.evaluate((node) => window.getComputedStyle(node).borderTopColor),
      )
      .toBe(dmAgentBaseBorderColor);
    await expect(page.locator("#typing-indicator")).not.toHaveClass(/show/);

    const dmAgentMessages = page.locator("#messages .msg-agent .msg-content");
    const beforeDmStreamDedupCount = await dmAgentMessages.count();
    await page.fill(
      "#chat-input",
      `DM stream dedupe FORCE_STREAM_AGENT_MESSAGE_SEQ:abcdefghijklmnopqr|stuv|. FORCE_DELAY_MS:1800 FORCE_FINAL_REPLY:${dmStreamDedupFinalToken}`,
    );
    await page.click("#send-btn");
    await expect(dmAgentMessages).toHaveCount(beforeDmStreamDedupCount, { timeout: 1200 });
    await expect(dmAgentMessages).toHaveCount(beforeDmStreamDedupCount, { timeout: 1200 });
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: dmStreamDedupFinalToken,
      }),
    ).toHaveCount(1, { timeout: 7000 });
    await expect(dmAgentMessages).toHaveCount(beforeDmStreamDedupCount + 1, { timeout: 7000 });

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
    await expectChatInputText(page, "");
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
    await expect(page.locator("#channel-modal[open]")).toHaveCount(1);
    await expect(page.locator("#channel-workspace-input")).toHaveClass(/field-error/);
    await expect(page.locator("#channel-workspace-error")).toHaveText("채널 워크스페이스 경로는 필수입니다.");
    await page.fill("#channel-workspace-input", channelWorkspacePath);
    await page.click("#channel-submit-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(0);
    await expect(channelRow(page, channelName)).toHaveCount(1);

    await openAddChannelModal(page);
    await page.fill("#channel-name-input", channelName);
    await page.fill("#channel-desc-input", "duplicate channel should stay inline");
    await page.fill("#channel-workspace-input", createWorkspaceDir(testInfo, `${channelName}-duplicate-name`));
    await page.click("#channel-submit-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(1);
    await expect(page.locator("#channel-name-input")).toHaveClass(/field-error/);
    await expect(page.locator("#channel-name-error")).toHaveText(
      "이미 사용 중인 채널 이름입니다. 다른 이름을 입력하세요.",
    );
    await expect(page.locator("#warning")).not.toContainText("채널 저장 실패");
    await page.click("#channel-cancel-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(0);

    await openAddChannelModal(page);
    await page.fill("#channel-name-input", duplicateWorkspaceChannelName);
    await page.fill("#channel-desc-input", "duplicate workspace should stay inline");
    await page.fill("#channel-workspace-input", channelWorkspacePath);
    await page.click("#channel-submit-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(1);
    await expect(page.locator("#channel-workspace-input")).toHaveClass(/field-error/);
    await expect(page.locator("#channel-workspace-error")).toHaveText(
      "이미 다른 활성 채널이 사용 중인 워크스페이스입니다.",
    );
    await expect(page.locator("#warning")).not.toContainText("채널 저장 실패");
    await page.click("#channel-cancel-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(0);

    await openChannelMenu(page, channelName);
    await page.click("#channel-menu-edit");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(1);
    await page.fill("#channel-name-input", editedChannelName);
    await page.fill("#channel-desc-input", "updated by e2e");
    await page.fill("#channel-workspace-input", editedChannelWorkspacePath);
    await page.click("#channel-submit-btn");
    await expect(page.locator("#channel-modal[open]")).toHaveCount(0);
    await expect(channelRow(page, editedChannelName)).toHaveCount(1);
    await expect(channelRow(page, channelName)).toHaveCount(0);

    await channelRow(page, editedChannelName).click();
    await expect(page.locator("#agent-title")).toHaveText(`# ${editedChannelName}`);
    await expect(page.locator("#channel-workspace-btn")).toBeVisible();
    await expect(page.locator("#channel-members-btn")).toBeVisible();
    await expect(page.locator("#header-avatar")).toBeVisible();
    await page.click("#channel-workspace-btn");
    await expect(page.locator("#warning")).not.toContainText("워크스페이스 폴더 열기 실패");

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
    await expect(page.locator("#messages .msg-agent .msg-avatar").first()).toBeVisible();
    await expect(page.locator("#messages .msg-kind")).toHaveCount(0);
    await expect(
      page.locator("#messages .msg-user .msg-content .mention", {
        hasText: `@{${memberAlphaEdited}}`,
      }),
    ).toHaveCount(1);
    await expect(
      page.locator("#messages .msg-user .msg-content", { hasText: "mention response test" }),
    ).toHaveCount(1);
    await expect(page.locator("#messages .msg-agent .msg-content", { hasText: "테스트 응답" })).toHaveCount(1);
    const channelMemberAvatarTone = await readAvatarTone(
      memberRow(page, memberAlphaEdited).locator(".member-avatar"),
    );
    const channelAgentAvatarTone = await readAvatarTone(
      page
        .locator("#messages .msg-agent")
        .filter({ hasText: memberAlphaEdited })
        .first()
        .locator(".msg-avatar"),
    );
    expect(channelAgentAvatarTone).toEqual(channelMemberAvatarTone);

    const channelMultiCompletedFirstToken = `CHANNEL_MULTI_A_${suffix}`;
    const channelMultiCompletedSecondToken = `CHANNEL_MULTI_B_EXTENDED_${suffix}`;
    const beforeChannelMultiCompletedCount = await channelMessages.count();
    await page.fill(
      "#chat-input",
      `@{${memberAlphaEdited}} FORCE_ITEM_COMPLETED_AGENT_MESSAGE_SEQ:${channelMultiCompletedFirstToken}|${channelMultiCompletedSecondToken}`,
    );
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: channelMultiCompletedFirstToken,
      }),
    ).toHaveCount(1, { timeout: 7000 });
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: channelMultiCompletedSecondToken,
      }),
    ).toHaveCount(1, { timeout: 7000 });
    await expect(channelMessages).toHaveCount(beforeChannelMultiCompletedCount + 3, { timeout: 7000 });

    const beforeChannelStreamDedupCount = await channelMessages.count();
    await page.fill(
      "#chat-input",
      `@{${memberAlphaEdited}} FORCE_STREAM_AGENT_MESSAGE_SEQ:abcdefghijklmnopqr|stuv|. FORCE_DELAY_MS:1800 FORCE_FINAL_REPLY:${channelStreamDedupFinalToken}`,
    );
    await page.click("#send-btn");
    await expect(page.locator("#typing-indicator")).toHaveClass(/show/, { timeout: 1200 });
    await expect(page.locator("#typing-label")).toContainText(memberAlphaEdited);
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: "abcdefghijklmnopqr",
      }),
    ).toHaveCount(0, { timeout: 1200 });
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: "abcdefghijklmnopqrstuv",
      }),
    ).toHaveCount(0, { timeout: 1200 });
    await expect(
      page.locator("#messages .msg-agent .msg-content", {
        hasText: channelStreamDedupFinalToken,
      }),
    ).toHaveCount(1, { timeout: 7000 });
    await expect(channelMessages).toHaveCount(beforeChannelStreamDedupCount + 2, { timeout: 7000 });
    await expect(page.locator("#typing-indicator")).not.toHaveClass(/show/, { timeout: 7000 });

    const alphaSenderItems = page.locator("#messages .msg-agent .msg-sender", {
      hasText: memberAlphaEdited,
    });
    const betaSenderItems = page.locator("#messages .msg-agent .msg-sender", {
      hasText: memberBeta,
    });

    const beforeChannelBusyConcurrentCount = await channelMessages.count();
    const beforeChannelBusyAlphaSenderCount = await alphaSenderItems.count();
    await page.fill("#chat-input", `@{${memberAlphaEdited}} FORCE_DELAY_MS:1800 channel-busy-first`);
    await page.click("#send-btn");
    await page.fill("#chat-input", "channel second while first busy");
    await page.click("#send-btn");
    await expect(
      page.locator("#messages .msg-user .msg-content", { hasText: "channel-busy-first" }),
    ).toHaveCount(1, { timeout: 1200 });
    await expect(
      page.locator("#messages .msg-user .msg-content", { hasText: "channel second while first busy" }),
    ).toHaveCount(1, { timeout: 1200 });
    await expect(alphaSenderItems).toHaveCount(beforeChannelBusyAlphaSenderCount, { timeout: 1200 });
    await expect(alphaSenderItems).toHaveCount(beforeChannelBusyAlphaSenderCount + 1, { timeout: 7000 });
    await expect(channelMessages).toHaveCount(beforeChannelBusyConcurrentCount + 3, { timeout: 7000 });

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
