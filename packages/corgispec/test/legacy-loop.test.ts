import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectLegacyLoop } from "../src/lib/legacy-loop.js";

const roots: string[] = [];

function fixture(platform: "claude" | "opencode", content: string): string {
  const root = mkdtempSync(resolve(tmpdir(), "corgi-legacy-loop-"));
  roots.push(root);
  const directory = resolve(root, `.${platform}/corgi-loop/change-a`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "state.json"), content, "utf-8");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("inspectLegacyLoop", () => {
  it("returns a valid active v1 state", () => {
    const root = fixture(
      "claude",
      JSON.stringify({ active: true, changeName: "change-a", sessionId: "s1" }),
    );

    expect(inspectLegacyLoop(root, "change-a")).toMatchObject({
      runs: [{ active: true, platform: "claude", sessionId: "s1" }],
      corruptPaths: [],
      unsupportedPaths: [],
    });
  });

  it("reports malformed and future state instead of ignoring them", () => {
    const malformed = fixture("claude", "{");
    expect(inspectLegacyLoop(malformed, "change-a").corruptPaths).toHaveLength(1);

    const future = fixture(
      "opencode",
      JSON.stringify({ schemaVersion: 9, active: true, changeName: "change-a" }),
    );
    expect(inspectLegacyLoop(future, "change-a").unsupportedPaths).toHaveLength(1);
  });
});
