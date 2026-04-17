import { v4 as uuidv4 } from "uuid";
import type { SandboxBackend, SandboxInfo, ExecutionResult } from "./types.js";
import { ExecutionLog } from "./execution-log.js";

export class SandboxManager {
  private sandboxes = new Map<string, SandboxInfo>();
  private ttlTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private backend: SandboxBackend,
    private defaultTimeoutMs: number = 5000,
    private ttlMs: number = 300_000, // 5 minutes
    private executionLog: ExecutionLog = new ExecutionLog(),
    private maxSandboxes: number = 0, // 0 = unlimited
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
    if (this.maxSandboxes > 0 && this.sandboxes.size >= this.maxSandboxes) {
      throw new SandboxLimitError(this.maxSandboxes);
    }
    const sandboxId = uuidv4();
    const now = Date.now();
    const info: SandboxInfo = { sandboxId, createdAt: now, lastUsedAt: now };
    await this.backend.create(sandboxId);
    this.sandboxes.set(sandboxId, info);
    return info;
  }

  async execute(sandboxId: string, code: string, timeoutMs?: number): Promise<ExecutionResult> {
    const info = this.sandboxes.get(sandboxId);
    if (!info) {
      throw new SandboxNotFoundError(sandboxId);
    }
    info.lastUsedAt = Date.now();
    const result = await this.backend.execute(sandboxId, code, timeoutMs ?? this.defaultTimeoutMs);
    this.executionLog.append(sandboxId, { code, result });
    return result;
  }

  getLogs(sandboxId: string) {
    if (!this.sandboxes.has(sandboxId)) {
      throw new SandboxNotFoundError(sandboxId);
    }
    return this.executionLog.get(sandboxId);
  }

  async destroy(sandboxId: string): Promise<void> {
    if (!this.sandboxes.has(sandboxId)) {
      throw new SandboxNotFoundError(sandboxId);
    }
    await this.backend.destroy(sandboxId);
    this.executionLog.clear(sandboxId);
    this.sandboxes.delete(sandboxId);
  }

  get activeSandboxCount(): number {
    return this.sandboxes.size;
  }

  private async evictExpired(): Promise<void> {
    const now = Date.now();
    for (const [id, info] of this.sandboxes) {
      if (now - info.lastUsedAt > this.ttlMs) {
        await this.backend.destroy(id).catch(() => {});
        this.sandboxes.delete(id);
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
