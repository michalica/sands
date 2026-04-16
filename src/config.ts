export const config = {
  port: parseInt(process.env.PORT ?? "3000", 10),
  host: process.env.HOST ?? "0.0.0.0",
  backendType: process.env.SANDBOX_BACKEND ?? "process",
  defaultTimeoutMs: parseInt(process.env.TIMEOUT_MS ?? "5000", 10),
  maxMemoryMb: parseInt(process.env.MAX_MEMORY_MB ?? "256", 10),
  sandboxTtlMs: parseInt(process.env.SANDBOX_TTL_MS ?? "300000", 10),
  ttlCleanupIntervalMs: parseInt(process.env.TTL_CLEANUP_INTERVAL_MS ?? "30000", 10),
  // Firecracker-specific
  vcpuCount: parseInt(process.env.VCPU_COUNT ?? "1", 10),
  kernelImagePath: process.env.KERNEL_IMAGE_PATH ?? "/opt/sandboxjs/vmlinux",
  rootfsPath: process.env.ROOTFS_PATH ?? "/opt/sandboxjs/rootfs.ext4",
  firecrackerSocketDir: process.env.FIRECRACKER_SOCKET_DIR ?? "/tmp/sandboxjs/firecracker",
  firecrackerBin: process.env.FIRECRACKER_BIN ?? "/usr/local/bin/firecracker",
} as const;
