import type { DatabaseSync } from "node:sqlite";
import type { Agent, ChannelMember } from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

function mapAgent(row: Record<string, unknown>): Agent {
  return {
    id: String(row.id),
    name: String(row.name),
    role: String(row.role),
    roleProfile: row.role_profile ? String(row.role_profile) : null,
    systemPrompt: String(row.system_prompt),
    sessionId: row.session_id ? String(row.session_id) : null,
    createdAt: String(row.created_at),
  };
}

export class ChannelMemberRepository {
  constructor(private readonly db: DatabaseSync) {}

  listChannelMembers(channelId: string): ChannelMember[] {
    const stmt = this.db.prepare(
      `SELECT channel_id, agent_id, joined_at
       FROM channel_members
       WHERE channel_id = ?
       ORDER BY joined_at ASC`,
    );
    const rows = stmt.all(channelId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      channelId: String(row.channel_id),
      agentId: String(row.agent_id),
      joinedAt: String(row.joined_at),
    }));
  }

  listChannelMemberAgents(channelId: string): Agent[] {
    const stmt = this.db.prepare(
      `SELECT a.id, a.name, a.role, a.role_profile, a.system_prompt, a.session_id, a.created_at
       FROM channel_members cm
       INNER JOIN agents a ON a.id = cm.agent_id
       WHERE cm.channel_id = ?
       ORDER BY cm.joined_at ASC`,
    );
    const rows = stmt.all(channelId) as Array<Record<string, unknown>>;
    return rows.map(mapAgent);
  }

  addChannelMember(channelId: string, agentId: string): ChannelMember | null {
    const joinedAt = nowIso();
    const stmt = this.db.prepare(
      `INSERT INTO channel_members (channel_id, agent_id, joined_at)
       VALUES (?, ?, ?)
       ON CONFLICT(channel_id, agent_id) DO NOTHING`,
    );
    stmt.run(channelId, agentId, joinedAt);

    const row = this.db
      .prepare(
        `SELECT channel_id, agent_id, joined_at
         FROM channel_members
         WHERE channel_id = ? AND agent_id = ?`,
      )
      .get(channelId, agentId) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      channelId: String(row.channel_id),
      agentId: String(row.agent_id),
      joinedAt: String(row.joined_at),
    };
  }

  removeChannelMember(channelId: string, agentId: string): boolean {
    const stmt = this.db.prepare(
      `DELETE FROM channel_members WHERE channel_id = ? AND agent_id = ?`,
    );
    const result = stmt.run(channelId, agentId) as { changes?: number };
    return Boolean(result.changes && result.changes > 0);
  }
}

