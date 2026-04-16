import { describe, it, expect, afterEach } from "vitest";
import { ProcessBackend } from "../src/sandbox/process-backend.js";

describe("ProcessBackend", () => {
  const backend = new ProcessBackend();
  const createdIds: string[] = [];

  afterEach(async () => {
    for (const id of createdIds) {
      await backend.destroy(id).catch(() => {});
    }
    createdIds.length = 0;
  });

  async function createSandbox(id: string) {
    await backend.create(id);
    createdIds.push(id);
  }

  it("creates and tracks a sandbox", async () => {
    await createSandbox("test-1");
    expect(backend.exists("test-1")).toBe(true);
  });

  it("executes code and captures stdout", async () => {
    await createSandbox("test-stdout");
    const result = await backend.execute("test-stdout", "console.log('hello world')", 5000);

    expect(result.stdout).toBe("hello world\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("captures stderr", async () => {
    await createSandbox("test-stderr");
    const result = await backend.execute("test-stderr", "console.error('oops')", 5000);

    expect(result.stderr).toBe("oops\n");
    expect(result.exitCode).toBe(0);
  });

  it("returns non-zero exit code", async () => {
    await createSandbox("test-exit");
    const result = await backend.execute("test-exit", "process.exit(42)", 5000);

    expect(result.exitCode).toBe(42);
  });

  it("handles syntax errors", async () => {
    await createSandbox("test-syntax");
    const result = await backend.execute("test-syntax", "const x = {{{", 5000);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("SyntaxError");
  });

  it("enforces timeout on infinite loops", async () => {
    await createSandbox("test-timeout");
    const result = await backend.execute("test-timeout", "while(true){}", 500);

    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(400);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it("supports multiple executions in the same sandbox", async () => {
    await createSandbox("test-multi");

    const r1 = await backend.execute("test-multi", "console.log('first')", 5000);
    const r2 = await backend.execute("test-multi", "console.log('second')", 5000);

    expect(r1.stdout).toBe("first\n");
    expect(r2.stdout).toBe("second\n");
  });

  describe("memory limits", () => {
    it("kills process that exceeds memory limit", { timeout: 15000 }, async () => {
      const limitedBackend = new ProcessBackend(64);
      await limitedBackend.create("test-oom");

      const result = await limitedBackend.execute(
        "test-oom",
        // Allocate V8 heap memory (arrays of numbers, not Buffers which use native memory)
        `const a = []; while(true) a.push(new Array(100000).fill(0));`,
        10000,
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.timedOut).toBe(false);
      await limitedBackend.destroy("test-oom");
    });

    it("allows execution within memory limit", async () => {
      const limitedBackend = new ProcessBackend(128);
      await limitedBackend.create("test-mem-ok");

      const result = await limitedBackend.execute(
        "test-mem-ok",
        "const buf = Buffer.alloc(10 * 1024 * 1024); console.log('ok');",
        5000,
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("ok\n");
      await limitedBackend.destroy("test-mem-ok");
    });
  });

  it("destroys a sandbox and removes tracking", async () => {
    await backend.create("test-destroy");
    expect(backend.exists("test-destroy")).toBe(true);

    await backend.destroy("test-destroy");
    expect(backend.exists("test-destroy")).toBe(false);
  });
});
