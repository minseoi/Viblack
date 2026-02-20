export type SenderType = "user" | "agent" | "system";

export interface Agent {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  sessionId: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  agentId: string;
  sender: SenderType;
  content: string;
  createdAt: string;
}

export interface CodexStatus {
  ok: boolean;
  version?: string;
  command?: string;
  error?: string;
}
