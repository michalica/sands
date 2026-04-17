import type { FastifyInstance } from "fastify";
import { SandboxManager } from "../sandbox/manager.js";
import { config } from "../config.js";

const startedAt = Date.now();

export async function metricsRoutes(app: FastifyInstance, manager: SandboxManager) {
  app.get("/metrics", async () => {
    return {
      activeSandboxes: manager.activeSandboxCount,
      maxSandboxes: manager.maxSandboxCount,
      backendType: config.backendType,
      uptime: Math.round((Date.now() - startedAt) / 1000),
      config: {
        defaultTimeoutMs: config.defaultTimeoutMs,
        maxMemoryMb: config.maxMemoryMb,
        sandboxTtlMs: config.sandboxTtlMs,
        cpuQuotaPercent: config.cpuQuotaPercent,
      },
    };
  });
}
