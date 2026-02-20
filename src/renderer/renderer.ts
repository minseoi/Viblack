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

let backendBaseUrl = "";
let activeAgentId: string | null = null;
let renderedMessages: ChatMessage[] = [];
let agents: Agent[] = [];
let codexReady = false;
let openMemberMenuAgentId: string | null = null;
let memberFormMode: "create" | "edit" = "create";
let editingAgentId: string | null = null;
let pendingMemberAction: { type: "clear" | "delete"; agentId: string } | null = null;
const unreadAgentIds = new Set<string>();
const inflightAgentIds = new Set<string>();

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

function setComposerEnabled(enabled: boolean): void {
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  const button = document.getElementById("send-btn") as HTMLButtonElement | null;
  if (input) {
    input.disabled = !enabled;
    input.placeholder = enabled
      ? "Helper에게 작업을 요청하세요. (Enter 전송, Shift+Enter 줄바꿈)"
      : "먼저 멤버를 추가하세요.";
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

    const body = document.createElement("pre");
    body.className = "msg-content";
    body.textContent = message.content;

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

function openActionModal(
  action: { type: "clear" | "delete"; agentId: string },
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

  pendingMemberAction = action;
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
  pendingMemberAction = null;
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
        return;
      }
      activeAgentId = agent.id;
      unreadAgentIds.delete(agent.id);
      renderMemberList();
      void refreshMessages();
    });

    const textWrap = document.createElement("div");
    textWrap.className = "member-text";

    const nameEl = document.createElement("div");
    nameEl.className = "member-name";
    nameEl.textContent = agent.name;

    const roleEl = document.createElement("div");
    roleEl.className = "member-role";
    const roleParts = [agent.role];
    if (inflightAgentIds.has(agent.id)) {
      roleParts.push("응답 생성 중");
    } else if (unreadAgentIds.has(agent.id)) {
      roleParts.push("새 응답");
    }
    roleEl.textContent = roleParts.join(" · ");

    textWrap.appendChild(nameEl);
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

  setComposerEnabled(activeAgentId !== null);
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

  const preferred = preferredAgentId ?? activeAgentId;
  if (preferred && agents.some((agent) => agent.id === preferred)) {
    activeAgentId = preferred;
  } else {
    activeAgentId = agents.length > 0 ? agents[0].id : null;
  }

  renderMemberList();
}

async function refreshMessagesByAgent(agentId: string): Promise<void> {
  const data = await fetchJson<{ agent: Agent; messages: ChatMessage[] }>(
    `${backendBaseUrl}/api/agents/${agentId}/messages`,
  );
  if (activeAgentId === agentId) {
    unreadAgentIds.delete(agentId);
    const title = document.getElementById("agent-title");
    if (title) {
      title.textContent = `${data.agent.name} (${data.agent.role})`;
    }
    renderMessages(data.messages, data.agent.name);
    setStatus(codexReady ? "Ready" : "Codex unavailable");
    renderMemberList();
    return;
  }

  unreadAgentIds.add(agentId);
  renderMemberList();
}

async function refreshMessages(): Promise<void> {
  if (!activeAgentId) {
    const title = document.getElementById("agent-title");
    if (title) {
      title.textContent = "멤버를 추가하세요";
    }
    setStatus("No member selected");
    renderMessages([]);
    return;
  }

  const data = await fetchJson<{ agent: Agent; messages: ChatMessage[] }>(
    `${backendBaseUrl}/api/agents/${activeAgentId}/messages`,
  );
  const title = document.getElementById("agent-title");
  if (title) {
    title.textContent = `${data.agent.name} (${data.agent.role})`;
  }
  renderMessages(data.messages, data.agent.name);
  setStatus(codexReady ? "Ready" : "Codex unavailable");
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

async function runPendingMemberAction(): Promise<void> {
  const action = pendingMemberAction;
  if (!action) {
    return;
  }

  closeActionModal();
  if (action.type === "clear") {
    await clearMemberDm(action.agentId);
    return;
  }
  await deleteMember(action.agentId);
}

function initMemberCrudUi(): void {
  const addMemberBtn = document.getElementById("add-member-btn");
  const memberModal = document.getElementById("member-modal") as HTMLDialogElement | null;
  const modalForm = document.getElementById("member-form");
  const cancelBtn = document.getElementById("member-cancel-btn");
  const clearBtn = document.getElementById("member-menu-clear");
  const editBtn = document.getElementById("member-menu-edit");
  const deleteBtn = document.getElementById("member-menu-delete");
  const actionCancelBtn = document.getElementById("action-cancel-btn");
  const actionConfirmBtn = document.getElementById("action-confirm-btn");
  const actionModal = document.getElementById("action-modal") as HTMLDialogElement | null;
  const menu = document.getElementById("member-menu");

  addMemberBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    closeMemberMenu();
    openMemberModal("create", null);
  });

  modalForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveMemberForm();
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
      { type: "clear", agentId: target.id },
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
      { type: "delete", agentId: target.id },
      "멤버 제거",
      `"${target.name}" 멤버를 제거할까요? 기존 DM 대화도 함께 삭제됩니다.`,
      "제거",
    );
  });

  actionCancelBtn?.addEventListener("click", () => {
    closeActionModal();
  });

  actionConfirmBtn?.addEventListener("click", () => {
    void runPendingMemberAction();
  });

  actionModal?.addEventListener("close", () => {
    pendingMemberAction = null;
    restoreInputFocus();
  });

  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    if (!menu) {
      return;
    }
    if (menu.contains(target)) {
      return;
    }
    const menuButton = (event.target as HTMLElement).closest(".member-menu-btn");
    if (menuButton) {
      return;
    }
    closeMemberMenu();
  });

  window.addEventListener("resize", () => {
    closeMemberMenu();
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
