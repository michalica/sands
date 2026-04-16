import { describe, it, expect } from "vitest";
import { ExecutionLog } from "../src/sandbox/execution-log.js";
import type { ExecutionResult } from "../src/sandbox/types.js";

const mockResult: ExecutionResult = {
  stdout: "ok\n",
  stderr: "",
  exitCode: 0,
  durationMs: 10,
  timedOut: false,
};

describe("ExecutionLog", () => {
  it("starts with no logs for a sandbox", () => {
    const log = new ExecutionLog();
    expect(log.get("sandbox-1")).toEqual([]);
  });

  it("appends and retrieves log entries", () => {
    const log = new ExecutionLog();
    log.append("sandbox-1", { code: "console.log(1)", result: mockResult });
    log.append("sandbox-1", { code: "console.log(2)", result: mockResult });

    const entries = log.get("sandbox-1");
    expect(entries).toHaveLength(2);
    expect(entries[0].code).toBe("console.log(1)");
    expect(entries[1].code).toBe("console.log(2)");
  });

  it("assigns unique executionId and timestamp to each entry", () => {
    const log = new ExecutionLog();
    log.append("sandbox-1", { code: "a", result: mockResult });
    log.append("sandbox-1", { code: "b", result: mockResult });

    const entries = log.get("sandbox-1");
    expect(entries[0].executionId).toBeDefined();
    expect(entries[1].executionId).toBeDefined();
    expect(entries[0].executionId).not.toBe(entries[1].executionId);
    expect(entries[0].timestamp).toBeTypeOf("number");
  });

  it("keeps logs separate per sandbox", () => {
    const log = new ExecutionLog();
    log.append("sandbox-1", { code: "a", result: mockResult });
    log.append("sandbox-2", { code: "b", result: mockResult });

    expect(log.get("sandbox-1")).toHaveLength(1);
    expect(log.get("sandbox-2")).toHaveLength(1);
    expect(log.get("sandbox-1")[0].code).toBe("a");
    expect(log.get("sandbox-2")[0].code).toBe("b");
  });

  it("clears logs for a specific sandbox", () => {
    const log = new ExecutionLog();
    log.append("sandbox-1", { code: "a", result: mockResult });
    log.append("sandbox-2", { code: "b", result: mockResult });

    log.clear("sandbox-1");

    expect(log.get("sandbox-1")).toEqual([]);
    expect(log.get("sandbox-2")).toHaveLength(1);
  });

  it("includes full execution result in log entry", () => {
    const log = new ExecutionLog();
    const result: ExecutionResult = {
      stdout: "hello\n",
      stderr: "warn\n",
      exitCode: 1,
      durationMs: 42,
      timedOut: false,
    };
    log.append("sandbox-1", { code: "x", result });

    const entry = log.get("sandbox-1")[0];
    expect(entry.result).toEqual(result);
  });
});
