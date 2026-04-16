export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  host: process.env.HOST ?? "0.0.0.0",
  defaultTimeoutMs: parseInt(process.env.TIMEOUT_MS ?? "5000", 10),
  maxMemoryMb: parseInt(process.env.MAX_MEMORY_MB ?? "256", 10),
  sandboxTtlMs: parseInt(process.env.SANDBOX_TTL_MS ?? "300000", 10),
  ttlCleanupIntervalMs: parseInt(process.env.TTL_CLEANUP_INTERVAL_MS ?? "30000", 10),
} as const;
