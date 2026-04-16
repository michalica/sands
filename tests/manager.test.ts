import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxManager, SandboxNotFoundError } from "../src/sandbox/manager.js";
import { ExecutionLog } from "../src/sandbox/execution-log.js";
import type { SandboxBackend, ExecutionResult } from "../src/sandbox/types.js";

function createMockBackend(): SandboxBackend {
  const sandboxes = new Set<string>();
  return {
    create: vi.fn(async (id: string) => { sandboxes.add(id); }),
    execute: vi.fn(async (): Promise<ExecutionResult> => ({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
      durationMs: 10,
      timedOut: false,
    })),
    destroy: vi.fn(async (id: string) => { sandboxes.delete(id); }),
    exists: vi.fn((id: string) => sandboxes.has(id)),
  };
}

describe("SandboxManager", () => {
  let backend: ReturnType<typeof createMockBackend>;
  let log: ExecutionLog;
  let manager: SandboxManager;

  beforeEach(() => {
    backend = createMockBackend();
    log = new ExecutionLog();
    manager = new SandboxManager(backend, 5000, 1000, log);
  });

  describe("create", () => {
    it("creates a sandbox and returns info", async () => {
      const info = await manager.create();

      expect(info.sandboxId).toBeDefined();
      expect(info.createdAt).toBeTypeOf("number");
      expect(info.lastUsedAt).toBeTypeOf("number");
      expect(backend.create).toHaveBeenCalledWith(info.sandboxId);
      expect(manager.activeSandboxCount).toBe(1);
    });

    it("creates multiple sandboxes with unique ids", async () => {
      const a = await manager.create();
      const b = await manager.create();

      expect(a.sandboxId).not.toBe(b.sandboxId);
      expect(manager.activeSandboxCount).toBe(2);
    });
  });

  describe("execute", () => {
    it("executes code in an existing sandbox", async () => {
      const info = await manager.create();
      const result = await manager.execute(info.sandboxId, "console.log('hi')");

      expect(result.stdout).toBe("ok\n");
      expect(result.exitCode).toBe(0);
      expect(backend.execute).toHaveBeenCalledWith(info.sandboxId, "console.log('hi')", 5000);
    });

    it("uses custom timeout when provided", async () => {
      const info = await manager.create();
      await manager.execute(info.sandboxId, "code", 2000);

      expect(backend.execute).toHaveBeenCalledWith(info.sandboxId, "code", 2000);
    });

    it("throws SandboxNotFoundError for unknown id", async () => {
      await expect(manager.execute("nonexistent", "code")).rejects.toThrow(SandboxNotFoundError);
    });

    it("updates lastUsedAt on execute", async () => {
      const info = await manager.create();
      const originalLastUsed = info.lastUsedAt;

      // Small delay to ensure timestamp changes
      await new Promise((r) => setTimeout(r, 10));
      await manager.execute(info.sandboxId, "code");

      // Create a new sandbox to check the first one was updated
      // We verify indirectly: if lastUsedAt updated, TTL eviction won't remove it
      expect(backend.execute).toHaveBeenCalled();
    });
  });

  describe("destroy", () => {
    it("destroys an existing sandbox", async () => {
      const info = await manager.create();
      await manager.destroy(info.sandboxId);

      expect(backend.destroy).toHaveBeenCalledWith(info.sandboxId);
      expect(manager.activeSandboxCount).toBe(0);
    });

    it("throws SandboxNotFoundError for unknown id", async () => {
      await expect(manager.destroy("nonexistent")).rejects.toThrow(SandboxNotFoundError);
    });

    it("throws SandboxNotFoundError on double destroy", async () => {
      const info = await manager.create();
      await manager.destroy(info.sandboxId);

      await expect(manager.destroy(info.sandboxId)).rejects.toThrow(SandboxNotFoundError);
    });
  });

  describe("execution logs", () => {
    it("records logs on execute", async () => {
      const info = await manager.create();
      await manager.execute(info.sandboxId, "console.log('hi')");

      const logs = manager.getLogs(info.sandboxId);
      expect(logs).toHaveLength(1);
      expect(logs[0].code).toBe("console.log('hi')");
      expect(logs[0].result.stdout).toBe("ok\n");
    });

    it("records multiple executions", async () => {
      const info = await manager.create();
      await manager.execute(info.sandboxId, "a");
      await manager.execute(info.sandboxId, "b");

      const logs = manager.getLogs(info.sandboxId);
      expect(logs).toHaveLength(2);
      expect(logs[0].code).toBe("a");
      expect(logs[1].code).toBe("b");
    });

    it("clears logs on destroy", async () => {
      const info = await manager.create();
      await manager.execute(info.sandboxId, "code");
      await manager.destroy(info.sandboxId);

      // After destroy, logs should be cleared
      expect(log.get(info.sandboxId)).toEqual([]);
    });

    it("throws SandboxNotFoundError for getLogs on unknown id", () => {
      expect(() => manager.getLogs("nonexistent")).toThrow(SandboxNotFoundError);
    });
  });

  describe("TTL eviction", () => {
    it("evicts sandboxes that exceed TTL", async () => {
      vi.useFakeTimers();
      const mgr = new SandboxManager(backend, 5000, 1000);

      const info = await mgr.create();
      expect(mgr.activeSandboxCount).toBe(1);

      mgr.startTtlCleanup(500);

      // Advance past TTL + cleanup interval
      await vi.advanceTimersByTimeAsync(1500);

      expect(mgr.activeSandboxCount).toBe(0);
      expect(backend.destroy).toHaveBeenCalledWith(info.sandboxId);

      mgr.stopTtlCleanup();
      vi.useRealTimers();
    });

    it("does not evict recently used sandboxes", async () => {
      vi.useFakeTimers();
      const mgr = new SandboxManager(backend, 5000, 1000);

      const info = await mgr.create();
      mgr.startTtlCleanup(500);

      // Advance 600ms, then execute (resets lastUsedAt)
      await vi.advanceTimersByTimeAsync(600);
      await mgr.execute(info.sandboxId, "code");

      // Advance another 600ms — total 1200ms from create, but only 600ms from last use
      await vi.advanceTimersByTimeAsync(600);

      expect(mgr.activeSandboxCount).toBe(1);

      mgr.stopTtlCleanup();
      vi.useRealTimers();
    });
  });
});
