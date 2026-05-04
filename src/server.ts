import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { config } from "./config.js";
import { SandboxManager } from "./sandbox/manager.js";
import { createBackend } from "./sandbox/backend-factory.js";
import { createDb } from "./db/index.js";
import { SandboxStore } from "./db/store.js";
import { sandboxRoutes } from "./routes/sandboxes.js";
import { metricsRoutes } from "./routes/metrics.js";
import { eventsRoutes } from "./routes/events.js";
import { registerApiKeyAuth } from "./auth-hook.js";

const app = Fastify({ logger: true });

const dashboardOrigin = process.env.DASHBOARD_ORIGIN ?? "http://localhost:3001";
await app.register(cors, { origin: [dashboardOrigin], credentials: true });
await app.register(websocket);

// Initialize database
mkdirSync(dirname(config.databasePath), { recursive: true });
const db = createDb(config.databasePath);
const store = new SandboxStore(db);

const backend = createBackend({
  type: config.backendType,
  maxMemoryMb: config.maxMemoryMb,
  firecracker: {
    vcpuCount: config.vcpuCount,
    kernelImagePath: config.kernelImagePath,
    rootfsPath: config.rootfsPath,
    socketDir: config.firecrackerSocketDir,
    firecrackerBin: config.firecrackerBin,
    jailerBin: config.jailerBin,
    jailerUid: config.jailerUid,
    jailerGid: config.jailerGid,
    cpuQuotaPercent: config.cpuQuotaPercent,
    chrootBaseDir: config.chrootBaseDir,
  },
});
const manager = new SandboxManager(backend, config.defaultTimeoutMs, config.sandboxTtlMs, config.maxSandboxes, store);

// Health check (unauthenticated)
app.get("/health", async () => ({ status: "ok", activeSandboxes: manager.activeSandboxCount }));

// Require an API key for the customer-facing API surface
registerApiKeyAuth(app, ["/sandboxes", "/metrics"]);

// Register routes
await sandboxRoutes(app, manager);
await metricsRoutes(app, manager);
await eventsRoutes(app);

// Start
manager.startTtlCleanup(config.ttlCleanupIntervalMs);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    manager.stopTtlCleanup();
    await app.close();
    process.exit(0);
  });
}
