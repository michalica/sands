import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { SandboxManager } from "../src/sandbox/manager.js";
import { SandboxStore } from "../src/db/store.js";
import { createDb } from "../src/db/index.js";
import { ProcessBackend } from "../src/sandbox/process-backend.js";
import { sandboxRoutes } from "../src/routes/sandboxes.js";

describe("structured logs", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret";
  });

  async function createApp() {
    const logs: Record<string, unknown>[] = [];
    const app = Fastify({
      logger: {
        level: "info",
        stream: {
          write: (line: string) => {
            logs.push(JSON.parse(line));
          },
        },
      },
    });
    const backend = new ProcessBackend();
    const db = createDb(":memory:");
    const store = new SandboxStore(db);
    const manager = new SandboxManager(backend, 5000, 300_000, 0, store);

    app.addHook("preHandler", async (request) => {
      request.userId = "user-1";
    });

    await sandboxRoutes(app, manager);
    await app.ready();

    return { app, logs };
  }

  it("logs create requests with request, sandbox, user, and template context", async () => {
    const { app, logs } = await createApp();

    const res = await app.inject({
      method: "POST",
      url: "/sandboxes",
      payload: { template: "python-3.12" },
    });

    expect(res.statusCode).toBe(201);
    const entry = logs.find((log) => log.msg === "sandbox created") as Record<string, unknown> | undefined;
    expect(entry).toBeDefined();
    expect(entry?.request_id).toBeDefined();
    expect(entry?.sandbox_id).toBe(res.json().sandboxId);
    expect(entry?.user_id).toBe("user-1");
    expect(entry?.template).toBe("python-3.12");

    await app.close();
  });

  it("logs execution requests with request, sandbox, user, and template context", async () => {
    const { app, logs } = await createApp();

    const createRes = await app.inject({
      method: "POST",
      url: "/sandboxes",
      payload: { template: "node-22" },
    });
    const { sandboxId } = createRes.json();

    const execRes = await app.inject({
      method: "POST",
      url: `/sandboxes/${sandboxId}/execute`,
      payload: { code: "console.log('ok')" },
    });

    expect(execRes.statusCode).toBe(200);
    const entry = logs.find((log) => log.msg === "sandbox executed") as Record<string, unknown> | undefined;
    expect(entry).toBeDefined();
    expect(entry?.request_id).toBeDefined();
    expect(entry?.sandbox_id).toBe(sandboxId);
    expect(entry?.user_id).toBe("user-1");
    expect(entry?.template).toBe("node-22");
    expect(entry?.outcome).toBe("success");

    await app.close();
  });
});
