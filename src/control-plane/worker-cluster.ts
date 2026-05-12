import type {
  SandboxBackend,
  ExecutionResult,
  SandboxTemplate,
} from "../sandbox/types.js";
import { SandboxLimitError, SandboxNotFoundError } from "../sandbox/manager.js";

export interface WorkerInfo {
  workerId: string;
  url: string;
  active: number;
  max: number;
  lastHeartbeatAt: number;
}

interface WorkerRegistration {
  workerId: string;
  url: string;
  active: number;
  max: number;
}

interface WorkerHeartbeat {
  active: number;
  max: number;
}

/**
 * The control plane's view of the worker fleet.
 *
 * Plays two roles:
 *   1. Worker registry — register / heartbeat / evict-stale / pick.
 *   2. SandboxBackend adapter — implements create/execute/destroy by
 *      forwarding to whichever worker owns the sandbox.
 *
 * Sandbox→worker mapping is in-memory (kept simple at v1). On control-plane
 * restart we rebuild the map by querying each worker's GET /sandboxes;
 * orphans on the worker side age out via the worker's own TTL.
 */
export class WorkerCluster implements SandboxBackend {
  private workers = new Map<string, WorkerInfo>();
  private sandboxToWorker = new Map<string, string>();

  private readonly authToken: string;
  private readonly staleTimeoutMs: number;

  constructor(opts: { authToken: string; staleTimeoutMs?: number }) {
    this.authToken = opts.authToken;
    this.staleTimeoutMs = opts.staleTimeoutMs ?? 30_000;
  }

  // ---------- Registry ----------

  registerWorker(reg: WorkerRegistration): void {
    this.workers.set(reg.workerId, {
      workerId: reg.workerId,
      url: reg.url,
      active: reg.active,
      max: reg.max,
      lastHeartbeatAt: Date.now(),
    });
    // Reconcile asynchronously so we learn about sandboxes that already exist
    // on this worker (after a control-plane restart).
    this.reconcileWorker(reg.workerId).catch(() => {});
  }

  updateHeartbeat(workerId: string, beat: WorkerHeartbeat): boolean {
    const worker = this.workers.get(workerId);
    if (!worker) return false;
    worker.active = beat.active;
    worker.max = beat.max;
    worker.lastHeartbeatAt = Date.now();
    return true;
  }

  evictStale(): string[] {
    const now = Date.now();
    const evicted: string[] = [];
    for (const [id, worker] of this.workers) {
      if (now - worker.lastHeartbeatAt > this.staleTimeoutMs) {
        this.workers.delete(id);
        for (const [sandboxId, ownerWorkerId] of this.sandboxToWorker) {
          if (ownerWorkerId === id) this.sandboxToWorker.delete(sandboxId);
        }
        evicted.push(id);
      }
    }
    return evicted;
  }

  listWorkers(): WorkerInfo[] {
    return Array.from(this.workers.values());
  }

  /** Pick the worker with the most free capacity. Null if none has any. */
  pickWorker(): WorkerInfo | null {
    let best: WorkerInfo | null = null;
    let bestFree = 0;
    for (const worker of this.workers.values()) {
      const free = worker.max - worker.active;
      if (free > bestFree) {
        bestFree = free;
        best = worker;
      }
    }
    return best;
  }

  // ---------- SandboxBackend ----------

  exists(sandboxId: string): boolean {
    return this.sandboxToWorker.has(sandboxId);
  }

  async create(sandboxId: string, template?: SandboxTemplate): Promise<void> {
    const worker = this.pickWorker();
    if (!worker) throw new SandboxLimitError(this.totalCapacity());

    const res = await this.fetchWorker(worker, "POST", "/sandboxes", {
      sandboxId,
      templateId: template?.id,
    });
    if (!res.ok) {
      throw new Error(`worker ${worker.workerId}: ${res.status} ${await res.text()}`);
    }

    this.sandboxToWorker.set(sandboxId, worker.workerId);
    worker.active += 1; // optimistic — heartbeat will correct this
  }

  async execute(
    sandboxId: string,
    code: string,
    timeoutMs: number,
  ): Promise<ExecutionResult> {
    const worker = this.workerFor(sandboxId);
    const res = await this.fetchWorker(worker, "POST", `/sandboxes/${sandboxId}/execute`, {
      code,
      timeoutMs,
    });
    if (res.status === 404) throw new SandboxNotFoundError(sandboxId);
    if (!res.ok) throw new Error(`worker ${worker.workerId}: ${res.status} ${await res.text()}`);
    return (await res.json()) as ExecutionResult;
  }

  async destroy(sandboxId: string): Promise<void> {
    const worker = this.workerFor(sandboxId);
    const res = await this.fetchWorker(worker, "DELETE", `/sandboxes/${sandboxId}`);
    // 404 also counts as "successfully gone" for destroy.
    if (!res.ok && res.status !== 404) {
      throw new Error(`worker ${worker.workerId}: ${res.status} ${await res.text()}`);
    }
    this.sandboxToWorker.delete(sandboxId);
    worker.active = Math.max(0, worker.active - 1);
  }

  // ---------- Internals ----------

  private workerFor(sandboxId: string): WorkerInfo {
    const workerId = this.sandboxToWorker.get(sandboxId);
    if (!workerId) throw new SandboxNotFoundError(sandboxId);
    const worker = this.workers.get(workerId);
    if (!worker) throw new SandboxNotFoundError(sandboxId);
    return worker;
  }

  private async fetchWorker(
    worker: WorkerInfo,
    method: "POST" | "DELETE" | "GET",
    path: string,
    body?: object,
  ): Promise<Response> {
    return fetch(`${worker.url}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.authToken}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  private async reconcileWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    try {
      const res = await this.fetchWorker(worker, "GET", "/sandboxes");
      if (!res.ok) return;
      const data = (await res.json()) as { sandboxes: Array<{ sandboxId: string }> };
      for (const s of data.sandboxes) {
        this.sandboxToWorker.set(s.sandboxId, workerId);
      }
    } catch {
      // Best effort; if the worker isn't reachable now, the next heartbeat
      // cycle will trigger another reconcile path.
    }
  }

  private totalCapacity(): number {
    let total = 0;
    for (const w of this.workers.values()) total += w.max;
    return total;
  }
}
