#!/usr/bin/env node

/**
 * SandboxJS Guest Agent
 *
 * Runs inside a Firecracker microVM. Receives JS code over stdin (one JSON line),
 * executes it with Node.js, and writes the result as JSON to stdout.
 *
 * Used with socat: socat VSOCK-LISTEN:9999,fork EXEC:"node /opt/agent/agent.js"
 *
 * Protocol:
 *   Input:  {"type":"execute","code":"...","timeoutMs":5000}\n
 *   Output: {"stdout":"...","stderr":"","exitCode":0,"durationMs":12,"timedOut":false}\n
 */

const { spawn } = require("child_process");
const { writeFileSync } = require("fs");

let input = "";

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  const newlineIdx = input.indexOf("\n");
  if (newlineIdx !== -1) {
    const line = input.slice(0, newlineIdx);
    input = input.slice(newlineIdx + 1);
    handleRequest(line);
  }
});

function handleRequest(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    sendResponse({ error: "Invalid JSON" });
    return;
  }

  if (request.type !== "execute" || typeof request.code !== "string") {
    sendResponse({ error: "Invalid request" });
    return;
  }

  const { code, timeoutMs = 5000 } = request;

  writeFileSync("/tmp/job.js", code, "utf-8");

  const start = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;

  const child = spawn("node", ["--max-old-space-size=256", "/tmp/job.js"], {
    timeout: timeoutMs,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, timeoutMs);

  child.on("close", (exitCode) => {
    clearTimeout(timer);
    if (settled) return;
    settled = true;
    sendResponse({
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
    sendResponse({
      stdout,
      stderr: stderr + err.message,
      exitCode: 1,
      durationMs: Date.now() - start,
      timedOut: false,
    });
  });
}

function sendResponse(data) {
  process.stdout.write(JSON.stringify(data) + "\n");
}
