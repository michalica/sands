import { describe, it, expect, beforeEach } from "vitest";
import { SandboxStore } from "../src/db/store.js";
import { createDb } from "../src/db/index.js";

describe("SandboxStore", () => {
  let store: SandboxStore;

  beforeEach(() => {
    // Use in-memory SQLite for tests
    const db = createDb(":memory:");
    store = new SandboxStore(db);
  });

  describe("sandboxes", () => {
    it("creates and retrieves a sandbox", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      const sandbox = store.getSandbox("s1");

      expect(sandbox).toBeDefined();
      expect(sandbox!.sandboxId).toBe("s1");
      expect(sandbox!.templateId).toBe("node-22");
      expect(sandbox!.createdAt).toBe(1000);
      expect(sandbox!.status).toBe("running");
      expect(sandbox!.destroyedAt).toBeNull();
    });

    it("returns null for nonexistent sandbox", () => {
      expect(store.getSandbox("nonexistent")).toBeNull();
    });

    it("updates lastUsedAt", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      store.updateLastUsed("s1", 2000);

      const sandbox = store.getSandbox("s1");
      expect(sandbox!.lastUsedAt).toBe(2000);
    });

    it("marks sandbox as destroyed", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      store.markDestroyed("s1", 3000);

      const sandbox = store.getSandbox("s1");
      expect(sandbox!.status).toBe("destroyed");
      expect(sandbox!.destroyedAt).toBe(3000);
    });

    it("lists all sandboxes", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      store.createSandbox({ sandboxId: "s2", templateId: "node-22", createdAt: 2000, lastUsedAt: 2000 });
      store.markDestroyed("s1", 3000);

      const all = store.listSandboxes();
      expect(all).toHaveLength(2);
    });

    it("lists sandboxes by status", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      store.createSandbox({ sandboxId: "s2", templateId: "node-22", createdAt: 2000, lastUsedAt: 2000 });
      store.markDestroyed("s1", 3000);

      const running = store.listSandboxes({ status: "running" });
      expect(running).toHaveLength(1);
      expect(running[0].sandboxId).toBe("s2");

      const destroyed = store.listSandboxes({ status: "destroyed" });
      expect(destroyed).toHaveLength(1);
      expect(destroyed[0].sandboxId).toBe("s1");
    });

    it("finds expired sandboxes", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      store.createSandbox({ sandboxId: "s2", templateId: "node-22", createdAt: 2000, lastUsedAt: 5000 });

      // TTL of 2000ms, current time 4000 → s1 expired (1000 + 2000 < 4000), s2 not
      const expired = store.getExpired(2000, 4000);
      expect(expired).toHaveLength(1);
      expect(expired[0].sandboxId).toBe("s1");
    });
  });

  describe("execution logs", () => {
    it("appends and retrieves logs", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      store.appendLog("s1", {
        executionId: "e1",
        timestamp: 1500,
        code: "console.log('hi')",
        result: { stdout: "hi\n", stderr: "", exitCode: 0, durationMs: 10, timedOut: false },
      });

      const logs = store.getLogs("s1");
      expect(logs).toHaveLength(1);
      expect(logs[0].executionId).toBe("e1");
      expect(logs[0].code).toBe("console.log('hi')");
      expect(logs[0].result.stdout).toBe("hi\n");
      expect(logs[0].result.exitCode).toBe(0);
    });

    it("returns multiple logs in order", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      store.appendLog("s1", {
        executionId: "e1", timestamp: 1000, code: "a",
        result: { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false },
      });
      store.appendLog("s1", {
        executionId: "e2", timestamp: 2000, code: "b",
        result: { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false },
      });

      const logs = store.getLogs("s1");
      expect(logs).toHaveLength(2);
      expect(logs[0].code).toBe("a");
      expect(logs[1].code).toBe("b");
    });

    it("returns empty array for sandbox with no logs", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      expect(store.getLogs("s1")).toEqual([]);
    });

    it("returns logs for destroyed sandboxes", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      store.appendLog("s1", {
        executionId: "e1", timestamp: 1500, code: "x",
        result: { stdout: "ok\n", stderr: "", exitCode: 0, durationMs: 5, timedOut: false },
      });
      store.markDestroyed("s1", 2000);

      const logs = store.getLogs("s1");
      expect(logs).toHaveLength(1);
      expect(logs[0].result.stdout).toBe("ok\n");
    });

    it("counts executions per sandbox", () => {
      store.createSandbox({ sandboxId: "s1", templateId: "node-22", createdAt: 1000, lastUsedAt: 1000 });
      store.appendLog("s1", {
        executionId: "e1", timestamp: 1000, code: "a",
        result: { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false },
      });
      store.appendLog("s1", {
        executionId: "e2", timestamp: 2000, code: "b",
        result: { stdout: "", stderr: "", exitCode: 0, durationMs: 1, timedOut: false },
      });

      expect(store.getExecutionCount("s1")).toBe(2);
      expect(store.getExecutionCount("nonexistent")).toBe(0);
    });
  });

  describe("templates", () => {
    it("lists seeded templates", () => {
      const templates = store.listTemplates();

      expect(templates.map((template) => template.id)).toEqual(["node-22", "python-3.12"]);
    });

    it("retrieves a template by id", () => {
      const template = store.getTemplate("node-22");

      expect(template).toBeDefined();
      expect(template?.name).toBe("Node.js 22");
    });
  });
});
