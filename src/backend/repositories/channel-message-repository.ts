import type { DatabaseSync } from "node:sqlite";
import type { ChannelMessage, ChannelMessageKind, ChannelMessageMention, SenderType } from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

export class ChannelMessageRepository {
  constructor(private readonly db: DatabaseSync) {}

  appendChannelMessage(
    channelId: string,
    senderType: SenderType,
    senderId: string | null,
    content: string,
    messageKind: ChannelMessageKind = "general",
  ): ChannelMessage {
    const createdAt = nowIso();
    const insert = this.db.prepare(
      `INSERT INTO channel_messages
       (channel_id, sender_type, sender_id, content, message_kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const result = insert.run(channelId, senderType, senderId, content, messageKind, createdAt) as {
      lastInsertRowid: number | bigint;
    };
    return {
      id: Number(result.lastInsertRowid),
      channelId,
      senderType,
      senderId,
      content,
      messageKind,
      createdAt,
    };
  }

  updateChannelMessage(
    messageId: number,
    senderType: SenderType,
    senderId: string | null,
    content: string,
    messageKind: ChannelMessageKind,
  ): ChannelMessage | null {
    const stmt = this.db.prepare(
      `UPDATE channel_messages
       SET sender_type = ?, sender_id = ?, content = ?, message_kind = ?
       WHERE id = ?`,
    );
    const result = stmt.run(senderType, senderId, content, messageKind, messageId) as {
      changes?: number;
    };
    if (!result.changes || result.changes < 1) {
      return null;
    }

    const row = this.db
      .prepare(
        `SELECT id, channel_id, sender_type, sender_id, content, message_kind, created_at
         FROM channel_messages
         WHERE id = ?`,
      )
      .get(messageId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      id: Number(row.id),
      channelId: String(row.channel_id),
      senderType: row.sender_type as SenderType,
      senderId: row.sender_id ? String(row.sender_id) : null,
      content: String(row.content),
      messageKind: row.message_kind as ChannelMessageKind,
      createdAt: String(row.created_at),
    };
  }

  listChannelMessages(channelId: string, afterMessageId?: number): ChannelMessage[] {
    const hasAfter = typeof afterMessageId === "number" && Number.isFinite(afterMessageId);
    const stmt = this.db.prepare(
      hasAfter
        ? `SELECT id, channel_id, sender_type, sender_id, content, message_kind, created_at
           FROM channel_messages
           WHERE channel_id = ? AND id > ?
           ORDER BY id ASC`
        : `SELECT id, channel_id, sender_type, sender_id, content, message_kind, created_at
           FROM channel_messages
           WHERE channel_id = ?
           ORDER BY id ASC`,
    );
    const rows = hasAfter
      ? (stmt.all(channelId, Math.max(0, Math.trunc(afterMessageId ?? 0))) as Array<
          Record<string, unknown>
        >)
      : (stmt.all(channelId) as Array<Record<string, unknown>>);
    return rows.map((row) => ({
      id: Number(row.id),
      channelId: String(row.channel_id),
      senderType: row.sender_type as SenderType,
      senderId: row.sender_id ? String(row.sender_id) : null,
      content: String(row.content),
      messageKind: row.message_kind as ChannelMessageKind,
      createdAt: String(row.created_at),
    }));
  }

  listRecentChannelMessages(
    channelId: string,
    beforeOrAtMessageId: number,
    limit: number,
  ): ChannelMessage[] {
    const effectiveBeforeMessageId = Math.max(0, Math.trunc(beforeOrAtMessageId));
    const effectiveLimit = Math.max(1, Math.trunc(limit));
    const rows = this.db
      .prepare(
        `SELECT id, channel_id, sender_type, sender_id, content, message_kind, created_at
         FROM channel_messages
         WHERE channel_id = ? AND id <= ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(channelId, effectiveBeforeMessageId, effectiveLimit) as Array<Record<string, unknown>>;

    return rows
      .reverse()
      .map((row) => ({
        id: Number(row.id),
        channelId: String(row.channel_id),
        senderType: row.sender_type as SenderType,
        senderId: row.sender_id ? String(row.sender_id) : null,
        content: String(row.content),
        messageKind: row.message_kind as ChannelMessageKind,
        createdAt: String(row.created_at),
      }));
  }

  addChannelMessageMentions(
    messageId: number,
    mentions: Array<{ agentId: string; mentionName: string }>,
  ): ChannelMessageMention[] {
    if (mentions.length === 0) {
      return [];
    }

    const createdAt = nowIso();
    const insert = this.db.prepare(
      `INSERT INTO channel_message_mentions (message_id, agent_id, mention_name, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(message_id, agent_id) DO NOTHING`,
    );

    this.db.exec("BEGIN");
    try {
      for (const mention of mentions) {
        insert.run(messageId, mention.agentId, mention.mentionName, createdAt);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
    return this.listChannelMessageMentions(messageId);
  }

  listChannelMessageMentions(messageId: number): ChannelMessageMention[] {
    const stmt = this.db.prepare(
      `SELECT message_id, agent_id, mention_name, created_at
       FROM channel_message_mentions
       WHERE message_id = ?
       ORDER BY rowid ASC`,
    );
    const rows = stmt.all(messageId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      messageId: Number(row.message_id),
      agentId: String(row.agent_id),
      mentionName: String(row.mention_name),
      createdAt: String(row.created_at),
    }));
  }
}
