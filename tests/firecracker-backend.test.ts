import { describe, it, expect } from "vitest";
import { FirecrackerBackend } from "../src/sandbox/firecracker-backend.js";

describe("FirecrackerBackend", () => {
  it("can be instantiated", () => {
    const backend = new FirecrackerBackend(256);
    expect(backend).toBeDefined();
  });

  it("implements SandboxBackend interface", () => {
    const backend = new FirecrackerBackend(256);
    expect(typeof backend.create).toBe("function");
    expect(typeof backend.execute).toBe("function");
    expect(typeof backend.destroy).toBe("function");
    expect(typeof backend.exists).toBe("function");
  });

  it("throws on create (requires Linux/KVM)", async () => {
    const backend = new FirecrackerBackend(256);
    await expect(backend.create("test-1")).rejects.toThrow(/Linux.*KVM/i);
  });

  it("throws on execute (requires Linux/KVM)", async () => {
    const backend = new FirecrackerBackend(256);
    await expect(backend.execute("test-1", "code", 5000)).rejects.toThrow(/Linux.*KVM/i);
  });

  it("throws on destroy (requires Linux/KVM)", async () => {
    const backend = new FirecrackerBackend(256);
    await expect(backend.destroy("test-1")).rejects.toThrow(/Linux.*KVM/i);
  });
});
