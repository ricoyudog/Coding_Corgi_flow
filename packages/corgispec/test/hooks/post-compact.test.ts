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

describe("hook post-compact", () => {
  let tempDir: string;
  let openspec: FakeOpenSpecFixture;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      `corgispec-hook-post-compact-${Date.now()}-${Math.random().toString(36).slice(2)}`
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
      execSync(`node ${CLI} hook post-compact --path ${tempDir}`, {
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
      execSync(`node ${CLI} hook post-compact --path ${tempDir}`, {
        encoding: "utf-8",
        env: openspec.env,
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
    }
  });

  it("outputs JSON context matching session-start format", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    const output = execSync(`node ${CLI} hook post-compact --path ${tempDir}`, {
      encoding: "utf-8",
      env: openspec.env,
    });

    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("hookSpecificOutput");
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PostCompact");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("## CorgiSpec Project Context");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("**Schema**: github-tracked");
  });

  it("produces same context structure as session-start", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    const change = setupFakeChange({
      projectRoot: tempDir,
      changeName: "test-change",
      taskContent: "## 1. Init\n\n- [x] 1.1 Done\n",
    });
    openspec.writeData({
      listRoot: change.planningRoot,
      statuses: { "test-change": change.status },
    });
    execSync("git init", { cwd: tempDir, stdio: "ignore" });

    const sessionOutput = execSync(`node ${CLI} hook session-start --path ${tempDir}`, {
      encoding: "utf-8",
      env: openspec.env,
    });

    const compactOutput = execSync(`node ${CLI} hook post-compact --path ${tempDir}`, {
      encoding: "utf-8",
      env: openspec.env,
    });

    const sessionParsed = JSON.parse(sessionOutput);
    const compactParsed = JSON.parse(compactOutput);

    expect(compactParsed.hookSpecificOutput.additionalContext).toBe(
      sessionParsed.hookSpecificOutput.additionalContext
    );
    expect(compactParsed.hookSpecificOutput.hookEventName).toBe("PostCompact");
    expect(sessionParsed.hookSpecificOutput.hookEventName).toBe("SessionStart");
  });
});
