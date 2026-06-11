import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI = resolve(__dirname, "../../dist/corgispec.js");

describe("hook pre-write", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      `corgispec-hook-pre-write-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("allows write when hooks are disabled", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: github-tracked\nisolation:\n  mode: worktree\n  root: .worktrees\n"
    );

    const output = execSync(`node ${CLI} hook pre-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { file_path: "src/outside.ts" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: "1" },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });

  it("allows write when no config found", () => {
    const output = execSync(`node ${CLI} hook pre-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });

  it("allows write when isolation mode is none", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");

    const output = execSync(`node ${CLI} hook pre-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { file_path: "src/anywhere.ts" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });

  it("allows write inside worktree when isolation mode is worktree", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    mkdirSync(resolve(tempDir, ".worktrees/my-change"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: github-tracked\nisolation:\n  mode: worktree\n  root: .worktrees\n"
    );

    const output = execSync(`node ${CLI} hook pre-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { file_path: ".worktrees/my-change/src/app.ts" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });

  it("blocks write outside worktree when isolation mode is worktree", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: github-tracked\nisolation:\n  mode: worktree\n  root: .worktrees\n"
    );

    try {
      execSync(`node ${CLI} hook pre-write --path ${tempDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { file_path: "src/main.ts" } }),
        env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(2);
      const output = (err.stderr || "").toString();
      expect(output).toContain("Blocked");
      expect(output).toContain("outside the worktree root");
    }
  });

  it("allows write when file_path is missing from input", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: github-tracked\nisolation:\n  mode: worktree\n  root: .worktrees\n"
    );

    const output = execSync(`node ${CLI} hook pre-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: {} }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });

  it("allows write when stdin is empty", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: github-tracked\nisolation:\n  mode: worktree\n  root: .worktrees\n"
    );

    const output = execSync(`node ${CLI} hook pre-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: "",
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });
});
