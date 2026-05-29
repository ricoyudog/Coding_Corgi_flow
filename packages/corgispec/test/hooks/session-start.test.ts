import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI = resolve(__dirname, "../../dist/corgispec.js");

describe("hook session-start", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      `corgispec-hook-session-start-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exits 1 when hooks are disabled", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");

    try {
      execSync(`node ${CLI} hook session-start --path ${tempDir}`, {
        encoding: "utf-8",
        env: { ...process.env, CORGISPEC_HOOKS_DISABLE: "1" },
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
    }
  });

  it("exits 1 when no config found", () => {
    try {
      execSync(`node ${CLI} hook session-start --path ${tempDir}`, {
        encoding: "utf-8",
        env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
    }
  });

  it("outputs JSON context for project with no isolation", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");

    // Initialize git so getCurrentBranch works
    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    const output = execSync(`node ${CLI} hook session-start --path ${tempDir}`, {
      encoding: "utf-8",
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("hookSpecificOutput");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("## CorgiSpec Project Context");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("**Schema**: github-tracked");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("**Isolation mode**: none");
  });

  it("includes active changes in context", () => {
    mkdirSync(resolve(tempDir, "openspec/changes/my-feature"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    writeFileSync(
      resolve(tempDir, "openspec/changes/my-feature/tasks.md"),
      "## 1. Setup\n\n- [ ] 1.1 Create files\n"
    );

    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    const output = execSync(`node ${CLI} hook session-start --path ${tempDir}`, {
      encoding: "utf-8",
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("my-feature");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Active changes");
  });

  it("resolves worktree paths when isolation mode is worktree", () => {
    mkdirSync(resolve(tempDir, "openspec/changes/add-auth"), { recursive: true });
    mkdirSync(resolve(tempDir, ".worktrees/add-auth"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: github-tracked\nisolation:\n  mode: worktree\n  root: .worktrees\n  branch_prefix: feat/\n"
    );

    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    const output = execSync(`node ${CLI} hook session-start --path ${tempDir}`, {
      encoding: "utf-8",
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("worktree");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("add-auth");
  });

  it("reports current branch from git", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    const output = execSync(`node ${CLI} hook session-start --path ${tempDir}`, {
      encoding: "utf-8",
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("**Current branch**:");
  });
});
