import { spawn, execSync, type ChildProcess } from "node:child_process";
import { copyFile, link, mkdir, access, rm, open } from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import { join, basename } from "node:path";
import type { SandboxBackend, ExecutionResult } from "./types.js";
import { FirecrackerApi } from "./firecracker-api.js";

const REQUIRES_LINUX = "FirecrackerBackend requires Linux with KVM enabled";
const BOOT_ARGS = "console=ttyS0 reboot=k panic=1 pci=off init=/init";
const AGENT_READY_MARKER = "SANDBOXJS_AGENT_READY";
const API_SOCKET_NAME = "run/firecracker.socket";

export interface FirecrackerConfig {
  maxMemoryMb: number;
  vcpuCount?: number;
  kernelImagePath?: string;
  rootfsPath?: string;
  socketDir?: string;
  firecrackerBin?: string;
  jailerBin?: string;
  jailerUid?: number;
  jailerGid?: number;
  cpuQuotaPercent?: number;
  chrootBaseDir?: string;
}

interface VmState {
  proc: ChildProcess;
  jailId: string;
  chrootPath: string;
  apiSocketPath: string;
  serialInputPath: string;
  serialInput: WriteStream | null;
  api: FirecrackerApi;
  serialBuffer: string;
  ready: boolean;
  pendingResolve: ((result: ExecutionResult) => void) | null;
  pendingReject: ((err: Error) => void) | null;
}

/**
 * Firecracker microVM-based sandbox backend with jailer support.
 * Uses jailer for chroot, cgroups (CPU limits), privilege dropping.
 * Uses serial console (stdin/stdout) for guest-host communication.
 */
export class FirecrackerBackend implements SandboxBackend {
  private vms = new Map<string, VmState>();

  private maxMemoryMb: number;
  private vcpuCount: number;
  private kernelImagePath: string;
  private rootfsPath: string;
  private firecrackerBin: string;
  private jailerBin: string;
  private jailerUid: number;
  private jailerGid: number;
  private cpuQuotaPercent: number;
  private chrootBaseDir: string;

  constructor(config: FirecrackerConfig) {
    this.maxMemoryMb = config.maxMemoryMb;
    this.vcpuCount = config.vcpuCount ?? 1;
    this.kernelImagePath = config.kernelImagePath ?? "/opt/sandboxjs/vmlinux";
    this.rootfsPath = config.rootfsPath ?? "/opt/sandboxjs/rootfs.ext4";
    this.firecrackerBin = config.firecrackerBin ?? "/usr/local/bin/firecracker";
    this.jailerBin = config.jailerBin ?? "/usr/local/bin/jailer";
    this.jailerUid = config.jailerUid ?? 1000;
    this.jailerGid = config.jailerGid ?? 1000;
    this.cpuQuotaPercent = config.cpuQuotaPercent ?? 50;
    this.chrootBaseDir = config.chrootBaseDir ?? "/srv/jailer";
  }

  private assertLinux(): void {
    if (process.platform !== "linux") {
      throw new Error(REQUIRES_LINUX);
    }
  }

  /** Sanitize sandbox ID for jailer: alphanumeric + hyphens only, max 64 chars */
  sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
  }

  /** Get the chroot root path for a jailed sandbox */
  getChrootPath(sandboxId: string): string {
    const id = this.sanitizeId(sandboxId);
    const execName = basename(this.firecrackerBin);
    return join(this.chrootBaseDir, execName, id, "root");
  }

  /** Get the full host path to the API socket inside the chroot */
  getApiSocketPath(sandboxId: string): string {
    return join(this.getChrootPath(sandboxId), API_SOCKET_NAME);
  }

  /** Build the jailer command-line arguments */
  buildJailerArgs(sandboxId: string): string[] {
    const id = this.sanitizeId(sandboxId);
    const args = [
      "--id", id,
      "--exec-file", this.firecrackerBin,
      "--uid", String(this.jailerUid),
      "--gid", String(this.jailerGid),
      "--chroot-base-dir", this.chrootBaseDir,
      "--new-pid-ns",
    ];

    // Add CPU cgroup limit if configured
    if (this.cpuQuotaPercent > 0 && this.cpuQuotaPercent < 100) {
      const quota = Math.round(this.cpuQuotaPercent * 1000);
      args.push("--cgroup-version", "2");
      args.push("--cgroup", `cpu.max=${quota} 100000`);
    }

    // Separator for firecracker args
    args.push("--", "--api-sock", API_SOCKET_NAME);
    return args;
  }

  exists(sandboxId: string): boolean {
    return this.vms.has(sandboxId);
  }

  async create(sandboxId: string): Promise<void> {
    this.assertLinux();

    const jailId = this.sanitizeId(sandboxId);
    const chrootPath = this.getChrootPath(sandboxId);
    const apiSocketPath = this.getApiSocketPath(sandboxId);

    // Jailer creates the chroot dir, but we need to pre-populate resources
    await mkdir(chrootPath, { recursive: true });

    // Hard-link (or copy) kernel and rootfs into the chroot
    const chrootKernel = join(chrootPath, "vmlinux");
    const chrootRootfs = join(chrootPath, "rootfs.ext4");

    try {
      await link(this.kernelImagePath, chrootKernel);
    } catch {
      await copyFile(this.kernelImagePath, chrootKernel);
    }
    await copyFile(this.rootfsPath, chrootRootfs);

    // Create a FIFO for serial input (jailer closes stdin, so we need a pipe)
    const serialInputPath = join(chrootPath, "serial.in");
    execSync(`mkfifo ${serialInputPath}`);

    // Set ownership so the jailed process (uid/gid) can access the files
    execSync(`chown -R ${this.jailerUid}:${this.jailerGid} ${chrootPath}`);

    // Spawn jailer with stdin from the FIFO
    // We use a shell wrapper to redirect the FIFO to stdin
    const args = this.buildJailerArgs(sandboxId);
    console.log(`[jailer] spawning with FIFO serial input`);
    const proc = spawn("sh", ["-c", `${this.jailerBin} ${args.map(a => `'${a}'`).join(" ")} < ${serialInputPath}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Open the FIFO for writing (must happen after the reader opens it)
    // Opening FIFO for write blocks until a reader exists, so do it after spawn
    await new Promise((r) => setTimeout(r, 500));
    const serialInput = createWriteStream(serialInputPath, { flags: "w" });

    // Capture early exit / errors
    proc.stderr!.on("data", (chunk: Buffer) => {
      console.log(`[jailer:${jailId.slice(0, 8)}] stderr: ${chunk.toString().trim()}`);
    });
    proc.on("exit", (code) => {
      if (code !== null && code !== 0) {
        console.log(`[jailer:${jailId.slice(0, 8)}] exited with code ${code}`);
      }
    });

    // Wait for API socket
    await this.waitForSocket(apiSocketPath, 10000);

    const api = new FirecrackerApi(apiSocketPath);

    // Configure VM — paths are relative to chroot
    await api.put("/machine-config", {
      vcpu_count: this.vcpuCount,
      mem_size_mib: this.maxMemoryMb,
    });

    await api.put("/boot-source", {
      kernel_image_path: "/vmlinux",
      boot_args: BOOT_ARGS,
    });

    await api.put("/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: "/rootfs.ext4",
      is_root_device: true,
      is_read_only: false,
    });

    // Start the VM
    await api.put("/actions", { action_type: "InstanceStart" });

    const state: VmState = {
      proc,
      jailId,
      chrootPath,
      apiSocketPath,
      serialInputPath,
      serialInput,
      api,
      serialBuffer: "",
      ready: false,
      pendingResolve: null,
      pendingReject: null,
    };

    // Listen for serial output from the VM
    proc.stdout!.on("data", (chunk: Buffer) => {
      this.handleSerialData(sandboxId, chunk.toString());
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
      const timer = setTimeout(() => {
        vm.pendingResolve = null;
        vm.pendingReject = null;
        reject(new Error("Agent response timeout"));
      }, timeoutMs + 5000);

      vm.pendingResolve = (result) => {
        clearTimeout(timer);
        vm.pendingResolve = null;
        vm.pendingReject = null;
        resolve(result);
      };

      vm.pendingReject = (err) => {
        clearTimeout(timer);
        vm.pendingResolve = null;
        vm.pendingReject = null;
        reject(err);
      };

      // Send code to guest agent via serial FIFO
      const request = JSON.stringify({ type: "execute", code, timeoutMs });
      console.log(`[jailer:${vm.jailId.slice(0, 8)}] sending to serial FIFO`);
      if (vm.serialInput) {
        vm.serialInput.write(request + "\n");
      } else {
        reject(new Error("Serial input not available"));
      }
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

    // Close serial input FIFO
    if (vm.serialInput) {
      vm.serialInput.end();
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

    // Remove entire chroot directory
    const execName = basename(this.firecrackerBin);
    const jailDir = join(this.chrootBaseDir, execName, vm.jailId);
    await rm(jailDir, { recursive: true, force: true });

    this.vms.delete(sandboxId);
  }

  private handleSerialData(sandboxId: string, data: string): void {
    const vm = this.vms.get(sandboxId);
    if (!vm) return;

    console.log(`[serial:${vm.jailId.slice(0, 8)}] received: ${JSON.stringify(data.slice(0, 200))}`);
    vm.serialBuffer += data;

    let newlineIdx: number;
    while ((newlineIdx = vm.serialBuffer.indexOf("\n")) !== -1) {
      const line = vm.serialBuffer.slice(0, newlineIdx).trim();
      vm.serialBuffer = vm.serialBuffer.slice(newlineIdx + 1);

      if (line === AGENT_READY_MARKER) {
        vm.ready = true;
        continue;
      }

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
          // Not valid JSON, ignore
        }
      }
    }
  }

  private waitForAgent(sandboxId: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const vm = this.vms.get(sandboxId);
        if (!vm) { reject(new Error("VM disappeared")); return; }
        if (vm.ready) { resolve(); return; }
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
