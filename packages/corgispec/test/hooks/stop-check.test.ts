import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
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

  it("exits 2 when tasks are incomplete", () => {
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
