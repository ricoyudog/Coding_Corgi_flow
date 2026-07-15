import { describe, it, expect } from "vitest";
import {
  checkNodeVersion,
  isNodeVersionSupported,
  MIN_NODE_VERSION,
} from "../src/lib/node-guard.js";

describe("node-guard", () => {
  it("does not exit when Node version is adequate", () => {
    // package.json and CI guarantee the process meets the declared engine.
    // checkNodeVersion() should not throw or exit
    expect(() => checkNodeVersion()).not.toThrow();
  });

  it.each([
    ["20.19.0", true],
    ["20.19.1", true],
    ["20.20.0", true],
    ["21.0.0", true],
    ["22.0.0", true],
    ["20.18.999", false],
    ["20.18.0", false],
    ["19.99.99", false],
    ["20.19", false],
    ["v20.19.0", false],
    ["not-a-version", false],
  ])("classifies Node %s support as %s", (version, expected) => {
    expect(isNodeVersionSupported(version)).toBe(expected);
  });

  it("keeps the runtime guard aligned with the package engine floor", () => {
    expect(MIN_NODE_VERSION).toBe("20.19.0");
  });
});
