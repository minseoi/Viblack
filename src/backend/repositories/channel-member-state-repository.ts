import type { DatabaseSync } from "node:sqlite";
import type { ChannelMemberState } from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

function mapChannelMemberState(row: Record<string, unknown>): ChannelMemberState {
  return {
    channelId: String(row.channel_id),
    agentId: String(row.agent_id),
    lastReadMessageId: Number(row.last_read_message_id ?? 0),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null,
    isCoordinator: Number(row.is_coordinator ?? 0) === 1,
    updatedAt: String(row.updated_at),
  };
}

export class ChannelMemberStateRepository {
  constructor(private readonly db: DatabaseSync) {}

  ensureMemberState(channelId: string, agentId: string, isCoordinator = false): ChannelMemberState {
    const current = this.getChannelMemberState(channelId, agentId);
    if (current) {
      return current;
    }
    const updatedAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO channel_member_states
         (channel_id, agent_id, last_read_message_id, last_seen_at, is_coordinator, updated_at)
         VALUES (?, ?, 0, NULL, ?, ?)`,
      )
      .run(channelId, agentId, isCoordinator ? 1 : 0, updatedAt);
    const inserted = this.getChannelMemberState(channelId, agentId);
    if (!inserted) {
      throw new Error("failed to create channel member state");
    }
    return inserted;
  }

  getChannelMemberState(channelId: string, agentId: string): ChannelMemberState | null {
    const stmt = this.db.prepare(
      `SELECT channel_id, agent_id, last_read_message_id, last_seen_at, is_coordinator, updated_at
       FROM channel_member_states
       WHERE channel_id = ? AND agent_id = ?`,
    );
    const row = stmt.get(channelId, agentId) as Record<string, unknown> | undefined;
    return row ? mapChannelMemberState(row) : null;
  }

  listChannelMemberStates(channelId: string): ChannelMemberState[] {
    const stmt = this.db.prepare(
      `SELECT channel_id, agent_id, last_read_message_id, last_seen_at, is_coordinator, updated_at
       FROM channel_member_states
       WHERE channel_id = ?
       ORDER BY updated_at ASC`,
    );
    const rows = stmt.all(channelId) as Array<Record<string, unknown>>;
    return rows.map(mapChannelMemberState);
  }

  deleteChannelMemberState(channelId: string, agentId: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM channel_member_states WHERE channel_id = ? AND agent_id = ?`)
      .run(channelId, agentId) as { changes?: number };
    return Boolean(result.changes && result.changes > 0);
  }

  upsertChannelMemberState(input: {
    channelId: string;
    agentId: string;
    lastReadMessageId?: number;
    lastSeenAt?: string | null;
    isCoordinator?: boolean;
  }): ChannelMemberState {
    const current = this.getChannelMemberState(input.channelId, input.agentId);
    const updatedAt = nowIso();
    const lastReadMessageId =
      input.lastReadMessageId ?? current?.lastReadMessageId ?? 0;
    const lastSeenAt =
      input.lastSeenAt === undefined ? (current?.lastSeenAt ?? null) : input.lastSeenAt;
    const isCoordinator =
      input.isCoordinator === undefined ? (current?.isCoordinator ?? false) : input.isCoordinator;

    this.db
      .prepare(
        `INSERT INTO channel_member_states
         (channel_id, agent_id, last_read_message_id, last_seen_at, is_coordinator, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(channel_id, agent_id)
         DO UPDATE SET
           last_read_message_id = excluded.last_read_message_id,
           last_seen_at = excluded.last_seen_at,
           is_coordinator = excluded.is_coordinator,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.channelId,
        input.agentId,
        lastReadMessageId,
        lastSeenAt,
        isCoordinator ? 1 : 0,
        updatedAt,
      );

    const state = this.getChannelMemberState(input.channelId, input.agentId);
    if (!state) {
      throw new Error("failed to upsert channel member state");
    }
    return state;
  }
}
