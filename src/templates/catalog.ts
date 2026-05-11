import type { SandboxTemplate } from "../sandbox/types.js";

const SHARED_KERNEL_PATH = "/opt/sandboxjs/vmlinux";
const TEMPLATE_BASE_DIR = "/opt/sandboxjs/templates";

function templateRootfsPath(id: string): string {
  return `${TEMPLATE_BASE_DIR}/${id}/rootfs.ext4`;
}

function templateSpecPath(id: string): string {
  return `${process.cwd()}/infra/firecracker/templates/${id}.json`;
}

export function getSeedTemplates(): SandboxTemplate[] {
  return [
    {
      id: "node-22",
      name: "Node.js 22",
      version: "22",
      rootfsPath: templateRootfsPath("node-22"),
      kernelPath: SHARED_KERNEL_PATH,
      defaultPackages: ["node"],
      buildMeta: {
        seeded: true,
        specPath: templateSpecPath("node-22"),
      },
    },
    {
      id: "python-3.12",
      name: "Python 3.12",
      version: "3.12",
      rootfsPath: templateRootfsPath("python-3.12"),
      kernelPath: SHARED_KERNEL_PATH,
      defaultPackages: ["python3", "pip"],
      buildMeta: {
        seeded: true,
        specPath: templateSpecPath("python-3.12"),
      },
    },
  ];
}
