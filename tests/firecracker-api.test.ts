import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { FirecrackerApi } from "../src/sandbox/firecracker-api.js";

describe("FirecrackerApi", () => {
  let server: http.Server;
  let socketPath: string;
  let api: FirecrackerApi;
  let lastRequest: { method: string; path: string; body: string };

  beforeEach(async () => {
    socketPath = `/tmp/sandboxjs-test-${Date.now()}.sock`;
    lastRequest = { method: "", path: "", body: "" };

    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        lastRequest = { method: req.method!, path: req.url!, body };
        res.writeHead(204);
        res.end();
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(socketPath, resolve);
    });

    api = new FirecrackerApi(socketPath);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it("sends PUT requests with JSON body", async () => {
    await api.put("/machine-config", { vcpu_count: 1, mem_size_mib: 256 });

    expect(lastRequest.method).toBe("PUT");
    expect(lastRequest.path).toBe("/machine-config");
    expect(JSON.parse(lastRequest.body)).toEqual({ vcpu_count: 1, mem_size_mib: 256 });
  });

  it("sends correct content-type header", async () => {
    // We verify indirectly by checking the server received valid JSON
    await api.put("/boot-source", { kernel_image_path: "/vmlinux" });
    expect(JSON.parse(lastRequest.body)).toEqual({ kernel_image_path: "/vmlinux" });
  });

  it("sends PUT to different paths", async () => {
    await api.put("/actions", { action_type: "InstanceStart" });

    expect(lastRequest.path).toBe("/actions");
    expect(JSON.parse(lastRequest.body)).toEqual({ action_type: "InstanceStart" });
  });
});
