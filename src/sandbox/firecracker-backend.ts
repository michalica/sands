import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, unlink, access } from "node:fs/promises";
import { join } from "node:path";
import type { SandboxBackend, ExecutionResult } from "./types.js";
import { FirecrackerApi } from "./firecracker-api.js";

const REQUIRES_LINUX = "FirecrackerBackend requires Linux with KVM enabled";
const BOOT_ARGS = "console=ttyS0 reboot=k panic=1 pci=off init=/init";
const AGENT_READY_MARKER = "SANDBOXJS_AGENT_READY";

export interface FirecrackerConfig {
  maxMemoryMb: number;
  vcpuCount?: number;
  kernelImagePath?: string;
  rootfsPath?: string;
  socketDir?: string;
  firecrackerBin?: string;
}

interface VmState {
  proc: ChildProcess;
  socketPath: string;
  rootfsCopyPath: string;
  api: FirecrackerApi;
  serialBuffer: string;
  ready: boolean;
  pendingResolve: ((result: ExecutionResult) => void) | null;
  pendingReject: ((err: Error) => void) | null;
}

/**
 * Firecracker microVM-based sandbox backend.
 * Uses serial console (stdin/stdout) for guest-host communication
 * instead of vsock (which has issues on Raspberry Pi kernels).
 */
export class FirecrackerBackend implements SandboxBackend {
  private vms = new Map<string, VmState>();

  private maxMemoryMb: number;
  private vcpuCount: number;
  private kernelImagePath: string;
  private rootfsPath: string;
  private socketDir: string;
  private firecrackerBin: string;

  constructor(config: FirecrackerConfig) {
    this.maxMemoryMb = config.maxMemoryMb;
    this.vcpuCount = config.vcpuCount ?? 1;
    this.kernelImagePath = config.kernelImagePath ?? "/opt/sandboxjs/vmlinux";
    this.rootfsPath = config.rootfsPath ?? "/opt/sandboxjs/rootfs.ext4";
    this.socketDir = config.socketDir ?? "/tmp/sandboxjs/firecracker";
    this.firecrackerBin = config.firecrackerBin ?? "/usr/local/bin/firecracker";
  }

  private assertLinux(): void {
    if (process.platform !== "linux") {
      throw new Error(REQUIRES_LINUX);
    }
  }

  exists(sandboxId: string): boolean {
    return this.vms.has(sandboxId);
  }

  async create(sandboxId: string): Promise<void> {
    this.assertLinux();

    await mkdir(this.socketDir, { recursive: true });

    const socketPath = join(this.socketDir, `${sandboxId}.sock`);
    const rootfsCopyPath = join(this.socketDir, `${sandboxId}.rootfs.ext4`);

    // Copy rootfs so each VM has its own writable filesystem
    await copyFile(this.rootfsPath, rootfsCopyPath);

    // Start Firecracker process — pipe stdin/stdout for serial console communication
    const proc = spawn(this.firecrackerBin, ["--api-sock", socketPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Wait for the API socket to appear
    await this.waitForSocket(socketPath, 5000);

    const api = new FirecrackerApi(socketPath);

    // Configure VM — no vsock, use serial console instead
    await api.put("/machine-config", {
      vcpu_count: this.vcpuCount,
      mem_size_mib: this.maxMemoryMb,
    });

    await api.put("/boot-source", {
      kernel_image_path: this.kernelImagePath,
      boot_args: BOOT_ARGS,
    });

    await api.put("/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: rootfsCopyPath,
      is_root_device: true,
      is_read_only: false,
    });

    // Start the VM
    await api.put("/actions", { action_type: "InstanceStart" });

    const state: VmState = {
      proc,
      socketPath,
      rootfsCopyPath,
      api,
      serialBuffer: "",
      ready: false,
      pendingResolve: null,
      pendingReject: null,
    };

    // Listen for serial output from the VM
    proc.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      console.log(`[FC:${sandboxId.slice(0, 8)}] stdout: ${JSON.stringify(text.slice(0, 200))}`);
      this.handleSerialData(sandboxId, text);
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      console.log(`[FC:${sandboxId.slice(0, 8)}] stderr: ${chunk.toString().slice(0, 200)}`);
    });

    this.vms.set(sandboxId, state);

    // Wait for the guest agent to signal it's ready
    await this.waitForAgent(sandboxId, 15000);
  }

  async execute(sandboxId: string, code: string, timeoutMs: number): Promise<ExecutionResult> {
    this.assertLinux();

    const vm = this.vms.get(sandboxId);
    if (!vm) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    if (!vm.ready) {
      throw new Error("Guest agent not ready");
    }

    return new Promise<ExecutionResult>((resolve, reject) => {
      vm.pendingResolve = resolve;
      vm.pendingReject = reject;

      const timer = setTimeout(() => {
        vm.pendingResolve = null;
        vm.pendingReject = null;
        reject(new Error("Agent response timeout"));
      }, timeoutMs + 5000);

      // Store timer ref on the resolve so we can clear it
      const origResolve = resolve;
      vm.pendingResolve = (result) => {
        clearTimeout(timer);
        vm.pendingResolve = null;
        vm.pendingReject = null;
        origResolve(result);
      };

      const origReject = reject;
      vm.pendingReject = (err) => {
        clearTimeout(timer);
        vm.pendingResolve = null;
        vm.pendingReject = null;
        origReject(err);
      };

      // Send code to guest agent via serial console (stdin)
      const request = JSON.stringify({ type: "execute", code, timeoutMs });
      vm.proc.stdin!.write(request + "\n");
    });
  }

  async destroy(sandboxId: string): Promise<void> {
    this.assertLinux();

    const vm = this.vms.get(sandboxId);
    if (!vm) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    // Reject any pending execution
    if (vm.pendingReject) {
      vm.pendingReject(new Error("Sandbox destroyed"));
    }

    // Try graceful shutdown
    try {
      await vm.api.put("/actions", { action_type: "SendCtrlAltDel" });
      await this.waitForProcessExit(vm.proc, 3000);
    } catch {
      // Force kill if graceful shutdown fails
    }

    if (!vm.proc.killed) {
      vm.proc.kill("SIGKILL");
    }

    // Cleanup files
    await unlink(vm.socketPath).catch(() => {});
    await unlink(vm.rootfsCopyPath).catch(() => {});

    this.vms.delete(sandboxId);
  }

  private handleSerialData(sandboxId: string, data: string): void {
    const vm = this.vms.get(sandboxId);
    if (!vm) return;

    vm.serialBuffer += data;

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = vm.serialBuffer.indexOf("\n")) !== -1) {
      const line = vm.serialBuffer.slice(0, newlineIdx).trim();
      vm.serialBuffer = vm.serialBuffer.slice(newlineIdx + 1);

      // Check for agent ready signal
      if (line === AGENT_READY_MARKER) {
        vm.ready = true;
        continue;
      }

      // Try to parse as JSON result from agent
      if (vm.pendingResolve && line.startsWith("{")) {
        try {
          const result = JSON.parse(line);
          if ("exitCode" in result) {
            vm.pendingResolve({
              stdout: result.stdout ?? "",
              stderr: result.stderr ?? "",
              exitCode: result.exitCode ?? 1,
              durationMs: result.durationMs ?? 0,
              timedOut: result.timedOut ?? false,
            });
          }
        } catch {
          // Not valid JSON, ignore (kernel boot messages etc.)
        }
      }
    }
  }

  private waitForAgent(sandboxId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const vm = this.vms.get(sandboxId);
        if (!vm) {
          reject(new Error("VM disappeared"));
          return;
        }
        if (vm.ready) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Timeout waiting for guest agent"));
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });
  }

  private async waitForSocket(path: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await access(path);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    throw new Error(`Timeout waiting for socket: ${path}`);
  }

  private waitForProcessExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), timeoutMs);
      proc.on("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
