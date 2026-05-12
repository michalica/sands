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
import { workerRoutes, registerWorkerAuth } from "./routes/workers.js";
import { registerApiKeyAuth } from "./auth-hook.js";
import { WorkerCluster } from "./control-plane/worker-cluster.js";

const app = Fastify({ logger: true });

const dashboardOrigin = process.env.DASHBOARD_ORIGIN ?? "http://localhost:3001";
await app.register(cors, { origin: [dashboardOrigin], credentials: true });
await app.register(websocket);

// Initialize database
mkdirSync(dirname(config.databasePath), { recursive: true });
const db = createDb(config.databasePath);
const store = new SandboxStore(db);

// Pick a backend:
//   - If WORKER_AUTH_TOKEN is set, the control plane routes all sandbox
//     lifecycle ops to one or more workers via WorkerCluster.
//   - Otherwise, fall back to running the FirecrackerBackend in-process
//     (the legacy single-VM mode — useful for local dev where you don't
//     want to run a separate worker daemon).
const WORKER_AUTH_TOKEN = process.env.WORKER_AUTH_TOKEN;
const STALE_TIMEOUT_MS = parseInt(process.env.WORKER_STALE_TIMEOUT_MS ?? "30000", 10);

let cluster: WorkerCluster | null = null;
let backend;
if (WORKER_AUTH_TOKEN) {
  cluster = new WorkerCluster({ authToken: WORKER_AUTH_TOKEN, staleTimeoutMs: STALE_TIMEOUT_MS });
  backend = cluster;
  app.log.info("control plane mode: routing to workers via WorkerCluster");
} else {
  backend = createBackend({
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
  app.log.warn("WORKER_AUTH_TOKEN not set — running legacy single-VM in-process backend");
}

const manager = new SandboxManager(backend, config.defaultTimeoutMs, config.sandboxTtlMs, config.maxSandboxes, store);

// Health check (unauthenticated)
app.get("/health", async () => ({ status: "ok", activeSandboxes: manager.activeSandboxCount }));

if (cluster) {
  // Worker registration + heartbeat — auth via shared bearer token, not user API keys.
  registerWorkerAuth(app, WORKER_AUTH_TOKEN!, ["/workers"]);
  await workerRoutes(app, cluster);
}

// Require an API key for the customer-facing API surface
registerApiKeyAuth(app, ["/sandboxes", "/metrics"]);

// Register routes
await sandboxRoutes(app, manager);
await metricsRoutes(app, manager);
await eventsRoutes(app);

// Start
manager.startTtlCleanup(config.ttlCleanupIntervalMs);

// Periodically evict workers that haven't heartbeat'd recently.
let staleEvictTimer: ReturnType<typeof setInterval> | null = null;
if (cluster) {
  staleEvictTimer = setInterval(() => {
    const evicted = cluster!.evictStale();
    if (evicted.length > 0) {
      app.log.warn(`evicted stale workers: ${evicted.join(", ")}`);
    }
  }, 5_000);
}

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
    if (staleEvictTimer) clearInterval(staleEvictTimer);
    await app.close();
    process.exit(0);
  });
}
