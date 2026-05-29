import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI = resolve(__dirname, "../../dist/corgispec.js");

describe("hook post-write", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      `corgispec-hook-post-write-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(resolve(tempDir, "openspec/changes/my-change"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exits 0 when hooks are disabled", () => {
    const output = execSync(`node ${CLI} hook post-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { file_path: "openspec/changes/my-change/tasks.md" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: "1" },
    });

    expect(output).toBe("");
  });

  it("exits 0 for file inside change directory", () => {
    const output = execSync(`node ${CLI} hook post-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { file_path: "openspec/changes/my-change/tasks.md" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(output).toBe("");
  });

  it("exits 0 for file outside change directory", () => {
    const output = execSync(`node ${CLI} hook post-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(output).toBe("");
  });

  it("exits 0 when file_path is missing", () => {
    const output = execSync(`node ${CLI} hook post-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: {} }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(output).toBe("");
  });

  it("exits 0 when no project root found", () => {
    const emptyDir = resolve(
      tmpdir(),
      `corgispec-hook-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(emptyDir, { recursive: true });

    try {
      const output = execSync(`node ${CLI} hook post-write --path ${emptyDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { file_path: "openspec/changes/x/tasks.md" } }),
        env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
      });
      expect(output).toBe("");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
