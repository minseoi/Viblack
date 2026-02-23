import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  Agent,
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelMessageKind,
  ChannelMessageMention,
  ChatMessage,
  SenderType,
} from "./types";

const HELPER_AGENT_ID = "helper";

export class DuplicateAgentNameError extends Error {
  constructor(name: string) {
    super(`agent name already exists: ${name}`);
    this.name = "DuplicateAgentNameError";
  }
}

export class DuplicateChannelNameError extends Error {
  constructor(name: string) {
    super(`channel name already exists: ${name}`);
    this.name = "DuplicateChannelNameError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

export class ViblackDb {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.bootstrap();
  }

  close(): void {
    this.db.close();
  }

  listAgents(): Agent[] {
    const stmt = this.db.prepare(
      `SELECT id, name, role, role_profile, system_prompt, session_id, created_at
       FROM agents ORDER BY created_at ASC`,
    );
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map(this.mapAgent);
  }

  getAgent(agentId: string): Agent | null {
    const stmt = this.db.prepare(
      `SELECT id, name, role, role_profile, system_prompt, session_id, created_at
       FROM agents WHERE id = ?`,
    );
    const row = stmt.get(agentId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return this.mapAgent(row);
  }

  createAgent(name: string, role: string, systemPrompt: string): Agent {
    this.assertUniqueAgentName(name);
    const id = this.generateAgentId(name);
    const createdAt = nowIso();
    const stmt = this.db.prepare(
      `INSERT INTO agents (id, name, role, role_profile, system_prompt, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(id, name, role, null, systemPrompt, null, createdAt);
    const agent = this.getAgent(id);
    if (!agent) {
      throw new Error("failed to create agent");
    }
    return agent;
  }

  updateAgent(agentId: string, name: string, role: string, systemPrompt: string): Agent | null {
    this.assertUniqueAgentName(name, agentId);
    const stmt = this.db.prepare(
      `UPDATE agents
       SET name = ?, role = ?, system_prompt = ?
       WHERE id = ?`,
    );
    const result = stmt.run(name, role, systemPrompt, agentId) as { changes?: number };
    if (!result.changes || result.changes < 1) {
      return null;
    }
    return this.getAgent(agentId);
  }

  deleteAgent(agentId: string): boolean {
    this.db.exec("BEGIN");
    try {
      this.db.prepare(`DELETE FROM messages WHERE agent_id = ?`).run(agentId);
      const result = this.db.prepare(`DELETE FROM agents WHERE id = ?`).run(agentId) as {
        changes?: number;
      };
      this.db.exec("COMMIT");
      return Boolean(result.changes && result.changes > 0);
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  clearAgentMessages(agentId: string): boolean {
    const agent = this.getAgent(agentId);
    if (!agent) {
      return false;
    }
    this.db.prepare(`DELETE FROM messages WHERE agent_id = ?`).run(agentId);
    this.db.prepare(`UPDATE agents SET session_id = NULL WHERE id = ?`).run(agentId);
    return true;
  }

  updateAgentSession(agentId: string, sessionId: string): void {
    const stmt = this.db.prepare(`UPDATE agents SET session_id = ? WHERE id = ?`);
    stmt.run(sessionId, agentId);
  }

  appendMessage(agentId: string, sender: SenderType, content: string): ChatMessage {
    const createdAt = nowIso();
    const insert = this.db.prepare(
      `INSERT INTO messages (agent_id, sender, content, created_at)
       VALUES (?, ?, ?, ?)`,
    );
    const result = insert.run(agentId, sender, content, createdAt) as {
      lastInsertRowid: number | bigint;
    };
    return {
      id: Number(result.lastInsertRowid),
      agentId,
      sender,
      content,
      createdAt,
    };
  }

  listMessages(agentId: string): ChatMessage[] {
    const stmt = this.db.prepare(
      `SELECT id, agent_id, sender, content, created_at
       FROM messages
       WHERE agent_id = ?
       ORDER BY id ASC`,
    );
    const rows = stmt.all(agentId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      agentId: String(row.agent_id),
      sender: row.sender as SenderType,
      content: String(row.content),
      createdAt: String(row.created_at),
    }));
  }

  listChannels(includeArchived = false): Channel[] {
    const stmt = this.db.prepare(
      `SELECT id, name, description, archived_at, created_at
       FROM channels
       WHERE (? = 1 OR archived_at IS NULL)
       ORDER BY created_at ASC`,
    );
    const rows = stmt.all(includeArchived ? 1 : 0) as Array<Record<string, unknown>>;
    return rows.map(this.mapChannel);
  }

  getChannel(channelId: string): Channel | null {
    const stmt = this.db.prepare(
      `SELECT id, name, description, archived_at, created_at
       FROM channels WHERE id = ?`,
    );
    const row = stmt.get(channelId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return this.mapChannel(row);
  }

  createChannel(name: string, description: string): Channel {
    this.assertUniqueChannelName(name);
    const id = this.generateChannelId(name);
    const createdAt = nowIso();
    const stmt = this.db.prepare(
      `INSERT INTO channels (id, name, description, archived_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    stmt.run(id, name, description, null, createdAt);
    const channel = this.getChannel(id);
    if (!channel) {
      throw new Error("failed to create channel");
    }
    return channel;
  }

  updateChannel(channelId: string, name: string, description: string): Channel | null {
    this.assertUniqueChannelName(name, channelId);
    const stmt = this.db.prepare(
      `UPDATE channels
       SET name = ?, description = ?
       WHERE id = ?`,
    );
    const result = stmt.run(name, description, channelId) as { changes?: number };
    if (!result.changes || result.changes < 1) {
      return null;
    }
    return this.getChannel(channelId);
  }

  archiveChannel(channelId: string): boolean {
    const stmt = this.db.prepare(`UPDATE channels SET archived_at = ? WHERE id = ?`);
    const result = stmt.run(nowIso(), channelId) as { changes?: number };
    return Boolean(result.changes && result.changes > 0);
  }

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
    return rows.map(this.mapAgent);
  }

  addChannelMember(channelId: string, agentId: string): ChannelMember | null {
    if (!this.getChannel(channelId) || !this.getAgent(agentId)) {
      return null;
    }

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

  listChannelMessages(channelId: string): ChannelMessage[] {
    const stmt = this.db.prepare(
      `SELECT id, channel_id, sender_type, sender_id, content, message_kind, created_at
       FROM channel_messages
       WHERE channel_id = ?
       ORDER BY id ASC`,
    );
    const rows = stmt.all(channelId) as Array<Record<string, unknown>>;
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

  private bootstrap(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        role_profile TEXT,
        system_prompt TEXT NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(agent_id) REFERENCES agents(id)
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        archived_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, agent_id),
        FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,
        FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS channel_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL,
        sender_type TEXT NOT NULL,
        sender_id TEXT,
        content TEXT NOT NULL,
        message_kind TEXT NOT NULL DEFAULT 'general',
        created_at TEXT NOT NULL,
        FOREIGN KEY(channel_id) REFERENCES channels(id) ON DELETE CASCADE,
        FOREIGN KEY(sender_id) REFERENCES agents(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS channel_message_mentions (
        message_id INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        mention_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, agent_id),
        FOREIGN KEY(message_id) REFERENCES channel_messages(id) ON DELETE CASCADE,
        FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
      );
    `);

    this.ensureAgentRoleProfileColumn();
    this.ensureChannelIndexes();

    const existsStmt = this.db.prepare(`SELECT id FROM agents WHERE id = ?`);
    const helper = existsStmt.get(HELPER_AGENT_ID) as Record<string, unknown> | undefined;
    if (!helper) {
      const createdAt = nowIso();
      const insertStmt = this.db.prepare(
        `INSERT INTO agents (id, name, role, role_profile, system_prompt, session_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      insertStmt.run(
        HELPER_AGENT_ID,
        "Helper",
        "General assistant",
        null,
        "You are Helper, a practical AI teammate. Reply in concise Korean unless asked otherwise.",
        null,
        createdAt,
      );
      this.appendMessage(
        HELPER_AGENT_ID,
        "system",
        "Helper 에이전트가 준비되었습니다. 메시지를 보내 작업을 시작하세요.",
      );
    }
  }

  private mapAgent(row: Record<string, unknown>): Agent {
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

  private mapChannel(row: Record<string, unknown>): Channel {
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      archivedAt: row.archived_at ? String(row.archived_at) : null,
      createdAt: String(row.created_at),
    };
  }

  private generateAgentId(name: string): string {
    const normalized = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const base = normalized || "member";

    let id = base;
    let index = 2;
    while (this.getAgent(id)) {
      id = `${base}-${index}`;
      index += 1;
    }
    return id;
  }

  private assertUniqueAgentName(name: string, excludeAgentId?: string): void {
    const stmt = this.db.prepare(`SELECT id FROM agents WHERE name = ? COLLATE NOCASE LIMIT 1`);
    const row = stmt.get(name) as Record<string, unknown> | undefined;
    if (!row) {
      return;
    }

    const existingId = String(row.id);
    if (excludeAgentId && existingId === excludeAgentId) {
      return;
    }

    throw new DuplicateAgentNameError(name);
  }

  private generateChannelId(name: string): string {
    const normalized = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const base = normalized || "channel";

    let id = base;
    let index = 2;
    while (this.getChannel(id)) {
      id = `${base}-${index}`;
      index += 1;
    }
    return id;
  }

  private assertUniqueChannelName(name: string, excludeChannelId?: string): void {
    const stmt = this.db.prepare(`SELECT id FROM channels WHERE name = ? COLLATE NOCASE LIMIT 1`);
    const row = stmt.get(name) as Record<string, unknown> | undefined;
    if (!row) {
      return;
    }

    const existingId = String(row.id);
    if (excludeChannelId && existingId === excludeChannelId) {
      return;
    }

    throw new DuplicateChannelNameError(name);
  }

  private ensureAgentRoleProfileColumn(): void {
    const columns = this.db.prepare(`PRAGMA table_info(agents)`).all() as Array<Record<string, unknown>>;
    const hasRoleProfile = columns.some((column) => String(column.name) === "role_profile");
    if (!hasRoleProfile) {
      this.db.exec(`ALTER TABLE agents ADD COLUMN role_profile TEXT`);
    }
  }

  private ensureChannelIndexes(): void {
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_channels_created_at ON channels(created_at);
      CREATE INDEX IF NOT EXISTS idx_channel_members_channel_id ON channel_members(channel_id);
      CREATE INDEX IF NOT EXISTS idx_channel_members_agent_id ON channel_members(agent_id);
      CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_id_id ON channel_messages(channel_id, id);
      CREATE INDEX IF NOT EXISTS idx_channel_message_mentions_message_id ON channel_message_mentions(message_id);
      CREATE INDEX IF NOT EXISTS idx_channel_message_mentions_agent_id ON channel_message_mentions(agent_id);
    `);
  }
}
