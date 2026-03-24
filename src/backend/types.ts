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

export interface ChannelMemberState {
  channelId: string;
  agentId: string;
  lastReadMessageId: number;
  lastSeenAt: string | null;
  isCoordinator: boolean;
  updatedAt: string;
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

export type ChannelExecutionKind = "mention" | "remention";
export type ChannelExecutionStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";

export interface ChannelExecutionJob {
  id: number;
  channelId: string;
  triggerMessageId: number;
  sourceMessageId: number;
  sourceAgentId: string | null;
  targetAgentId: string;
  executionKind: ChannelExecutionKind;
  status: ChannelExecutionStatus;
  depth: number;
  errorText: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AppSetting {
  key: string;
  value: string;
  updatedAt: string;
}

export interface AppSettingsSnapshot {
  selectedModel: string | null;
  selectedModelAvailable: boolean;
  availableModels: string[];
  modelsCachePath: string;
  cacheError: string | null;
}

export interface CodexStatus {
  ok: boolean;
  version?: string;
  command?: string;
  error?: string;
}
