#!/usr/bin/env node
/**
 * Captures a Firecracker snapshot for one template.
 *
 *   sudo npx tsx scripts/build-snapshot.ts <template-id>
 *
 * Output:
 *   /opt/sandboxjs/templates/<template-id>/snapshot/state.bin
 *   /opt/sandboxjs/templates/<template-id>/snapshot/memory.bin
 *   /opt/sandboxjs/templates/<template-id>/snapshot/manifest.json
 *
 * On entry, if manifest.json's hashes match the current rootfs + kernel +
 * Firecracker binary, the snapshot is considered current and we exit early.
 *
 * Side effects: boots one short-lived Firecracker VM under jailer, then
 * pauses it and dumps state+memory. The source VM is SIGKILLed afterward.
 */

import { spawn, execSync } from "node:child_process";
import { copyFile, link, mkdir, access, rm, readFile, writeFile, rename } from "node:fs/promises";
import { createConnection } from "node:net";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FirecrackerApi } from "../src/sandbox/firecracker-api.js";

const TEMPLATE_ID = process.argv[2];
if (!TEMPLATE_ID) {
  console.error("Usage: build-snapshot.ts <template-id>");
  process.exit(1);
}

const TEMPLATE_DIR = `/opt/sandboxjs/templates/${TEMPLATE_ID}`;
const ROOTFS_PATH = `${TEMPLATE_DIR}/rootfs.ext4`;
const SNAPSHOT_DIR = `${TEMPLATE_DIR}/snapshot`;
const MANIFEST_PATH = `${SNAPSHOT_DIR}/manifest.json`;
const STATE_OUT = `${SNAPSHOT_DIR}/state.bin`;
const MEMORY_OUT = `${SNAPSHOT_DIR}/memory.bin`;

const KERNEL_PATH = "/opt/sandboxjs/vmlinux";
const FIRECRACKER_BIN = "/usr/local/bin/firecracker";
const JAILER_BIN = "/usr/local/bin/jailer";
const JAILER_UID = 1000;
const JAILER_GID = 1000;

const CHROOT_BASE = "/tmp/snapshot-build";
const JAIL_ID = `${TEMPLATE_ID}-snapshot`;
const CHROOT = `${CHROOT_BASE}/firecracker/${JAIL_ID}/root`;

const MEM_MB = 256;
const VCPU = 1;
const BOOT_ARGS = "console=ttyS0 reboot=k panic=1 pci=off quiet init=/init";
const VSOCK_PORT = 5252;
const GUEST_CID = 3;

interface Manifest {
  templateId: string;
  createdAt: string;
  rootfsSha256: string;
  kernelSha256: string;
  firecrackerVersion: string;
}

function sha256File(path: string): string {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex");
}

function firecrackerVersion(): string {
  try {
    return execSync(`${FIRECRACKER_BIN} --version`, { encoding: "utf8" }).split("\n")[0].trim();
  } catch {
    return "unknown";
  }
}

function currentHashes(): Omit<Manifest, "templateId" | "createdAt"> {
  return {
    rootfsSha256: sha256File(ROOTFS_PATH),
    kernelSha256: sha256File(KERNEL_PATH),
    firecrackerVersion: firecrackerVersion(),
  };
}

async function readManifest(): Promise<Manifest | null> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

function manifestsMatch(a: Manifest, b: Omit<Manifest, "templateId" | "createdAt">): boolean {
  return a.rootfsSha256 === b.rootfsSha256
    && a.kernelSha256 === b.kernelSha256
    && a.firecrackerVersion === b.firecrackerVersion;
}

async function waitForPath(path: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { await access(path); return; } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for path: ${path}`);
}

function probeVsock(udsPath: string, port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(udsPath);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(new Error("vsock probe timeout"));
    }, timeoutMs);
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err); else resolve();
    };
    sock.on("error", (err) => finish(err));
    sock.on("end", () => finish(new Error("probe closed early")));
    sock.on("connect", () => sock.write(`CONNECT ${port}\n`));
    sock.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (text.startsWith("OK ")) finish(null);
      else finish(new Error(`bad handshake: ${text.trim()}`));
    });
  });
}

async function waitForAgent(udsPath: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { await probeVsock(udsPath, VSOCK_PORT, 1000); return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("agent did not become ready within timeout");
}

async function main(): Promise<void> {
  // 0. Sanity check inputs
  await access(ROOTFS_PATH); // throws if template rootfs is missing

  // 1. If a current snapshot already exists, skip.
  const wanted = currentHashes();
  const existing = await readManifest();
  if (existing && manifestsMatch(existing, wanted)) {
    console.log(`[OK] Snapshot already current for ${TEMPLATE_ID}, skipping`);
    return;
  }

  console.log(`[..] Building snapshot for ${TEMPLATE_ID}`);

  // 2. Fresh chroot
  await rm(`${CHROOT_BASE}/firecracker/${JAIL_ID}`, { recursive: true, force: true });
  await mkdir(CHROOT, { recursive: true });

  // 3. Stage kernel + rootfs into the chroot
  try { await link(KERNEL_PATH, join(CHROOT, "vmlinux")); }
  catch { await copyFile(KERNEL_PATH, join(CHROOT, "vmlinux")); }
  await copyFile(ROOTFS_PATH, join(CHROOT, "rootfs.ext4"));

  execSync(`chown -R ${JAILER_UID}:${JAILER_GID} ${CHROOT_BASE}/firecracker/${JAIL_ID}`);

  // 4. Spawn jailer
  const jailerArgs = [
    "--id", JAIL_ID,
    "--exec-file", FIRECRACKER_BIN,
    "--uid", String(JAILER_UID),
    "--gid", String(JAILER_GID),
    "--chroot-base-dir", CHROOT_BASE,
    "--new-pid-ns",
    "--",
    "--api-sock", "run/firecracker.socket",
  ];
  const proc = spawn(JAILER_BIN, jailerArgs, { stdio: ["ignore", "pipe", "pipe"] });
  proc.stderr.on("data", (b: Buffer) => process.stderr.write(`[jailer] ${b.toString()}`));

  try {
    const apiSocket = join(CHROOT, "run/firecracker.socket");
    await waitForPath(apiSocket, 10000);
    const api = new FirecrackerApi(apiSocket);

    // 5. Configure VM (mirrors firecracker-backend.ts:create)
    await api.put("/machine-config", { vcpu_count: VCPU, mem_size_mib: MEM_MB });
    await api.put("/boot-source", { kernel_image_path: "/vmlinux", boot_args: BOOT_ARGS });
    await api.put("/drives/rootfs", {
      drive_id: "rootfs",
      path_on_host: "/rootfs.ext4",
      is_root_device: true,
      is_read_only: false,
    });
    await api.put("/vsock", { guest_cid: GUEST_CID, uds_path: "v.sock" });

    // 6. Entropy device so restored VMs get fresh randomness
    // (Firecracker injects host entropy at restore time.)
    try {
      await api.put("/entropy", {});
    } catch (err) {
      console.warn(`[WARN] /entropy not supported by this Firecracker — restored VMs may share PRNG seed: ${(err as Error).message}`);
    }

    // 7. Boot
    await api.put("/actions", { action_type: "InstanceStart" });

    // 8. Wait for agent
    const vsockUds = join(CHROOT, "v.sock");
    await waitForAgent(vsockUds);
    console.log(`[..] agent ready, pausing VM`);

    // 9. Pause + capture. Pause is PATCH /vm, not /actions.
    await api.patch("/vm", { state: "Paused" });
    await api.put("/snapshot/create", {
      snapshot_path: "/state.bin",
      mem_file_path: "/memory.bin",
      snapshot_type: "Full",
    });
    console.log(`[..] snapshot captured`);
  } finally {
    // 10. Kill source VM (snapshot files are already written to disk).
    // jailer was spawned with --new-pid-ns, so its firecracker child is in
    // a separate PID namespace — killing jailer does NOT take firecracker
    // with it. Need to explicitly kill the firecracker process to avoid
    // leaving orphans that hog KVM and conflict with future builds.
    if (!proc.killed) proc.kill("SIGKILL");
    try {
      execSync(`pkill -9 -f "firecracker --id ${JAIL_ID}"`);
    } catch {
      // pkill returns nonzero when no process matched — fine, nothing to kill
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // 11. Move snapshot files out of the temp chroot to their final home.
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  await rename(join(CHROOT, "state.bin"), STATE_OUT);
  await rename(join(CHROOT, "memory.bin"), MEMORY_OUT);

  // 12. Clean up the temp chroot
  await rm(`${CHROOT_BASE}/firecracker/${JAIL_ID}`, { recursive: true, force: true });

  // 13. Write manifest for invalidation tracking
  const manifest: Manifest = {
    templateId: TEMPLATE_ID,
    createdAt: new Date().toISOString(),
    ...wanted,
  };
  await writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

  console.log(`[OK] Snapshot built for ${TEMPLATE_ID}`);
  console.log(`     state:  ${STATE_OUT}`);
  console.log(`     memory: ${MEMORY_OUT}`);
}

main().catch((err) => {
  console.error("[ERR]", err);
  process.exit(1);
});
