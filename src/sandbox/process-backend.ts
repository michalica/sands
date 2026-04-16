import { spawn } from "node:child_process";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SandboxBackend, ExecutionResult } from "./types.js";

export class ProcessBackend implements SandboxBackend {
  private sandboxes = new Set<string>();

  constructor(private maxMemoryMb: number = 256) {}

  private sandboxDir(sandboxId: string): string {
    return join(tmpdir(), "sandboxjs", sandboxId);
  }

  async create(sandboxId: string): Promise<void> {
    const dir = this.sandboxDir(sandboxId);
    await mkdir(dir, { recursive: true });
    this.sandboxes.add(sandboxId);
  }

  exists(sandboxId: string): boolean {
    return this.sandboxes.has(sandboxId);
  }

  async execute(sandboxId: string, code: string, timeoutMs: number): Promise<ExecutionResult> {
    const dir = this.sandboxDir(sandboxId);
    const filePath = join(dir, "job.js");
    await writeFile(filePath, code, "utf-8");

    const start = performance.now();

    return new Promise<ExecutionResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const child = spawn("node", [`--max-old-space-size=${this.maxMemoryMb}`, filePath], {
        cwd: dir,
        timeout: timeoutMs,
        env: { PATH: process.env.PATH },
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
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
        const durationMs = Math.round(performance.now() - start);
        resolve({
          stdout,
          stderr,
          exitCode: exitCode ?? 1,
          durationMs,
          timedOut,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        const durationMs = Math.round(performance.now() - start);
        resolve({
          stdout,
          stderr: stderr + err.message,
          exitCode: 1,
          durationMs,
          timedOut: false,
        });
      });
    });
  }

  async destroy(sandboxId: string): Promise<void> {
    this.sandboxes.delete(sandboxId);
    const dir = this.sandboxDir(sandboxId);
    await rm(dir, { recursive: true, force: true });
  }
}
