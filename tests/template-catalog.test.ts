import { describe, it, expect } from "vitest";
import { getSeedTemplates } from "../src/templates/catalog.js";

describe("template catalog", () => {
  it("returns the curated Tier 1 templates", () => {
    const templates = getSeedTemplates();

    expect(templates.map((template) => template.id)).toEqual([
      "node-22",
      "python-3.12",
    ]);
  });

  it("assigns per-template rootfs paths and a shared kernel path", () => {
    const templates = getSeedTemplates();

    expect(templates).toEqual([
      expect.objectContaining({
        id: "node-22",
        rootfsPath: "/opt/sandboxjs/templates/node-22/rootfs.ext4",
        kernelPath: "/opt/sandboxjs/vmlinux",
      }),
      expect.objectContaining({
        id: "python-3.12",
        rootfsPath: "/opt/sandboxjs/templates/python-3.12/rootfs.ext4",
        kernelPath: "/opt/sandboxjs/vmlinux",
      }),
    ]);
  });

  it("includes build metadata that points to a template spec", () => {
    const templates = getSeedTemplates();

    for (const template of templates) {
      expect(template.buildMeta).toEqual(
        expect.objectContaining({
          seeded: true,
          specPath: expect.stringContaining(`/infra/firecracker/templates/${template.id}.json`),
        }),
      );
    }
  });
});
