import type { DatabaseSync } from "node:sqlite";
import type { AppSetting } from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

function mapAppSetting(row: Record<string, unknown>): AppSetting {
  return {
    key: String(row.key),
    value: String(row.value),
    updatedAt: String(row.updated_at),
  };
}

export class AppSettingsRepository {
  constructor(private readonly db: DatabaseSync) {}

  getSetting(key: string): AppSetting | null {
    const row = this.db
      .prepare(
        `SELECT key, value, updated_at
         FROM app_settings
         WHERE key = ?`,
      )
      .get(key) as Record<string, unknown> | undefined;
    return row ? mapAppSetting(row) : null;
  }

  setSetting(key: string, value: string): AppSetting {
    const updatedAt = nowIso();
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key)
         DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, value, updatedAt);
    const setting = this.getSetting(key);
    if (!setting) {
      throw new Error("failed to persist app setting");
    }
    return setting;
  }

  deleteSetting(key: string): boolean {
    const result = this.db.prepare(`DELETE FROM app_settings WHERE key = ?`).run(key) as {
      changes?: number;
    };
    return Boolean(result.changes && result.changes > 0);
  }
}
