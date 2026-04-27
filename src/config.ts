export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  host: process.env.HOST ?? "0.0.0.0",
  backendType: process.env.SANDBOX_BACKEND ?? "process",
  defaultTimeoutMs: parseInt(process.env.TIMEOUT_MS ?? "5000", 10),
  maxMemoryMb: parseInt(process.env.MAX_MEMORY_MB ?? "256", 10),
  maxSandboxes: parseInt(process.env.MAX_SANDBOXES ?? "12", 10),
  sandboxTtlMs: parseInt(process.env.SANDBOX_TTL_MS ?? "300000", 10),
  ttlCleanupIntervalMs: parseInt(process.env.TTL_CLEANUP_INTERVAL_MS ?? "30000", 10),
  // Firecracker-specific
  vcpuCount: parseInt(process.env.VCPU_COUNT ?? "1", 10),
  kernelImagePath: process.env.KERNEL_IMAGE_PATH ?? "/opt/sandboxjs/vmlinux",
  rootfsPath: process.env.ROOTFS_PATH ?? "/opt/sandboxjs/rootfs.ext4",
  firecrackerSocketDir: process.env.FIRECRACKER_SOCKET_DIR ?? "/opt/sandboxjs/vms",
  firecrackerBin: process.env.FIRECRACKER_BIN ?? "/usr/local/bin/firecracker",
  // Jailer
  jailerBin: process.env.JAILER_BIN ?? "/usr/local/bin/jailer",
  jailerUid: parseInt(process.env.JAILER_UID ?? "1000", 10),
  jailerGid: parseInt(process.env.JAILER_GID ?? "1000", 10),
  cpuQuotaPercent: parseInt(process.env.CPU_QUOTA_PERCENT ?? "25", 10),
  chrootBaseDir: process.env.CHROOT_BASE_DIR ?? "/srv/jailer",
  // Database
  databasePath: process.env.DATABASE_PATH ?? "data/sandboxjs.db",
} as const;
