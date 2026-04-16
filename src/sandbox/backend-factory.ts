import type { SandboxBackend } from "./types.js";
import { ProcessBackend } from "./process-backend.js";
import { FirecrackerBackend } from "./firecracker-backend.js";

export function createBackend(type: string, maxMemoryMb: number): SandboxBackend {
  switch (type) {
    case "firecracker":
      return new FirecrackerBackend(maxMemoryMb);
    case "process":
    default:
      return new ProcessBackend(maxMemoryMb);
  }
}
