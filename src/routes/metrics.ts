import type { FastifyInstance } from "fastify";
import { SandboxManager } from "../sandbox/manager.js";
import { config } from "../config.js";

const startedAt = Date.now();

export async function metricsRoutes(app: FastifyInstance, manager: SandboxManager) {
  app.get<{ Querystring: { format?: string } }>("/metrics", async (request, reply) => {
    const uptime = Math.round((Date.now() - startedAt) / 1000);

    if (request.query.format === "json") {
      return {
        ...manager.getMetricsSummary(config.maxMemoryMb, config.backendType, uptime),
        config: {
          defaultTimeoutMs: config.defaultTimeoutMs,
          maxMemoryMb: config.maxMemoryMb,
          sandboxTtlMs: config.sandboxTtlMs,
          cpuQuotaPercent: config.cpuQuotaPercent,
        },
      };
    }

    reply.header("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    return manager.renderPrometheusMetrics(config.maxMemoryMb);
  });
}
