import { spawn, execSync, type ChildProcess } from "node:child_process";
import { copyFile, link, mkdir, access, rm } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { join, basename, dirname } from "node:path";
import type { SandboxBackend, ExecutionResult, SandboxTemplate } from "./types.js";
import { FirecrackerApi } from "./firecracker-api.js";

const REQUIRES_LINUX = "FirecrackerBackend requires Linux with KVM enabled";
const BOOT_ARGS = "console=ttyS0 reboot=k panic=1 pci=off quiet init=/init";
const API_SOCKET_NAME = "run/firecracker.socket";
const VSOCK_UDS_NAME = "v.sock";
const GUEST_CID = 3;
const AGENT_VSOCK_PORT = 5252;
const READY_TIMEOUT_MS = 15000;
const READY_POLL_INTERVAL_MS = 100;

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

interface NetworkInterfaceConfig {
  iface_id: string;
  host_dev_name: string;
  guest_mac: string;
}

interface VmState {
  proc: ChildProcess;
  jailId: string;
  chrootPath: string;
  apiSocketPath: string;
  vsockUdsPath: string;
  api: FirecrackerApi;
}

/**
 * Firecracker microVM-based sandbox backend with jailer support.
 * Uses jailer for chroot, cgroups (CPU limits), privilege dropping.
 * Uses virtio-vsock for guest-host communication: each call opens its own
 * stream via the chroot UDS (`v.sock`), sends a length-prefixed JSON
 * request, reads a length-prefixed JSON response, and closes.
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

  /** Get the full host path to the vsock UDS inside the chroot */
  getVsockUdsPath(sandboxId: string): string {
    return join(this.getChrootPath(sandboxId), VSOCK_UDS_NAME);
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

  getTapDeviceName(sandboxId: string): string {
    return `tap-${this.sanitizeId(sandboxId)}`.slice(0, 15);
  }

  buildNetworkInterfaceConfig(sandboxId: string): NetworkInterfaceConfig {
    const bytes = [0, 0, 0, 0];
    for (let i = 0; i < sandboxId.length; i += 1) {
      bytes[i % bytes.length] = (bytes[i % bytes.length] + sandboxId.charCodeAt(i)) % 256;
    }
    const pairs = bytes.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"));
    return {
      iface_id: "eth0",
      host_dev_name: this.getTapDeviceName(sandboxId),
      guest_mac: `02:FC:${pairs.join(":")}`,
    };
  }

  exists(sandboxId: string): boolean {
    return this.vms.has(sandboxId);
  }

  /** Where the snapshot files for a template would live, if any. */
  snapshotPaths(template?: SandboxTemplate): { state: string; memory: string } | null {
    const rootfs = template?.rootfsPath ?? this.rootfsPath;
    if (!rootfs) return null;
    const dir = dirname(rootfs);
    return {
      state: join(dir, "snapshot", "state.bin"),
      memory: join(dir, "snapshot", "memory.bin"),
    };
  }

  /** True if both snapshot files exist on disk for this template. */
  async hasSnapshot(template?: SandboxTemplate): Promise<boolean> {
    const paths = this.snapshotPaths(template);
    if (!paths) return false;
    try {
      await access(paths.state);
      await access(paths.memory);
      return true;
    } catch {
      return false;
    }
  }

  async create(sandboxId: string, template?: SandboxTemplate): Promise<void> {
    this.assertLinux();

    const jailId = this.sanitizeId(sandboxId);
    const chrootPath = this.getChrootPath(sandboxId);
    const apiSocketPath = this.getApiSocketPath(sandboxId);
    const vsockUdsPath = this.getVsockUdsPath(sandboxId);

    // Jailer creates the chroot dir, but we need to pre-populate resources
    await mkdir(chrootPath, { recursive: true });

    // Hard-link (or copy) kernel and rootfs into the chroot
    const chrootKernel = join(chrootPath, "vmlinux");
    const chrootRootfs = join(chrootPath, "rootfs.ext4");

    const kernelImagePath = template?.kernelPath ?? this.kernelImagePath;
    const rootfsPath = template?.rootfsPath ?? this.rootfsPath;

    try {
      await link(kernelImagePath, chrootKernel);
    } catch {
      await copyFile(kernelImagePath, chrootKernel);
    }
    await copyFile(rootfsPath, chrootRootfs);

    // If a snapshot exists for this template, stage it into the chroot so we can
    // restore from it instead of doing a full kernel boot.
    let useSnapshot = false;
    const snapshot = this.snapshotPaths(template);
    if (snapshot) {
      try {
        await access(snapshot.state);
        await access(snapshot.memory);
        try {
          await link(snapshot.state, join(chrootPath, "state.bin"));
          await link(snapshot.memory, join(chrootPath, "memory.bin"));
        } catch {
          // Cross-filesystem hardlink fails — copy instead. Slower but correct.
          await copyFile(snapshot.state, join(chrootPath, "state.bin"));
          await copyFile(snapshot.memory, join(chrootPath, "memory.bin"));
        }
        useSnapshot = true;
      } catch {
        // No snapshot present; fall through to cold boot.
      }
    }

    // Set ownership so the jailed process (uid/gid) can access the files
    execSync(`chown -R ${this.jailerUid}:${this.jailerGid} ${chrootPath}`);

    // Spawn jailer. Stdin goes nowhere; stdout/stderr captured for logging.
    const args = this.buildJailerArgs(sandboxId);
    const proc = spawn(this.jailerBin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      console.log(`[jailer:${jailId.slice(0, 8)}] stderr: ${chunk.toString().trim()}`);
    });
    proc.on("exit", (code) => {
      if (code !== null && code !== 0) {
        console.log(`[jailer:${jailId.slice(0, 8)}] exited with code ${code}`);
      }
    });

    // Wait for API socket
    await this.waitForPath(apiSocketPath, 10000);

    const api = new FirecrackerApi(apiSocketPath);

    if (useSnapshot) {
      // Restore from snapshot. The snapshot already contains machine config,
      // boot source, drives, vsock device — we only need to load it.
      await api.put("/snapshot/load", {
        snapshot_path: "/state.bin",
        mem_backend: { backend_type: "File", backend_path: "/memory.bin" },
        enable_diff_snapshots: false,
        resume_vm: true,
      });
    } else {
      // Cold boot path. Configure each device, then InstanceStart.
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

      // Configure vsock. uds_path is relative to chroot; Firecracker creates
      // <chroot>/v.sock and listens there. Each incoming host-side connection
      // initiates with "CONNECT <port>\n" to reach the guest on that vsock port.
      await api.put("/vsock", {
        guest_cid: GUEST_CID,
        uds_path: VSOCK_UDS_NAME,
      });

      // Entropy device — also matters for snapshot-loaded VMs (the device is
      // captured by the snapshot, so it's already wired up there).
      try {
        await api.put("/entropy", {});
      } catch {
        // Older Firecracker without entropy device; not fatal.
      }

      // Start the VM
      await api.put("/actions", { action_type: "InstanceStart" });
    }

    const state: VmState = {
      proc,
      jailId,
      chrootPath,
      apiSocketPath,
      vsockUdsPath,
      api,
    };

    this.vms.set(sandboxId, state);

    // Wait for the guest agent to accept a vsock connection.
    await this.waitForAgent(sandboxId, READY_TIMEOUT_MS);
  }

  async execute(sandboxId: string, code: string, timeoutMs: number): Promise<ExecutionResult> {
    this.assertLinux();

    const vm = this.vms.get(sandboxId);
    if (!vm) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const request = { type: "execute", code, timeoutMs };
    const response = await this.callAgent(vm.vsockUdsPath, request, timeoutMs + 5000);

    return {
      stdout: typeof response.stdout === "string" ? response.stdout : "",
      stderr: typeof response.stderr === "string" ? response.stderr : "",
      exitCode: typeof response.exitCode === "number" ? response.exitCode : 1,
      durationMs: typeof response.durationMs === "number" ? response.durationMs : 0,
      timedOut: response.timedOut === true,
    };
  }

  async destroy(sandboxId: string): Promise<void> {
    this.assertLinux();

    const vm = this.vms.get(sandboxId);
    if (!vm) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    // SIGKILL directly. Firecracker microVMs rarely respond to SendCtrlAltDel,
    // and these are ephemeral — there's no graceful state to preserve.
    // jailer is spawned with --new-pid-ns; its firecracker child is in a
    // separate PID namespace, so killing jailer does NOT take firecracker
    // with it. Explicitly kill any firecracker for this jail ID too.
    vm.proc.kill("SIGKILL");
    try {
      execSync(`pkill -9 -f "firecracker --id ${vm.jailId}"`);
    } catch {
      // pkill returns nonzero when no match — expected when jailer cleanup worked
    }
    await this.waitForProcessExit(vm.proc, 500);

    // Remove entire chroot directory
    const execName = basename(this.firecrackerBin);
    const jailDir = join(this.chrootBaseDir, execName, vm.jailId);
    await rm(jailDir, { recursive: true, force: true });

    this.vms.delete(sandboxId);
  }

  /** Open a vsock connection to the agent via Firecracker's UDS and run one request/response cycle. */
  private callAgent(udsPath: string, request: object, timeoutMs: number): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const sock: Socket = createConnection(udsPath);
      let phase: "handshake" | "payload" = "handshake";
      let buffer = Buffer.alloc(0);
      let expected: number | null = null;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sock.destroy();
        reject(new Error("Agent call timeout"));
      }, timeoutMs);

      const finish = (err: Error | null, value?: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        if (err) reject(err);
        else resolve(value!);
      };

      sock.on("error", (err) => finish(err));
      sock.on("end", () => {
        if (!settled) finish(new Error("Agent closed connection prematurely"));
      });

      sock.on("connect", () => {
        // Firecracker vsock handshake: ask to be routed to the guest agent's port.
        sock.write(`CONNECT ${AGENT_VSOCK_PORT}\n`);
      });

      sock.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);

        if (phase === "handshake") {
          const newlineIdx = buffer.indexOf(0x0a);
          if (newlineIdx === -1) return;
          const line = buffer.subarray(0, newlineIdx).toString("utf8");
          buffer = buffer.subarray(newlineIdx + 1);
          if (!line.startsWith("OK ")) {
            return finish(new Error(`Firecracker vsock handshake failed: ${line}`));
          }
          phase = "payload";

          // Now send the length-prefixed JSON request.
          const payload = Buffer.from(JSON.stringify(request), "utf8");
          const lenBuf = Buffer.alloc(4);
          lenBuf.writeUInt32BE(payload.length);
          sock.write(Buffer.concat([lenBuf, payload]));
        }

        if (phase === "payload") {
          if (expected === null && buffer.length >= 4) {
            expected = buffer.readUInt32BE(0);
            buffer = buffer.subarray(4);
          }
          if (expected !== null && buffer.length >= expected) {
            const json = buffer.subarray(0, expected).toString("utf8");
            try {
              finish(null, JSON.parse(json) as Record<string, unknown>);
            } catch (err) {
              finish(err as Error);
            }
          }
        }
      });
    });
  }

  /** Poll-connect to the guest agent until it answers, or time out. */
  private async waitForAgent(sandboxId: string, timeoutMs: number): Promise<void> {
    const vm = this.vms.get(sandboxId);
    if (!vm) throw new Error("VM disappeared before readiness check");

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await this.probeAgent(vm.vsockUdsPath);
        return;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
    }
    throw new Error("Timeout waiting for guest agent");
  }

  /** A single attempt to reach the agent. Resolves on successful handshake. */
  private probeAgent(udsPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock: Socket = createConnection(udsPath);
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sock.destroy();
        reject(new Error("probe timeout"));
      }, 1000);

      const finish = (err: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sock.destroy();
        if (err) reject(err);
        else resolve();
      };

      sock.on("error", (err) => finish(err));
      sock.on("end", () => finish(new Error("probe closed early")));
      sock.on("connect", () => {
        sock.write(`CONNECT ${AGENT_VSOCK_PORT}\n`);
      });
      sock.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (text.startsWith("OK ")) finish(null);
        else finish(new Error(`bad handshake: ${text.trim()}`));
      });
    });
  }

  private async waitForPath(path: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await access(path);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    throw new Error(`Timeout waiting for path: ${path}`);
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
