import Fastify from "fastify";
import { config } from "./config.js";
import { SandboxManager } from "./sandbox/manager.js";
import { ProcessBackend } from "./sandbox/process-backend.js";
import { sandboxRoutes } from "./routes/sandboxes.js";

const app = Fastify({ logger: true });

const backend = new ProcessBackend();
const manager = new SandboxManager(backend, config.defaultTimeoutMs, config.sandboxTtlMs);

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
