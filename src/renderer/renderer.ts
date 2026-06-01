type SenderType = "user" | "agent" | "system";
type ChannelMessageKind = "request" | "progress" | "result" | "remention" | "general";
type AvatarVariant = "user" | "agent" | "system" | "channel" | "app";
type SettingsTab = "model" | "debug";

interface Agent {
  id: string;
  name: string;
  role: string;
  roleProfile?: string | null;
  systemPrompt: string;
}

interface ChatMessage {
  id: number;
  agentId?: string;
  sender: SenderType;
  senderId?: string | null;
  senderLabel?: string;
  content: string;
  createdAt: string;
  messageKind?: ChannelMessageKind;
}

interface Channel {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  archivedAt: string | null;
  createdAt: string;
}

interface ChannelMemberResponse {
  channel: Channel;
  members: Agent[];
}

interface ChannelApiMessage {
  id: number;
  channelId: string;
  senderType: SenderType;
  senderId: string | null;
  content: string;
  messageKind: ChannelMessageKind;
  createdAt: string;
}

interface ChannelMessageEventPayload {
  channelId: string;
  messageId: number;
}

interface ChannelExecutionJob {
  id: number;
  targetAgentId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "skipped";
}

interface PendingChannelUserMessage {
  localId: number;
  channelId: string;
  content: string;
  createdAt: string;
}

interface AppSettingsResponse {
  selectedModel: string | null;
  selectedModelAvailable: boolean;
  availableModels: string[];
  modelsCachePath: string;
  cacheError: string | null;
  debugMode: boolean;
}

interface PromptTemplatesResponse {
  defaultMemberSystemPrompt: string;
}

interface RenderMessagesOptions {
  forceScrollToBottom?: boolean;
}

interface ActiveMentionQuery {
  start: number;
  end: number;
  query: string;
}

interface MentionSuggestionState {
  isOpen: boolean;
  query: ActiveMentionQuery | null;
  candidates: Agent[];
  activeIndex: number;
}

let backendBaseUrl = "";
let activeAgentId: string | null = null;
let renderedMessages: ChatMessage[] = [];
let agents: Agent[] = [];
let codexReady = false;
let appSettings: AppSettingsResponse | null = null;
let promptTemplates: PromptTemplatesResponse | null = null;
let openMemberMenuAgentId: string | null = null;
let openChannelMenuChannelId: string | null = null;
let memberFormMode: "create" | "edit" = "create";
let editingAgentId: string | null = null;
let channelFormMode: "create" | "edit" = "create";
let editingChannelId: string | null = null;
type PendingAction =
  | { target: "member"; type: "clear" | "delete"; agentId: string }
  | { target: "channel"; type: "delete"; channelId: string };
let pendingAction: PendingAction | null = null;
let openChannelMemberMenuMemberId: string | null = null;
const selectedChannelMemberAddIds = new Set<string>();
const unreadAgentIds = new Set<string>();
const inflightAgentIds = new Set<string>();
let isGeneratingMemberPrompt = false;
let isSavingSettings = false;
let activeSettingsTab: SettingsTab = "model";
const channelStore = new ChannelStore();
let channelSyncController: ChannelSyncController | null = null;
const DM_INFLIGHT_SYNC_INTERVAL_MS = 350;
const MESSAGE_AUTO_SCROLL_THRESHOLD_PX = 40;
const NEW_MESSAGE_SCROLL_REVEAL_OFFSET_PX = 12;
const CHANNEL_ACTION_BLOCK_PATTERN =
  /(?:CHANNEL_ACTION_BEGIN\s*[\s\S]*?\s*CHANNEL_ACTION_END|\[CHANNEL_ACTION\]\s*[\s\S]*?\s*(?:\[\/CHANNEL_ACTION\]|\[\/CHANNEL_ACTION>|<\/CHANNEL_ACTION>))/g;
const MENTION_SUGGESTION_LIMIT = 8;
let lastRenderedMessageContextKey = "none";
let lastRenderedPersistedMessageCount = 0;
let lastRenderedMaxPersistedMessageId = 0;
let lastRenderedNonUserMessageSignature = "";
let isMessagesDetachedFromBottom = false;
let pendingNewMessageAnchorIndex: number | null = null;
let pendingMessagesScrollRestoreFrameId: number | null = null;
let mentionSuggestionBlurTimer: number | null = null;
let deferredMentionSelectionTimer: number | null = null;
let isChatInputComposing = false;
let mentionSuggestionState: MentionSuggestionState = {
  isOpen: false,
  query: null,
  candidates: [],
  activeIndex: 0,
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return value.replaceAll('"', "&quot;");
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function getAgentAvatarSeed(label: string, fallback = "agent"): string {
  const normalized = label.trim().normalize("NFKC").toLowerCase();
  return `agent:${normalized || fallback.trim() || "agent"}`;
}

function getAvatarInitials(label: string, variant: AvatarVariant): string {
  if (variant === "channel") {
    return "#";
  }
  if (variant === "system") {
    return "SY";
  }
  if (variant === "app") {
    return "VB";
  }
  if (variant === "user") {
    return "ME";
  }

  const normalized = label.trim();
  if (!normalized) {
    return "AI";
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${Array.from(words[0] ?? "")[0] ?? ""}${Array.from(words[1] ?? "")[0] ?? ""}`.toUpperCase();
  }

  return Array.from(normalized.replace(/[#@]/g, ""))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function getAvatarTone(seed: string, variant: AvatarVariant): {
  background: string;
  color: string;
  ring: string;
} {
  if (variant === "user") {
    return {
      background: "linear-gradient(135deg, #d7f4e9 0%, #97d5bc 100%)",
      color: "#0f5137",
      ring: "rgba(15, 81, 55, 0.22)",
    };
  }
  if (variant === "system") {
    return {
      background: "linear-gradient(135deg, #fff2d6 0%, #f2ca7b 100%)",
      color: "#714800",
      ring: "rgba(113, 72, 0, 0.2)",
    };
  }
  if (variant === "channel") {
    return {
      background: "linear-gradient(135deg, #dde6f2 0%, #b9c9de 100%)",
      color: "#23364d",
      ring: "rgba(35, 54, 77, 0.2)",
    };
  }
  if (variant === "app") {
    return {
      background: "linear-gradient(135deg, #d9e5f4 0%, #9cb6d8 100%)",
      color: "#213552",
      ring: "rgba(33, 53, 82, 0.22)",
    };
  }

  const hue = hashSeed(seed) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 82% 93%) 0%, hsl(${(hue + 24) % 360} 67% 79%) 100%)`,
    color: `hsl(${hue} 42% 24%)`,
    ring: `hsla(${hue}, 38%, 28%, 0.2)`,
  };
}

function applyAvatarStyle(
  element: HTMLElement,
  label: string,
  variant: AvatarVariant,
  seed = label,
): void {
  const initials = getAvatarInitials(label, variant);
  const tone = getAvatarTone(seed, variant);
  element.textContent = initials || "AI";
  element.style.setProperty("--avatar-bg", tone.background);
  element.style.setProperty("--avatar-fg", tone.color);
  element.style.setProperty("--avatar-ring", tone.ring);
}

function getMessageAvatarSeed(message: ChatMessage, senderLabel: string): string {
  if (message.sender === "user") {
    return "user";
  }
  if (message.sender === "system") {
    return "system";
  }
  const agentName =
    (message.senderId ? agents.find((agent) => agent.id === message.senderId)?.name : undefined) ??
    (message.agentId ? agents.find((agent) => agent.id === message.agentId)?.name : undefined) ??
    senderLabel;
  const fallback = message.senderId ?? message.agentId ?? activeAgentId ?? senderLabel;
  return getAgentAvatarSeed(agentName, fallback);
}

function getTypingAvatarSeed(actor: { id: string; name: string; variant: AvatarVariant }): string {
  if (actor.variant === "agent") {
    return getAgentAvatarSeed(actor.name, actor.id);
  }
  return actor.id;
}

function getHeaderAgentAvatarSeed(agent: Agent | undefined, fallbackId: string): string {
  return getAgentAvatarSeed(agent?.name ?? "Agent", agent?.id ?? fallbackId);
}

function getMemberAvatarSeed(agent: Agent): string {
  return getAgentAvatarSeed(agent.name, agent.id);
}

function getMessageAvatarVariant(message: ChatMessage): AvatarVariant {
  if (message.sender === "user") {
    return "user";
  }
  if (message.sender === "system") {
    return "system";
  }
  return "agent";
}

function getMessageSenderLabel(message: ChatMessage, agentName = "Agent"): string {
  if (message.sender === "user") {
    return "You";
  }
  if (message.sender === "system") {
    return "System";
  }
  return message.senderLabel ?? agentName;
}

function formatMessageTimestamp(createdAt: string): string {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return createdAt;
  }
  return parsed.toLocaleString([], {
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderHeaderAvatar(): void {
  const avatarEl = document.getElementById("header-avatar");
  if (!avatarEl) {
    return;
  }

  const activeChannelId = channelStore.getActiveChannelId();
  if (activeChannelId) {
    const channel = getChannelById(activeChannelId);
    applyAvatarStyle(avatarEl, channel?.name ?? "#", "channel", channel?.id ?? activeChannelId);
    return;
  }

  if (activeAgentId) {
    const activeAgent = agents.find((agent) => agent.id === activeAgentId);
    applyAvatarStyle(
      avatarEl,
      activeAgent?.name ?? "Agent",
      "agent",
      getHeaderAgentAvatarSeed(activeAgent, activeAgentId),
    );
    return;
  }

  applyAvatarStyle(avatarEl, "Viblack", "app", "viblack");
}

function getActiveTypingActors(): Array<{ id: string; name: string; variant: AvatarVariant }> {
  const activeChannelId = channelStore.getActiveChannelId();
  if (activeChannelId) {
    const memberNameById = new Map(
      channelStore.getActiveChannelMembers().map((member) => [member.id, member.name]),
    );
    return channelStore
      .getActiveChannelTypingAgentIds()
      .map((agentId) => ({
        id: agentId,
        name: memberNameById.get(agentId) ?? "Agent",
        variant: "agent" as const,
      }));
  }

  if (activeAgentId && inflightAgentIds.has(activeAgentId)) {
    const activeAgent = agents.find((agent) => agent.id === activeAgentId);
    return [
      {
        id: activeAgentId,
        name: activeAgent?.name ?? "Agent",
        variant: "agent" as const,
      },
    ];
  }

  return [];
}

function renderTypingIndicator(): void {
  const indicator = document.getElementById("typing-indicator");
  const avatarsEl = document.getElementById("typing-avatars");
  const labelEl = document.getElementById("typing-label");
  if (!indicator || !avatarsEl || !labelEl) {
    return;
  }

  const actors = getActiveTypingActors();
  avatarsEl.innerHTML = "";

  if (actors.length === 0) {
    indicator.classList.remove("show");
    labelEl.textContent = "";
    return;
  }

  indicator.classList.add("show");
  for (const actor of actors.slice(0, 3)) {
    const avatar = document.createElement("div");
    avatar.className = "avatar typing-avatar";
    applyAvatarStyle(avatar, actor.name, actor.variant, getTypingAvatarSeed(actor));
    avatarsEl.appendChild(avatar);
  }

  if (actors.length === 1) {
    labelEl.textContent = `${actors[0]?.name ?? "Agent"} 작성 중`;
    return;
  }

  const visibleNames = actors.slice(0, 2).map((actor) => actor.name);
  const remainingCount = actors.length - visibleNames.length;
  labelEl.textContent =
    remainingCount > 0
      ? `${visibleNames.join(", ")} 외 ${remainingCount}명 작성 중`
      : `${visibleNames.join(", ")} 작성 중`;
}

function getMessagesWrap(): HTMLElement | null {
  return document.querySelector(".messages-wrap") as HTMLElement | null;
}

function getActiveMessageContextKey(): string {
  const activeChannelId = channelStore.getActiveChannelId();
  if (activeChannelId) {
    return `channel:${activeChannelId}`;
  }
  if (activeAgentId) {
    return `agent:${activeAgentId}`;
  }
  return "none";
}

function getMessagesDistanceFromBottom(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop);
}

function isMessagesWrapNearBottom(element: HTMLElement): boolean {
  return getMessagesDistanceFromBottom(element) <= MESSAGE_AUTO_SCROLL_THRESHOLD_PX;
}

function setNewMessagesIndicatorVisible(visible: boolean): void {
  const indicator = document.getElementById("new-messages-indicator");
  if (!indicator) {
    return;
  }
  indicator.classList.toggle("show", visible);
  indicator.setAttribute("aria-hidden", String(!visible));
}

function setPendingNewMessageAnchor(messageIndex: number | null): void {
  pendingNewMessageAnchorIndex = messageIndex;
  const indicator = document.getElementById("new-messages-indicator");
  if (!indicator) {
    return;
  }
  if (messageIndex === null) {
    delete indicator.dataset.anchorMessageIndex;
    return;
  }
  indicator.dataset.anchorMessageIndex = String(messageIndex);
}

function clearNewMessagesIndicator(): void {
  setPendingNewMessageAnchor(null);
  setNewMessagesIndicatorVisible(false);
}

function cancelPendingMessagesScrollRestore(): void {
  if (pendingMessagesScrollRestoreFrameId === null) {
    return;
  }
  window.cancelAnimationFrame(pendingMessagesScrollRestoreFrameId);
  pendingMessagesScrollRestoreFrameId = null;
}

function scrollMessagesToBottom(): void {
  const wrap = getMessagesWrap();
  if (!wrap) {
    return;
  }
  cancelPendingMessagesScrollRestore();
  wrap.scrollTop = wrap.scrollHeight;
  isMessagesDetachedFromBottom = false;
  clearNewMessagesIndicator();
}

function scrollToMessageStart(messageIndex: number): boolean {
  const wrap = getMessagesWrap();
  if (!wrap) {
    return false;
  }
  const messageEl = wrap.querySelector<HTMLElement>(`.msg[data-message-index="${messageIndex}"]`);
  if (!messageEl) {
    return false;
  }

  cancelPendingMessagesScrollRestore();
  const wrapRect = wrap.getBoundingClientRect();
  const messageRect = messageEl.getBoundingClientRect();
  const targetScrollTop = Math.max(
    0,
    wrap.scrollTop + (messageRect.top - wrapRect.top) - NEW_MESSAGE_SCROLL_REVEAL_OFFSET_PX,
  );
  wrap.scrollTop = targetScrollTop;
  clearNewMessagesIndicator();
  isMessagesDetachedFromBottom = !isMessagesWrapNearBottom(wrap);
  return true;
}

function getFirstMessageIndexBelowViewport(): number | null {
  const wrap = getMessagesWrap();
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
      const parsedIndex = Number(messageEl.dataset.messageIndex ?? "");
      if (Number.isFinite(parsedIndex)) {
        return parsedIndex;
      }
    }
  }
  return null;
}

function scrollToNewMessagesAnchorOrBottom(): void {
  const anchorIndex = pendingNewMessageAnchorIndex ?? getFirstMessageIndexBelowViewport();
  if (anchorIndex !== null && scrollToMessageStart(anchorIndex)) {
    return;
  }
  scrollMessagesToBottom();
}

function isMessageVisibleInsideWrap(messageIndex: number): boolean {
  const wrap = getMessagesWrap();
  if (!wrap) {
    return false;
  }

  const messageEl = wrap.querySelector<HTMLElement>(`.msg[data-message-index="${messageIndex}"]`);
  if (!messageEl) {
    return false;
  }

  const wrapRect = wrap.getBoundingClientRect();
  const messageRect = messageEl.getBoundingClientRect();
  return messageRect.bottom > wrapRect.top && messageRect.top < wrapRect.bottom;
}

function syncNewMessagesIndicatorForScrollPosition(): void {
  const wrap = getMessagesWrap();
  if (!wrap) {
    return;
  }
  if (
    pendingNewMessageAnchorIndex !== null &&
    isMessageVisibleInsideWrap(pendingNewMessageAnchorIndex)
  ) {
    clearNewMessagesIndicator();
    isMessagesDetachedFromBottom = !isMessagesWrapNearBottom(wrap);
    return;
  }
  if (isMessagesWrapNearBottom(wrap)) {
    isMessagesDetachedFromBottom = false;
    clearNewMessagesIndicator();
    return;
  }
  isMessagesDetachedFromBottom = true;
}

function getPersistedMessageStats(messages: ChatMessage[]): { count: number; maxId: number } {
  let count = 0;
  let maxId = 0;
  for (const message of messages) {
    if (message.id <= 0) {
      continue;
    }
    count += 1;
    maxId = Math.max(maxId, message.id);
  }
  return { count, maxId };
}

function getLatestNonUserMessageSignature(messages: ChatMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sender === "user" || message.id <= 0) {
      continue;
    }
    return `${message.id}:${message.sender}:${message.createdAt}:${message.content}`;
  }
  return "";
}

function getFirstNewPersistedMessageIndex(
  messages: ChatMessage[],
  previousMaxMessageId: number,
): number | null {
  let earliestNewIndex: number | null = null;
  for (const [index, message] of messages.entries()) {
    if (message.id <= previousMaxMessageId || message.id <= 0) {
      continue;
    }
    if (earliestNewIndex === null) {
      earliestNewIndex = index;
    }
  }
  return earliestNewIndex;
}

function getLatestNonUserMessageIndex(messages: ChatMessage[]): number | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.sender === "user" || message.id <= 0) {
      if (message.sender === "user") {
        continue;
      }
      if (message.id <= 0) {
        return index;
      }
      continue;
    }
    return index;
  }
  return null;
}

function highlightInlineMentions(text: string): string {
  return text
    .replace(
      /(^|[\s.,!?;:()[\]{}<>"'`])(@\{[^{}\r\n]+\})/g,
      '$1<span class="mention">$2</span>',
    )
    .replace(
      /(^|[\s.,!?;:()[\]{}<>"'`])(@(?![@{])[^\s.,!?;:()[\]{}<>"'`]+)/g,
      '$1<span class="mention">$2</span>',
    );
}

function renderInlineMarkdown(text: string): string {
  const inlineCodeTokens: string[] = [];
  const withTokens = text.replace(/`([^`\n]+)`/g, (_matched, codeText: string) => {
    const token = `@@INLINE_CODE_${inlineCodeTokens.length}@@`;
    inlineCodeTokens.push(`<code>${escapeHtml(codeText)}</code>`);
    return token;
  });

  let html = escapeHtml(withTokens);
  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  html = highlightInlineMentions(html);

  for (let i = 0; i < inlineCodeTokens.length; i += 1) {
    html = html.replace(`@@INLINE_CODE_${i}@@`, inlineCodeTokens[i]);
  }
  return html;
}

function parseMarkdownTextBlock(block: string): string {
  const lines = block.split("\n");
  const htmlParts: string[] = [];
  let index = 0;

  const isListOrBlockStart = (line: string): boolean =>
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*_]{3,}\s*$/.test(line) ||
    /^[-+*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line);

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      htmlParts.push(`<h${level}>${renderInlineMarkdown(headingMatch[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^[-*_]{3,}\s*$/.test(line)) {
      htmlParts.push("<hr />");
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      htmlParts.push(`<blockquote>${quoteLines.map(renderInlineMarkdown).join("<br />")}</blockquote>`);
      continue;
    }

    if (/^[-+*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-+*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-+*]\s+/, ""));
        index += 1;
      }
      htmlParts.push(`<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      htmlParts.push(`<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isListOrBlockStart(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    htmlParts.push(`<p>${paragraphLines.map(renderInlineMarkdown).join("<br />")}</p>`);
  }

  return htmlParts.join("");
}

function renderMarkdown(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const codeBlockPattern = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;

  let cursor = 0;
  const htmlParts: string[] = [];
  let match = codeBlockPattern.exec(normalized);

  while (match) {
    const start = match.index;
    const end = codeBlockPattern.lastIndex;
    const plainText = normalized.slice(cursor, start);
    if (plainText.trim()) {
      htmlParts.push(parseMarkdownTextBlock(plainText));
    }

    const lang = (match[1] ?? "").trim();
    const code = match[2] ?? "";
    const classAttr = lang ? ` class="language-${escapeAttr(lang)}"` : "";
    htmlParts.push(`<pre><code${classAttr}>${escapeHtml(code)}</code></pre>`);
    cursor = end;
    match = codeBlockPattern.exec(normalized);
  }

  const tail = normalized.slice(cursor);
  if (tail.trim()) {
    htmlParts.push(parseMarkdownTextBlock(tail));
  }

  return htmlParts.join("") || `<p>${escapeHtml(text)}</p>`;
}

function stripChannelActionBlocks(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(CHANNEL_ACTION_BLOCK_PATTERN, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getRenderableMessageText(message: ChatMessage): string {
  if (message.sender === "user" || appSettings?.debugMode) {
    return message.content;
  }
  return stripChannelActionBlocks(message.content);
}

function getChatInput(): HTMLElement | null {
  return document.getElementById("chat-input");
}

function getComposerNodeTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.length ?? 0;
  }
  if (node instanceof HTMLBRElement) {
    return 1;
  }
  return Array.from(node.childNodes).reduce((sum, child) => sum + getComposerNodeTextLength(child), 0);
}

function getComposerTextFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }
  if (node instanceof HTMLBRElement) {
    return "\n";
  }
  return Array.from(node.childNodes).map(getComposerTextFromNode).join("");
}

function getComposerText(input: HTMLElement): string {
  return getComposerTextFromNode(input).replace(/\u00a0/g, " ");
}

function updateComposerEmptyState(input: HTMLElement): void {
  input.dataset.empty = getComposerText(input).length === 0 ? "true" : "false";
}

function appendComposerPlainText(parent: HTMLElement | DocumentFragment, text: string): void {
  const parts = text.split("\n");
  parts.forEach((part, index) => {
    if (index > 0) {
      parent.appendChild(document.createElement("br"));
    }
    if (part) {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

function placeComposerCaretAtOffset(root: HTMLElement, targetOffset: number): void {
  const selection = window.getSelection();
  if (!selection) {
    return;
  }

  const range = document.createRange();
  let remaining = Math.max(0, targetOffset);
  let placed = false;

  const visit = (node: Node): void => {
    if (placed) {
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (remaining <= length) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
        return;
      }
      remaining -= length;
      return;
    }
    if (node instanceof HTMLBRElement) {
      if (remaining <= 1) {
        const parent = node.parentNode;
        if (parent) {
          range.setStartAfter(node);
          range.collapse(true);
          placed = true;
        }
        return;
      }
      remaining -= 1;
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      visit(child);
      if (placed) {
        return;
      }
    }
  };

  visit(root);
  if (!placed) {
    range.selectNodeContents(root);
    range.collapse(false);
  }

  selection.removeAllRanges();
  selection.addRange(range);
}

function setComposerText(input: HTMLElement, value: string, caretOffset = value.length): void {
  input.innerHTML = "";
  appendComposerPlainText(input, value);
  updateComposerEmptyState(input);
  placeComposerCaretAtOffset(input, caretOffset);
}

function getComposerOffsetForPosition(root: HTMLElement, container: Node, offset: number): number {
  if (container === root) {
    return Array.from(root.childNodes)
      .slice(0, offset)
      .reduce((sum, child) => sum + getComposerNodeTextLength(child), 0);
  }
  if (container.nodeType === Node.TEXT_NODE) {
    let total = offset;
    let current: Node | null = container;
    while (current && current !== root) {
      let sibling = current.previousSibling;
      while (sibling) {
        total += getComposerNodeTextLength(sibling);
        sibling = sibling.previousSibling;
      }
      current = current.parentNode;
    }
    return total;
  }
  if (container instanceof HTMLElement) {
    let total = Array.from(container.childNodes)
      .slice(0, offset)
      .reduce((sum, child) => sum + getComposerNodeTextLength(child), 0);
    let current: Node | null = container;
    while (current && current !== root) {
      let sibling = current.previousSibling;
      while (sibling) {
        total += getComposerNodeTextLength(sibling);
        sibling = sibling.previousSibling;
      }
      current = current.parentNode;
    }
    return total;
  }
  return 0;
}

function getComposerSelectionOffset(input: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!input.contains(range.startContainer)) {
    return null;
  }
  return getComposerOffsetForPosition(input, range.startContainer, range.startOffset);
}

function focusInput(): void {
  const input = getChatInput();
  if (!input || isMessagesDetachedFromBottom) {
    return;
  }
  setTimeout(() => {
    input.focus();
    placeComposerCaretAtOffset(input, getComposerText(input).length);
  }, 0);
}

function restoreInputFocus(): void {
  const input = getChatInput();
  if (!input || input.getAttribute("aria-disabled") === "true") {
    return;
  }
  setTimeout(() => {
    input.focus();
  }, 0);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

function setStatus(text: string): void {
  void text;
  renderTypingIndicator();
}

function setHeader(title: string, subtitle = ""): void {
  const titleEl = document.getElementById("agent-title");
  const subtitleEl = document.getElementById("agent-subtitle");
  if (titleEl) {
    titleEl.textContent = title;
  }
  if (subtitleEl) {
    subtitleEl.textContent = subtitle;
  }
  renderHeaderAvatar();
}

function getEnabledComposerPlaceholder(): string {
  const activeChannelId = channelStore.getActiveChannelId();
  if (activeChannelId) {
    const channel = getChannelById(activeChannelId);
    return channel
      ? `#${channel.name} 채널에 메시지를 남기세요. (@멤버 멘션으로 작업 위임)`
      : "채널에 메시지를 남기세요. (@멤버 멘션으로 작업 위임)";
  }
  if (activeAgentId) {
    const agent = agents.find((item) => item.id === activeAgentId);
    return `${agent?.name ?? "멤버"}에게 메시지를 보내세요. (Enter 전송, Shift+Enter 줄바꿈)`;
  }
  return "Helper에게 작업을 요청하세요. (Enter 전송, Shift+Enter 줄바꿈)";
}

function setComposerEnabled(enabled: boolean, disabledPlaceholder = "먼저 멤버를 추가하세요."): void {
  const input = getChatInput();
  const button = document.getElementById("send-btn") as HTMLButtonElement | null;
  if (input) {
    input.contentEditable = enabled ? "true" : "false";
    input.setAttribute("aria-disabled", enabled ? "false" : "true");
    input.setAttribute("data-placeholder", enabled ? getEnabledComposerPlaceholder() : disabledPlaceholder);
    updateComposerEmptyState(input);
  }
  if (button) {
    button.disabled = !enabled;
  }
  if (!enabled) {
    closeMentionSuggestions();
  }
}

function normalizeMentionSearchText(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase();
}

function isMentionStartBoundary(value: string, index: number): boolean {
  if (index <= 0) {
    return true;
  }
  return /[\s([{\-–—.,!?;:]/.test(value[index - 1] ?? "");
}

function getActiveMentionQuery(input: HTMLElement): ActiveMentionQuery | null {
  if (!channelStore.getActiveChannelId() || input.getAttribute("aria-disabled") === "true") {
    return null;
  }
  const end = getComposerSelectionOffset(input);
  if (end === null) {
    return null;
  }

  const value = getComposerText(input);
  const beforeCaret = value.slice(0, end);
  const braceStart = beforeCaret.lastIndexOf("@{");
  if (braceStart >= 0 && isMentionStartBoundary(value, braceStart)) {
    const query = beforeCaret.slice(braceStart + 2);
    if (!query.includes("}") && !query.includes("\n") && !query.includes("@")) {
      return { start: braceStart, end, query };
    }
  }

  for (let index = end - 1; index >= 0; index -= 1) {
    const char = value[index] ?? "";
    if (char === "@") {
      if (!isMentionStartBoundary(value, index)) {
        return null;
      }
      const query = value.slice(index + 1, end);
      if (/[\s@{}]/.test(query)) {
        return null;
      }
      return { start: index, end, query };
    }
    if (/[\s{}]/.test(char)) {
      return null;
    }
  }

  return null;
}

function getMentionSuggestionCandidates(query: string): Agent[] {
  const normalizedQuery = normalizeMentionSearchText(query);
  const members = channelStore.getActiveChannelMembers();
  if (!normalizedQuery) {
    return members.slice(0, MENTION_SUGGESTION_LIMIT);
  }

  const compactQuery = normalizedQuery.replace(/\s+/g, "");
  const ranked = members
    .map((member, index) => {
      const normalizedName = normalizeMentionSearchText(member.name);
      const compactName = normalizedName.replace(/\s+/g, "");
      const startsWithScore = normalizedName.startsWith(normalizedQuery) || compactName.startsWith(compactQuery);
      const includesScore = normalizedName.includes(normalizedQuery) || compactName.includes(compactQuery);
      return { member, index, rank: startsWithScore ? 0 : includesScore ? 1 : 2 };
    })
    .filter((item) => item.rank < 2)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.member);

  return ranked.slice(0, MENTION_SUGGESTION_LIMIT);
}

function formatMentionInsertion(memberName: string): string {
  const normalized = memberName.trim();
  if (/\s/.test(normalized)) {
    return `@{${normalized}}`;
  }
  return `@${normalized}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findComposerMentionMatches(value: string): Array<{ start: number; end: number; text: string }> {
  const members = channelStore.getActiveChannelMembers();
  if (!channelStore.getActiveChannelId() || members.length === 0) {
    return [];
  }

  const names = members
    .map((member) => member.name.trim())
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) {
    return [];
  }

  const namePattern = names.map(escapeRegExp).join("|");
  const mentionPattern = new RegExp(
    `(^|[\\s.,!?;:()[\\]{}<>"'\`])(@\\{(?:${namePattern})\\}|@(?:${namePattern}))(?=$|[\\s.,!?;:()[\\]{}<>"'\`])`,
    "gu",
  );
  const matches: Array<{ start: number; end: number; text: string }> = [];
  for (const match of value.matchAll(mentionPattern)) {
    const fullMatch = match[0] ?? "";
    const boundary = match[1] ?? "";
    const mention = match[2] ?? "";
    const matchIndex = match.index ?? 0;
    const mentionStart = matchIndex + boundary.length;
    matches.push({
      start: mentionStart,
      end: matchIndex + fullMatch.length,
      text: mention,
    });
  }
  return matches;
}

function setComposerTextWithMentions(input: HTMLElement, value: string, caretOffset = value.length): void {
  input.innerHTML = "";
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of findComposerMentionMatches(value)) {
    appendComposerPlainText(fragment, value.slice(cursor, match.start));
    const mention = document.createElement("span");
    mention.className = "chat-input-mention";
    mention.contentEditable = "false";
    mention.textContent = match.text;
    fragment.appendChild(mention);
    cursor = match.end;
  }
  appendComposerPlainText(fragment, value.slice(cursor));
  input.appendChild(fragment);
  updateComposerEmptyState(input);
  placeComposerCaretAtOffset(input, caretOffset);
}

function renderMentionSuggestions(): void {
  const menu = document.getElementById("mention-suggestions");
  const input = getChatInput();
  if (!menu || !input) {
    return;
  }

  menu.innerHTML = "";
  if (!mentionSuggestionState.isOpen || !mentionSuggestionState.query) {
    menu.classList.remove("show");
    menu.setAttribute("aria-hidden", "true");
    input.removeAttribute("aria-activedescendant");
    return;
  }

  menu.classList.add("show");
  menu.setAttribute("aria-hidden", "false");

  if (mentionSuggestionState.candidates.length === 0) {
    const empty = document.createElement("div");
    empty.className = "mention-suggestion-empty";
    empty.textContent = "멤버 없음";
    menu.appendChild(empty);
    input.removeAttribute("aria-activedescendant");
    return;
  }

  const list = document.createElement("ul");
  list.className = "mention-suggestion-list";

  mentionSuggestionState.candidates.forEach((member, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const itemId = `mention-suggestion-${member.id}`;
    button.id = itemId;
    button.type = "button";
    button.className = `mention-suggestion-item${index === mentionSuggestionState.activeIndex ? " active" : ""}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", index === mentionSuggestionState.activeIndex ? "true" : "false");
    button.dataset.agentId = member.id;

    const avatar = document.createElement("div");
    avatar.className = "avatar mention-suggestion-avatar";
    applyAvatarStyle(avatar, member.name, "agent", getMemberAvatarSeed(member));

    const main = document.createElement("div");
    main.className = "mention-suggestion-main";

    const name = document.createElement("div");
    name.className = "mention-suggestion-name";
    name.textContent = member.name;

    const role = document.createElement("div");
    role.className = "mention-suggestion-role";
    role.textContent = member.role;

    main.appendChild(name);
    main.appendChild(role);
    button.appendChild(avatar);
    button.appendChild(main);
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      selectMentionSuggestion(index);
    });

    item.appendChild(button);
    list.appendChild(item);
  });

  menu.appendChild(list);
  const active = mentionSuggestionState.candidates[mentionSuggestionState.activeIndex];
  if (active) {
    input.setAttribute("aria-activedescendant", `mention-suggestion-${active.id}`);
  }
}

function closeMentionSuggestions(): void {
  if (mentionSuggestionBlurTimer !== null) {
    window.clearTimeout(mentionSuggestionBlurTimer);
    mentionSuggestionBlurTimer = null;
  }
  if (deferredMentionSelectionTimer !== null) {
    window.clearTimeout(deferredMentionSelectionTimer);
    deferredMentionSelectionTimer = null;
  }
  mentionSuggestionState = {
    isOpen: false,
    query: null,
    candidates: [],
    activeIndex: 0,
  };
  renderMentionSuggestions();
}

function refreshMentionSuggestionsForInput(input: HTMLElement): boolean {
  if (mentionSuggestionBlurTimer !== null) {
    window.clearTimeout(mentionSuggestionBlurTimer);
    mentionSuggestionBlurTimer = null;
  }

  const query = getActiveMentionQuery(input);
  if (!query) {
    closeMentionSuggestions();
    return false;
  }

  const currentActiveId = mentionSuggestionState.candidates[mentionSuggestionState.activeIndex]?.id;
  const candidates = getMentionSuggestionCandidates(query.query);
  const nextActiveIndex =
    currentActiveId && candidates.some((candidate) => candidate.id === currentActiveId)
      ? candidates.findIndex((candidate) => candidate.id === currentActiveId)
      : 0;
  mentionSuggestionState = {
    isOpen: true,
    query,
    candidates,
    activeIndex: Math.min(Math.max(0, nextActiveIndex), Math.max(0, candidates.length - 1)),
  };
  renderMentionSuggestions();
  return true;
}

function syncMentionSuggestions(): void {
  const input = getChatInput();
  if (!input) {
    return;
  }
  refreshMentionSuggestionsForInput(input);
}

function selectMentionSuggestion(index: number): void {
  const input = getChatInput();
  const query = mentionSuggestionState.query;
  const member = mentionSuggestionState.candidates[index];
  if (!input || !query || !member) {
    return;
  }

  const currentValue = getComposerText(input);
  const before = currentValue.slice(0, query.start);
  const after = currentValue.slice(query.end);
  const needsTrailingSpace = after.length === 0 || !/^\s/.test(after);
  const insertion = `${formatMentionInsertion(member.name)}${needsTrailingSpace ? " " : ""}`;
  const nextValue = `${before}${insertion}${after}`;
  const nextCaret = before.length + insertion.length;
  setComposerTextWithMentions(input, nextValue, nextCaret);
  input.focus();
  closeMentionSuggestions();
}

function runDeferredMentionSelection(): void {
  deferredMentionSelectionTimer = null;
  const input = getChatInput();
  if (!input || isChatInputComposing) {
    return;
  }
  refreshMentionSuggestionsForInput(input);
  if (mentionSuggestionState.candidates.length === 0) {
    return;
  }
  selectMentionSuggestion(mentionSuggestionState.activeIndex);
}

function scheduleDeferredMentionSelection(delayMs = 0): void {
  if (deferredMentionSelectionTimer !== null) {
    window.clearTimeout(deferredMentionSelectionTimer);
  }
  deferredMentionSelectionTimer = window.setTimeout(runDeferredMentionSelection, delayMs);
}

function moveMentionSuggestion(delta: number): void {
  if (!mentionSuggestionState.isOpen || mentionSuggestionState.candidates.length === 0) {
    return;
  }
  const count = mentionSuggestionState.candidates.length;
  mentionSuggestionState.activeIndex = (mentionSuggestionState.activeIndex + delta + count) % count;
  renderMentionSuggestions();
}

function handleMentionSuggestionKeydown(event: KeyboardEvent): boolean {
  const input = getChatInput();
  const nativeEvent = event as KeyboardEvent & { keyCode?: number };

  if (event.key === "ArrowDown") {
    if (!mentionSuggestionState.isOpen || mentionSuggestionState.candidates.length === 0) {
      return false;
    }
    event.preventDefault();
    moveMentionSuggestion(1);
    return true;
  }
  if (event.key === "ArrowUp") {
    if (!mentionSuggestionState.isOpen || mentionSuggestionState.candidates.length === 0) {
      return false;
    }
    event.preventDefault();
    moveMentionSuggestion(-1);
    return true;
  }

  if (event.key === "Enter" && (nativeEvent.isComposing || nativeEvent.keyCode === 229)) {
    return false;
  }

  if (event.key === "Tab" && (nativeEvent.isComposing || nativeEvent.keyCode === 229 || isChatInputComposing)) {
    event.preventDefault();
    scheduleDeferredMentionSelection(80);
    return true;
  }

  if (input && (event.key === "Enter" || event.key === "Tab")) {
    refreshMentionSuggestionsForInput(input);
  }

  if ((event.key === "Enter" || event.key === "Tab") && mentionSuggestionState.candidates.length > 0) {
    event.preventDefault();
    selectMentionSuggestion(mentionSuggestionState.activeIndex);
    return true;
  }
  if (event.key === "Escape") {
    if (!mentionSuggestionState.isOpen) {
      return false;
    }
    event.preventDefault();
    closeMentionSuggestions();
    return true;
  }

  return false;
}

function showWarning(text: string | null): void {
  const warningEl = document.getElementById("warning");
  if (!warningEl) {
    return;
  }
  if (!text) {
    warningEl.textContent = "";
    warningEl.classList.remove("show");
    return;
  }
  warningEl.textContent = text;
  warningEl.classList.add("show");
}

function getSelectedModelLabel(): string {
  return appSettings?.selectedModel ? appSettings.selectedModel : "Codex 기본값";
}

function getReadyStatusText(command?: string): string {
  const modelLabel = appSettings?.selectedModel;
  if (command) {
    return modelLabel ? `Ready (${command} / ${modelLabel})` : `Ready (${command})`;
  }
  return modelLabel ? `Ready (${modelLabel})` : "Ready";
}

function getActiveChannelStatusText(): string {
  const typingActors = getActiveTypingActors();
  if (typingActors.length > 0) {
    if (typingActors.length === 1) {
      return `${typingActors[0]?.name ?? "Agent"} 작성 중...`;
    }
    return `${typingActors.length}명 작성 중...`;
  }
  if (
    channelStore.getInflightChannelRequestCount() > 0 ||
    channelStore.getActiveChannelRunningJobCount() > 0
  ) {
    return "Channel is working...";
  }
  return codexReady ? getReadyStatusText() : "Codex unavailable";
}

function renderSettingsTabUi(): void {
  const modelTabBtn = document.getElementById("settings-tab-model");
  const debugTabBtn = document.getElementById("settings-tab-debug");
  const modelPanel = document.getElementById("settings-panel-model");
  const debugPanel = document.getElementById("settings-panel-debug");
  if (!modelTabBtn || !debugTabBtn || !modelPanel || !debugPanel) {
    return;
  }

  const isModelTab = activeSettingsTab === "model";
  modelTabBtn.classList.toggle("active", isModelTab);
  modelTabBtn.setAttribute("aria-selected", String(isModelTab));
  modelPanel.classList.toggle("active", isModelTab);
  modelPanel.toggleAttribute("hidden", !isModelTab);

  debugTabBtn.classList.toggle("active", !isModelTab);
  debugTabBtn.setAttribute("aria-selected", String(!isModelTab));
  debugPanel.classList.toggle("active", !isModelTab);
  debugPanel.toggleAttribute("hidden", isModelTab);
}

function setActiveSettingsTab(nextTab: SettingsTab): void {
  activeSettingsTab = nextTab;
  renderSettingsTabUi();
}

function syncStatusForCurrentContext(): void {
  if (channelStore.getActiveChannelId()) {
    setStatus(getActiveChannelStatusText());
    return;
  }
  if (activeAgentId && inflightAgentIds.has(activeAgentId)) {
    const activeAgent = agents.find((agent) => agent.id === activeAgentId);
    setStatus(`${activeAgent?.name ?? "Agent"} 작성 중...`);
    return;
  }
  setStatus(codexReady ? getReadyStatusText() : "Codex unavailable");
}

function renderSettingsModal(): void {
  const modelSelect = document.getElementById("settings-model-select") as HTMLSelectElement | null;
  const currentModelEl = document.getElementById("settings-current-model");
  const debugModeStatusEl = document.getElementById("settings-debug-mode-status");
  const debugModeInput = document.getElementById("settings-debug-mode-input") as HTMLInputElement | null;
  const cachePathEl = document.getElementById("settings-cache-path");
  const helpEl = document.getElementById("settings-model-help");
  const errorEl = document.getElementById("settings-cache-error");
  const saveBtn = document.getElementById("settings-model-save-btn") as HTMLButtonElement | null;
  const indicatorEl = document.getElementById("workspace-model-indicator");
  if (
    !modelSelect ||
    !currentModelEl ||
    !debugModeStatusEl ||
    !debugModeInput ||
    !cachePathEl ||
    !helpEl ||
    !errorEl ||
    !saveBtn
  ) {
    return;
  }

  const settings = appSettings;
  const availableModels = settings?.availableModels ?? [];
  const selectedModel = settings?.selectedModel ?? null;
  const debugMode = settings?.debugMode ?? false;

  currentModelEl.textContent = getSelectedModelLabel();
  debugModeStatusEl.textContent = debugMode ? "켜짐" : "꺼짐";
  cachePathEl.textContent = settings?.modelsCachePath ?? "~/.codex/models_cache.json";
  helpEl.textContent = selectedModel
    ? `현재 모든 Codex 질의는 ${selectedModel}로 실행됩니다.`
    : "현재 Codex 기본 모델을 사용합니다.";
  if (indicatorEl) {
    indicatorEl.textContent = selectedModel ? `모델 · ${selectedModel}` : "모델 · Codex 기본값";
  }

  modelSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Codex 기본값";
  modelSelect.appendChild(defaultOption);

  const knownModels = new Set<string>();
  for (const model of availableModels) {
    knownModels.add(model);
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model;
    modelSelect.appendChild(option);
  }
  if (selectedModel && !knownModels.has(selectedModel)) {
    const unavailableOption = document.createElement("option");
    unavailableOption.value = selectedModel;
    unavailableOption.textContent = `${selectedModel} (캐시에서 찾을 수 없음)`;
    modelSelect.appendChild(unavailableOption);
  }

  modelSelect.value = selectedModel ?? "";
  modelSelect.disabled = isSavingSettings;
  debugModeInput.checked = debugMode;
  debugModeInput.disabled = isSavingSettings;
  saveBtn.disabled = isSavingSettings;

  const errorMessage =
    settings?.cacheError ??
    (settings?.selectedModel && !settings.selectedModelAvailable
      ? `저장된 모델 "${settings.selectedModel}" 이(가) 현재 캐시에 없습니다.`
      : null);
  errorEl.textContent = errorMessage ?? "";
  errorEl.classList.toggle("show", Boolean(errorMessage));
  renderSettingsTabUi();
}

async function loadSettings(): Promise<void> {
  appSettings = await fetchJson<AppSettingsResponse>(`${backendBaseUrl}/api/settings`);
  renderSettingsModal();
}

async function loadPromptTemplates(): Promise<void> {
  promptTemplates = await fetchJson<PromptTemplatesResponse>(
    `${backendBaseUrl}/api/system/prompt-templates`,
  );
}

async function openSettingsModal(): Promise<void> {
  const modal = document.getElementById("settings-modal") as HTMLDialogElement | null;
  if (!modal) {
    return;
  }

  closeMemberMenu();
  closeChannelMenu();
  closeChannelMemberMenu();
  setActiveSettingsTab("model");
  await loadSettings();

  if (modal.open) {
    modal.close();
  }
  modal.showModal();
  setTimeout(() => {
    const focusTarget =
      activeSettingsTab === "debug"
        ? (document.getElementById("settings-debug-mode-input") as HTMLInputElement | null)
        : (document.getElementById("settings-model-select") as HTMLSelectElement | null);
    focusTarget?.focus();
  }, 0);
}

function closeSettingsModal(): void {
  const modal = document.getElementById("settings-modal") as HTMLDialogElement | null;
  if (!modal || !modal.open) {
    return;
  }
  modal.close();
}

async function saveSettings(): Promise<void> {
  const modelSelect = document.getElementById("settings-model-select") as HTMLSelectElement | null;
  const debugModeInput = document.getElementById("settings-debug-mode-input") as HTMLInputElement | null;
  if (!modelSelect || !debugModeInput) {
    return;
  }
  const nextSelectedModel = modelSelect.value || null;
  const nextDebugMode = debugModeInput.checked;

  isSavingSettings = true;
  renderSettingsModal();

  try {
    appSettings = await fetchJson<AppSettingsResponse>(`${backendBaseUrl}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        selectedModel: nextSelectedModel,
        debugMode: nextDebugMode,
      }),
    });
    renderSettingsModal();
    await refreshMessages();
    showWarning(null);
    closeSettingsModal();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`환경 설정 저장 실패: ${message}`);
    setStatus(`Error: ${message}`);
  } finally {
    isSavingSettings = false;
    renderSettingsModal();
  }
}

function initSidebarSections(): void {
  const toggles = document.querySelectorAll<HTMLButtonElement>(".section-toggle");
  toggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const section = toggle.closest(".sidebar-section");
      if (!section) {
        return;
      }
      const isCollapsed = section.classList.toggle("collapsed");
      toggle.setAttribute("aria-expanded", String(!isCollapsed));
    });
  });
}

function getChannelById(channelId: string | null): Channel | null {
  return channelStore.getChannelById(channelId);
}

function updateChannelActionButtons(): void {
  const buttons = [
    document.getElementById("channel-workspace-btn"),
    document.getElementById("channel-members-btn"),
  ].filter((button): button is HTMLElement => button instanceof HTMLElement);
  const hasActiveChannel = Boolean(channelStore.getActiveChannelId());
  for (const button of buttons) {
    if (hasActiveChannel) {
      button.classList.remove("hidden");
    } else {
      button.classList.add("hidden");
    }
  }
}

async function refreshChannels(preferredChannelId?: string | null): Promise<void> {
  const data = await fetchJson<{ channels: Channel[] }>(`${backendBaseUrl}/api/channels`);
  channelStore.setChannels(data.channels, preferredChannelId ?? channelStore.getActiveChannelId());
  renderChannelList();
  updateChannelActionButtons();
}

function normalizeSearchKeyword(value: string): string {
  return value.trim().toLowerCase();
}

function matchesAgentSearch(agent: Agent, keyword: string): boolean {
  if (!keyword) {
    return true;
  }
  const target = `${agent.name} ${agent.role}`.toLowerCase();
  return target.includes(keyword);
}

async function refreshActiveChannelMembers(): Promise<void> {
  const activeChannelId = channelStore.getActiveChannelId();
  if (!activeChannelId) {
    channelStore.clearActiveChannelMembers();
    return;
  }

  const data = await fetchJson<ChannelMemberResponse>(
    `${backendBaseUrl}/api/channels/${activeChannelId}/members`,
  );
  channelStore.setActiveChannelMembers(data.members);
}

function mapChannelMessagesToChatMessages(
  messages: ChannelApiMessage[],
  members: Agent[],
): ChatMessage[] {
  const memberNameById = new Map<string, string>(members.map((member) => [member.id, member.name]));
  return messages.map((message) => ({
    id: message.id,
    sender: message.senderType,
    senderId: message.senderId,
    senderLabel: message.senderId ? memberNameById.get(message.senderId) : undefined,
    content: message.content,
    createdAt: message.createdAt,
    messageKind: message.messageKind,
  }));
}

function getLastChannelMessageId(messages: ChannelApiMessage[]): number {
  return channelStore.getLastChannelMessageId(messages);
}

function mergeChannelMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  return channelStore.mergeChannelMessages(current, incoming);
}

function getPersistedChannelMessages(messages: ChatMessage[]): ChatMessage[] {
  return channelStore.getPersistedChannelMessages(messages);
}

function createPendingChannelUserMessage(channelId: string, content: string): ChatMessage {
  return channelStore.createPendingChannelUserMessage(channelId, content);
}

function removePendingChannelUserMessage(localId: number): void {
  channelStore.removePendingChannelUserMessage(localId);
}

function getPendingChannelUserMessagesForRender(channelId: string): ChatMessage[] {
  return channelStore.getPendingChannelUserMessagesForRender(channelId);
}

function reconcilePendingChannelUserMessages(channelId: string, serverMessages: ChatMessage[]): void {
  channelStore.reconcilePendingChannelUserMessages(channelId, serverMessages);
}

function renderChannelList(): void {
  const list = document.getElementById("channel-list");
  if (!list) {
    return;
  }

  list.innerHTML = "";
  const channels = channelStore.getChannels();
  const activeChannelId = channelStore.getActiveChannelId();
  if (channels.length === 0) {
    const empty = document.createElement("li");
    empty.className = "section-item empty";
    empty.textContent = "채널이 없습니다.";
    list.appendChild(empty);
    return;
  }

  for (const channel of channels) {
    const item = document.createElement("li");
    item.className = `section-item channel${channel.id === activeChannelId ? " active" : ""}`;

    const rowEl = document.createElement("div");
    rowEl.className = "channel-row";

    const nameEl = document.createElement("div");
    nameEl.className = "channel-name";
    nameEl.textContent = `# ${channel.name}`;

    const menuBtn = document.createElement("button");
    menuBtn.className = "channel-menu-btn";
    menuBtn.type = "button";
    menuBtn.textContent = "☰";
    menuBtn.setAttribute("aria-label", `${channel.name} 채널 메뉴`);
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openChannelMenu(channel.id, menuBtn);
    });

    rowEl.appendChild(nameEl);
    rowEl.appendChild(menuBtn);
    item.appendChild(rowEl);

    item.addEventListener("click", () => {
      closeChannelMenu();
      closeMentionSuggestions();
      channelStore.setActiveChannelId(channel.id);
      activeAgentId = null;
      renderChannelList();
      renderMemberList();
      updateChannelActionButtons();
      void refreshMessages();
    });
    list.appendChild(item);
  }
}

function renderMessages(
  messages: ChatMessage[],
  agentName = "Agent",
  options: RenderMessagesOptions = {},
): void {
  const list = document.getElementById("messages");
  const wrap = getMessagesWrap();
  if (!list) {
    return;
  }

  const nextContextKey = getActiveMessageContextKey();
  const sameContext = nextContextKey === lastRenderedMessageContextKey;
  const previousScrollTop = wrap ? wrap.scrollTop : 0;
  const wasNearBottom = !wrap || isMessagesWrapNearBottom(wrap);
  const nextPersistedStats = getPersistedMessageStats(messages);
  const nextNonUserMessageSignature = getLatestNonUserMessageSignature(messages);
  const firstNewPersistedMessageIndex = getFirstNewPersistedMessageIndex(
    messages,
    lastRenderedMaxPersistedMessageId,
  );
  const latestNonUserMessageIndex = getLatestNonUserMessageIndex(messages);
  const hasNewPersistedMessages =
    sameContext &&
    (nextPersistedStats.maxId > lastRenderedMaxPersistedMessageId ||
      nextPersistedStats.count > lastRenderedPersistedMessageCount);
  const hasNewRemoteMessage =
    sameContext &&
    nextNonUserMessageSignature.length > 0 &&
    nextNonUserMessageSignature !== lastRenderedNonUserMessageSignature;

  list.innerHTML = "";
  if (messages.length === 0) {
    const empty = document.createElement("li");
    empty.className = "msg-empty";
    empty.textContent = "대화를 시작해 보세요.";
    list.appendChild(empty);
  }

  for (const [index, message] of messages.entries()) {
    const item = document.createElement("li");
    item.className = `msg msg-${message.sender}`;
    item.dataset.messageId = String(message.id);
    item.dataset.messageIndex = String(index);
    if (message.messageKind && message.messageKind !== "general") {
      item.classList.add(message.messageKind);
    }

    const avatar = document.createElement("div");
    avatar.className = "avatar msg-avatar";
    const senderLabel = getMessageSenderLabel(message, agentName);
    applyAvatarStyle(
      avatar,
      senderLabel,
      getMessageAvatarVariant(message),
      getMessageAvatarSeed(message, senderLabel),
    );

    const main = document.createElement("div");
    main.className = "msg-main";

    const meta = document.createElement("div");
    meta.className = "msg-meta";

    const sender = document.createElement("div");
    sender.className = "msg-sender";
    sender.textContent = senderLabel;

    const ts = document.createElement("div");
    ts.className = "msg-time";
    ts.textContent = formatMessageTimestamp(message.createdAt);

    meta.appendChild(sender);
    meta.appendChild(ts);

    const body = document.createElement("div");
    body.className = "msg-content";
    body.innerHTML = renderMarkdown(getRenderableMessageText(message));

    main.appendChild(meta);
    main.appendChild(body);
    item.appendChild(avatar);
    item.appendChild(main);
    list.appendChild(item);
  }

  if (wrap) {
    cancelPendingMessagesScrollRestore();
    const shouldScrollToBottom =
      options.forceScrollToBottom ||
      !sameContext ||
      (!isMessagesDetachedFromBottom && wasNearBottom);
    if (shouldScrollToBottom) {
      scrollMessagesToBottom();
    } else {
      wrap.scrollTop = previousScrollTop;
      pendingMessagesScrollRestoreFrameId = window.requestAnimationFrame(() => {
        pendingMessagesScrollRestoreFrameId = null;
        if (!isMessagesDetachedFromBottom || getActiveMessageContextKey() !== nextContextKey) {
          return;
        }
        wrap.scrollTop = previousScrollTop;
      });
    }
  }

  if (!sameContext || messages.length === 0) {
    if (!sameContext) {
      isMessagesDetachedFromBottom = false;
    }
    clearNewMessagesIndicator();
  } else if (
    (hasNewPersistedMessages || hasNewRemoteMessage) &&
    !(options.forceScrollToBottom || wasNearBottom)
  ) {
    setPendingNewMessageAnchor(firstNewPersistedMessageIndex ?? latestNonUserMessageIndex);
    setNewMessagesIndicatorVisible(true);
  }

  renderedMessages = messages;
  lastRenderedMessageContextKey = nextContextKey;
  lastRenderedPersistedMessageCount = nextPersistedStats.count;
  lastRenderedMaxPersistedMessageId = nextPersistedStats.maxId;
  lastRenderedNonUserMessageSignature = nextNonUserMessageSignature;
  syncNewMessagesIndicatorForScrollPosition();
}

function initMessagesViewportUi(): void {
  const wrap = getMessagesWrap();
  const newMessagesBtn = document.getElementById("new-messages-btn") as HTMLButtonElement | null;
  wrap?.addEventListener("scroll", () => {
    cancelPendingMessagesScrollRestore();
    syncNewMessagesIndicatorForScrollPosition();
  }, { passive: true });
  newMessagesBtn?.addEventListener("click", () => {
    scrollToNewMessagesAnchorOrBottom();
  });
}

function closeMemberMenu(): void {
  const menu = document.getElementById("member-menu");
  if (!menu) {
    return;
  }
  menu.classList.remove("show");
  menu.setAttribute("aria-hidden", "true");
  openMemberMenuAgentId = null;
}

function closeChannelMenu(): void {
  const menu = document.getElementById("channel-menu");
  if (!menu) {
    return;
  }
  menu.classList.remove("show");
  menu.setAttribute("aria-hidden", "true");
  openChannelMenuChannelId = null;
}

function openChannelMenu(channelId: string, anchor: HTMLElement): void {
  const menu = document.getElementById("channel-menu");
  if (!menu) {
    return;
  }
  if (openChannelMenuChannelId === channelId && menu.classList.contains("show")) {
    closeChannelMenu();
    return;
  }

  openChannelMenuChannelId = channelId;
  menu.classList.add("show");
  menu.setAttribute("aria-hidden", "false");

  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth || 124;
  const height = menu.offsetHeight || 76;
  const margin = 8;

  let left = rect.right - width;
  let top = rect.bottom + 4;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  if (top + height > window.innerHeight - margin) {
    top = rect.top - height - 4;
  }
  top = Math.max(margin, top);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeChannelMemberMenu(): void {
  const menu = document.getElementById("channel-member-menu");
  if (!menu) {
    return;
  }
  menu.classList.remove("show");
  menu.setAttribute("aria-hidden", "true");
  openChannelMemberMenuMemberId = null;
}

function openChannelMemberMenu(memberId: string, anchor: HTMLElement): void {
  const menu = document.getElementById("channel-member-menu");
  if (!menu) {
    return;
  }
  if (openChannelMemberMenuMemberId === memberId && menu.classList.contains("show")) {
    closeChannelMemberMenu();
    return;
  }

  openChannelMemberMenuMemberId = memberId;
  menu.classList.add("show");
  menu.setAttribute("aria-hidden", "false");

  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth || 124;
  const height = menu.offsetHeight || 44;
  const margin = 8;

  let left = rect.right - width;
  let top = rect.bottom + 4;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  if (top + height > window.innerHeight - margin) {
    top = rect.top - height - 4;
  }
  top = Math.max(margin, top);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function openActionModal(
  action: PendingAction,
  title: string,
  description: string,
  confirmLabel: string,
): void {
  const modal = document.getElementById("action-modal") as HTMLDialogElement | null;
  const titleEl = document.getElementById("action-modal-title");
  const descEl = document.getElementById("action-modal-desc");
  const confirmBtn = document.getElementById("action-confirm-btn");
  if (!modal || !titleEl || !descEl || !confirmBtn) {
    return;
  }

  pendingAction = action;
  titleEl.textContent = title;
  descEl.textContent = description;
  confirmBtn.textContent = confirmLabel;

  if (modal.open) {
    modal.close();
  }
  modal.showModal();
}

function closeActionModal(): void {
  const modal = document.getElementById("action-modal") as HTMLDialogElement | null;
  pendingAction = null;
  if (!modal || !modal.open) {
    return;
  }
  modal.close();
  restoreInputFocus();
}

function openMemberMenu(agentId: string, anchor: HTMLElement): void {
  const menu = document.getElementById("member-menu");
  if (!menu) {
    return;
  }
  if (openMemberMenuAgentId === agentId && menu.classList.contains("show")) {
    closeMemberMenu();
    return;
  }

  openMemberMenuAgentId = agentId;
  menu.classList.add("show");
  menu.setAttribute("aria-hidden", "false");

  const rect = anchor.getBoundingClientRect();
  const width = menu.offsetWidth || 124;
  const height = menu.offsetHeight || 76;
  const margin = 8;

  let left = rect.right - width;
  let top = rect.bottom + 4;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  if (top + height > window.innerHeight - margin) {
    top = rect.top - height - 4;
  }
  top = Math.max(margin, top);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function renderMemberList(): void {
  const list = document.getElementById("member-list");
  if (!list) {
    return;
  }

  list.innerHTML = "";
  if (agents.length === 0) {
    const empty = document.createElement("li");
    empty.className = "member-empty";
    empty.textContent = "멤버가 없습니다.";
    list.appendChild(empty);
    setComposerEnabled(false);
    return;
  }

  for (const agent of agents) {
    const item = document.createElement("li");
    item.className = `member-item${agent.id === activeAgentId ? " active" : ""}`;

    const mainBtn = document.createElement("button");
    mainBtn.className = "member-main";
    mainBtn.type = "button";
    mainBtn.addEventListener("click", () => {
      if (activeAgentId === agent.id) {
        if (channelStore.getActiveChannelId()) {
          channelStore.setActiveChannelId(null);
          renderChannelList();
          updateChannelActionButtons();
          void refreshMessages();
        }
        return;
      }
      channelStore.setActiveChannelId(null);
      closeMentionSuggestions();
      activeAgentId = agent.id;
      unreadAgentIds.delete(agent.id);
      renderChannelList();
      renderMemberList();
      updateChannelActionButtons();
      void refreshMessages();
    });

    const avatar = document.createElement("div");
    avatar.className = "avatar member-avatar";
    applyAvatarStyle(avatar, agent.name, "agent", getMemberAvatarSeed(agent));

    const textWrap = document.createElement("div");
    textWrap.className = "member-text";

    const nameEl = document.createElement("div");
    nameEl.className = "member-name";
    nameEl.textContent = agent.name;

    const nameRowEl = document.createElement("div");
    nameRowEl.className = "member-name-row";
    nameRowEl.appendChild(nameEl);

    if (inflightAgentIds.has(agent.id) || unreadAgentIds.has(agent.id)) {
      const statusChip = document.createElement("span");
      statusChip.className = `member-status-chip ${inflightAgentIds.has(agent.id) ? "working" : "unread"}`;
      statusChip.textContent = inflightAgentIds.has(agent.id) ? "작성중" : "새 응답";
      nameRowEl.appendChild(statusChip);
    }

    const roleEl = document.createElement("div");
    roleEl.className = "member-role";
    roleEl.textContent = agent.role;

    textWrap.appendChild(nameRowEl);
    textWrap.appendChild(roleEl);

    const menuBtn = document.createElement("button");
    menuBtn.className = "member-menu-btn";
    menuBtn.type = "button";
    menuBtn.textContent = "☰";
    menuBtn.setAttribute("aria-label", `${agent.name} 메뉴`);
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openMemberMenu(agent.id, menuBtn);
    });

    mainBtn.appendChild(avatar);
    mainBtn.appendChild(textWrap);
    mainBtn.appendChild(menuBtn);
    item.appendChild(mainBtn);
    list.appendChild(item);
  }

  if (channelStore.getActiveChannelId()) {
    setComposerEnabled(true);
  } else {
    setComposerEnabled(activeAgentId !== null);
  }
}

function setMemberNameInputError(isError: boolean, reason?: string): void {
  const nameInput = document.getElementById("member-name-input") as HTMLInputElement | null;
  const errorText = document.getElementById("member-name-error") as HTMLDivElement | null;
  if (!nameInput || !errorText) {
    return;
  }

  if (isError) {
    nameInput.classList.add("field-error");
    nameInput.setAttribute("aria-invalid", "true");
    errorText.textContent = reason ?? "이미 사용 중인 멤버 표시명입니다.";
    errorText.classList.add("show");
    return;
  }

  nameInput.classList.remove("field-error");
  nameInput.removeAttribute("aria-invalid");
  errorText.textContent = "";
  errorText.classList.remove("show");
}

function setChannelNameInputError(isError: boolean, reason?: string): void {
  const nameInput = document.getElementById("channel-name-input") as HTMLInputElement | null;
  const errorText = document.getElementById("channel-name-error") as HTMLDivElement | null;
  if (!nameInput || !errorText) {
    return;
  }

  if (isError) {
    nameInput.classList.add("field-error");
    nameInput.setAttribute("aria-invalid", "true");
    errorText.textContent = reason ?? "이미 사용 중인 채널 이름입니다.";
    errorText.classList.add("show");
    return;
  }

  nameInput.classList.remove("field-error");
  nameInput.removeAttribute("aria-invalid");
  errorText.textContent = "";
  errorText.classList.remove("show");
}

function setChannelWorkspaceInputError(isError: boolean, reason?: string): void {
  const workspaceInput = document.getElementById("channel-workspace-input") as HTMLInputElement | null;
  const errorText = document.getElementById("channel-workspace-error") as HTMLDivElement | null;
  if (!workspaceInput || !errorText) {
    return;
  }

  if (isError) {
    workspaceInput.classList.add("field-error");
    workspaceInput.setAttribute("aria-invalid", "true");
    errorText.textContent = reason ?? "유효한 워크스페이스 경로를 입력하세요.";
    errorText.classList.add("show");
    return;
  }

  workspaceInput.classList.remove("field-error");
  workspaceInput.removeAttribute("aria-invalid");
  errorText.textContent = "";
  errorText.classList.remove("show");
}

function isDuplicateNameErrorMessage(message: string): boolean {
  return message.toLowerCase().includes("agent display name already exists");
}

function isDuplicateChannelNameErrorMessage(message: string): boolean {
  return message.toLowerCase().includes("channel name already exists");
}

function isDuplicateChannelWorkspaceErrorMessage(message: string): boolean {
  return message.toLowerCase().includes("channel workspace already in use");
}

function isInvalidChannelWorkspaceErrorMessage(message: string): boolean {
  return message.toLowerCase().includes("workspace path");
}

function toChannelWorkspaceErrorMessage(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("workspace path is required")) {
    return "채널 워크스페이스 경로는 필수입니다.";
  }
  if (normalized.includes("workspace path must be an absolute path")) {
    return "워크스페이스 경로는 절대 경로여야 합니다.";
  }
  if (normalized.includes("workspace path does not exist")) {
    return "지정한 워크스페이스 폴더가 존재하지 않습니다.";
  }
  if (normalized.includes("workspace path must point to a directory")) {
    return "워크스페이스 경로는 폴더여야 합니다.";
  }
  if (normalized.includes("workspace path must be readable and writable")) {
    return "워크스페이스 폴더는 읽기/쓰기가 가능해야 합니다.";
  }
  if (normalized.includes("workspace path could not be resolved")) {
    return "워크스페이스 경로를 확인할 수 없습니다.";
  }
  return "유효한 워크스페이스 경로를 입력하세요.";
}

function openMemberModal(mode: "create" | "edit", targetAgent: Agent | null): void {
  const modal = document.getElementById("member-modal") as HTMLDialogElement | null;
  const titleEl = document.getElementById("member-modal-title");
  const nameInput = document.getElementById("member-name-input") as HTMLInputElement | null;
  const roleInput = document.getElementById("member-role-input") as HTMLInputElement | null;
  const promptInput = document.getElementById("member-prompt-input") as HTMLTextAreaElement | null;
  if (!modal || !titleEl || !nameInput || !roleInput || !promptInput) {
    return;
  }

  memberFormMode = mode;
  editingAgentId = mode === "edit" && targetAgent ? targetAgent.id : null;

  if (mode === "edit" && targetAgent) {
    titleEl.textContent = "멤버 수정";
    nameInput.value = targetAgent.name;
    roleInput.value = targetAgent.role;
    promptInput.value = targetAgent.systemPrompt;
  } else {
    titleEl.textContent = "멤버 추가";
    nameInput.value = "";
    roleInput.value = "";
    promptInput.value = promptTemplates?.defaultMemberSystemPrompt ?? "";
  }

  if (modal.open) {
    modal.close();
  }
  setMemberNameInputError(false);
  setMemberPromptGeneratingState(false);
  modal.showModal();
  nameInput.focus();
}

function closeMemberModal(): void {
  if (isGeneratingMemberPrompt) {
    showWarning("시스템 프롬프트 생성 중에는 멤버 창을 닫을 수 없습니다.");
    return;
  }
  const modal = document.getElementById("member-modal") as HTMLDialogElement | null;
  if (!modal || !modal.open) {
    return;
  }
  modal.close();
  restoreInputFocus();
}

function setMemberPromptGeneratingState(isGenerating: boolean): void {
  isGeneratingMemberPrompt = isGenerating;

  const nameInput = document.getElementById("member-name-input") as HTMLInputElement | null;
  const roleInput = document.getElementById("member-role-input") as HTMLInputElement | null;
  const promptInput = document.getElementById("member-prompt-input") as HTMLTextAreaElement | null;
  const generateBtn = document.getElementById(
    "member-generate-prompt-btn",
  ) as HTMLButtonElement | null;
  const cancelBtn = document.getElementById("member-cancel-btn") as HTMLButtonElement | null;
  const saveBtn = document.getElementById("member-save-btn") as HTMLButtonElement | null;
  const memberModal = document.getElementById("member-modal") as HTMLDialogElement | null;

  if (nameInput) {
    nameInput.disabled = isGenerating;
  }
  if (roleInput) {
    roleInput.disabled = isGenerating;
  }
  if (promptInput) {
    promptInput.disabled = isGenerating;
  }
  if (generateBtn) {
    generateBtn.disabled = isGenerating;
  }
  if (cancelBtn) {
    cancelBtn.disabled = isGenerating;
  }
  if (saveBtn) {
    saveBtn.disabled = isGenerating;
  }
  if (memberModal) {
    memberModal.setAttribute("aria-busy", String(isGenerating));
  }
}

function openChannelModal(mode: "create" | "edit", channel: Channel | null): void {
  const modal = document.getElementById("channel-modal") as HTMLDialogElement | null;
  const titleEl = document.getElementById("channel-modal-title");
  const submitBtn = document.getElementById("channel-submit-btn");
  const nameInput = document.getElementById("channel-name-input") as HTMLInputElement | null;
  const descInput = document.getElementById("channel-desc-input") as HTMLInputElement | null;
  const workspaceInput = document.getElementById("channel-workspace-input") as HTMLInputElement | null;
  if (!modal || !titleEl || !submitBtn || !nameInput || !descInput || !workspaceInput) {
    return;
  }

  channelFormMode = mode;
  editingChannelId = mode === "edit" && channel ? channel.id : null;

  if (mode === "edit" && channel) {
    titleEl.textContent = "채널 수정";
    submitBtn.textContent = "저장";
    nameInput.value = channel.name;
    descInput.value = channel.description;
    workspaceInput.value = channel.workspacePath;
  } else {
    titleEl.textContent = "채널 추가";
    submitBtn.textContent = "만들기";
    nameInput.value = "";
    descInput.value = "";
    workspaceInput.value = "";
  }

  if (modal.open) {
    modal.close();
  }
  setChannelNameInputError(false);
  setChannelWorkspaceInputError(false);
  modal.showModal();
  nameInput.focus();
}

function closeChannelModal(): void {
  const modal = document.getElementById("channel-modal") as HTMLDialogElement | null;
  if (!modal || !modal.open) {
    return;
  }
  modal.close();
  restoreInputFocus();
}

function renderChannelMembersModalContent(): void {
  const list = document.getElementById("channel-members-list");
  const title = document.getElementById("channel-members-title");
  const searchInput = document.getElementById("channel-members-search-input") as HTMLInputElement | null;
  const channel = getChannelById(channelStore.getActiveChannelId());
  if (!list || !title || !channel) {
    return;
  }

  closeChannelMemberMenu();
  title.textContent = `# ${channel.name} 멤버`;
  list.innerHTML = "";
  const keyword = normalizeSearchKeyword(searchInput?.value ?? "");

  const members = channelStore
    .getActiveChannelMembers()
    .filter((agent) => matchesAgentSearch(agent, keyword));

  if (members.length === 0) {
    const empty = document.createElement("div");
    empty.className = "modal-list-item empty";
    empty.textContent = keyword ? "검색 결과가 없습니다." : "채널에 멤버가 없습니다.";
    list.appendChild(empty);
    return;
  }

  for (const member of members) {
    const item = document.createElement("div");
    item.className = "modal-list-item member-entry";

    const infoWrap = document.createElement("div");

    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = member.name;

    const subEl = document.createElement("div");
    subEl.className = "sub";
    subEl.textContent = member.role;

    infoWrap.appendChild(nameEl);
    infoWrap.appendChild(subEl);

    const menuBtn = document.createElement("button");
    menuBtn.className = "channel-member-menu-btn";
    menuBtn.type = "button";
    menuBtn.textContent = "☰";
    menuBtn.setAttribute("aria-label", `${member.name} 멤버 메뉴`);
    menuBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      openChannelMemberMenu(member.id, menuBtn);
    });

    item.appendChild(infoWrap);
    item.appendChild(menuBtn);
    list.appendChild(item);
  }
}

async function openChannelMembersModal(): Promise<void> {
  const modal = document.getElementById("channel-members-modal") as HTMLDialogElement | null;
  const searchInput = document.getElementById("channel-members-search-input") as HTMLInputElement | null;
  const channel = getChannelById(channelStore.getActiveChannelId());
  if (!modal || !channel) {
    return;
  }

  try {
    await refreshActiveChannelMembers();
    if (searchInput) {
      searchInput.value = "";
    }
    renderChannelMembersModalContent();
    if (modal.open) {
      modal.close();
    }
    modal.showModal();
    searchInput?.focus();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`채널 멤버 조회 실패: ${message}`);
    setStatus(`Error: ${message}`);
  }
}

function closeChannelMembersModal(): void {
  const modal = document.getElementById("channel-members-modal") as HTMLDialogElement | null;
  closeChannelMemberMenu();
  if (!modal || !modal.open) {
    return;
  }
  modal.close();
  restoreInputFocus();
}

function renderChannelMemberAddList(): void {
  const list = document.getElementById("channel-member-add-list");
  const searchInput = document.getElementById("channel-member-add-search-input") as HTMLInputElement | null;
  const submitBtn = document.getElementById("channel-member-add-submit-btn") as HTMLButtonElement | null;
  const channel = getChannelById(channelStore.getActiveChannelId());
  if (!list || !submitBtn || !channel) {
    return;
  }

  const keyword = normalizeSearchKeyword(searchInput?.value ?? "");
  const visibleAgents = agents.filter((agent) => matchesAgentSearch(agent, keyword));
  const activeChannelMemberIds = new Set(
    channelStore.getActiveChannelMembers().map((member) => member.id),
  );

  for (const selectedId of Array.from(selectedChannelMemberAddIds)) {
    const stillSelectable = agents.some(
      (agent) => agent.id === selectedId && !activeChannelMemberIds.has(agent.id),
    );
    if (!stillSelectable) {
      selectedChannelMemberAddIds.delete(selectedId);
    }
  }

  list.innerHTML = "";
  if (visibleAgents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "modal-list-item empty";
    empty.textContent = "검색 결과가 없습니다.";
    list.appendChild(empty);
    submitBtn.disabled = true;
    submitBtn.textContent = "추가";
    return;
  }

  for (const agent of visibleAgents) {
    const alreadyAdded = activeChannelMemberIds.has(agent.id);
    const isSelected = selectedChannelMemberAddIds.has(agent.id);

    const item = document.createElement("div");
    const classes = ["modal-list-item"];
    if (alreadyAdded) {
      classes.push("disabled");
    } else {
      classes.push("selectable");
    }
    if (isSelected) {
      classes.push("selected");
    }
    item.className = classes.join(" ");

    const nameEl = document.createElement("div");
    nameEl.className = "name";
    nameEl.textContent = agent.name;

    const subEl = document.createElement("div");
    subEl.className = "sub";
    subEl.textContent = alreadyAdded ? `${agent.role} · 이미 채널에 있음` : agent.role;

    item.appendChild(nameEl);
    item.appendChild(subEl);

    if (!alreadyAdded) {
      item.addEventListener("click", () => {
        if (selectedChannelMemberAddIds.has(agent.id)) {
          selectedChannelMemberAddIds.delete(agent.id);
        } else {
          selectedChannelMemberAddIds.add(agent.id);
        }
        renderChannelMemberAddList();
      });
    }

    list.appendChild(item);
  }

  submitBtn.disabled = selectedChannelMemberAddIds.size === 0;
  submitBtn.textContent =
    selectedChannelMemberAddIds.size > 0 ? `${selectedChannelMemberAddIds.size}명 추가` : "추가";
}

async function openChannelMemberAddModal(): Promise<void> {
  const modal = document.getElementById("channel-member-add-modal") as HTMLDialogElement | null;
  const searchInput = document.getElementById("channel-member-add-search-input") as HTMLInputElement | null;
  const channel = getChannelById(channelStore.getActiveChannelId());
  if (!modal || !searchInput || !channel) {
    return;
  }

  try {
    await refreshActiveChannelMembers();
    selectedChannelMemberAddIds.clear();
    searchInput.value = "";
    renderChannelMemberAddList();

    if (modal.open) {
      modal.close();
    }
    modal.showModal();
    searchInput.focus();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`채널 멤버 추가 창 로드 실패: ${message}`);
    setStatus(`Error: ${message}`);
  }
}

function closeChannelMemberAddModal(): void {
  const modal = document.getElementById("channel-member-add-modal") as HTMLDialogElement | null;
  selectedChannelMemberAddIds.clear();
  if (!modal || !modal.open) {
    return;
  }
  modal.close();
  restoreInputFocus();
}

async function chooseChannelWorkspaceDirectory(): Promise<void> {
  const workspaceInput = document.getElementById("channel-workspace-input") as HTMLInputElement | null;
  if (!workspaceInput) {
    return;
  }

  try {
    const selectedPath = await window.viblackApi.pickDirectory(workspaceInput.value || undefined);
    if (!selectedPath) {
      return;
    }
    workspaceInput.value = selectedPath;
    setChannelWorkspaceInputError(false);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`워크스페이스 폴더 선택 실패: ${message}`);
    setStatus(`Error: ${message}`);
  }
}

async function openActiveChannelWorkspace(): Promise<void> {
  const channel = getChannelById(channelStore.getActiveChannelId());
  if (!channel) {
    return;
  }

  try {
    const error = await window.viblackApi.openPath(channel.workspacePath);
    if (error) {
      showWarning(`워크스페이스 폴더 열기 실패: ${error}`);
      setStatus(`Error: ${error}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`워크스페이스 폴더 열기 실패: ${message}`);
    setStatus(`Error: ${message}`);
  }
}

async function saveChannel(
  channelName: string,
  channelDescription: string,
  channelWorkspacePath: string,
): Promise<void> {
  const name = channelName.trim();
  const description = channelDescription.trim();
  const workspacePath = channelWorkspacePath.trim();
  const nameInput = document.getElementById("channel-name-input") as HTMLInputElement | null;
  const workspaceInput = document.getElementById("channel-workspace-input") as HTMLInputElement | null;
  if (!name || !description) {
    showWarning("채널 이름과 설명을 입력하세요.");
    return;
  }
  if (!workspacePath) {
    setChannelWorkspaceInputError(true, "채널 워크스페이스 경로는 필수입니다.");
    workspaceInput?.focus();
    return;
  }

  setChannelNameInputError(false);
  setChannelWorkspaceInputError(false);
  const normalizedChannelName = name.toLowerCase();
  const duplicateChannel = channelStore.getChannels().find(
    (channel) =>
      channel.id !== editingChannelId && channel.name.trim().toLowerCase() === normalizedChannelName,
  );
  if (duplicateChannel) {
    setChannelNameInputError(true, "이미 사용 중인 채널 이름입니다. 다른 이름을 입력하세요.");
    nameInput?.focus();
    return;
  }

  try {
    if (channelFormMode === "edit" && editingChannelId) {
      await fetchJson<{ channel: Channel }>(`${backendBaseUrl}/api/channels/${editingChannelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, workspacePath }),
      });
      await refreshChannels(editingChannelId);
      if (channelStore.getActiveChannelId() === editingChannelId) {
        const updated = getChannelById(editingChannelId);
        setHeader(updated ? `# ${updated.name}` : "채널", updated?.description ?? "");
      }
    } else {
      const created = await fetchJson<{ channel: Channel }>(`${backendBaseUrl}/api/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description, workspacePath }),
      });
      channelStore.setActiveChannelId(created.channel.id);
      activeAgentId = null;
      await refreshChannels(created.channel.id);
      await refreshMessages();
    }

    showWarning(null);
    setChannelNameInputError(false);
    setChannelWorkspaceInputError(false);
    closeChannelModal();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (isDuplicateChannelNameErrorMessage(message)) {
      setChannelNameInputError(true, "이미 사용 중인 채널 이름입니다. 다른 이름을 입력하세요.");
      nameInput?.focus();
      return;
    }
    if (isDuplicateChannelWorkspaceErrorMessage(message)) {
      setChannelWorkspaceInputError(true, "이미 다른 활성 채널이 사용 중인 워크스페이스입니다.");
      workspaceInput?.focus();
      return;
    }
    if (isInvalidChannelWorkspaceErrorMessage(message)) {
      setChannelWorkspaceInputError(true, toChannelWorkspaceErrorMessage(message));
      workspaceInput?.focus();
      return;
    }
    showWarning(`채널 저장 실패: ${message}`);
    setStatus(`Error: ${message}`);
  }
}

async function addSelectedMembersToActiveChannel(memberIds: string[]): Promise<void> {
  const channel = getChannelById(channelStore.getActiveChannelId());
  if (!channel) {
    return;
  }

  const activeChannelMemberIds = new Set(
    channelStore.getActiveChannelMembers().map((member) => member.id),
  );
  const toAdd = memberIds.filter((memberId) => memberId && !activeChannelMemberIds.has(memberId));
  if (toAdd.length === 0) {
    return;
  }

  try {
    await Promise.all(
      toAdd.map((memberId) =>
        fetchJson<{ ok: boolean }>(`${backendBaseUrl}/api/channels/${channel.id}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: memberId }),
        }),
      ),
    );
    await refreshActiveChannelMembers();
    closeChannelMemberAddModal();
    await openChannelMembersModal();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`채널 멤버 추가 실패: ${message}`);
    setStatus(`Error: ${message}`);
  }
}

async function removeMemberFromActiveChannel(memberId: string): Promise<void> {
  const channel = getChannelById(channelStore.getActiveChannelId());
  if (!channel) {
    return;
  }

  try {
    await fetchJson<{ ok: boolean }>(
      `${backendBaseUrl}/api/channels/${channel.id}/members/${memberId}`,
      { method: "DELETE" },
    );
    await refreshActiveChannelMembers();
    closeChannelMemberMenu();
    renderChannelMembersModalContent();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`채널 멤버 제거 실패: ${message}`);
    setStatus(`Error: ${message}`);
  }
}

async function deleteChannel(channelId: string): Promise<void> {
  try {
    await fetchJson<{ ok: boolean }>(`${backendBaseUrl}/api/channels/${channelId}`, {
      method: "DELETE",
    });
    channelStore.clearPendingChannelUserMessagesForChannel(channelId);
    const currentChannelId = channelStore.getActiveChannelId();
    const nextChannelId = currentChannelId === channelId ? null : currentChannelId;
    if (currentChannelId === channelId) {
      channelStore.setActiveChannelId(null);
      channelStore.clearActiveChannelMembers();
    }
    closeChannelMenu();
    await refreshChannels(nextChannelId);
    renderMemberList();
    await refreshMessages();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`채널 제거 실패: ${message}`);
    setStatus(`Error: ${message}`);
  }
}

async function refreshAgents(preferredAgentId?: string | null): Promise<void> {
  const data = await fetchJson<{ agents: Agent[] }>(`${backendBaseUrl}/api/agents`);
  agents = data.agents;
  const validIds = new Set(agents.map((agent) => agent.id));
  for (const unreadId of Array.from(unreadAgentIds)) {
    if (!validIds.has(unreadId)) {
      unreadAgentIds.delete(unreadId);
    }
  }
  for (const inflightId of Array.from(inflightAgentIds)) {
    if (!validIds.has(inflightId)) {
      inflightAgentIds.delete(inflightId);
    }
  }

  if (channelStore.getActiveChannelId()) {
    activeAgentId = null;
  } else {
    const preferred = preferredAgentId ?? activeAgentId;
    if (preferred && agents.some((agent) => agent.id === preferred)) {
      activeAgentId = preferred;
    } else {
      activeAgentId = agents.length > 0 ? agents[0].id : null;
    }
  }

  renderChannelList();
  renderMemberList();
}

async function refreshMessagesByAgent(
  agentId: string,
  options?: { preserveWorkingStatus?: boolean },
): Promise<void> {
  if (channelStore.getActiveChannelId()) {
    unreadAgentIds.add(agentId);
    renderMemberList();
    return;
  }

  const data = await fetchJson<{ agent: Agent; messages: ChatMessage[] }>(
    `${backendBaseUrl}/api/agents/${agentId}/messages`,
  );
  if (activeAgentId === agentId) {
    unreadAgentIds.delete(agentId);
    setHeader(data.agent.name, data.agent.role);
    renderMessages(data.messages, data.agent.name);
    if (!options?.preserveWorkingStatus) {
      setStatus(codexReady ? getReadyStatusText() : "Codex unavailable");
    }
    renderMemberList();
    return;
  }

  unreadAgentIds.add(agentId);
  renderMemberList();
}

function closeChannelEventStream(): void {
  channelSyncController?.disconnect();
}

function initChannelEventStream(): void {
  if (!channelSyncController) {
    channelSyncController = new ChannelSyncController({
      getBackendBaseUrl: () => backendBaseUrl,
      store: channelStore,
      fetchJson,
      mapChannelMessagesToChatMessages,
      getRenderedMessages: () => renderedMessages,
      setHeader,
      renderMessages,
      refreshActiveChannelMessages: refreshMessages,
      refreshActiveChannelExecutionState,
      syncStatusForCurrentContext,
    });
  }
  channelSyncController.init();
}

async function syncActiveChannelMessageDelta(): Promise<void> {
  await channelSyncController?.syncActiveChannelMessageDelta();
}

async function refreshActiveChannelExecutionState(channelId: string): Promise<void> {
  const data = await fetchJson<{
    channel: Channel;
    jobs: ChannelExecutionJob[];
  }>(`${backendBaseUrl}/api/channels/${channelId}/executions`);

  if (channelStore.getActiveChannelId() !== channelId) {
    return;
  }

  const runningJobCount = data.jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  ).length;
  channelStore.setActiveChannelRunningJobCount(runningJobCount);
  channelStore.setActiveChannelTypingAgentIds(
    data.jobs
      .filter((job) => job.status === "queued" || job.status === "running")
      .map((job) => job.targetAgentId),
  );
}

async function refreshMessages(): Promise<void> {
  updateChannelActionButtons();
  try {
    const activeChannelId = channelStore.getActiveChannelId();
    if (activeChannelId) {
      const [data, executionData] = await Promise.all([
        fetchJson<{
          channel: Channel;
          members: Agent[];
          messages: ChannelApiMessage[];
          mentionsByMessage: Record<number, Array<{ agentId: string; mentionName: string }>>;
        }>(`${backendBaseUrl}/api/channels/${activeChannelId}/messages`),
        fetchJson<{
          channel: Channel;
          jobs: ChannelExecutionJob[];
        }>(`${backendBaseUrl}/api/channels/${activeChannelId}/executions`),
      ]);
      const runningJobCount = executionData.jobs.filter(
        (job) => job.status === "queued" || job.status === "running",
      ).length;
      channelStore.setActiveChannelRunningJobCount(runningJobCount);
      channelStore.setActiveChannelTypingAgentIds(
        executionData.jobs
          .filter((job) => job.status === "queued" || job.status === "running")
          .map((job) => job.targetAgentId),
      );
      channelStore.setActiveChannelMembers(data.members);
      setHeader(`# ${data.channel.name}`, data.channel.description);
      syncStatusForCurrentContext();
      setComposerEnabled(true);
      const serverMessages = mapChannelMessagesToChatMessages(data.messages, data.members);
      reconcilePendingChannelUserMessages(activeChannelId, serverMessages);
      const pendingForRender = getPendingChannelUserMessagesForRender(activeChannelId);
      renderMessages(mergeChannelMessages(serverMessages, pendingForRender));
      channelStore.setLastSeenChannelMessageId(getLastChannelMessageId(data.messages));
      channelStore.clearPendingChannelDeltaSync();
      return;
    }

    channelStore.resetLastSeenChannelMessageId();
    channelStore.clearPendingChannelDeltaSync();
    channelStore.clearActiveChannelRunningJobCount();
    channelStore.clearActiveChannelTypingAgentIds();
    if (!activeAgentId) {
      setHeader("멤버를 추가하세요", "");
      setStatus("No member selected");
      renderMessages([]);
      return;
    }

    const data = await fetchJson<{ agent: Agent; messages: ChatMessage[] }>(
      `${backendBaseUrl}/api/agents/${activeAgentId}/messages`,
    );
    setHeader(data.agent.name, data.agent.role);
    renderMessages(data.messages, data.agent.name);
    syncStatusForCurrentContext();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    setStatus(`Error: ${message}`);
    showWarning(`메시지 로딩 실패: ${message}`);
    renderMessages([]);
  }
}

async function generateMemberSystemPrompt(): Promise<void> {
  if (isGeneratingMemberPrompt) {
    return;
  }

  const nameInput = document.getElementById("member-name-input") as HTMLInputElement | null;
  const roleInput = document.getElementById("member-role-input") as HTMLInputElement | null;
  const promptInput = document.getElementById("member-prompt-input") as HTMLTextAreaElement | null;
  const generateBtn = document.getElementById(
    "member-generate-prompt-btn",
  ) as HTMLButtonElement | null;
  if (!nameInput || !roleInput || !promptInput || !generateBtn) {
    return;
  }

  const role = roleInput.value.trim();
  if (!role) {
    showWarning("역할을 먼저 입력하세요.");
    roleInput.focus();
    return;
  }

  const originalLabel = generateBtn.textContent ?? "시스템 프롬프트 자동 생성";
  setMemberPromptGeneratingState(true);
  generateBtn.textContent = "생성 중...";
  setStatus("Generating prompt...");

  try {
    const payload = await fetchJson<{ systemPrompt: string }>(
      `${backendBaseUrl}/api/system/generate-system-prompt`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameInput.value.trim(),
          role,
        }),
      },
    );

    promptInput.value = payload.systemPrompt;
    showWarning(null);
    setStatus(codexReady ? getReadyStatusText() : "Codex unavailable");
    promptInput.focus();
    const len = promptInput.value.length;
    promptInput.setSelectionRange(len, len);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`시스템 프롬프트 자동 생성 실패: ${message}`);
    setStatus(`Error: ${message}`);
  } finally {
    setMemberPromptGeneratingState(false);
    generateBtn.textContent = originalLabel;
  }
}

async function saveMemberForm(): Promise<void> {
  if (isGeneratingMemberPrompt) {
    return;
  }

  const nameInput = document.getElementById("member-name-input") as HTMLInputElement | null;
  const roleInput = document.getElementById("member-role-input") as HTMLInputElement | null;
  const promptInput = document.getElementById("member-prompt-input") as HTMLTextAreaElement | null;
  if (!nameInput || !roleInput || !promptInput) {
    return;
  }

  const payload = {
    name: nameInput.value.trim(),
    role: roleInput.value.trim(),
    systemPrompt: promptInput.value.trim(),
  };
  if (!payload.name || !payload.role || !payload.systemPrompt) {
    showWarning("이름, 역할, 시스템 프롬프트를 모두 입력하세요.");
    return;
  }

  setMemberNameInputError(false);
  const normalizedDisplayName = payload.name.toLowerCase();
  const duplicateAgent = agents.find(
    (agent) =>
      agent.id !== editingAgentId && agent.name.trim().toLowerCase() === normalizedDisplayName,
  );
  if (duplicateAgent) {
    setMemberNameInputError(true, "이미 사용 중인 멤버 표시명입니다. 다른 이름을 입력하세요.");
    nameInput.focus();
    return;
  }

  try {
    if (memberFormMode === "edit" && editingAgentId) {
      await fetchJson<{ agent: Agent }>(`${backendBaseUrl}/api/agents/${editingAgentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refreshAgents(editingAgentId);
    } else {
      const created = await fetchJson<{ agent: Agent }>(`${backendBaseUrl}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await refreshAgents(created.agent.id);
    }

    showWarning(null);
    setMemberNameInputError(false);
    closeMemberModal();
    closeMemberMenu();
    await refreshMessages();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (isDuplicateNameErrorMessage(message)) {
      setMemberNameInputError(true, "이미 사용 중인 멤버 표시명입니다. 다른 이름을 입력하세요.");
      nameInput.focus();
      return;
    }
    showWarning(`멤버 저장 실패: ${message}`);
    setStatus(`Error: ${message}`);
  }
}

async function deleteMember(agentId: string): Promise<void> {
  await fetchJson<{ ok: boolean }>(`${backendBaseUrl}/api/agents/${agentId}`, {
    method: "DELETE",
  });

  const nextPreferred = activeAgentId === agentId ? null : activeAgentId;
  closeMemberMenu();
  await refreshAgents(nextPreferred);
  await refreshMessages();
}

async function clearMemberDm(agentId: string): Promise<void> {
  await fetchJson<{ ok: boolean }>(`${backendBaseUrl}/api/agents/${agentId}/messages`, {
    method: "DELETE",
  });

  closeMemberMenu();
  if (activeAgentId === agentId) {
    await refreshMessages();
  }
}

async function runPendingAction(): Promise<void> {
  const action = pendingAction;
  if (!action) {
    return;
  }

  closeActionModal();
  if (action.target === "member" && action.type === "clear") {
    await clearMemberDm(action.agentId);
    return;
  }
  if (action.target === "member" && action.type === "delete") {
    await deleteMember(action.agentId);
    return;
  }
  if (action.target === "channel" && action.type === "delete") {
    await deleteChannel(action.channelId);
  }
}

function initMemberCrudUi(): void {
  const openSettingsBtn = document.getElementById("open-settings-btn");
  const settingsModal = document.getElementById("settings-modal") as HTMLDialogElement | null;
  const settingsCloseBtn = document.getElementById("settings-close-btn");
  const settingsCancelBtn = document.getElementById("settings-model-cancel-btn");
  const settingsSaveBtn = document.getElementById("settings-model-save-btn");
  const settingsModelTabBtn = document.getElementById("settings-tab-model");
  const settingsDebugTabBtn = document.getElementById("settings-tab-debug");
  const addChannelBtn = document.getElementById("add-channel-btn");
  const channelMenu = document.getElementById("channel-menu");
  const channelMenuEditBtn = document.getElementById("channel-menu-edit");
  const channelMenuDeleteBtn = document.getElementById("channel-menu-delete");
  const channelModal = document.getElementById("channel-modal") as HTMLDialogElement | null;
  const channelForm = document.getElementById("channel-form") as HTMLFormElement | null;
  const channelCancelBtn = document.getElementById("channel-cancel-btn");
  const channelNameInput = document.getElementById("channel-name-input") as HTMLInputElement | null;
  const channelDescInput = document.getElementById("channel-desc-input") as HTMLInputElement | null;
  const channelWorkspaceInput = document.getElementById("channel-workspace-input") as HTMLInputElement | null;
  const channelWorkspaceBrowseBtn = document.getElementById("channel-workspace-browse-btn");
  const channelWorkspaceBtn = document.getElementById("channel-workspace-btn");
  const channelMembersBtn = document.getElementById("channel-members-btn");
  const channelMembersModal = document.getElementById("channel-members-modal") as HTMLDialogElement | null;
  const channelMembersSearchInput = document.getElementById(
    "channel-members-search-input",
  ) as HTMLInputElement | null;
  const channelMemberMenu = document.getElementById("channel-member-menu");
  const channelMemberMenuRemoveBtn = document.getElementById("channel-member-menu-remove");
  const channelMembersAddBtn = document.getElementById("channel-members-add-btn");
  const channelMembersCloseBtn = document.getElementById("channel-members-close-btn");
  const channelMemberAddModal = document.getElementById("channel-member-add-modal") as HTMLDialogElement | null;
  const channelMemberAddForm = document.getElementById(
    "channel-member-add-form",
  ) as HTMLFormElement | null;
  const channelMemberAddSearchInput = document.getElementById(
    "channel-member-add-search-input",
  ) as HTMLInputElement | null;
  const channelMemberAddCancelBtn = document.getElementById("channel-member-add-cancel-btn");
  const addMemberBtn = document.getElementById("add-member-btn");
  const memberModal = document.getElementById("member-modal") as HTMLDialogElement | null;
  const modalForm = document.getElementById("member-form");
  const memberNameInput = document.getElementById("member-name-input") as HTMLInputElement | null;
  const cancelBtn = document.getElementById("member-cancel-btn");
  const generatePromptBtn = document.getElementById("member-generate-prompt-btn");
  const clearBtn = document.getElementById("member-menu-clear");
  const editBtn = document.getElementById("member-menu-edit");
  const deleteBtn = document.getElementById("member-menu-delete");
  const actionCancelBtn = document.getElementById("action-cancel-btn");
  const actionConfirmBtn = document.getElementById("action-confirm-btn");
  const actionModal = document.getElementById("action-modal") as HTMLDialogElement | null;
  const memberMenu = document.getElementById("member-menu");

  openSettingsBtn?.addEventListener("click", () => {
    void openSettingsModal().catch((err) => {
      const message = err instanceof Error ? err.message : "unknown error";
      showWarning(`설정 로딩 실패: ${message}`);
      setStatus(`Error: ${message}`);
    });
  });

  settingsCloseBtn?.addEventListener("click", () => {
    closeSettingsModal();
  });

  settingsCancelBtn?.addEventListener("click", () => {
    closeSettingsModal();
  });

  settingsSaveBtn?.addEventListener("click", () => {
    void saveSettings();
  });

  settingsModelTabBtn?.addEventListener("click", () => {
    setActiveSettingsTab("model");
  });

  settingsDebugTabBtn?.addEventListener("click", () => {
    setActiveSettingsTab("debug");
  });

  settingsModal?.addEventListener("close", () => {
    restoreInputFocus();
  });

  addChannelBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMemberMenu();
    closeChannelMenu();
    closeChannelMemberMenu();
    openChannelModal("create", null);
  });

  channelForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!channelNameInput || !channelDescInput || !channelWorkspaceInput) {
      return;
    }
    void saveChannel(channelNameInput.value, channelDescInput.value, channelWorkspaceInput.value);
  });

  channelCancelBtn?.addEventListener("click", () => {
    closeChannelModal();
  });

  channelNameInput?.addEventListener("input", () => {
    setChannelNameInputError(false);
  });

  channelWorkspaceInput?.addEventListener("input", () => {
    setChannelWorkspaceInputError(false);
  });

  channelWorkspaceBrowseBtn?.addEventListener("click", () => {
    void chooseChannelWorkspaceDirectory();
  });

  channelWorkspaceBtn?.addEventListener("click", () => {
    void openActiveChannelWorkspace();
  });

  channelModal?.addEventListener("close", () => {
    restoreInputFocus();
  });

  channelMembersBtn?.addEventListener("click", () => {
    void openChannelMembersModal();
  });

  channelMenuEditBtn?.addEventListener("click", () => {
    if (!openChannelMenuChannelId) {
      return;
    }
    const target =
      channelStore.getChannels().find((channel) => channel.id === openChannelMenuChannelId) ?? null;
    closeChannelMenu();
    openChannelModal("edit", target);
  });

  channelMenuDeleteBtn?.addEventListener("click", () => {
    if (!openChannelMenuChannelId) {
      return;
    }
    const target = channelStore.getChannels().find((channel) => channel.id === openChannelMenuChannelId);
    if (!target) {
      return;
    }
    closeChannelMenu();
    openActionModal(
      { target: "channel", type: "delete", channelId: target.id },
      "채널 제거",
      `"#${target.name}" 채널을 제거할까요?`,
      "제거",
    );
  });

  channelMembersSearchInput?.addEventListener("input", () => {
    renderChannelMembersModalContent();
  });

  channelMemberMenuRemoveBtn?.addEventListener("click", () => {
    if (!openChannelMemberMenuMemberId) {
      return;
    }
    void removeMemberFromActiveChannel(openChannelMemberMenuMemberId);
  });

  channelMembersAddBtn?.addEventListener("click", () => {
    closeChannelMembersModal();
    void openChannelMemberAddModal();
  });

  channelMembersCloseBtn?.addEventListener("click", () => {
    closeChannelMembersModal();
  });

  channelMembersModal?.addEventListener("close", () => {
    restoreInputFocus();
  });

  channelMemberAddForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const selectedIds = Array.from(selectedChannelMemberAddIds);
    if (selectedIds.length === 0) {
      return;
    }
    void addSelectedMembersToActiveChannel(selectedIds);
  });

  channelMemberAddSearchInput?.addEventListener("input", () => {
    renderChannelMemberAddList();
  });

  channelMemberAddCancelBtn?.addEventListener("click", () => {
    closeChannelMemberAddModal();
  });

  channelMemberAddModal?.addEventListener("close", () => {
    restoreInputFocus();
  });

  addMemberBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMemberMenu();
    closeChannelMenu();
    closeChannelMemberMenu();
    openMemberModal("create", null);
  });

  modalForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveMemberForm();
  });

  memberNameInput?.addEventListener("input", () => {
    setMemberNameInputError(false);
  });

  generatePromptBtn?.addEventListener("click", () => {
    void generateMemberSystemPrompt();
  });

  cancelBtn?.addEventListener("click", () => {
    closeMemberModal();
  });

  memberModal?.addEventListener("close", () => {
    restoreInputFocus();
  });

  memberModal?.addEventListener("cancel", (event) => {
    if (!isGeneratingMemberPrompt) {
      return;
    }
    event.preventDefault();
  });

  clearBtn?.addEventListener("click", () => {
    if (!openMemberMenuAgentId) {
      return;
    }
    const target = agents.find((agent) => agent.id === openMemberMenuAgentId);
    if (!target) {
      return;
    }
    closeMemberMenu();
    openActionModal(
      { target: "member", type: "clear", agentId: target.id },
      "DM 클리어",
      `"${target.name}"과의 DM 대화를 모두 지울까요?`,
      "클리어",
    );
  });

  editBtn?.addEventListener("click", () => {
    if (!openMemberMenuAgentId) {
      return;
    }
    const target = agents.find((agent) => agent.id === openMemberMenuAgentId) ?? null;
    closeMemberMenu();
    openMemberModal("edit", target);
  });

  deleteBtn?.addEventListener("click", () => {
    if (!openMemberMenuAgentId) {
      return;
    }
    const target = agents.find((agent) => agent.id === openMemberMenuAgentId);
    if (!target) {
      return;
    }
    closeMemberMenu();
    openActionModal(
      { target: "member", type: "delete", agentId: target.id },
      "멤버 제거",
      `"${target.name}" 멤버를 제거할까요? 기존 DM 대화도 함께 삭제됩니다.`,
      "제거",
    );
  });

  actionCancelBtn?.addEventListener("click", () => {
    closeActionModal();
  });

  actionConfirmBtn?.addEventListener("click", () => {
    void runPendingAction();
  });

  actionModal?.addEventListener("close", () => {
    pendingAction = null;
    restoreInputFocus();
  });

  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    if (memberMenu && !memberMenu.contains(target)) {
      const menuButton = (event.target as HTMLElement).closest(".member-menu-btn");
      if (!menuButton) {
        closeMemberMenu();
      }
    }

    if (channelMenu && !channelMenu.contains(target)) {
      const channelMenuButton = (event.target as HTMLElement).closest(".channel-menu-btn");
      if (!channelMenuButton) {
        closeChannelMenu();
      }
    }

    if (channelMemberMenu && !channelMemberMenu.contains(target)) {
      const channelMemberMenuButton = (event.target as HTMLElement).closest(".channel-member-menu-btn");
      if (!channelMemberMenuButton) {
        closeChannelMemberMenu();
      }
    }
  });

  window.addEventListener("resize", () => {
    closeMemberMenu();
    closeChannelMenu();
    closeChannelMemberMenu();
    closeMentionSuggestions();
  });
}

async function init(): Promise<void> {
  try {
    backendBaseUrl = await window.viblackApi.getBackendBaseUrl();
    await loadPromptTemplates();
    await loadSettings();
    closeChannelEventStream();
    initChannelEventStream();
    const codexStatus = await window.viblackApi.getBootCodexStatus();

    if (!codexStatus.ok) {
      showWarning(
        [
          "Codex CLI를 찾지 못했습니다. 터미널에서 `codex --version`을 확인하세요.",
          codexStatus.error ? `오류: ${codexStatus.error}` : "",
        ]
          .filter((line) => line.length > 0)
          .join(" "),
      );
      codexReady = false;
      setStatus("Codex unavailable");
    } else {
      showWarning(null);
      codexReady = true;
      setStatus(getReadyStatusText(codexStatus.command ?? "codex"));
    }

    await refreshAgents();
    await refreshChannels();
    await refreshMessages();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`초기화 실패: ${message}`);
    setStatus(`Error: ${message}`);
  }
}

async function sendMessage(): Promise<void> {
  const input = getChatInput();
  const button = document.getElementById("send-btn") as HTMLButtonElement | null;
  if (!input || !button) {
    return;
  }

  const content = getComposerText(input).trim();
  if (!content) {
    return;
  }

  const activeChannelId = channelStore.getActiveChannelId();
  if (activeChannelId) {
    const channelId = activeChannelId;
    let hadError = false;
    setComposerText(input, "");
    closeMentionSuggestions();
    channelStore.incrementInflightChannelRequestCount();
    setStatus("Channel is working...");

    const optimisticUser = createPendingChannelUserMessage(channelId, content);
    renderMessages([...renderedMessages, optimisticUser], "Agent", {
      forceScrollToBottom: true,
    });

    try {
      await fetchJson(`${backendBaseUrl}/api/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, messageKind: "general" }),
      });
      await refreshMessages();
      focusInput();
    } catch (err) {
      hadError = true;
      removePendingChannelUserMessage(optimisticUser.id);
      const message = err instanceof Error ? err.message : "unknown error";
      setStatus(`Error: ${message}`);
      showWarning(`채널 메시지 전송 실패: ${message}`);
      await refreshMessages();
      focusInput();
    } finally {
      channelStore.decrementInflightChannelRequestCount();
      if (!hadError && channelStore.getActiveChannelId() === channelId) {
        syncStatusForCurrentContext();
      }
      button.disabled = !activeAgentId && !channelStore.getActiveChannelId();
    }
    return;
  }

  const targetAgentId = activeAgentId;
  if (!targetAgentId) {
    return;
  }
  if (inflightAgentIds.has(targetAgentId)) {
    return;
  }

  setComposerText(input, "");
  closeMentionSuggestions();
  inflightAgentIds.add(targetAgentId);
  const activeAgent = agents.find((agent) => agent.id === targetAgentId);
  renderMemberList();
  setStatus(`${activeAgent?.name ?? "Agent"} is working...`);

  const nowIso = new Date().toISOString();
  const optimisticUser: ChatMessage = {
    id: Date.now(),
    sender: "user",
    content,
    createdAt: nowIso,
    messageKind: "general",
  };
  renderMessages([...renderedMessages, optimisticUser], activeAgent?.name ?? "Agent", {
    forceScrollToBottom: true,
  });

  const dmInflightSyncTimer = window.setInterval(() => {
    void refreshMessagesByAgent(targetAgentId, { preserveWorkingStatus: true }).catch(() => {
      // Ignore transient fetch errors while request is still in-flight.
    });
  }, DM_INFLIGHT_SYNC_INTERVAL_MS);

  void refreshMessagesByAgent(targetAgentId, { preserveWorkingStatus: true }).catch(() => {
    // Ignore transient fetch errors while request is still in-flight.
  });

  try {
    await fetchJson(`${backendBaseUrl}/api/agents/${targetAgentId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    await refreshMessagesByAgent(targetAgentId);
    if (activeAgentId === targetAgentId) {
      setStatus(codexReady ? getReadyStatusText() : "Codex unavailable");
    }
    focusInput();
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    setStatus(`Error: ${message}`);
    showWarning(`메시지 전송 실패: ${message}`);
    if (activeAgentId === targetAgentId) {
      await refreshMessages();
    }
    focusInput();
  } finally {
    window.clearInterval(dmInflightSyncTimer);
    inflightAgentIds.delete(targetAgentId);
    renderMemberList();
    syncStatusForCurrentContext();
    button.disabled = !activeAgentId && !channelStore.getActiveChannelId();
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initMessagesViewportUi();
  initSidebarSections();
  initMemberCrudUi();
  window.addEventListener("beforeunload", () => {
    closeChannelEventStream();
  });

  const form = document.getElementById("chat-form");
  const input = getChatInput();

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage();
  });

  input?.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Tab") {
        return;
      }
      if (handleMentionSuggestionKeydown(event)) {
        event.stopPropagation();
      }
    },
    true,
  );

  input?.addEventListener("keydown", (event) => {
    if (handleMentionSuggestionKeydown(event)) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      // While IME composition is active, Enter should finalize composition only.
      const nativeEvent = event as KeyboardEvent & { keyCode?: number };
      if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        return;
      }
      event.preventDefault();
      void sendMessage();
    }
  });

  input?.addEventListener("input", () => {
    updateComposerEmptyState(input);
    syncMentionSuggestions();
  });

  input?.addEventListener("compositionstart", () => {
    isChatInputComposing = true;
  });

  input?.addEventListener("compositionend", () => {
    isChatInputComposing = false;
    updateComposerEmptyState(input);
    syncMentionSuggestions();
    if (deferredMentionSelectionTimer !== null) {
      scheduleDeferredMentionSelection(0);
    }
  });

  input?.addEventListener("click", () => {
    syncMentionSuggestions();
  });

  input?.addEventListener("keyup", (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
      return;
    }
    updateComposerEmptyState(input);
    syncMentionSuggestions();
  });

  input?.addEventListener("blur", () => {
    if (mentionSuggestionBlurTimer !== null) {
      window.clearTimeout(mentionSuggestionBlurTimer);
    }
    mentionSuggestionBlurTimer = window.setTimeout(() => {
      mentionSuggestionBlurTimer = null;
      if (document.activeElement === input) {
        return;
      }
      closeMentionSuggestions();
    }, 120);
  });

  void init();
  if (input) {
    updateComposerEmptyState(input);
  }
});
