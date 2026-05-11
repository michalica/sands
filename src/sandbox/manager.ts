import { v4 as uuidv4 } from "uuid";
import type { SandboxBackend, SandboxInfo, ExecutionResult, SandboxNetworkPolicy, SandboxTemplate } from "./types.js";
import { broadcastEvent } from "../routes/events.js";
import type { SandboxStore } from "../db/store.js";
import { SandboxMetrics } from "../metrics/prometheus.js";

interface RunningSandbox extends SandboxInfo {
  userId: string | null;
  templateId: string;
  networkPolicy: SandboxNetworkPolicy;
}

const DEFAULT_NETWORK_POLICY: SandboxNetworkPolicy = {
  enabled: false,
  allowed: [],
  disallowed: [],
};

export class SandboxManager {
  /** In-memory map of running sandboxes (needed for backend.execute) */
  private running = new Map<string, RunningSandbox>();
  private ttlTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private backend: SandboxBackend,
    private defaultTimeoutMs: number = 5000,
    private ttlMs: number = 300_000,
    private maxSandboxes: number = 0,
    private store?: SandboxStore,
    private metrics: SandboxMetrics = new SandboxMetrics(),
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

  async create(
    userId: string | null = null,
    templateId: string = "node-22",
    networkPolicy: SandboxNetworkPolicy = DEFAULT_NETWORK_POLICY,
  ): Promise<SandboxInfo & { templateId: string; networkPolicy: SandboxNetworkPolicy }> {
    if (this.maxSandboxes > 0 && this.running.size >= this.maxSandboxes) {
      throw new SandboxLimitError(this.maxSandboxes);
    }
    const template = this.store?.getTemplate(templateId) ?? null;
    if ((this.store && !template) || (!this.store && templateId !== "node-22")) {
      throw new UnknownTemplateError(templateId);
    }
    const sandboxId = uuidv4();
    const now = Date.now();
    const info = { sandboxId, templateId, networkPolicy, createdAt: now, lastUsedAt: now };
    const templateLoadStartedAt = performance.now();
    const templateLoadMs = Math.round(performance.now() - templateLoadStartedAt);
    const coldStartStartedAt = performance.now();
    await this.backend.create(sandboxId, template ?? undefined);
    this.metrics.recordSandboxCreated(Math.round(performance.now() - coldStartStartedAt), templateLoadMs);
    this.running.set(sandboxId, { ...info, userId });
    this.store?.createSandbox({ ...info, userId });
    broadcastEvent(userId, { type: "sandbox:created", sandboxId, createdAt: now });
    return info;
  }

  private assertOwner(sandboxId: string, userId: string | null): RunningSandbox {
    const info = this.running.get(sandboxId);
    if (!info) throw new SandboxNotFoundError(sandboxId);
    if (userId !== null && info.userId !== null && info.userId !== userId) {
      throw new SandboxNotFoundError(sandboxId);
    }
    return info;
  }

  async execute(sandboxId: string, code: string, timeoutMs?: number, userId: string | null = null): Promise<ExecutionResult> {
    const info = this.assertOwner(sandboxId, userId);
    const now = Date.now();
    info.lastUsedAt = now;
    this.store?.updateLastUsed(sandboxId, now);

    const result = await this.backend.execute(sandboxId, code, timeoutMs ?? this.defaultTimeoutMs);
    this.metrics.recordExecution(result);

    const executionId = uuidv4();
    const timestamp = Date.now();
    this.store?.appendLog(sandboxId, { executionId, timestamp, code, result });
    broadcastEvent(info.userId, { type: "execution:completed", sandboxId, executionId, code, result });
    return result;
  }

  getLogs(sandboxId: string, userId: string | null = null) {
    if (this.store) {
      const sandbox = this.store.getSandbox(sandboxId);
      if (!sandbox) throw new SandboxNotFoundError(sandboxId);
      if (userId !== null && sandbox.userId !== null && sandbox.userId !== userId) {
        throw new SandboxNotFoundError(sandboxId);
      }
      return this.store.getLogs(sandboxId);
    }
    if (!this.running.has(sandboxId)) {
      throw new SandboxNotFoundError(sandboxId);
    }
    return [];
  }

  async destroy(sandboxId: string, userId: string | null = null): Promise<void> {
    const info = this.assertOwner(sandboxId, userId);
    await this.backend.destroy(sandboxId);
    this.metrics.recordSandboxDestroyed();
    this.running.delete(sandboxId);
    this.store?.markDestroyed(sandboxId, Date.now());
    broadcastEvent(info.userId, { type: "sandbox:destroyed", sandboxId });
  }

  get activeSandboxCount(): number {
    return this.running.size;
  }

  get maxSandboxCount(): number {
    return this.maxSandboxes;
  }

  listTemplates(): SandboxTemplate[] {
    return this.store?.listTemplates() ?? [];
  }

  renderPrometheusMetrics(maxMemoryMb: number): string {
    return this.metrics.renderPrometheus(this.activeSandboxCount, this.maxSandboxCount, maxMemoryMb);
  }

  getMetricsSummary(maxMemoryMb: number, backendType: string, uptimeSeconds: number) {
    return this.metrics.toJSON(
      this.activeSandboxCount,
      this.maxSandboxCount,
      backendType,
      uptimeSeconds,
      maxMemoryMb,
    );
  }

  listSandboxes(status?: "running" | "destroyed" | "all", userId: string | null = null) {
    if (this.store) {
      const filter = status === "all" ? undefined : (status ?? "running");
      const sandboxes = this.store.listSandboxes({
        ...(filter && { status: filter }),
        ...(userId !== null && { userId }),
      });
      return sandboxes.map((s) => ({
        ...s,
        executionCount: this.store!.getExecutionCount(s.sandboxId),
      }));
    }
    // Fallback: in-memory only
    return Array.from(this.running.values())
      .filter((info) => userId === null || info.userId === null || info.userId === userId)
      .map((info) => ({
        ...info,
        status: "running" as const,
        destroyedAt: null,
        executionCount: 0,
      }));
  }

  getSandbox(sandboxId: string, userId: string | null = null) {
    if (this.store) {
      const sandbox = this.store.getSandbox(sandboxId);
      if (!sandbox) throw new SandboxNotFoundError(sandboxId);
      if (userId !== null && sandbox.userId !== null && sandbox.userId !== userId) {
        throw new SandboxNotFoundError(sandboxId);
      }
      const logs = this.store.getLogs(sandboxId);
      return {
        ...sandbox,
        executionCount: logs.length,
        lastExecution: logs.length > 0 ? logs[logs.length - 1] : null,
      };
    }
    const info = this.running.get(sandboxId);
    if (!info) throw new SandboxNotFoundError(sandboxId);
    if (userId !== null && info.userId !== null && info.userId !== userId) {
      throw new SandboxNotFoundError(sandboxId);
    }
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

export class UnknownTemplateError extends Error {
  constructor(templateId: string) {
    super(`Unknown template: ${templateId}`);
    this.name = "UnknownTemplateError";
  }
}
