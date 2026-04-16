import type { SandboxBackend } from "./types.js";
import { ProcessBackend } from "./process-backend.js";
import { FirecrackerBackend, type FirecrackerConfig } from "./firecracker-backend.js";

interface BackendConfig {
  type: string;
  maxMemoryMb: number;
  firecracker?: Omit<FirecrackerConfig, "maxMemoryMb">;
}

export function createBackend(config: BackendConfig): SandboxBackend {
  switch (config.type) {
    case "firecracker":
      return new FirecrackerBackend({
        maxMemoryMb: config.maxMemoryMb,
        ...config.firecracker,
      });
    case "process":
    default:
      return new ProcessBackend(config.maxMemoryMb);
  }
}
