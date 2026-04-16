import type { SandboxBackend, ExecutionResult } from "./types.js";

const REQUIRES_LINUX = "FirecrackerBackend requires Linux with KVM enabled";

/**
 * Firecracker microVM-based sandbox backend.
 *
 * This backend manages Firecracker microVMs for strong isolation.
 * It requires a Linux host with KVM access (/dev/kvm).
 *
 * On non-Linux platforms, all operations throw — use ProcessBackend for local dev.
 *
 * Firecracker API reference: https://github.com/firecracker-microvm/firecracker/blob/main/src/api_server/swagger/firecracker.yaml
 */
export class FirecrackerBackend implements SandboxBackend {
  private sandboxes = new Set<string>();

  constructor(
    private maxMemoryMb: number = 256,
    private vcpuCount: number = 1,
    private kernelImagePath: string = "/opt/sandboxjs/vmlinux",
    private rootfsPath: string = "/opt/sandboxjs/rootfs.ext4",
    private socketDir: string = "/tmp/sandboxjs/firecracker",
  ) {}

  private assertLinux(): void {
    if (process.platform !== "linux") {
      throw new Error(REQUIRES_LINUX);
    }
  }

  exists(sandboxId: string): boolean {
    return this.sandboxes.has(sandboxId);
  }

  /**
   * Create a Firecracker microVM.
   *
   * Steps (to be implemented with actual Firecracker API calls):
   * 1. Create a Unix socket for the Firecracker API
   * 2. Start the Firecracker process with --api-sock
   * 3. PUT /machine-config (vcpu_count, mem_size_mib)
   * 4. PUT /boot-source (kernel_image_path, boot_args)
   * 5. PUT /drives/rootfs (path, is_root_device)
   * 6. PUT /actions (InstanceStart)
   */
  async create(sandboxId: string): Promise<void> {
    this.assertLinux();

    // TODO: Implement Firecracker VM creation
    // const socketPath = join(this.socketDir, `${sandboxId}.sock`);
    // 1. Spawn firecracker --api-sock ${socketPath}
    // 2. Configure VM via HTTP over Unix socket:
    //    - PUT /machine-config { vcpu_count: this.vcpuCount, mem_size_mib: this.maxMemoryMb }
    //    - PUT /boot-source { kernel_image_path: this.kernelImagePath, boot_args: "console=ttyS0 reboot=k panic=1 pci=off" }
    //    - PUT /drives/rootfs { drive_id: "rootfs", path_on_host: this.rootfsPath, is_root_device: true, is_read_only: false }
    //    - PUT /actions { action_type: "InstanceStart" }

    this.sandboxes.add(sandboxId);
  }

  /**
   * Execute code inside a running Firecracker microVM.
   *
   * Communication options:
   * - vsock: Guest agent listens on a vsock port, host sends code and receives results
   * - serial: Write code to serial console, read structured output back
   */
  async execute(sandboxId: string, code: string, timeoutMs: number): Promise<ExecutionResult> {
    this.assertLinux();

    // TODO: Implement code execution via vsock/serial
    // 1. Connect to guest agent via vsock (CID + port)
    // 2. Send { code, timeoutMs } to guest agent
    // 3. Guest agent writes code to /tmp/job.js, runs `node /tmp/job.js`
    // 4. Guest agent returns { stdout, stderr, exitCode, durationMs, timedOut }

    return {
      stdout: "",
      stderr: "Firecracker execution not yet implemented",
      exitCode: 1,
      durationMs: 0,
      timedOut: false,
    };
  }

  /**
   * Destroy a Firecracker microVM.
   *
   * Steps:
   * 1. Send InstanceHalt action via Firecracker API
   * 2. Kill the Firecracker process
   * 3. Clean up the Unix socket
   */
  async destroy(sandboxId: string): Promise<void> {
    this.assertLinux();

    // TODO: Implement VM destruction
    // 1. PUT /actions { action_type: "SendCtrlAltDel" } to graceful shutdown
    // 2. Kill firecracker process
    // 3. Remove socket file

    this.sandboxes.delete(sandboxId);
  }
}
