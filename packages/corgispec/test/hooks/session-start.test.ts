import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import {
  installFakeOpenSpec,
  setupFakeChange,
  type FakeOpenSpecFixture,
} from "./fake-openspec.js";

const CLI = resolve(__dirname, "../../dist/corgispec.js");

describe("hook session-start", () => {
  let tempDir: string;
  let openspec: FakeOpenSpecFixture;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      `corgispec-hook-session-start-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    openspec = installFakeOpenSpec(tempDir, {
      listRoot: resolve(tempDir, "openspec"),
      statuses: {},
    });
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
        env: openspec.env,
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
      env: openspec.env,
    });

    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("hookSpecificOutput");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("## CorgiSpec Project Context");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("**Schema**: github-tracked");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("**Isolation mode**: none");
  });

  it("includes active changes in context", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    const change = setupFakeChange({
      projectRoot: tempDir,
      changeName: "my-feature",
      taskContent: "## 1. Setup\n\n- [ ] 1.1 Create files\n",
    });
    openspec.writeData({
      listRoot: change.planningRoot,
      statuses: { "my-feature": change.status },
    });

    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    const output = execSync(`node ${CLI} hook session-start --path ${tempDir}`, {
      encoding: "utf-8",
      env: openspec.env,
    });

    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("my-feature");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("Active changes");
  });

  it("resolves worktree paths when isolation mode is worktree", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: github-tracked\nisolation:\n  mode: worktree\n  root: .worktrees\n  branch_prefix: feat/\n"
    );
    const change = setupFakeChange({ projectRoot: tempDir, changeName: "add-auth" });
    openspec.writeData({
      listRoot: change.planningRoot,
      statuses: { "add-auth": change.status },
    });

    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    const output = execSync(`node ${CLI} hook session-start --path ${tempDir}`, {
      encoding: "utf-8",
      env: openspec.env,
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
      env: openspec.env,
    });

    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput.additionalContext).toContain("**Current branch**:");
  });

  it("uses an external Store and configured custom task artifact", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: custom-flow\ncorgi:\n  taskArtifactId: work-items\n",
    );
    const externalRoot = `${tempDir}-external-planning`;
    const change = setupFakeChange({
      projectRoot: tempDir,
      planningRoot: externalRoot,
      changeName: "external-change",
      taskArtifactId: "work-items",
      taskFileName: "work/work-items.md",
      taskContent: "## 7. External\n\n- [ ] 7.1 Continue\n",
      schemaName: "custom-flow",
    });
    openspec.writeData({
      listRoot: externalRoot,
      statuses: { "external-change": change.status },
    });
    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    const output = execSync(
      `node ${CLI} hook session-start --path ${tempDir} --store shared`,
      { encoding: "utf8", env: openspec.env },
    );
    const context = JSON.parse(output).hookSpecificOutput.additionalContext as string;
    expect(context).toContain("external-change");
    expect(context).toContain("Group 7 in-progress");
    expect(openspec.calls()).toContainEqual(["list", "--json", "--store", "shared"]);
    expect(openspec.calls()).toContainEqual([
      "status", "--change", "external-change", "--json", "--store", "shared",
    ]);
    rmSync(externalRoot, { recursive: true, force: true });
  });

  it("fails closed on malformed OpenSpec JSON without polluting stdout", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    openspec.writeData({
      listRoot: resolve(tempDir, "openspec"),
      statuses: {},
      malformedCommand: "list",
    });

    try {
      execSync(`node ${CLI} hook session-start --path ${tempDir}`, {
        encoding: "utf8",
        env: openspec.env,
      });
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.status).toBe(2);
      expect(error.stdout.toString()).toBe("");
      expect(error.stderr.toString()).toContain("malformed JSON");
    }
  });
});
