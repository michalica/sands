import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { SandboxManager } from "../src/sandbox/manager.js";
import { SandboxStore } from "../src/db/store.js";
import { createDb } from "../src/db/index.js";
import { ProcessBackend } from "../src/sandbox/process-backend.js";
import { sandboxRoutes } from "../src/routes/sandboxes.js";
import { metricsRoutes } from "../src/routes/metrics.js";

describe("Prometheus metrics", () => {
  async function createApp() {
    const app = Fastify();
    const backend = new ProcessBackend();
    const db = createDb(":memory:");
    const store = new SandboxStore(db);
    const manager = new SandboxManager(backend, 5000, 300_000, 0, store);

    await sandboxRoutes(app, manager);
    await metricsRoutes(app, manager);
    await app.ready();

    return { app, manager };
  }

  function metricValue(body: string, name: string, labels?: Record<string, string>): number {
    const labelText = labels
      ? `{${Object.entries(labels)
          .map(([key, value]) => `${key}="${value}"`)
          .join(",")}}`
      : "";
    const match = body.match(new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${labelText} (.+)$`, "m"));
    if (!match) {
      throw new Error(`Metric not found: ${name}${labelText}`);
    }
    return Number(match[1]);
  }

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret";
  });

  it("returns Prometheus text output", async () => {
    const { app } = await createApp();

    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.body).toContain("# HELP sandboxes_created_total");
    expect(res.body).toContain("# TYPE executions_total counter");
    expect(res.body).toContain("active_sandboxes 0");

    await app.close();
  });

  it("tracks sandbox lifecycle and execution outcomes", async () => {
    const { app } = await createApp();

    const createRes = await app.inject({ method: "POST", url: "/sandboxes" });
    const { sandboxId } = createRes.json();

    await app.inject({
      method: "POST",
      url: `/sandboxes/${sandboxId}/execute`,
      payload: { code: "console.log('ok')" },
    });

    await app.inject({
      method: "POST",
      url: `/sandboxes/${sandboxId}/execute`,
      payload: { code: "while(true){}", timeoutMs: 200 },
    });

    await app.inject({ method: "DELETE", url: `/sandboxes/${sandboxId}` });

    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(metricValue(res.body, "sandboxes_created_total")).toBe(1);
    expect(metricValue(res.body, "sandboxes_destroyed_total")).toBe(1);
    expect(metricValue(res.body, "executions_total", { outcome: "success" })).toBe(1);
    expect(metricValue(res.body, "executions_total", { outcome: "timeout" })).toBe(1);
    expect(metricValue(res.body, "active_sandboxes")).toBe(0);
    expect(metricValue(res.body, "microvm_memory_used_bytes")).toBe(0);

    await app.close();
  });

  it("records execution and startup histograms", async () => {
    const { app } = await createApp();

    const createRes = await app.inject({ method: "POST", url: "/sandboxes" });
    const { sandboxId } = createRes.json();

    await app.inject({
      method: "POST",
      url: `/sandboxes/${sandboxId}/execute`,
      payload: { code: "console.log('ok')" },
    });

    const res = await app.inject({ method: "GET", url: "/metrics" });

    expect(metricValue(res.body, "cold_start_ms_count")).toBe(1);
    expect(metricValue(res.body, "template_load_ms_count")).toBe(1);
    expect(metricValue(res.body, "execution_ms_count")).toBe(1);
    expect(metricValue(res.body, "execution_ms_sum")).toBeGreaterThanOrEqual(0);

    await app.close();
  });
});
