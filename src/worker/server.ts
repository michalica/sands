import Fastify from "fastify";
import { config } from "../config.js";
import { SandboxManager } from "../sandbox/manager.js";
import { createBackend } from "../sandbox/backend-factory.js";
import { workerRoutes } from "./routes.js";
import { registerControlPlaneAuth } from "./auth-hook.js";
import { startRegistration } from "./registration.js";

const WORKER_PORT = parseInt(process.env.WORKER_PORT ?? "7000", 10);
const WORKER_HOST = process.env.WORKER_HOST ?? "127.0.0.1";
const WORKER_ID = process.env.WORKER_ID ?? `worker-${Math.random().toString(36).slice(2, 10)}`;
const WORKER_TOKEN = process.env.WORKER_AUTH_TOKEN;
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL;
const WORKER_PUBLIC_URL = process.env.WORKER_PUBLIC_URL ?? `http://${WORKER_HOST}:${WORKER_PORT}`;

if (!WORKER_TOKEN) {
  console.error("ERROR: WORKER_AUTH_TOKEN env var is required");
  process.exit(1);
}

const app = Fastify({ logger: true });

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

// No store on workers — sandbox metadata lives at the control plane.
// The manager keeps its in-memory `running` map for execute routing + TTL.
const manager = new SandboxManager(
  backend,
  config.defaultTimeoutMs,
  config.sandboxTtlMs,
  config.maxSandboxes,
);

// Health check is unauthenticated so the control plane (or a load balancer)
// can probe it before the worker is registered.
app.get("/health", async () => ({ status: "ok", workerId: WORKER_ID }));

// Everything else requires the shared bearer token.
registerControlPlaneAuth(app, WORKER_TOKEN);

await workerRoutes(app, manager);

manager.startTtlCleanup(config.ttlCleanupIntervalMs);

try {
  await app.listen({ port: WORKER_PORT, host: WORKER_HOST });
  app.log.info(`worker daemon listening on http://${WORKER_HOST}:${WORKER_PORT} (id=${WORKER_ID})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Register with control plane + heartbeat. If CONTROL_PLANE_URL isn't set,
// the worker runs standalone (useful for local dev / smoke testing).
if (CONTROL_PLANE_URL) {
  startRegistration({
    controlPlaneUrl: CONTROL_PLANE_URL,
    workerId: WORKER_ID,
    workerPublicUrl: WORKER_PUBLIC_URL,
    workerToken: WORKER_TOKEN,
    manager,
    logger: app.log,
  });
} else {
  app.log.warn("CONTROL_PLANE_URL not set — running standalone, no registration");
}

// Graceful shutdown
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    manager.stopTtlCleanup();
    await app.close();
    process.exit(0);
  });
}
