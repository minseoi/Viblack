class ChannelStore {
  private channels: Channel[] = [];
  private activeChannelId: string | null = null;
  private activeChannelMembers: Agent[] = [];
  private inflightChannelRequestCount = 0;
  private activeChannelRunningJobCount = 0;
  private activeChannelTypingAgentIds: string[] = [];
  private lastSeenChannelMessageId = 0;
  private isChannelDeltaSyncing = false;
  private pendingChannelDeltaSync = false;
  private nextLocalChannelMessageId = -1;
  private pendingChannelUserMessages: PendingChannelUserMessage[] = [];

  getChannels(): Channel[] {
    return this.channels;
  }

  setChannels(channels: Channel[], preferredChannelId?: string | null): void {
    this.channels = channels;
    const preferred = preferredChannelId ?? this.activeChannelId;
    if (preferred && channels.some((channel) => channel.id === preferred)) {
      this.activeChannelId = preferred;
      return;
    }
    if (this.activeChannelId && channels.length === 0) {
      this.activeChannelId = null;
    }
  }

  getChannelById(channelId: string | null): Channel | null {
    if (!channelId) {
      return null;
    }
    return this.channels.find((channel) => channel.id === channelId) ?? null;
  }

  getActiveChannelId(): string | null {
    return this.activeChannelId;
  }

  setActiveChannelId(channelId: string | null): void {
    this.activeChannelId = channelId;
  }

  getActiveChannelMembers(): Agent[] {
    return this.activeChannelMembers;
  }

  setActiveChannelMembers(members: Agent[]): void {
    this.activeChannelMembers = members;
  }

  clearActiveChannelMembers(): void {
    this.activeChannelMembers = [];
  }

  getInflightChannelRequestCount(): number {
    return this.inflightChannelRequestCount;
  }

  incrementInflightChannelRequestCount(): void {
    this.inflightChannelRequestCount += 1;
  }

  decrementInflightChannelRequestCount(): void {
    this.inflightChannelRequestCount = Math.max(0, this.inflightChannelRequestCount - 1);
  }

  getActiveChannelRunningJobCount(): number {
    return this.activeChannelRunningJobCount;
  }

  setActiveChannelRunningJobCount(count: number): void {
    this.activeChannelRunningJobCount = Math.max(0, count);
  }

  clearActiveChannelRunningJobCount(): void {
    this.activeChannelRunningJobCount = 0;
  }

  getActiveChannelTypingAgentIds(): string[] {
    return [...this.activeChannelTypingAgentIds];
  }

  setActiveChannelTypingAgentIds(agentIds: string[]): void {
    this.activeChannelTypingAgentIds = [...new Set(agentIds)];
  }

  clearActiveChannelTypingAgentIds(): void {
    this.activeChannelTypingAgentIds = [];
  }

  getLastSeenChannelMessageId(): number {
    return this.lastSeenChannelMessageId;
  }

  setLastSeenChannelMessageId(messageId: number): void {
    this.lastSeenChannelMessageId = messageId;
  }

  resetLastSeenChannelMessageId(): void {
    this.lastSeenChannelMessageId = 0;
  }

  isChannelDeltaSyncingNow(): boolean {
    return this.isChannelDeltaSyncing;
  }

  setChannelDeltaSyncing(isSyncing: boolean): void {
    this.isChannelDeltaSyncing = isSyncing;
  }

  markChannelDeltaSyncPending(): void {
    this.pendingChannelDeltaSync = true;
  }

  hasPendingChannelDeltaSync(): boolean {
    return this.pendingChannelDeltaSync;
  }

  consumePendingChannelDeltaSync(): boolean {
    const pending = this.pendingChannelDeltaSync;
    this.pendingChannelDeltaSync = false;
    return pending;
  }

  clearPendingChannelDeltaSync(): void {
    this.pendingChannelDeltaSync = false;
  }

  createPendingChannelUserMessage(channelId: string, content: string): ChatMessage {
    const pending: PendingChannelUserMessage = {
      localId: this.nextLocalChannelMessageId,
      channelId,
      content,
      createdAt: new Date().toISOString(),
    };
    this.nextLocalChannelMessageId -= 1;
    this.pendingChannelUserMessages.push(pending);

    return {
      id: pending.localId,
      sender: "user",
      content: pending.content,
      createdAt: pending.createdAt,
      messageKind: "general",
    };
  }

  removePendingChannelUserMessage(localId: number): void {
    this.pendingChannelUserMessages = this.pendingChannelUserMessages.filter(
      (pending) => pending.localId !== localId,
    );
  }

  clearPendingChannelUserMessagesForChannel(channelId: string): void {
    this.pendingChannelUserMessages = this.pendingChannelUserMessages.filter(
      (pending) => pending.channelId !== channelId,
    );
  }

  getPendingChannelUserMessagesForRender(channelId: string): ChatMessage[] {
    return this.pendingChannelUserMessages
      .filter((pending) => pending.channelId === channelId)
      .map((pending) => ({
        id: pending.localId,
        sender: "user",
        content: pending.content,
        createdAt: pending.createdAt,
        messageKind: "general",
      }));
  }

  reconcilePendingChannelUserMessages(channelId: string, serverMessages: ChatMessage[]): void {
    const pendingForChannel = this.pendingChannelUserMessages.filter(
      (pending) => pending.channelId === channelId,
    );
    if (pendingForChannel.length === 0) {
      return;
    }

    const unmatchedServerUserContents = serverMessages
      .filter((message) => message.sender === "user")
      .map((message) => message.content);
    if (unmatchedServerUserContents.length === 0) {
      return;
    }

    const keepLocalIds = new Set<number>();
    for (const pending of pendingForChannel) {
      const matchIndex = unmatchedServerUserContents.indexOf(pending.content);
      if (matchIndex >= 0) {
        unmatchedServerUserContents.splice(matchIndex, 1);
      } else {
        keepLocalIds.add(pending.localId);
      }
    }

    this.pendingChannelUserMessages = this.pendingChannelUserMessages.filter((pending) => {
      if (pending.channelId !== channelId) {
        return true;
      }
      return keepLocalIds.has(pending.localId);
    });
  }

  mergeChannelMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
    if (incoming.length === 0) {
      return current;
    }

    const mergedById = new Map<number, ChatMessage>();
    for (const message of current) {
      mergedById.set(message.id, message);
    }
    for (const message of incoming) {
      mergedById.set(message.id, message);
    }
    return Array.from(mergedById.values()).sort((a, b) => a.id - b.id);
  }

  getPersistedChannelMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.filter((message) => message.id > 0);
  }

  getLastChannelMessageId(messages: ChannelApiMessage[]): number {
    if (messages.length === 0) {
      return 0;
    }
    return messages[messages.length - 1].id;
  }
}
