import { v4 as uuidv4 } from "uuid";
import type { SandboxBackend, SandboxInfo, ExecutionResult } from "./types.js";

export class SandboxManager {
  private sandboxes = new Map<string, SandboxInfo>();
  private ttlTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private backend: SandboxBackend,
    private defaultTimeoutMs: number = 5000,
    private ttlMs: number = 300_000, // 5 minutes
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
    return this.backend.execute(sandboxId, code, timeoutMs ?? this.defaultTimeoutMs);
  }

  async destroy(sandboxId: string): Promise<void> {
    if (!this.sandboxes.has(sandboxId)) {
      throw new SandboxNotFoundError(sandboxId);
    }
    await this.backend.destroy(sandboxId);
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
