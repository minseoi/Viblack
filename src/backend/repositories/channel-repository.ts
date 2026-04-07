import type { DatabaseSync } from "node:sqlite";
import { DuplicateChannelNameError, DuplicateChannelWorkspaceError } from "../db";
import type { Channel } from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

function mapChannel(row: Record<string, unknown>): Channel {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    workspacePath: String(row.workspace_path ?? ""),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
    createdAt: String(row.created_at),
  };
}

export class ChannelRepository {
  constructor(private readonly db: DatabaseSync) {}

  listChannels(includeArchived = false): Channel[] {
    const stmt = this.db.prepare(
      `SELECT id, name, description, workspace_path, archived_at, created_at
       FROM channels
       WHERE (? = 1 OR archived_at IS NULL)
       ORDER BY created_at ASC`,
    );
    const rows = stmt.all(includeArchived ? 1 : 0) as Array<Record<string, unknown>>;
    return rows.map(mapChannel);
  }

  getChannel(channelId: string): Channel | null {
    const stmt = this.db.prepare(
      `SELECT id, name, description, workspace_path, archived_at, created_at
       FROM channels WHERE id = ?`,
    );
    const row = stmt.get(channelId) as Record<string, unknown> | undefined;
    return row ? mapChannel(row) : null;
  }

  createChannel(name: string, description: string, workspacePath: string): Channel {
    this.assertUniqueChannelName(name);
    this.assertUniqueChannelWorkspacePath(workspacePath);
    const id = this.generateChannelId(name);
    const createdAt = nowIso();
    const stmt = this.db.prepare(
      `INSERT INTO channels (id, name, description, workspace_path, archived_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(id, name, description, workspacePath, null, createdAt);
    const channel = this.getChannel(id);
    if (!channel) {
      throw new Error("failed to create channel");
    }
    return channel;
  }

  updateChannel(channelId: string, name: string, description: string, workspacePath: string): Channel | null {
    this.assertUniqueChannelName(name, channelId);
    this.assertUniqueChannelWorkspacePath(workspacePath, channelId);
    const stmt = this.db.prepare(
      `UPDATE channels
       SET name = ?, description = ?, workspace_path = ?
       WHERE id = ?`,
    );
    const result = stmt.run(name, description, workspacePath, channelId) as { changes?: number };
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
    const stmt = this.db.prepare(
      `SELECT id
       FROM channels
       WHERE archived_at IS NULL
         AND name = ? COLLATE NOCASE
       LIMIT 1`,
    );
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

  private assertUniqueChannelWorkspacePath(workspacePath: string, excludeChannelId?: string): void {
    const stmt = this.db.prepare(
      `SELECT id
       FROM channels
       WHERE archived_at IS NULL
         AND workspace_path = ?
       LIMIT 1`,
    );
    const row = stmt.get(workspacePath) as Record<string, unknown> | undefined;
    if (!row) {
      return;
    }

    const existingId = String(row.id);
    if (excludeChannelId && existingId === excludeChannelId) {
      return;
    }

    throw new DuplicateChannelWorkspaceError(workspacePath);
  }
}
