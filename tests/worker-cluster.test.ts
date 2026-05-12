import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkerCluster } from "../src/control-plane/worker-cluster.js";
import { SandboxLimitError, SandboxNotFoundError } from "../src/sandbox/manager.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("WorkerCluster", () => {
  let cluster: WorkerCluster;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cluster = new WorkerCluster({ authToken: "test-token", staleTimeoutMs: 1000 });
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("registry", () => {
    it("registers a worker and exposes it via listWorkers", () => {
      // Reconcile fires fetch with the list endpoint — return empty.
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { sandboxes: [] }));
      cluster.registerWorker({
        workerId: "w1",
        url: "http://w1:7000",
        active: 0,
        max: 17,
      });
      const workers = cluster.listWorkers();
      expect(workers).toHaveLength(1);
      expect(workers[0]).toMatchObject({
        workerId: "w1",
        url: "http://w1:7000",
        active: 0,
        max: 17,
      });
    });

    it("updateHeartbeat refreshes capacity and timestamp; returns true for known worker", () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { sandboxes: [] }));
      cluster.registerWorker({ workerId: "w1", url: "http://w1:7000", active: 0, max: 17 });
      const ok = cluster.updateHeartbeat("w1", { active: 5, max: 17 });
      expect(ok).toBe(true);
      expect(cluster.listWorkers()[0].active).toBe(5);
    });

    it("updateHeartbeat returns false for unknown worker", () => {
      expect(cluster.updateHeartbeat("ghost", { active: 0, max: 17 })).toBe(false);
    });

    it("evictStale removes workers older than the timeout", () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(jsonResponse(200, { sandboxes: [] }));
      cluster.registerWorker({ workerId: "w1", url: "http://w1:7000", active: 0, max: 17 });
      vi.advanceTimersByTime(2000);
      const evicted = cluster.evictStale();
      expect(evicted).toEqual(["w1"]);
      expect(cluster.listWorkers()).toHaveLength(0);
    });
  });

  describe("pickWorker", () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(jsonResponse(200, { sandboxes: [] }));
    });

    it("returns null when no workers registered", () => {
      expect(cluster.pickWorker()).toBeNull();
    });

    it("returns null when all workers are full", () => {
      cluster.registerWorker({ workerId: "w1", url: "http://w1:7000", active: 17, max: 17 });
      expect(cluster.pickWorker()).toBeNull();
    });

    it("picks the worker with the most free capacity", () => {
      cluster.registerWorker({ workerId: "w1", url: "http://w1:7000", active: 5, max: 17 });
      cluster.registerWorker({ workerId: "w2", url: "http://w2:7000", active: 1, max: 17 });
      cluster.registerWorker({ workerId: "w3", url: "http://w3:7000", active: 10, max: 17 });
      const pick = cluster.pickWorker();
      expect(pick?.workerId).toBe("w2");
    });
  });

  describe("create", () => {
    beforeEach(() => {
      // First call: reconcile-on-register.
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { sandboxes: [] }));
      cluster.registerWorker({ workerId: "w1", url: "http://w1:7000", active: 0, max: 17 });
    });

    it("forwards create to the picked worker and records the mapping", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(201, { sandboxId: "sb-1" }));
      await cluster.create("sb-1", {
        id: "node-22",
        name: "Node 22",
        version: "22",
        rootfsPath: "/x",
        kernelPath: "/y",
        defaultPackages: [],
        buildMeta: {},
      });
      expect(fetchMock).toHaveBeenLastCalledWith(
        "http://w1:7000/sandboxes",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ sandboxId: "sb-1", templateId: "node-22" }),
        }),
      );
      expect(cluster.exists("sb-1")).toBe(true);
      expect(cluster.listWorkers()[0].active).toBe(1); // optimistic increment
    });

    it("throws SandboxLimitError when no worker has capacity", async () => {
      cluster.updateHeartbeat("w1", { active: 17, max: 17 });
      await expect(cluster.create("sb-1", undefined)).rejects.toBeInstanceOf(SandboxLimitError);
    });
  });

  describe("execute", () => {
    beforeEach(async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { sandboxes: [] }));
      cluster.registerWorker({ workerId: "w1", url: "http://w1:7000", active: 0, max: 17 });
      fetchMock.mockResolvedValueOnce(jsonResponse(201, { sandboxId: "sb-1" }));
      await cluster.create("sb-1", undefined);
    });

    it("looks up the worker and forwards the call", async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          stdout: "ok",
          stderr: "",
          exitCode: 0,
          durationMs: 5,
          timedOut: false,
        }),
      );
      const result = await cluster.execute("sb-1", "code", 5000);
      expect(result.stdout).toBe("ok");
      expect(fetchMock).toHaveBeenLastCalledWith(
        "http://w1:7000/sandboxes/sb-1/execute",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("throws SandboxNotFoundError when sandbox is unknown", async () => {
      await expect(cluster.execute("ghost", "code", 5000)).rejects.toBeInstanceOf(SandboxNotFoundError);
    });

    it("translates worker 404 into SandboxNotFoundError", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not found" }));
      await expect(cluster.execute("sb-1", "code", 5000)).rejects.toBeInstanceOf(SandboxNotFoundError);
    });
  });

  describe("destroy", () => {
    beforeEach(async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { sandboxes: [] }));
      cluster.registerWorker({ workerId: "w1", url: "http://w1:7000", active: 0, max: 17 });
      fetchMock.mockResolvedValueOnce(jsonResponse(201, { sandboxId: "sb-1" }));
      await cluster.create("sb-1", undefined);
    });

    it("forwards destroy and drops the mapping", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await cluster.destroy("sb-1");
      expect(cluster.exists("sb-1")).toBe(false);
      expect(cluster.listWorkers()[0].active).toBe(0);
    });

    it("treats worker 404 as success (already gone)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "not found" }));
      await cluster.destroy("sb-1");
      expect(cluster.exists("sb-1")).toBe(false);
    });
  });
});
