type SenderType = "user" | "agent" | "system";

interface Agent {
  id: string;
  name: string;
  role: string;
  sessionId: string | null;
}

interface ChatMessage {
  id: number;
  sender: SenderType;
  content: string;
  createdAt: string;
}

let backendBaseUrl = "";
let activeAgentId = "helper";

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

function renderMessages(messages: ChatMessage[]): void {
  const list = document.getElementById("messages");
  if (!list) {
    return;
  }

  list.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("li");
    item.className = `msg msg-${message.sender}`;

    const sender = document.createElement("div");
    sender.className = "msg-sender";
    sender.textContent =
      message.sender === "user" ? "You" : message.sender === "agent" ? "Helper" : "System";

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

  list.scrollTop = list.scrollHeight;
}

async function refreshMessages(): Promise<void> {
  const data = await fetchJson<{ agent: Agent; messages: ChatMessage[] }>(
    `${backendBaseUrl}/api/agents/${activeAgentId}/messages`,
  );
  const title = document.getElementById("agent-title");
  if (title) {
    title.textContent = `${data.agent.name} (${data.agent.role})`;
  }
  renderMessages(data.messages);
}

async function init(): Promise<void> {
  backendBaseUrl = await window.viblackApi.getBackendBaseUrl();
  const codexStatus = await window.viblackApi.getBootCodexStatus();

  if (!codexStatus.ok) {
    alert(
      [
        "Codex CLI를 찾을 수 없습니다.",
        "터미널에서 `codex --version`이 동작하는지 확인해 주세요.",
        `오류: ${codexStatus.error ?? "unknown"}`,
      ].join("\n"),
    );
  }

  const agentsData = await fetchJson<{ agents: Agent[] }>(`${backendBaseUrl}/api/agents`);
  if (agentsData.agents.length > 0) {
    activeAgentId = agentsData.agents[0].id;
  }
  await refreshMessages();
  setStatus("Ready");
}

async function sendMessage(): Promise<void> {
  const input = document.getElementById("chat-input") as HTMLTextAreaElement | null;
  const button = document.getElementById("send-btn") as HTMLButtonElement | null;
  if (!input || !button) {
    return;
  }

  const content = input.value.trim();
  if (!content) {
    return;
  }

  input.value = "";
  button.disabled = true;
  setStatus("Helper is working...");

  try {
    await fetchJson(`${backendBaseUrl}/api/agents/${activeAgentId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    await refreshMessages();
    setStatus("Ready");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    setStatus(`Error: ${message}`);
    alert(`메시지 전송 실패: ${message}`);
  } finally {
    button.disabled = false;
  }
}

window.addEventListener("DOMContentLoaded", () => {
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
