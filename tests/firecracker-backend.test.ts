import { describe, it, expect } from "vitest";
import { FirecrackerBackend } from "../src/sandbox/firecracker-backend.js";

describe("FirecrackerBackend", () => {
  it("can be instantiated with defaults", () => {
    const backend = new FirecrackerBackend({ maxMemoryMb: 256 });
    expect(backend).toBeDefined();
  });

  it("can be instantiated with full config including jailer", () => {
    const backend = new FirecrackerBackend({
      maxMemoryMb: 128,
      vcpuCount: 2,
      kernelImagePath: "/custom/vmlinux",
      rootfsPath: "/custom/rootfs.ext4",
      socketDir: "/custom/sockets",
      firecrackerBin: "/custom/firecracker",
      jailerBin: "/custom/jailer",
      jailerUid: 1001,
      jailerGid: 1001,
      cpuQuotaPercent: 25,
      chrootBaseDir: "/custom/jailer-root",
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

  describe("jailer helpers", () => {
    it("sanitizes sandbox ID for jailer", () => {
      const backend = new FirecrackerBackend({ maxMemoryMb: 256 });
      // UUIDs with hyphens should work
      expect(backend.sanitizeId("abc-123-def")).toBe("abc-123-def");
      // Should strip invalid characters
      expect(backend.sanitizeId("abc_123.def")).toBe("abc123def");
      // Should truncate to 64 chars
      const longId = "a".repeat(100);
      expect(backend.sanitizeId(longId).length).toBe(64);
    });

    it("computes correct chroot path", () => {
      const backend = new FirecrackerBackend({
        maxMemoryMb: 256,
        firecrackerBin: "/usr/local/bin/firecracker",
        chrootBaseDir: "/srv/jailer",
      });
      const path = backend.getChrootPath("sandbox-123");
      expect(path).toBe("/srv/jailer/firecracker/sandbox-123/root");
    });

    it("computes correct API socket path inside chroot", () => {
      const backend = new FirecrackerBackend({
        maxMemoryMb: 256,
        firecrackerBin: "/usr/local/bin/firecracker",
        chrootBaseDir: "/srv/jailer",
      });
      const path = backend.getApiSocketPath("sandbox-123");
      expect(path).toBe("/srv/jailer/firecracker/sandbox-123/root/run/firecracker.socket");
    });

    it("builds correct jailer spawn args", () => {
      const backend = new FirecrackerBackend({
        maxMemoryMb: 256,
        firecrackerBin: "/usr/local/bin/firecracker",
        jailerBin: "/usr/local/bin/jailer",
        jailerUid: 1000,
        jailerGid: 1000,
        cpuQuotaPercent: 50,
        chrootBaseDir: "/srv/jailer",
      });
      const args = backend.buildJailerArgs("sandbox-123");
      expect(args).toContain("--id");
      expect(args).toContain("sandbox-123");
      expect(args).toContain("--exec-file");
      expect(args).toContain("/usr/local/bin/firecracker");
      expect(args).toContain("--uid");
      expect(args).toContain("1000");
      expect(args).toContain("--gid");
      expect(args).toContain("1000");
      expect(args).toContain("--chroot-base-dir");
      expect(args).toContain("/srv/jailer");
      expect(args).toContain("--new-pid-ns");
      // Should have cgroup CPU quota
      expect(args).toContain("--cgroup");
      expect(args.some(a => a.includes("cpu.max"))).toBe(true);
      // Firecracker args after --
      expect(args).toContain("--");
    });
  });
});
