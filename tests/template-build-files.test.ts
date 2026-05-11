import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const base = "/Users/tomasmichalica/Documents/sands/infra/firecracker";

describe("template build scaffolding", () => {
  it("includes a build-template.sh entrypoint", () => {
    expect(existsSync(`${base}/build-template.sh`)).toBe(true);
  });

  it("includes a node-22 setup script", () => {
    const script = readFileSync(`${base}/templates/node-22/setup.sh`, "utf-8");

    expect(script).toContain("Node.js 22");
    expect(script).toContain("apt-get");
  });

  it("includes a python-3.12 setup script", () => {
    const script = readFileSync(`${base}/templates/python-3.12/setup.sh`, "utf-8");

    expect(script).toContain("Python 3.12");
    expect(script).toContain("apt-get");
    expect(script).toContain("python3");
  });

  it("documents how to build a named template", () => {
    const script = readFileSync(`${base}/build-template.sh`, "utf-8");

    expect(script).toContain("Usage: ./build-template.sh <template-id>");
    expect(script).toContain("templates/${TEMPLATE_ID}/setup.sh");
    expect(script).toContain("/opt/sandboxjs/templates/${TEMPLATE_ID}/rootfs.ext4");
    expect(script).toContain("/opt/sandboxjs/base/rootfs.ext4");
    expect(script).toContain("SETUP_SCRIPT_PATH");
  });

  it("includes a base rootfs build entrypoint", () => {
    const script = readFileSync(`${base}/build-base-rootfs.sh`, "utf-8");

    expect(script).toContain("/opt/sandboxjs/base/rootfs.ext4");
    expect(script).toContain("guest-agent");
  });

});
