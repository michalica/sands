import { describe, it, expect } from "vitest";
import { config } from "../src/config.js";

describe("config", () => {
  it("exposes runtime networking defaults", () => {
    expect(config.networkingEnabled).toBe(false);
    expect(config.networkBaseCidr).toBe("172.20.0.0/16");
    expect(config.networkInternetInterface).toBe("eth0");
  });
});
