import http from "node:http";

export interface ChannelMessageEventPayload {
  channelId: string;
  messageId: number;
}

export interface ChannelExecutionEventPayload {
  channelId: string;
}

export class ChannelEventBus {
  private readonly channelEventClients = new Set<http.ServerResponse>();

  private writeSseEvent(res: http.ServerResponse, event: string, payload: unknown): void {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  attachClient(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    this.channelEventClients.add(res);
    this.writeSseEvent(res, "ready", { ok: true });

    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        this.channelEventClients.delete(res);
        clearInterval(heartbeat);
      }
    }, 20_000);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      this.channelEventClients.delete(res);
    };

    req.on("close", cleanup);
    req.on("aborted", cleanup);
  }

  broadcastChannelMessage(channelId: string, messageId: number): void {
    if (this.channelEventClients.size === 0) {
      return;
    }

    const payload: ChannelMessageEventPayload = { channelId, messageId };
    for (const client of Array.from(this.channelEventClients)) {
      try {
        this.writeSseEvent(client, "channel_message", payload);
      } catch {
        this.channelEventClients.delete(client);
      }
    }
  }

  broadcastChannelExecution(channelId: string): void {
    if (this.channelEventClients.size === 0) {
      return;
    }

    const payload: ChannelExecutionEventPayload = { channelId };
    for (const client of Array.from(this.channelEventClients)) {
      try {
        this.writeSseEvent(client, "channel_execution", payload);
      } catch {
        this.channelEventClients.delete(client);
      }
    }
  }

  closeAllClients(): void {
    for (const client of Array.from(this.channelEventClients)) {
      try {
        client.end();
      } catch {
        // Ignore SSE client close errors during shutdown.
      }
    }
    this.channelEventClients.clear();
  }
}
