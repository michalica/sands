import Fastify from "fastify";
import { config } from "./config.js";
import { SandboxManager } from "./sandbox/manager.js";
import { createBackend } from "./sandbox/backend-factory.js";
import { sandboxRoutes } from "./routes/sandboxes.js";

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
const manager = new SandboxManager(backend, config.defaultTimeoutMs, config.sandboxTtlMs, undefined, config.maxSandboxes);

// Health check
app.get("/health", async () => ({ status: "ok", activeSandboxes: manager.activeSandboxCount }));

// Register routes
await sandboxRoutes(app, manager);

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
