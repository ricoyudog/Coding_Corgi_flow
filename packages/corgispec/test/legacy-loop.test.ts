import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  it("reports a symlinked state file as corrupt", () => {
    if (process.platform === "win32") return;

    const root = mkdtempSync(resolve(tmpdir(), "corgi-legacy-loop-symlink-"));
    roots.push(root);
    const directory = resolve(root, ".opencode/corgi-loop/change-a");
    const target = resolve(root, "outside-state.json");
    mkdirSync(directory, { recursive: true });
    writeFileSync(target, JSON.stringify({ active: false, changeName: "change-a" }), "utf8");
    symlinkSync(target, resolve(directory, "state.json"));

    expect(inspectLegacyLoop(root, "change-a")).toMatchObject({
      runs: [],
      corruptPaths: [resolve(directory, "state.json")],
      unsupportedPaths: [],
    });
  });

  it("reports a state file below a symlinked ancestor as corrupt", () => {
    if (process.platform === "win32") return;

    const root = mkdtempSync(resolve(tmpdir(), "corgi-legacy-loop-ancestor-symlink-"));
    roots.push(root);
    const outside = resolve(root, "outside-opencode");
    const directory = resolve(outside, "corgi-loop/change-a");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      resolve(directory, "state.json"),
      JSON.stringify({ active: false, changeName: "change-a" }),
      "utf8",
    );
    symlinkSync(outside, resolve(root, ".opencode"));

    expect(inspectLegacyLoop(root, "change-a")).toMatchObject({
      runs: [],
      corruptPaths: [resolve(root, ".opencode/corgi-loop/change-a/state.json")],
      unsupportedPaths: [],
    });
  });
});
