#!/usr/bin/env node

/**
 * SandboxJS Guest Agent — Serial Console Mode
 *
 * Communicates via process.stdin/stdout which the init script
 * connects to /dev/ttyS0 (Firecracker serial console).
 *
 * Protocol:
 *   Host → Guest:  {"type":"execute","code":"...","timeoutMs":5000}\n
 *   Guest → Host:  {"stdout":"...","stderr":"","exitCode":0,"durationMs":12,"timedOut":false}\n
 */

const { spawn } = require("child_process");
const { writeFileSync } = require("fs");
const { createInterface } = require("readline");

function send(data) {
  process.stdout.write(JSON.stringify(data) + "\n");
}

// Signal ready
process.stdout.write("SANDBOXJS_AGENT_READY\n");

const rl = createInterface({ input: process.stdin });

rl.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line.trim());
  } catch {
    return;
  }

  if (request.type !== "execute" || typeof request.code !== "string") {
    return;
  }

  const { code, timeoutMs = 5000 } = request;

  writeFileSync("/tmp/job.js", code, "utf-8");

  const start = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;

  const child = spawn("/usr/local/bin/node", ["--max-old-space-size=256", "/tmp/job.js"], {
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
    send({
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
    send({
      stdout,
      stderr: stderr + err.message,
      exitCode: 1,
      durationMs: Date.now() - start,
      timedOut: false,
    });
  });
});
