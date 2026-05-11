import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const base = resolve(process.cwd(), "infra/firecracker");

describe("template build scaffolding", () => {
  it("includes a build-template.sh entrypoint", () => {
    expect(existsSync(`${base}/build-template.sh`)).toBe(true);
  });

  it("includes a template-helpers.sh shared library", () => {
    const helpers = readFileSync(`${base}/template-helpers.sh`, "utf-8");
    expect(helpers).toContain("copy_binary_into");
  });

  it("includes a node-22 setup script", () => {
    expect(existsSync(`${base}/templates/node-22/setup.sh`)).toBe(true);
  });

  it("includes a python-3.12 setup script", () => {
    const script = readFileSync(`${base}/templates/python-3.12/setup.sh`, "utf-8");
    expect(script).toContain("template-helpers.sh");
    expect(script).toContain("python3");
  });

  it("build-template.sh clones the base and runs setup.sh against a mounted rootfs", () => {
    const script = readFileSync(`${base}/build-template.sh`, "utf-8");

    expect(script).toContain("Usage: ./build-template.sh <template-id>");
    expect(script).toContain("/opt/sandboxjs/base/rootfs.ext4");
    expect(script).toContain("/opt/sandboxjs/templates/");
    expect(script).toContain("mount -o loop");
    expect(script).toContain("TEMPLATE_ROOT=");
    expect(script).toContain("SCRIPT_DIR=");
  });

  it("includes a base rootfs build entrypoint", () => {
    const script = readFileSync(`${base}/build-base-rootfs.sh`, "utf-8");

    expect(script).toContain("/opt/sandboxjs/base/rootfs.ext4");
    expect(script).toContain("guest-agent");
  });
});
