import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { SandboxManager } from "../src/sandbox/manager.js";
import { SandboxStore } from "../src/db/store.js";
import { createDb } from "../src/db/index.js";
import { ProcessBackend } from "../src/sandbox/process-backend.js";
import { sandboxRoutes } from "../src/routes/sandboxes.js";

describe("API routes", () => {
  const app = Fastify();
  const backend = new ProcessBackend();
  const db = createDb(":memory:");
  const store = new SandboxStore(db);
  const manager = new SandboxManager(backend, 5000, 300_000, 0, store);

  beforeAll(async () => {
    app.get("/health", async () => ({ status: "ok", activeSandboxes: manager.activeSandboxCount }));
    await sandboxRoutes(app, manager);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("GET /health", () => {
    it("returns ok", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok", activeSandboxes: expect.any(Number) });
    });
  });

  describe("POST /sandboxes", () => {
    it("creates a sandbox and returns 201", async () => {
      const res = await app.inject({ method: "POST", url: "/sandboxes" });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.sandboxId).toBeDefined();
      expect(typeof body.sandboxId).toBe("string");

      // cleanup
      await manager.destroy(body.sandboxId);
    });

    it("accepts a template when creating a sandbox", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/sandboxes",
        payload: { template: "python-3.12" },
      });

      expect(res.statusCode).toBe(201);
      await manager.destroy(res.json().sandboxId);
    });

    it("rejects unknown templates", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/sandboxes",
        payload: { template: "missing-template" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "Unknown template: missing-template" });
    });
  });

  describe("POST /sandboxes/:id/execute", () => {
    it("executes code and returns structured result", async () => {
      const create = await app.inject({ method: "POST", url: "/sandboxes" });
      const { sandboxId } = create.json();

      const res = await app.inject({
        method: "POST",
        url: `/sandboxes/${sandboxId}/execute`,
        payload: { code: "console.log(1 + 2)" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.stdout).toBe("3\n");
      expect(body.stderr).toBe("");
      expect(body.exitCode).toBe(0);
      expect(body.durationMs).toBeTypeOf("number");
      expect(body.timedOut).toBe(false);

      await manager.destroy(sandboxId);
    });

    it("returns 404 for nonexistent sandbox", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/sandboxes/nonexistent/execute",
        payload: { code: "1" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Sandbox not found" });
    });

    it("returns 400 when code is missing", async () => {
      const create = await app.inject({ method: "POST", url: "/sandboxes" });
      const { sandboxId } = create.json();

      const res = await app.inject({
        method: "POST",
        url: `/sandboxes/${sandboxId}/execute`,
        payload: {},
      });

      expect(res.statusCode).toBe(400);

      await manager.destroy(sandboxId);
    });

    it("respects custom timeoutMs", async () => {
      const create = await app.inject({ method: "POST", url: "/sandboxes" });
      const { sandboxId } = create.json();

      const res = await app.inject({
        method: "POST",
        url: `/sandboxes/${sandboxId}/execute`,
        payload: { code: "while(true){}", timeoutMs: 500 },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().timedOut).toBe(true);

      await manager.destroy(sandboxId);
    });

    it("rejects timeoutMs below minimum", async () => {
      const create = await app.inject({ method: "POST", url: "/sandboxes" });
      const { sandboxId } = create.json();

      const res = await app.inject({
        method: "POST",
        url: `/sandboxes/${sandboxId}/execute`,
        payload: { code: "1", timeoutMs: 10 },
      });

      expect(res.statusCode).toBe(400);

      await manager.destroy(sandboxId);
    });
  });

  describe("GET /sandboxes/:id/logs", () => {
    it("returns execution logs for a sandbox", async () => {
      const create = await app.inject({ method: "POST", url: "/sandboxes" });
      const { sandboxId } = create.json();

      await app.inject({
        method: "POST",
        url: `/sandboxes/${sandboxId}/execute`,
        payload: { code: "console.log('a')" },
      });
      await app.inject({
        method: "POST",
        url: `/sandboxes/${sandboxId}/execute`,
        payload: { code: "console.log('b')" },
      });

      const res = await app.inject({ method: "GET", url: `/sandboxes/${sandboxId}/logs` });

      expect(res.statusCode).toBe(200);
      const logs = res.json();
      expect(logs).toHaveLength(2);
      expect(logs[0].code).toBe("console.log('a')");
      expect(logs[0].executionId).toBeDefined();
      expect(logs[0].timestamp).toBeTypeOf("number");
      expect(logs[0].result.stdout).toBe("a\n");
      expect(logs[1].code).toBe("console.log('b')");

      await manager.destroy(sandboxId);
    });

    it("returns 404 for nonexistent sandbox", async () => {
      const res = await app.inject({ method: "GET", url: "/sandboxes/nonexistent/logs" });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Sandbox not found" });
    });

    it("returns empty array for sandbox with no executions", async () => {
      const create = await app.inject({ method: "POST", url: "/sandboxes" });
      const { sandboxId } = create.json();

      const res = await app.inject({ method: "GET", url: `/sandboxes/${sandboxId}/logs` });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);

      await manager.destroy(sandboxId);
    });
  });

  describe("DELETE /sandboxes/:id", () => {
    it("destroys a sandbox and returns 204", async () => {
      const create = await app.inject({ method: "POST", url: "/sandboxes" });
      const { sandboxId } = create.json();

      const res = await app.inject({
        method: "DELETE",
        url: `/sandboxes/${sandboxId}`,
      });

      expect(res.statusCode).toBe(204);
    });

    it("returns 404 for nonexistent sandbox", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: "/sandboxes/nonexistent",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "Sandbox not found" });
    });

    it("returns 404 on double delete", async () => {
      const create = await app.inject({ method: "POST", url: "/sandboxes" });
      const { sandboxId } = create.json();

      await app.inject({ method: "DELETE", url: `/sandboxes/${sandboxId}` });
      const res = await app.inject({ method: "DELETE", url: `/sandboxes/${sandboxId}` });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("GET /templates", () => {
    it("returns available templates", async () => {
      const res = await app.inject({ method: "GET", url: "/templates" });

      expect(res.statusCode).toBe(200);
      expect(res.json().templates).toEqual([
        expect.objectContaining({ id: "node-22" }),
        expect.objectContaining({ id: "python-3.12" }),
      ]);
    });
  });
});
