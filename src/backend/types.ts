export type SenderType = "user" | "agent" | "system";
export type ChannelMessageKind = "request" | "progress" | "result" | "remention" | "general";

export interface Agent {
  id: string;
  name: string;
  role: string;
  roleProfile: string | null;
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

export interface Channel {
  id: string;
  name: string;
  description: string;
  archivedAt: string | null;
  createdAt: string;
}

export interface ChannelMember {
  channelId: string;
  agentId: string;
  joinedAt: string;
}

export interface ChannelMessage {
  id: number;
  channelId: string;
  senderType: SenderType;
  senderId: string | null;
  content: string;
  messageKind: ChannelMessageKind;
  createdAt: string;
}

export interface ChannelMessageMention {
  messageId: number;
  agentId: string;
  mentionName: string;
  createdAt: string;
}

export interface CodexStatus {
  ok: boolean;
  version?: string;
  command?: string;
  error?: string;
}
