import { eq, and, lt, sql } from "drizzle-orm";
import { sandboxes, executionLogs } from "./schema.js";
import type { Db } from "./index.js";
import type { ExecutionResult } from "../sandbox/types.js";

export interface SandboxRecord {
  sandboxId: string;
  createdAt: number;
  lastUsedAt: number;
  status: "running" | "destroyed";
  destroyedAt: number | null;
}

export interface LogRecord {
  executionId: string;
  sandboxId: string;
  timestamp: number;
  code: string;
  result: ExecutionResult;
}

export class SandboxStore {
  constructor(private db: Db) {}

  createSandbox(info: { sandboxId: string; createdAt: number; lastUsedAt: number }): void {
    this.db.insert(sandboxes).values({
      sandboxId: info.sandboxId,
      createdAt: info.createdAt,
      lastUsedAt: info.lastUsedAt,
      status: "running",
    }).run();
  }

  getSandbox(sandboxId: string): SandboxRecord | null {
    const rows = this.db.select().from(sandboxes).where(eq(sandboxes.sandboxId, sandboxId)).all();
    if (rows.length === 0) return null;
    return rows[0] as SandboxRecord;
  }

  updateLastUsed(sandboxId: string, timestamp: number): void {
    this.db.update(sandboxes)
      .set({ lastUsedAt: timestamp })
      .where(eq(sandboxes.sandboxId, sandboxId))
      .run();
  }

  markDestroyed(sandboxId: string, timestamp: number): void {
    this.db.update(sandboxes)
      .set({ status: "destroyed", destroyedAt: timestamp })
      .where(eq(sandboxes.sandboxId, sandboxId))
      .run();
  }

  listSandboxes(status?: "running" | "destroyed"): SandboxRecord[] {
    if (status) {
      return this.db.select().from(sandboxes)
        .where(eq(sandboxes.status, status))
        .all() as SandboxRecord[];
    }
    return this.db.select().from(sandboxes).all() as SandboxRecord[];
  }

  getExpired(ttlMs: number, now: number): SandboxRecord[] {
    const cutoff = now - ttlMs;
    return this.db.select().from(sandboxes)
      .where(and(eq(sandboxes.status, "running"), lt(sandboxes.lastUsedAt, cutoff)))
      .all() as SandboxRecord[];
  }

  appendLog(sandboxId: string, entry: {
    executionId: string;
    timestamp: number;
    code: string;
    result: ExecutionResult;
  }): void {
    this.db.insert(executionLogs).values({
      executionId: entry.executionId,
      sandboxId,
      timestamp: entry.timestamp,
      code: entry.code,
      result: JSON.stringify(entry.result),
    }).run();
  }

  getLogs(sandboxId: string): LogRecord[] {
    const rows = this.db.select().from(executionLogs)
      .where(eq(executionLogs.sandboxId, sandboxId))
      .orderBy(executionLogs.timestamp)
      .all();

    return rows.map((row) => ({
      executionId: row.executionId,
      sandboxId: row.sandboxId,
      timestamp: row.timestamp,
      code: row.code,
      result: JSON.parse(row.result) as ExecutionResult,
    }));
  }

  getExecutionCount(sandboxId: string): number {
    const rows = this.db.select({ count: sql<number>`count(*)` })
      .from(executionLogs)
      .where(eq(executionLogs.sandboxId, sandboxId))
      .all();
    return rows[0]?.count ?? 0;
  }
}
