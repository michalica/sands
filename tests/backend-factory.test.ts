import { describe, it, expect } from "vitest";
import { createBackend } from "../src/sandbox/backend-factory.js";
import { ProcessBackend } from "../src/sandbox/process-backend.js";
import { FirecrackerBackend } from "../src/sandbox/firecracker-backend.js";

describe("createBackend", () => {
  it("returns ProcessBackend for 'process' type", () => {
    const backend = createBackend("process", 256);
    expect(backend).toBeInstanceOf(ProcessBackend);
  });

  it("returns FirecrackerBackend for 'firecracker' type", () => {
    const backend = createBackend("firecracker", 256);
    expect(backend).toBeInstanceOf(FirecrackerBackend);
  });

  it("defaults to ProcessBackend for unknown type", () => {
    const backend = createBackend("unknown", 256);
    expect(backend).toBeInstanceOf(ProcessBackend);
  });
});
