type SenderType = "user" | "agent" | "system";

interface Agent {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  sessionId: string | null;
}

interface ChatMessage {
  id: number;
  sender: SenderType;
  content: string;
  createdAt: string;
}

interface Channel {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  createdAt: string;
}

let backendBaseUrl = "";
let activeAgentId: string | null = null;
let activeChannelId: string | null = null;
let renderedMessages: ChatMessage[] = [];
let agents: Agent[] = [];
let channels: Channel[] = [];
let codexReady = false;
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

function focusInput(): void {
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  if (!input) {
    return;
  }
  setTimeout(() => {
    input.focus();
    const len = input.value.length;
    input.setSelectionRange(len, len);
  }, 0);
}

function restoreInputFocus(): void {
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  if (!input || input.disabled) {
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
  const statusEl = document.getElementById("status");
  if (statusEl) {
    statusEl.textContent = text;
  }
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
}

function setComposerEnabled(enabled: boolean, disabledPlaceholder = "먼저 멤버를 추가하세요."): void {
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  const button = document.getElementById("send-btn") as HTMLButtonElement | null;
  if (input) {
    input.disabled = !enabled;
    input.placeholder = enabled
      ? "Helper에게 작업을 요청하세요. (Enter 전송, Shift+Enter 줄바꿈)"
      : disabledPlaceholder;
  }
  if (button) {
    button.disabled = !enabled;
  }
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
  if (!channelId) {
    return null;
  }
  return channels.find((channel) => channel.id === channelId) ?? null;
}

function updateChannelMembersButton(): void {
  const button = document.getElementById("channel-members-btn");
  if (!button) {
    return;
  }
  if (activeChannelId) {
    button.classList.remove("hidden");
  } else {
    button.classList.add("hidden");
  }
}

function generateChannelId(name: string): string {
  const normalized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const base = normalized || "channel";
  let id = base;
  let index = 2;
  while (channels.some((channel) => channel.id === id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
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

function renderChannelList(): void {
  const list = document.getElementById("channel-list");
  if (!list) {
    return;
  }

  list.innerHTML = "";
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
      activeChannelId = channel.id;
      renderChannelList();
      renderMemberList();
      updateChannelMembersButton();

      setHeader(`# ${channel.name}`, channel.description);
      setStatus("Channel selected");
      setComposerEnabled(false, "채널 대화 기능은 준비 중입니다.");
      renderMessages([]);
    });
    list.appendChild(item);
  }
}

function renderMessages(messages: ChatMessage[], agentName = "Agent"): void {
  const list = document.getElementById("messages");
  const wrap = document.querySelector(".messages-wrap") as HTMLElement | null;
  if (!list) {
    return;
  }

  list.innerHTML = "";
  if (messages.length === 0) {
    const empty = document.createElement("li");
    empty.className = "msg-empty";
    empty.textContent = "대화를 시작해 보세요.";
    list.appendChild(empty);
  }

  for (const message of messages) {
    const item = document.createElement("li");
    item.className = `msg msg-${message.sender}`;

    const sender = document.createElement("div");
    sender.className = "msg-sender";
    sender.textContent =
      message.sender === "user" ? "You" : message.sender === "agent" ? agentName : "System";

    const body = document.createElement("div");
    body.className = "msg-content";
    body.innerHTML = renderMarkdown(message.content);

    const ts = document.createElement("div");
    ts.className = "msg-time";
    ts.textContent = new Date(message.createdAt).toLocaleString();

    item.appendChild(sender);
    item.appendChild(body);
    item.appendChild(ts);
    list.appendChild(item);
  }

  if (wrap) {
    wrap.scrollTop = wrap.scrollHeight;
  }
  renderedMessages = messages;
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
        if (activeChannelId) {
          activeChannelId = null;
          renderChannelList();
          updateChannelMembersButton();
          void refreshMessages();
        }
        return;
      }
      activeChannelId = null;
      activeAgentId = agent.id;
      unreadAgentIds.delete(agent.id);
      renderChannelList();
      renderMemberList();
      updateChannelMembersButton();
      void refreshMessages();
    });

    const textWrap = document.createElement("div");
    textWrap.className = "member-text";

    const nameEl = document.createElement("div");
    nameEl.className = "member-name";
    nameEl.textContent = agent.name;

    const nameRowEl = document.createElement("div");
    nameRowEl.className = "member-name-row";
    nameRowEl.appendChild(nameEl);

    if (inflightAgentIds.has(agent.id) || unreadAgentIds.has(agent.id)) {
      const dot = document.createElement("span");
      dot.className = `member-dot-badge ${inflightAgentIds.has(agent.id) ? "working" : "unread"}`;
      dot.title = inflightAgentIds.has(agent.id) ? "응답 생성 중" : "새 응답";
      nameRowEl.appendChild(dot);
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

    mainBtn.appendChild(textWrap);
    mainBtn.appendChild(menuBtn);
    item.appendChild(mainBtn);
    list.appendChild(item);
  }

  if (activeChannelId) {
    setComposerEnabled(false, "채널 대화 기능은 준비 중입니다.");
  } else {
    setComposerEnabled(activeAgentId !== null);
  }
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
    promptInput.value =
      "You are a practical AI teammate. Reply in concise Korean unless asked otherwise.";
  }

  if (modal.open) {
    modal.close();
  }
  modal.showModal();
  nameInput.focus();
}

function closeMemberModal(): void {
  const modal = document.getElementById("member-modal") as HTMLDialogElement | null;
  if (!modal || !modal.open) {
    return;
  }
  modal.close();
  restoreInputFocus();
}

function openChannelModal(mode: "create" | "edit", channel: Channel | null): void {
  const modal = document.getElementById("channel-modal") as HTMLDialogElement | null;
  const titleEl = document.getElementById("channel-modal-title");
  const submitBtn = document.getElementById("channel-submit-btn");
  const nameInput = document.getElementById("channel-name-input") as HTMLInputElement | null;
  const descInput = document.getElementById("channel-desc-input") as HTMLInputElement | null;
  if (!modal || !titleEl || !submitBtn || !nameInput || !descInput) {
    return;
  }

  channelFormMode = mode;
  editingChannelId = mode === "edit" && channel ? channel.id : null;

  if (mode === "edit" && channel) {
    titleEl.textContent = "채널 수정";
    submitBtn.textContent = "저장";
    nameInput.value = channel.name;
    descInput.value = channel.description;
  } else {
    titleEl.textContent = "채널 추가";
    submitBtn.textContent = "만들기";
    nameInput.value = "";
    descInput.value = "";
  }

  if (modal.open) {
    modal.close();
  }
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
  const channel = getChannelById(activeChannelId);
  if (!list || !title || !channel) {
    return;
  }

  closeChannelMemberMenu();
  title.textContent = `# ${channel.name} 멤버`;
  list.innerHTML = "";
  const keyword = normalizeSearchKeyword(searchInput?.value ?? "");

  const members = channel.memberIds
    .map((id) => agents.find((agent) => agent.id === id))
    .filter((agent): agent is Agent => Boolean(agent))
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

function openChannelMembersModal(): void {
  const modal = document.getElementById("channel-members-modal") as HTMLDialogElement | null;
  const searchInput = document.getElementById("channel-members-search-input") as HTMLInputElement | null;
  const channel = getChannelById(activeChannelId);
  if (!modal || !channel) {
    return;
  }

  if (searchInput) {
    searchInput.value = "";
  }
  renderChannelMembersModalContent();
  if (modal.open) {
    modal.close();
  }
  modal.showModal();
  searchInput?.focus();
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
  const channel = getChannelById(activeChannelId);
  if (!list || !submitBtn || !channel) {
    return;
  }

  const keyword = normalizeSearchKeyword(searchInput?.value ?? "");
  const visibleAgents = agents.filter((agent) => matchesAgentSearch(agent, keyword));

  for (const selectedId of Array.from(selectedChannelMemberAddIds)) {
    const stillSelectable = agents.some(
      (agent) => agent.id === selectedId && !channel.memberIds.includes(agent.id),
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
    const alreadyAdded = channel.memberIds.includes(agent.id);
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

function openChannelMemberAddModal(): void {
  const modal = document.getElementById("channel-member-add-modal") as HTMLDialogElement | null;
  const searchInput = document.getElementById("channel-member-add-search-input") as HTMLInputElement | null;
  const channel = getChannelById(activeChannelId);
  if (!modal || !searchInput || !channel) {
    return;
  }

  selectedChannelMemberAddIds.clear();
  searchInput.value = "";
  renderChannelMemberAddList();

  if (modal.open) {
    modal.close();
  }
  modal.showModal();
  searchInput.focus();
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

function saveChannel(channelName: string, channelDescription: string): void {
  const name = channelName.trim();
  const description = channelDescription.trim();
  if (!name || !description) {
    showWarning("채널 이름과 설명을 입력하세요.");
    return;
  }

  if (channelFormMode === "edit" && editingChannelId) {
    const target = channels.find((channel) => channel.id === editingChannelId);
    if (!target) {
      showWarning("수정할 채널을 찾지 못했습니다.");
      return;
    }
    const updated = { ...target, name, description };
    channels = channels.map((channel) => (channel.id === updated.id ? updated : channel));
    if (activeChannelId === updated.id) {
      setHeader(`# ${updated.name}`, updated.description);
    }
    renderChannelList();
    closeChannelModal();
    return;
  }

  const channel: Channel = {
    id: generateChannelId(name),
    name,
    description,
    memberIds: [],
    createdAt: new Date().toISOString(),
  };
  channels = [...channels, channel].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  activeChannelId = channel.id;
  renderChannelList();
  renderMemberList();
  updateChannelMembersButton();
  setHeader(`# ${channel.name}`, channel.description);
  setStatus("Channel selected");
  setComposerEnabled(false, "채널 대화 기능은 준비 중입니다.");
  renderMessages([]);
  closeChannelModal();
}

function addSelectedMembersToActiveChannel(memberIds: string[]): void {
  const channel = getChannelById(activeChannelId);
  if (!channel) {
    return;
  }

  const toAdd = memberIds.filter(
    (memberId) => memberId && !channel.memberIds.includes(memberId),
  );
  if (toAdd.length === 0) {
    return;
  }

  channel.memberIds = [...channel.memberIds, ...toAdd];
  channels = channels.map((item) => (item.id === channel.id ? channel : item));
  closeChannelMemberAddModal();
  openChannelMembersModal();
}

function removeMemberFromActiveChannel(memberId: string): void {
  const channel = getChannelById(activeChannelId);
  if (!channel) {
    return;
  }

  channel.memberIds = channel.memberIds.filter((id) => id !== memberId);
  channels = channels.map((item) => (item.id === channel.id ? channel : item));
  closeChannelMemberMenu();
  renderChannelMembersModalContent();
}

function deleteChannel(channelId: string): void {
  const target = channels.find((channel) => channel.id === channelId);
  if (!target) {
    return;
  }

  channels = channels.filter((channel) => channel.id !== channelId);
  if (activeChannelId === channelId) {
    activeChannelId = null;
  }

  closeChannelMenu();
  renderChannelList();
  renderMemberList();
  updateChannelMembersButton();
  void refreshMessages();
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

  channels = channels.map((channel) => ({
    ...channel,
    memberIds: channel.memberIds.filter((memberId) => validIds.has(memberId)),
  }));

  const preferred = preferredAgentId ?? activeAgentId;
  if (preferred && agents.some((agent) => agent.id === preferred)) {
    activeAgentId = preferred;
  } else {
    activeAgentId = agents.length > 0 ? agents[0].id : null;
  }

  renderChannelList();
  renderMemberList();
}

async function refreshMessagesByAgent(agentId: string): Promise<void> {
  if (activeChannelId) {
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
    setStatus(codexReady ? "Ready" : "Codex unavailable");
    renderMemberList();
    return;
  }

  unreadAgentIds.add(agentId);
  renderMemberList();
}

async function refreshMessages(): Promise<void> {
  updateChannelMembersButton();

  if (activeChannelId) {
    const channel = getChannelById(activeChannelId);
    setHeader(channel ? `# ${channel.name}` : "채널", channel?.description ?? "");
    setStatus("Channel selected");
    setComposerEnabled(false, "채널 대화 기능은 준비 중입니다.");
    renderMessages([]);
    return;
  }

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
  setStatus(codexReady ? "Ready" : "Codex unavailable");
}

async function generateMemberSystemPrompt(): Promise<void> {
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
  generateBtn.disabled = true;
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
    setStatus(codexReady ? "Ready" : "Codex unavailable");
    promptInput.focus();
    const len = promptInput.value.length;
    promptInput.setSelectionRange(len, len);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    showWarning(`시스템 프롬프트 자동 생성 실패: ${message}`);
    setStatus(`Error: ${message}`);
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = originalLabel;
  }
}

async function saveMemberForm(): Promise<void> {
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

  closeMemberModal();
  closeMemberMenu();
  await refreshMessages();
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
    deleteChannel(action.channelId);
  }
}

function initMemberCrudUi(): void {
  const addChannelBtn = document.getElementById("add-channel-btn");
  const channelMenu = document.getElementById("channel-menu");
  const channelMenuEditBtn = document.getElementById("channel-menu-edit");
  const channelMenuDeleteBtn = document.getElementById("channel-menu-delete");
  const channelModal = document.getElementById("channel-modal") as HTMLDialogElement | null;
  const channelForm = document.getElementById("channel-form") as HTMLFormElement | null;
  const channelCancelBtn = document.getElementById("channel-cancel-btn");
  const channelNameInput = document.getElementById("channel-name-input") as HTMLInputElement | null;
  const channelDescInput = document.getElementById("channel-desc-input") as HTMLInputElement | null;
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
  const cancelBtn = document.getElementById("member-cancel-btn");
  const generatePromptBtn = document.getElementById("member-generate-prompt-btn");
  const clearBtn = document.getElementById("member-menu-clear");
  const editBtn = document.getElementById("member-menu-edit");
  const deleteBtn = document.getElementById("member-menu-delete");
  const actionCancelBtn = document.getElementById("action-cancel-btn");
  const actionConfirmBtn = document.getElementById("action-confirm-btn");
  const actionModal = document.getElementById("action-modal") as HTMLDialogElement | null;
  const memberMenu = document.getElementById("member-menu");

  addChannelBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMemberMenu();
    closeChannelMenu();
    closeChannelMemberMenu();
    openChannelModal("create", null);
  });

  channelForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!channelNameInput || !channelDescInput) {
      return;
    }
    saveChannel(channelNameInput.value, channelDescInput.value);
  });

  channelCancelBtn?.addEventListener("click", () => {
    closeChannelModal();
  });

  channelModal?.addEventListener("close", () => {
    restoreInputFocus();
  });

  channelMembersBtn?.addEventListener("click", () => {
    openChannelMembersModal();
  });

  channelMenuEditBtn?.addEventListener("click", () => {
    if (!openChannelMenuChannelId) {
      return;
    }
    const target = channels.find((channel) => channel.id === openChannelMenuChannelId) ?? null;
    closeChannelMenu();
    openChannelModal("edit", target);
  });

  channelMenuDeleteBtn?.addEventListener("click", () => {
    if (!openChannelMenuChannelId) {
      return;
    }
    const target = channels.find((channel) => channel.id === openChannelMenuChannelId);
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
    removeMemberFromActiveChannel(openChannelMemberMenuMemberId);
  });

  channelMembersAddBtn?.addEventListener("click", () => {
    closeChannelMembersModal();
    openChannelMemberAddModal();
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
    addSelectedMembersToActiveChannel(selectedIds);
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

  generatePromptBtn?.addEventListener("click", () => {
    void generateMemberSystemPrompt();
  });

  cancelBtn?.addEventListener("click", () => {
    closeMemberModal();
  });

  memberModal?.addEventListener("close", () => {
    restoreInputFocus();
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
  });
}

async function init(): Promise<void> {
  backendBaseUrl = await window.viblackApi.getBackendBaseUrl();
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
    setStatus(`Ready (${codexStatus.command ?? "codex"})`);
  }

  await refreshAgents();
  await refreshMessages();
}

async function sendMessage(): Promise<void> {
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  const button = document.getElementById("send-btn") as HTMLButtonElement | null;
  if (activeChannelId) {
    return;
  }
  const targetAgentId = activeAgentId;
  if (!input || !button || !targetAgentId) {
    return;
  }

  const content = input.value.trim();
  if (!content) {
    return;
  }

  input.value = "";
  button.disabled = true;
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
  };
  renderMessages([...renderedMessages, optimisticUser]);

  try {
    await fetchJson(`${backendBaseUrl}/api/agents/${targetAgentId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    await refreshMessagesByAgent(targetAgentId);
    if (activeAgentId === targetAgentId) {
      setStatus(codexReady ? "Ready" : "Codex unavailable");
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
    inflightAgentIds.delete(targetAgentId);
    renderMemberList();
    button.disabled = false;
    if (!activeAgentId) {
      button.disabled = true;
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  initSidebarSections();
  initMemberCrudUi();

  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage();
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  });

  void init();
});
