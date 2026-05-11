import { eq, and, lt, sql } from "drizzle-orm";
import { sandboxes, executionLogs, templates } from "./schema.js";
import type { Db } from "./index.js";
import type { ExecutionResult, SandboxNetworkPolicy, SandboxTemplate } from "../sandbox/types.js";

export interface SandboxRecord {
  sandboxId: string;
  userId: string | null;
  templateId: string;
  networkPolicy: SandboxNetworkPolicy;
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

interface TemplateRow {
  id: string;
  name: string;
  version: string;
  rootfsPath: string;
  kernelPath: string;
  defaultPackages: string;
  buildMeta: string;
}

export class SandboxStore {
  constructor(private db: Db) {}

  createSandbox(info: {
    sandboxId: string;
    userId?: string | null;
    templateId: string;
    networkPolicy: SandboxNetworkPolicy;
    createdAt: number;
    lastUsedAt: number;
  }): void {
    this.db.insert(sandboxes).values({
      sandboxId: info.sandboxId,
      userId: info.userId ?? null,
      templateId: info.templateId,
      networkPolicy: JSON.stringify(info.networkPolicy),
      createdAt: info.createdAt,
      lastUsedAt: info.lastUsedAt,
      status: "running",
    }).run();
  }

  getSandbox(sandboxId: string): SandboxRecord | null {
    const rows = this.db.select().from(sandboxes).where(eq(sandboxes.sandboxId, sandboxId)).all();
    if (rows.length === 0) return null;
    const row = rows[0] as typeof rows[0] & { networkPolicy: string };
    return {
      ...row,
      networkPolicy: JSON.parse(row.networkPolicy) as SandboxNetworkPolicy,
    } as SandboxRecord;
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

  listSandboxes(opts?: { status?: "running" | "destroyed"; userId?: string }): SandboxRecord[] {
    const conditions = [];
    if (opts?.status) conditions.push(eq(sandboxes.status, opts.status));
    if (opts?.userId) conditions.push(eq(sandboxes.userId, opts.userId));
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const query = where
      ? this.db.select().from(sandboxes).where(where)
      : this.db.select().from(sandboxes);
    return (query.all() as Array<typeof sandboxes.$inferSelect & { networkPolicy: string }>).map((row) => ({
      ...row,
      networkPolicy: JSON.parse(row.networkPolicy) as SandboxNetworkPolicy,
    })) as SandboxRecord[];
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

  listTemplates(): SandboxTemplate[] {
    const rows = this.db.select().from(templates).all() as TemplateRow[];
    return rows.map((row) => this.mapTemplate(row));
  }

  getTemplate(id: string): SandboxTemplate | null {
    const rows = this.db.select().from(templates).where(eq(templates.id, id)).all() as TemplateRow[];
    if (rows.length === 0) return null;
    return this.mapTemplate(rows[0]);
  }

  private mapTemplate(row: TemplateRow): SandboxTemplate {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      rootfsPath: row.rootfsPath,
      kernelPath: row.kernelPath,
      defaultPackages: JSON.parse(row.defaultPackages) as string[],
      buildMeta: JSON.parse(row.buildMeta) as Record<string, unknown>,
    };
  }
}
