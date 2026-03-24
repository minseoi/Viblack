import type { DatabaseSync } from "node:sqlite";
import type { ChannelExecutionJob, ChannelExecutionKind, ChannelExecutionStatus } from "../types";

function nowIso(): string {
  return new Date().toISOString();
}

function mapChannelExecutionJob(row: Record<string, unknown>): ChannelExecutionJob {
  return {
    id: Number(row.id),
    channelId: String(row.channel_id),
    triggerMessageId: Number(row.trigger_message_id),
    sourceMessageId: Number(row.source_message_id),
    sourceAgentId: row.source_agent_id ? String(row.source_agent_id) : null,
    targetAgentId: String(row.target_agent_id),
    executionKind: row.execution_kind as ChannelExecutionKind,
    status: row.status as ChannelExecutionStatus,
    depth: Number(row.depth),
    errorText: row.error_text ? String(row.error_text) : null,
    createdAt: String(row.created_at),
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}

export class ChannelExecutionRepository {
  constructor(private readonly db: DatabaseSync) {}

  createExecutionJob(input: {
    channelId: string;
    triggerMessageId: number;
    sourceMessageId: number;
    sourceAgentId: string | null;
    targetAgentId: string;
    executionKind: ChannelExecutionKind;
    depth: number;
  }): ChannelExecutionJob {
    const createdAt = nowIso();
    const stmt = this.db.prepare(
      `INSERT INTO channel_execution_jobs
       (channel_id, trigger_message_id, source_message_id, source_agent_id, target_agent_id, execution_kind, status, depth, error_text, created_at, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, NULL, ?, NULL, NULL)`,
    );
    const result = stmt.run(
      input.channelId,
      input.triggerMessageId,
      input.sourceMessageId,
      input.sourceAgentId,
      input.targetAgentId,
      input.executionKind,
      input.depth,
      createdAt,
    ) as { lastInsertRowid: number | bigint };
    const job = this.getExecutionJob(Number(result.lastInsertRowid));
    if (!job) {
      throw new Error("failed to create channel execution job");
    }
    return job;
  }

  getExecutionJob(jobId: number): ChannelExecutionJob | null {
    const stmt = this.db.prepare(
      `SELECT id, channel_id, trigger_message_id, source_message_id, source_agent_id, target_agent_id, execution_kind, status, depth, error_text, created_at, started_at, finished_at
       FROM channel_execution_jobs
       WHERE id = ?`,
    );
    const row = stmt.get(jobId) as Record<string, unknown> | undefined;
    return row ? mapChannelExecutionJob(row) : null;
  }

  markExecutionJobRunning(jobId: number): ChannelExecutionJob | null {
    const startedAt = nowIso();
    this.db
      .prepare(
        `UPDATE channel_execution_jobs
         SET status = 'running', started_at = ?, finished_at = NULL, error_text = NULL
         WHERE id = ?`,
      )
      .run(startedAt, jobId);
    return this.getExecutionJob(jobId);
  }

  markExecutionJobFinished(
    jobId: number,
    status: Extract<ChannelExecutionStatus, "succeeded" | "failed" | "skipped">,
    errorText?: string | null,
  ): ChannelExecutionJob | null {
    const finishedAt = nowIso();
    this.db
      .prepare(
        `UPDATE channel_execution_jobs
         SET status = ?, error_text = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(status, errorText ?? null, finishedAt, jobId);
    return this.getExecutionJob(jobId);
  }

  listChannelExecutionJobs(channelId: string, afterJobId?: number): ChannelExecutionJob[] {
    const hasAfter = typeof afterJobId === "number" && Number.isFinite(afterJobId);
    const stmt = this.db.prepare(
      hasAfter
        ? `SELECT id, channel_id, trigger_message_id, source_message_id, source_agent_id, target_agent_id, execution_kind, status, depth, error_text, created_at, started_at, finished_at
           FROM channel_execution_jobs
           WHERE channel_id = ? AND id > ?
           ORDER BY id ASC`
        : `SELECT id, channel_id, trigger_message_id, source_message_id, source_agent_id, target_agent_id, execution_kind, status, depth, error_text, created_at, started_at, finished_at
           FROM channel_execution_jobs
           WHERE channel_id = ?
           ORDER BY id ASC`,
    );
    const rows = hasAfter
      ? (stmt.all(channelId, Math.max(0, Math.trunc(afterJobId ?? 0))) as Array<Record<string, unknown>>)
      : (stmt.all(channelId) as Array<Record<string, unknown>>);
    return rows.map(mapChannelExecutionJob);
  }
}

