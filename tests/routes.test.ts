import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import { SandboxManager } from "../src/sandbox/manager.js";
import { ProcessBackend } from "../src/sandbox/process-backend.js";
import { sandboxRoutes } from "../src/routes/sandboxes.js";

describe("API routes", () => {
  const app = Fastify();
  const backend = new ProcessBackend();
  const manager = new SandboxManager(backend, 5000);

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
});
