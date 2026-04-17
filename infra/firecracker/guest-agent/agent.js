#!/usr/bin/env node

/**
 * SandboxJS Guest Agent — Serial Console Mode
 *
 * Runs inside a Firecracker microVM. Communicates with the host
 * via the serial console (/dev/ttyS0), which maps to Firecracker's
 * stdin/stdout on the host side.
 *
 * Protocol:
 *   Host → Guest (via serial stdin):
 *     {"type":"execute","code":"...","timeoutMs":5000}\n
 *
 *   Guest → Host (via serial stdout):
 *     {"stdout":"...","stderr":"","exitCode":0,"durationMs":12,"timedOut":false}\n
 */

const { spawn } = require("child_process");
const { writeFileSync, openSync, createReadStream, createWriteStream } = require("fs");
const { createInterface } = require("readline");

// Open serial console for communication
const serialIn = createReadStream("/dev/ttyS0");
const serialOut = createWriteStream("/dev/ttyS0");

function sendResponse(data) {
  serialOut.write(JSON.stringify(data) + "\n");
}

// Signal to host that we're ready
sendResponse = function(data) {
  serialOut.write(JSON.stringify(data) + "\n");
};

// Tell host we're ready
serialOut.write("SANDBOXJS_AGENT_READY\n");

// Read lines from serial
const rl = createInterface({ input: serialIn });

rl.on("line", (line) => {
  let request;
  try {
    request = JSON.parse(line.trim());
  } catch {
    return; // Ignore non-JSON lines (kernel messages etc.)
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
});
