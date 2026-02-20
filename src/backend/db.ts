import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Agent, ChatMessage, SenderType } from "./types";

const HELPER_AGENT_ID = "helper";

function nowIso(): string {
  return new Date().toISOString();
}

export class ViblackDb {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.bootstrap();
  }

  close(): void {
    this.db.close();
  }

  listAgents(): Agent[] {
    const stmt = this.db.prepare(
      `SELECT id, name, role, system_prompt, session_id, created_at
       FROM agents ORDER BY created_at ASC`,
    );
    const rows = stmt.all() as Array<Record<string, unknown>>;
    return rows.map(this.mapAgent);
  }

  getAgent(agentId: string): Agent | null {
    const stmt = this.db.prepare(
      `SELECT id, name, role, system_prompt, session_id, created_at
       FROM agents WHERE id = ?`,
    );
    const row = stmt.get(agentId) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return this.mapAgent(row);
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

  private bootstrap(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
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
    `);

    const existsStmt = this.db.prepare(`SELECT id FROM agents WHERE id = ?`);
    const helper = existsStmt.get(HELPER_AGENT_ID) as Record<string, unknown> | undefined;
    if (!helper) {
      const createdAt = nowIso();
      const insertStmt = this.db.prepare(
        `INSERT INTO agents (id, name, role, system_prompt, session_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      insertStmt.run(
        HELPER_AGENT_ID,
        "Helper",
        "General assistant",
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
      systemPrompt: String(row.system_prompt),
      sessionId: row.session_id ? String(row.session_id) : null,
      createdAt: String(row.created_at),
    };
  }
}
