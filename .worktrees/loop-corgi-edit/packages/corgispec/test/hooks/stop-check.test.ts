import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI = resolve(__dirname, "../../dist/corgispec.js");

describe("hook stop-check", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      `corgispec-hook-stop-check-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
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
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(output).toBe("");
  });

  it("exits 0 when all tasks are complete", () => {
    mkdirSync(resolve(tempDir, "openspec/changes/done-change"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/changes/done-change/tasks.md"),
      "## 1. Setup\n\n- [x] 1.1 Completed task\n- [x] 1.2 Another done task\n"
    );

    const output = execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({}),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(output).toBe("");
  });

  it("exits 2 when tasks are incomplete", () => {
    mkdirSync(resolve(tempDir, "openspec/changes/wip-change"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/changes/wip-change/tasks.md"),
      "## 1. Implementation\n\n- [x] 1.1 Done task\n- [ ] 1.2 Not done yet\n"
    );

    try {
      execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({}),
        env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(2);
      const stderr = (err.stderr || "").toString();
      expect(stderr).toContain("Incomplete tasks");
      expect(stderr).toContain("Not done yet");
    }
  });

  it("exits 0 when change has no tasks.md", () => {
    mkdirSync(resolve(tempDir, "openspec/changes/no-tasks"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/changes/no-tasks/proposal.md"),
      "# Proposal\n"
    );

    const output = execSync(`node ${CLI} hook stop-check --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({}),
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
      const output = execSync(`node ${CLI} hook stop-check --path ${emptyDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({}),
        env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
      });
      expect(output).toBe("");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
