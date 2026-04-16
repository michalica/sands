import { describe, it, expect } from "vitest";
import { FirecrackerBackend } from "../src/sandbox/firecracker-backend.js";

describe("FirecrackerBackend", () => {
  it("can be instantiated with defaults", () => {
    const backend = new FirecrackerBackend({ maxMemoryMb: 256 });
    expect(backend).toBeDefined();
  });

  it("can be instantiated with full config", () => {
    const backend = new FirecrackerBackend({
      maxMemoryMb: 128,
      vcpuCount: 2,
      kernelImagePath: "/custom/vmlinux",
      rootfsPath: "/custom/rootfs.ext4",
      socketDir: "/custom/sockets",
      firecrackerBin: "/custom/firecracker",
    });
    expect(backend).toBeDefined();
  });

  it("implements SandboxBackend interface", () => {
    const backend = new FirecrackerBackend({ maxMemoryMb: 256 });
    expect(typeof backend.create).toBe("function");
    expect(typeof backend.execute).toBe("function");
    expect(typeof backend.destroy).toBe("function");
    expect(typeof backend.exists).toBe("function");
  });

  it("throws on create when not on Linux", async () => {
    const backend = new FirecrackerBackend({ maxMemoryMb: 256 });
    if (process.platform !== "linux") {
      await expect(backend.create("test-1")).rejects.toThrow(/Linux.*KVM/i);
    }
  });

  it("throws on execute when not on Linux", async () => {
    const backend = new FirecrackerBackend({ maxMemoryMb: 256 });
    if (process.platform !== "linux") {
      await expect(backend.execute("test-1", "code", 5000)).rejects.toThrow(/Linux.*KVM/i);
    }
  });

  it("throws on destroy when not on Linux", async () => {
    const backend = new FirecrackerBackend({ maxMemoryMb: 256 });
    if (process.platform !== "linux") {
      await expect(backend.destroy("test-1")).rejects.toThrow(/Linux.*KVM/i);
    }
  });

  it("tracks sandbox existence", () => {
    const backend = new FirecrackerBackend({ maxMemoryMb: 256 });
    expect(backend.exists("test-1")).toBe(false);
  });
});
