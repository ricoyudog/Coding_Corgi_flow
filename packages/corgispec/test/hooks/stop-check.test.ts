import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, execSync } from "node:child_process";
import {
  createFakeStatus,
  installFakeOpenSpec,
  setupFakeChange,
  type FakeOpenSpecFixture,
} from "./fake-openspec.js";

const CLI = resolve(__dirname, "../../dist/corgispec.js");

describe("hook stop-check", () => {
  let tempDir: string;
  let openspec: FakeOpenSpecFixture;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      `corgispec-hook-stop-check-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    openspec = installFakeOpenSpec(tempDir, {
      listRoot: resolve(tempDir, "openspec"),
      statuses: {},
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exits 0 when hooks are disabled", () => {
    mkdirSync(resolve(tempDir, "openspec/changes/my-change"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/changes/my-change/tasks.md"),
      "## 1. Setup\n\n- [ ] 1.1 Incomplete task\n"
    );

    const output = execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({}),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: "1" },
    });

    expect(output).toBe("");
  });

  it("exits 0 when no active changes exist", () => {
    const output = execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({}),
      env: openspec.env,
    });

    expect(output).toBe("");
  });

  it("exits 0 when all tasks are complete", () => {
    const change = setupFakeChange({
      projectRoot: tempDir,
      changeName: "done-change",
      taskContent: "## 1. Setup\n\n- [x] 1.1 Completed task\n- [x] 1.2 Another done task\n",
    });
    openspec.writeData({
      listRoot: change.planningRoot,
      statuses: { "done-change": change.status },
    });

    const output = execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({}),
      env: openspec.env,
    });

    expect(output).toBe("");
  });

  it("checks only the current worktree when siblings list the same change", () => {
    const sibling = resolve(tempDir, ".worktrees/sibling");
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: github-tracked\nisolation:\n  mode: worktree\n  root: .worktrees\n",
    );
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
    execFileSync("git", ["add", "openspec/config.yaml"], { cwd: tempDir, stdio: "ignore" });
    execFileSync(
      "git",
      ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "initial"],
      { cwd: tempDir, stdio: "ignore" },
    );
    mkdirSync(resolve(tempDir, ".worktrees"), { recursive: true });
    execFileSync("git", ["worktree", "add", "-b", "sibling", sibling], {
      cwd: tempDir,
      stdio: "ignore",
    });

    for (const root of [tempDir, sibling]) {
      const changeRoot = resolve(root, "openspec/changes/shared-change");
      mkdirSync(changeRoot, { recursive: true });
      writeFileSync(resolve(changeRoot, "tasks.md"), "## 1. Setup\n\n- [x] 1.1 Complete\n");
    }
    writeFileSync(
      openspec.executable,
      `#!/usr/bin/env node
const path = require("node:path");
const args = process.argv.slice(2);
const planningRoot = path.resolve(process.cwd(), "openspec");
const changeRoot = path.resolve(planningRoot, "changes", "shared-change");
const taskPath = path.resolve(changeRoot, "tasks.md");
if (args[0] === "--version") {
  process.stdout.write("1.6.0\\n");
  process.exit(0);
}
if (args[0] === "list") {
  process.stdout.write(JSON.stringify({
    changes: [{ name: "shared-change", completedTasks: 1, totalTasks: 1, lastModified: "2026-08-04T00:00:00.000Z", status: "complete" }],
    root: { path: planningRoot, source: "test" },
  }));
  process.exit(0);
}
if (args[0] === "status") {
  process.stdout.write(JSON.stringify({
    changeName: "shared-change",
    schemaName: "github-tracked",
    planningHome: { kind: "repo", root: planningRoot, changesDir: path.resolve(planningRoot, "changes"), defaultSchema: "github-tracked" },
    changeRoot,
    artifactPaths: { tasks: { outputPath: "tasks.md", resolvedOutputPath: taskPath, existingOutputPaths: [taskPath] } },
    nextSteps: [],
    actionContext: { mode: "planning", sourceOfTruth: "openspec", planningArtifacts: ["tasks"], linkedContext: [], allowedEditRoots: [changeRoot], requiresAffectedAreaSelection: false, constraints: [] },
    isComplete: true,
    applyRequires: [],
    artifacts: [{ id: "tasks", outputPath: "tasks.md", status: "done" }],
  }));
  process.exit(0);
}
process.exit(9);
`,
    );

    const output = execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({}),
      env: openspec.env,
    });

    expect(output).toBe("");
  });

  it("defers task postconditions when a linked worktree owns an active v3 run", () => {
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: github-tracked\nisolation:\n  mode: worktree\n  root: .worktrees\n",
    );
    execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
    execFileSync("git", ["add", "openspec/config.yaml"], { cwd: tempDir, stdio: "ignore" });
    execFileSync(
      "git",
      ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "initial"],
      { cwd: tempDir, stdio: "ignore" },
    );
    const delivery = resolve(tempDir, ".worktrees/active-delivery");
    mkdirSync(resolve(tempDir, ".worktrees"), { recursive: true });
    execFileSync("git", ["worktree", "add", "-b", "active-delivery", delivery], {
      cwd: tempDir,
      stdio: "ignore",
    });
    const runRoot = resolve(delivery, ".corgi/loop/active-change/runs/run-active");
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(
      resolve(delivery, ".corgi/loop/active-change/current.json"),
      JSON.stringify({ schemaVersion: 3, runId: "run-active" }),
    );
    writeFileSync(
      resolve(runRoot, "state.json"),
      JSON.stringify({
        schemaVersion: 3,
        changeName: "active-change",
        runId: "run-active",
        phase: "applying",
        stateRevision: 1,
      }),
    );
    const change = setupFakeChange({
      projectRoot: tempDir,
      changeName: "partial-primary-change",
      taskContent: "## 1. Work\n\n- [x] 1.1 Started\n- [ ] 1.2 Incomplete\n",
    });
    openspec.writeData({
      listRoot: change.planningRoot,
      statuses: { "partial-primary-change": change.status },
    });

    const output = execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({}),
      env: openspec.env,
    });

    expect(output).toBe("");
  });

  it("exits 0 after a completed group when the next group is untouched", () => {
    const change = setupFakeChange({
      projectRoot: tempDir,
      changeName: "checkpoint-change",
      taskContent: [
        "## 1. Setup",
        "",
        "- [x] 1.1 Completed checkpoint task",
        "",
        "## 2. Delivery",
        "",
        "- [ ] 2.1 Untouched next task",
        "- [ ] 2.2 Another untouched task",
        "",
      ].join("\n"),
    });
    openspec.writeData({
      listRoot: change.planningRoot,
      statuses: { "checkpoint-change": change.status },
    });

    const output = execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({}),
      env: openspec.env,
    });

    expect(output).toBe("");
  });

  it("exits 2 when the current group is partially complete", () => {
    const change = setupFakeChange({
      projectRoot: tempDir,
      changeName: "wip-change",
      taskContent: "## 1. Implementation\n\n- [x] 1.1 Done task\n- [ ] 1.2 Not done yet\n",
    });
    openspec.writeData({
      listRoot: change.planningRoot,
      statuses: { "wip-change": change.status },
    });

    try {
      execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({}),
        env: openspec.env,
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(2);
      const stderr = (err.stderr || "").toString();
      expect(stderr).toContain("Incomplete tasks");
      expect(stderr).toContain("Not done yet");
    }
  });

  it("exits 0 when the authoritative schema has no task artifact", () => {
    const changeRoot = resolve(tempDir, "openspec/changes/no-tasks");
    const proposal = resolve(changeRoot, "proposal.md");
    mkdirSync(changeRoot, { recursive: true });
    writeFileSync(proposal, "# Proposal\n");
    const status = createFakeStatus({
      changeName: "no-tasks",
      planningRoot: resolve(tempDir, "openspec"),
      changeRoot,
      artifacts: {
        proposal: {
          outputPath: "proposal.md",
          existingOutputPaths: [proposal],
          status: "done",
        },
      },
    });
    openspec.writeData({
      listRoot: resolve(tempDir, "openspec"),
      statuses: { "no-tasks": status },
    });

    const output = execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({}),
      env: openspec.env,
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
      const output = execSync(`node ${CLI} hook stop-check --path ${emptyDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({}),
        env: openspec.env,
      });
      expect(output).toBe("");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("returns a non-zero contract error for malformed OpenSpec JSON", () => {
    openspec.writeData({
      listRoot: resolve(tempDir, "openspec"),
      statuses: {},
      malformedCommand: "list",
    });
    try {
      execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
        encoding: "utf8",
        input: JSON.stringify({ session_id: "session-1" }),
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
