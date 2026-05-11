import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const base = "/Users/tomasmichalica/Documents/sands/infra/firecracker";

describe("template build scaffolding", () => {
  it("includes a build-template.sh entrypoint", () => {
    expect(existsSync(`${base}/build-template.sh`)).toBe(true);
  });

  it("includes a node-22 template spec", () => {
    const raw = readFileSync(`${base}/templates/node-22.json`, "utf-8");
    const spec = JSON.parse(raw) as Record<string, unknown>;

    expect(spec.id).toBe("node-22");
    expect(spec.name).toBe("Node.js 22");
    expect(spec.packages).toEqual(expect.arrayContaining(["node"]));
  });

  it("includes a python-3.12 template spec", () => {
    const raw = readFileSync(`${base}/templates/python-3.12.json`, "utf-8");
    const spec = JSON.parse(raw) as Record<string, unknown>;

    expect(spec.id).toBe("python-3.12");
    expect(spec.name).toBe("Python 3.12");
    expect(spec.packages).toEqual(expect.arrayContaining(["python3", "python3-pip"]));
  });

  it("documents how to build a named template", () => {
    const script = readFileSync(`${base}/build-template.sh`, "utf-8");

    expect(script).toContain("Usage: ./build-template.sh <template-id>");
    expect(script).toContain("templates/${TEMPLATE_ID}.json");
    expect(script).toContain("/opt/sandboxjs/templates/${TEMPLATE_ID}/rootfs.ext4");
  });
});
