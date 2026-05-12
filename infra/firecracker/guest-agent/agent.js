#!/usr/bin/env node

/**
 * SandboxJS Guest Agent — Vsock Mode
 *
 * Listens on a Unix domain socket at /tmp/agent.sock. A `socat` bridge
 * forwards from the guest's vsock port 5252 to this socket, so the host
 * connects via vsock (CONNECT 5252) and traffic lands here.
 *
 * Wire format (per connection): one request, one response.
 *   <uint32 BE length><JSON request>
 *   <uint32 BE length><JSON response>
 *
 * Request:  {"type":"execute","code":"...","timeoutMs":5000}
 * Response: {"stdout":"...","stderr":"...","exitCode":0,"durationMs":12,"timedOut":false}
 *
 * One connection per call — that gives us multiple concurrent calls per
 * sandbox for free (no shared single-slot pendingResolve dance).
 */

const net = require("net");
const { spawn } = require("child_process");
const { writeFileSync, unlinkSync } = require("fs");

const SOCK_PATH = "/tmp/agent.sock";
let jobSeq = 0;

try { unlinkSync(SOCK_PATH); } catch {}

const server = net.createServer((conn) => {
  let buffer = Buffer.alloc(0);
  let expected = null;

  conn.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    if (expected === null && buffer.length >= 4) {
      expected = buffer.readUInt32BE(0);
      buffer = buffer.subarray(4);
    }
    if (expected !== null && buffer.length >= expected) {
      const payload = buffer.subarray(0, expected).toString("utf8");
      buffer = buffer.subarray(expected);
      expected = null;

      let request;
      try { request = JSON.parse(payload); } catch {
        return respond(conn, { error: "invalid JSON" });
      }
      handle(conn, request);
    }
  });

  conn.on("error", () => {});
});

function handle(conn, request) {
  if (request.type !== "execute" || typeof request.code !== "string") {
    return respond(conn, { error: "unknown request type" });
  }
  const { code, timeoutMs = 5000 } = request;
  const jobPath = `/tmp/job-${++jobSeq}.js`;
  writeFileSync(jobPath, code, "utf-8");

  const start = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;

  const child = spawn("/usr/local/bin/node", ["--max-old-space-size=256", jobPath], {
    env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (c) => { stdout += c.toString(); });
  child.stderr.on("data", (c) => { stderr += c.toString(); });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  child.on("close", (exitCode) => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;
    respond(conn, {
      stdout,
      stderr,
      exitCode: exitCode ?? 1,
      durationMs: Date.now() - start,
      timedOut,
    });
  });

  child.on("error", (err) => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;
    respond(conn, {
      stdout,
      stderr: stderr + err.message,
      exitCode: 1,
      durationMs: Date.now() - start,
      timedOut: false,
    });
  });
}

function respond(conn, data) {
  const payload = Buffer.from(JSON.stringify(data), "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(payload.length);
  conn.end(Buffer.concat([lenBuf, payload]));
}

server.on("error", (err) => {
  console.error("agent server error:", err.message);
  process.exit(1);
});

server.listen(SOCK_PATH, () => {
  console.error("agent listening on " + SOCK_PATH);
});
