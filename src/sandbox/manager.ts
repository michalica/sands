import { v4 as uuidv4 } from "uuid";
import type { SandboxBackend, SandboxInfo, ExecutionResult } from "./types.js";
import { broadcastEvent } from "../routes/events.js";
import type { SandboxStore } from "../db/store.js";

export class SandboxManager {
  /** In-memory map of running sandboxes (needed for backend.execute) */
  private running = new Map<string, SandboxInfo>();
  private ttlTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private backend: SandboxBackend,
    private defaultTimeoutMs: number = 5000,
    private ttlMs: number = 300_000,
    private maxSandboxes: number = 0,
    private store?: SandboxStore,
  ) {}

  startTtlCleanup(intervalMs: number = 30_000): void {
    this.ttlTimer = setInterval(() => this.evictExpired(), intervalMs);
  }

  stopTtlCleanup(): void {
    if (this.ttlTimer) {
      clearInterval(this.ttlTimer);
      this.ttlTimer = null;
    }
  }

  async create(): Promise<SandboxInfo> {
    if (this.maxSandboxes > 0 && this.running.size >= this.maxSandboxes) {
      throw new SandboxLimitError(this.maxSandboxes);
    }
    const sandboxId = uuidv4();
    const now = Date.now();
    const info: SandboxInfo = { sandboxId, createdAt: now, lastUsedAt: now };
    await this.backend.create(sandboxId);
    this.running.set(sandboxId, info);
    this.store?.createSandbox(info);
    broadcastEvent({ type: "sandbox:created", sandboxId, createdAt: now });
    return info;
  }

  async execute(sandboxId: string, code: string, timeoutMs?: number): Promise<ExecutionResult> {
    const info = this.running.get(sandboxId);
    if (!info) {
      throw new SandboxNotFoundError(sandboxId);
    }
    const now = Date.now();
    info.lastUsedAt = now;
    this.store?.updateLastUsed(sandboxId, now);

    const result = await this.backend.execute(sandboxId, code, timeoutMs ?? this.defaultTimeoutMs);

    const executionId = uuidv4();
    const timestamp = Date.now();
    this.store?.appendLog(sandboxId, { executionId, timestamp, code, result });
    broadcastEvent({ type: "execution:completed", sandboxId, executionId, code, result });
    return result;
  }

  getLogs(sandboxId: string) {
    // Read from store (works for destroyed sandboxes too)
    if (this.store) {
      const sandbox = this.store.getSandbox(sandboxId);
      if (!sandbox) throw new SandboxNotFoundError(sandboxId);
      return this.store.getLogs(sandboxId);
    }
    // Fallback: in-memory only (running sandboxes)
    if (!this.running.has(sandboxId)) {
      throw new SandboxNotFoundError(sandboxId);
    }
    return [];
  }

  async destroy(sandboxId: string): Promise<void> {
    if (!this.running.has(sandboxId)) {
      throw new SandboxNotFoundError(sandboxId);
    }
    await this.backend.destroy(sandboxId);
    this.running.delete(sandboxId);
    this.store?.markDestroyed(sandboxId, Date.now());
    broadcastEvent({ type: "sandbox:destroyed", sandboxId });
  }

  get activeSandboxCount(): number {
    return this.running.size;
  }

  get maxSandboxCount(): number {
    return this.maxSandboxes;
  }

  listSandboxes(status?: "running" | "destroyed" | "all") {
    if (this.store) {
      const filter = status === "all" ? undefined : (status ?? "running");
      const sandboxes = filter ? this.store.listSandboxes(filter) : this.store.listSandboxes();
      return sandboxes.map((s) => ({
        ...s,
        executionCount: this.store!.getExecutionCount(s.sandboxId),
      }));
    }
    // Fallback: in-memory only
    return Array.from(this.running.values()).map((info) => ({
      ...info,
      status: "running" as const,
      destroyedAt: null,
      executionCount: 0,
    }));
  }

  getSandbox(sandboxId: string) {
    if (this.store) {
      const sandbox = this.store.getSandbox(sandboxId);
      if (!sandbox) throw new SandboxNotFoundError(sandboxId);
      const logs = this.store.getLogs(sandboxId);
      return {
        ...sandbox,
        executionCount: logs.length,
        lastExecution: logs.length > 0 ? logs[logs.length - 1] : null,
      };
    }
    // Fallback
    const info = this.running.get(sandboxId);
    if (!info) throw new SandboxNotFoundError(sandboxId);
    return { ...info, status: "running" as const, destroyedAt: null, executionCount: 0, lastExecution: null };
  }

  private async evictExpired(): Promise<void> {
    const now = Date.now();
    for (const [id, info] of this.running) {
      if (now - info.lastUsedAt > this.ttlMs) {
        await this.backend.destroy(id).catch(() => {});
        this.running.delete(id);
        this.store?.markDestroyed(id, now);
      }
    }
  }
}

export class SandboxNotFoundError extends Error {
  constructor(sandboxId: string) {
    super(`Sandbox not found: ${sandboxId}`);
    this.name = "SandboxNotFoundError";
  }
}

export class SandboxLimitError extends Error {
  constructor(max: number) {
    super(`Sandbox limit reached: maximum ${max} concurrent sandboxes`);
    this.name = "SandboxLimitError";
  }
}
