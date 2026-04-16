import { spawn, type ChildProcess } from "node:child_process";
import { copyFile, mkdir, unlink, access } from "node:fs/promises";
import { join } from "node:path";
import { createConnection, type Socket } from "node:net";
import type { SandboxBackend, ExecutionResult } from "./types.js";
import { FirecrackerApi } from "./firecracker-api.js";

const REQUIRES_LINUX = "FirecrackerBackend requires Linux with KVM enabled";
const BOOT_ARGS = "console=ttyS0 reboot=k panic=1 pci=off";
const VSOCK_PORT = 9999;

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
  vsockUdsPath: string;
  rootfsCopyPath: string;
  cid: number;
  api: FirecrackerApi;
}

/**
 * Firecracker microVM-based sandbox backend.
 * Requires a Linux host with KVM access (/dev/kvm).
 * On non-Linux platforms, all operations throw.
 */
export class FirecrackerBackend implements SandboxBackend {
  private vms = new Map<string, VmState>();
  private nextCid = 3; // CIDs 0-2 are reserved

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
    const vsockUdsPath = join(this.socketDir, `${sandboxId}_v.sock`);
    const rootfsCopyPath = join(this.socketDir, `${sandboxId}.rootfs.ext4`);
    const cid = this.nextCid++;

    // Copy rootfs so each VM has its own writable filesystem
    await copyFile(this.rootfsPath, rootfsCopyPath);

    // Start Firecracker process
    const proc = spawn(this.firecrackerBin, ["--api-sock", socketPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for the API socket to appear
    await this.waitForSocket(socketPath, 5000);

    const api = new FirecrackerApi(socketPath);

    // Configure VM
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

    await api.put("/vsock", {
      guest_cid: cid,
      uds_path: vsockUdsPath,
    });

    // Start the VM
    await api.put("/actions", { action_type: "InstanceStart" });

    const state: VmState = { proc, socketPath, vsockUdsPath, rootfsCopyPath, cid, api };
    this.vms.set(sandboxId, state);

    // Wait for guest agent to be reachable
    await this.waitForAgent(vsockUdsPath, 10000);
  }

  async execute(sandboxId: string, code: string, timeoutMs: number): Promise<ExecutionResult> {
    this.assertLinux();

    const vm = this.vms.get(sandboxId);
    if (!vm) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    return this.sendToAgent(vm.vsockUdsPath, code, timeoutMs);
  }

  async destroy(sandboxId: string): Promise<void> {
    this.assertLinux();

    const vm = this.vms.get(sandboxId);
    if (!vm) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
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
    await unlink(vm.vsockUdsPath).catch(() => {});
    await unlink(vm.rootfsCopyPath).catch(() => {});

    this.vms.delete(sandboxId);
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

  private async waitForAgent(vsockUdsPath: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        // Try connecting to the vsock UDS — Firecracker creates this for host-side connections
        const conn = await this.connectToVsock(vsockUdsPath, 2000);
        conn.destroy();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error("Timeout waiting for guest agent");
  }

  private connectToVsock(vsockUdsPath: string, timeoutMs: number): Promise<Socket> {
    // Firecracker exposes vsock connections via UDS at: {vsockUdsPath}_{port}
    const udsPath = `${vsockUdsPath}_${VSOCK_PORT}`;
    return new Promise((resolve, reject) => {
      const socket = createConnection(udsPath, () => {
        clearTimeout(timer);
        resolve(socket);
      });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Connection timeout"));
      }, timeoutMs);
      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private async sendToAgent(vsockUdsPath: string, code: string, timeoutMs: number): Promise<ExecutionResult> {
    const socket = await this.connectToVsock(vsockUdsPath, 5000);

    return new Promise<ExecutionResult>((resolve, reject) => {
      let data = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Agent response timeout"));
      }, timeoutMs + 5000); // extra buffer for agent overhead

      socket.on("data", (chunk) => {
        data += chunk.toString();
        const newlineIdx = data.indexOf("\n");
        if (newlineIdx !== -1) {
          clearTimeout(timer);
          socket.destroy();
          try {
            const result = JSON.parse(data.slice(0, newlineIdx));
            resolve({
              stdout: result.stdout ?? "",
              stderr: result.stderr ?? "",
              exitCode: result.exitCode ?? 1,
              durationMs: result.durationMs ?? 0,
              timedOut: result.timedOut ?? false,
            });
          } catch (err) {
            reject(new Error(`Failed to parse agent response: ${data}`));
          }
        }
      });

      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      // Send the execution request
      const request = JSON.stringify({ type: "execute", code, timeoutMs });
      socket.write(request + "\n");
    });
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
