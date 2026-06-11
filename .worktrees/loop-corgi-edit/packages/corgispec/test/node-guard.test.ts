import { describe, it, expect } from "vitest";
import { checkNodeVersion } from "../src/lib/node-guard.js";

describe("node-guard", () => {
  it("does not exit when Node version is adequate", () => {
    // If we're running this test, Node >= 18 is guaranteed
    // checkNodeVersion() should not throw or exit
    expect(() => checkNodeVersion()).not.toThrow();
  });
});
