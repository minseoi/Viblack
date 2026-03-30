interface ChannelSyncMessagesPayload {
  channel: Channel;
  members: Agent[];
  messages: ChannelApiMessage[];
  mentionsByMessage: Record<number, Array<{ agentId: string; mentionName: string }>>;
}

interface ChannelSyncControllerOptions {
  getBackendBaseUrl: () => string;
  store: ChannelStore;
  fetchJson: <T>(url: string, init?: RequestInit) => Promise<T>;
  mapChannelMessagesToChatMessages: (messages: ChannelApiMessage[], members: Agent[]) => ChatMessage[];
  getRenderedMessages: () => ChatMessage[];
  setHeader: (title: string, subtitle: string) => void;
  renderMessages: (messages: ChatMessage[], agentName?: string) => void;
  refreshActiveChannelMessages: () => Promise<void>;
  refreshActiveChannelExecutionState: (channelId: string) => Promise<void>;
  syncStatusForCurrentContext: () => void;
}

class ChannelSyncController {
  private channelEventSource: EventSource | null = null;

  constructor(private readonly options: ChannelSyncControllerOptions) {}

  disconnect(): void {
    if (!this.channelEventSource) {
      return;
    }
    this.channelEventSource.close();
    this.channelEventSource = null;
  }

  init(): void {
    const backendBaseUrl = this.options.getBackendBaseUrl();
    if (!backendBaseUrl || this.channelEventSource) {
      return;
    }

    const stream = new EventSource(`${backendBaseUrl}/api/channels/events`);
    this.channelEventSource = stream;

    stream.addEventListener("channel_message", (event) => {
      const activeChannelId = this.options.store.getActiveChannelId();
      if (!activeChannelId) {
        return;
      }

      let payload: ChannelMessageEventPayload | null = null;
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as ChannelMessageEventPayload;
      } catch {
        payload = null;
      }
      if (!payload || payload.channelId !== activeChannelId) {
        return;
      }
      if (payload.messageId <= this.options.store.getLastSeenChannelMessageId()) {
        void this.options.refreshActiveChannelMessages();
        return;
      }
      this.options.store.markChannelDeltaSyncPending();
      void this.syncActiveChannelMessageDelta();
    });
  }

  async syncActiveChannelMessageDelta(): Promise<void> {
    const activeChannelId = this.options.store.getActiveChannelId();
    if (!activeChannelId) {
      return;
    }
    if (this.options.store.isChannelDeltaSyncingNow()) {
      return;
    }

    this.options.store.setChannelDeltaSyncing(true);
    try {
      while (this.options.store.getActiveChannelId()) {
        const channelId = this.options.store.getActiveChannelId() as string;
        const shouldSync = this.options.store.consumePendingChannelDeltaSync();
        if (!shouldSync) {
          break;
        }

        const data = await this.options.fetchJson<ChannelSyncMessagesPayload>(
          `${this.options.getBackendBaseUrl()}/api/channels/${channelId}/messages?after=${this.options.store.getLastSeenChannelMessageId()}`,
        );

        if (this.options.store.getActiveChannelId() !== channelId) {
          continue;
        }

        this.options.store.setActiveChannelMembers(data.members);
        this.options.setHeader(`# ${data.channel.name}`, data.channel.description);
        if (data.messages.length === 0) {
          continue;
        }

        const incoming = this.options.mapChannelMessagesToChatMessages(data.messages, data.members);
        this.options.store.reconcilePendingChannelUserMessages(channelId, incoming);
        const mergedServer = this.options.store.mergeChannelMessages(
          this.options.store.getPersistedChannelMessages(this.options.getRenderedMessages()),
          incoming,
        );
        const pendingForRender = this.options.store.getPendingChannelUserMessagesForRender(channelId);
        this.options.renderMessages(this.options.store.mergeChannelMessages(mergedServer, pendingForRender));
        this.options.store.setLastSeenChannelMessageId(
          Math.max(
            this.options.store.getLastSeenChannelMessageId(),
            this.options.store.getLastChannelMessageId(data.messages),
          ),
        );
        await this.options.refreshActiveChannelExecutionState(channelId);
        this.options.syncStatusForCurrentContext();
      }
    } catch {
      // Ignore transient sync failures; next SSE event will retry.
    } finally {
      this.options.store.setChannelDeltaSyncing(false);
      if (
        this.options.store.hasPendingChannelDeltaSync() &&
        this.options.store.getActiveChannelId()
      ) {
        void this.syncActiveChannelMessageDelta();
      }
    }
  }
}
