import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import {
  installFakeOpenSpec,
  setupFakeChange,
  type FakeOpenSpecFixture,
} from "./fake-openspec.js";

const CLI = resolve(__dirname, "../../dist/corgispec.js");

describe("hook post-write", () => {
  let tempDir: string;
  let openspec: FakeOpenSpecFixture;
  let taskPath: string;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      `corgispec-hook-post-write-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    const change = setupFakeChange({ projectRoot: tempDir, changeName: "my-change" });
    taskPath = change.taskPath;
    openspec = installFakeOpenSpec(tempDir, {
      listRoot: change.planningRoot,
      statuses: { "my-change": change.status },
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("exits 0 when hooks are disabled", () => {
    const output = execSync(`node ${CLI} hook post-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { file_path: taskPath } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: "1" },
    });

    expect(output).toBe("");
  });

  it("exits 0 for file inside change directory", () => {
    const output = execSync(`node ${CLI} hook post-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { file_path: taskPath } }),
      env: openspec.env,
    });

    expect(output).toBe("");
  });

  it("exits 0 for file outside change directory", () => {
    const output = execSync(`node ${CLI} hook post-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { file_path: "src/app.ts" } }),
      env: openspec.env,
    });

    expect(output).toBe("");
  });

  it("exits 0 when file_path is missing", () => {
    const output = execSync(`node ${CLI} hook post-write --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: {} }),
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
      const output = execSync(`node ${CLI} hook post-write --path ${emptyDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { file_path: "openspec/changes/x/tasks.md" } }),
        env: openspec.env,
      });
      expect(output).toBe("");
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it("matches a custom task artifact in an external Store", () => {
    const externalRoot = `${tempDir}-external-store`;
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: custom-flow\ncorgi:\n  taskArtifactId: work-items\n",
    );
    const change = setupFakeChange({
      projectRoot: tempDir,
      planningRoot: externalRoot,
      changeName: "external-change",
      taskArtifactId: "work-items",
      taskFileName: "nested/work.md",
      schemaName: "custom-flow",
    });
    openspec.writeData({
      listRoot: externalRoot,
      statuses: { "external-change": change.status },
    });

    const output = execSync(
      `node ${CLI} hook post-write --path ${tempDir} --store remote`,
      {
        encoding: "utf8",
        input: JSON.stringify({ tool_input: { file_path: change.taskPath } }),
        env: openspec.env,
      },
    );
    expect(output).toBe("");
    expect(openspec.calls()).toContainEqual(["list", "--json", "--store", "remote"]);
    expect(openspec.calls()).toContainEqual([
      "status", "--change", "external-change", "--json", "--store", "remote",
    ]);
    rmSync(externalRoot, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")(
    "fails closed when a written path escapes the authoritative change root through a symlink",
    () => {
      const outside = `${tempDir}-outside`;
      mkdirSync(outside, { recursive: true });
      writeFileSync(resolve(outside, "escape.md"), "unsafe");
      const link = resolve(tempDir, "openspec/changes/my-change/linked");
      symlinkSync(outside, link, "dir");
      try {
        execSync(`node ${CLI} hook post-write --path ${tempDir}`, {
          encoding: "utf8",
          input: JSON.stringify({ tool_input: { file_path: resolve(link, "escape.md") } }),
          env: openspec.env,
        });
        expect.fail("Should have failed");
      } catch (error: any) {
        expect(error.status).toBe(2);
        expect(error.stderr.toString()).toContain("symlink");
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("returns non-zero and does not trigger validation on OpenSpec errors", () => {
    openspec.writeData({
      listRoot: resolve(tempDir, "openspec"),
      statuses: {},
      failCommand: "list",
    });
    try {
      execSync(`node ${CLI} hook post-write --path ${tempDir}`, {
        encoding: "utf8",
        input: JSON.stringify({ tool_input: { file_path: taskPath } }),
        env: openspec.env,
      });
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.status).toBe(2);
      expect(error.stdout.toString()).toBe("");
      expect(error.stderr.toString()).toContain("synthetic OpenSpec failure");
      expect(openspec.calls().some((argv) => argv[0] === "validate")).toBe(false);
    }
  });
});
