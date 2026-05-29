import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI = resolve(__dirname, "../../dist/corgispec.js");

describe("hook pre-bash", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      `corgispec-hook-pre-bash-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(tempDir, { recursive: true });
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("allows commands when hooks are disabled", () => {
    const output = execSync(`node ${CLI} hook pre-bash --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { command: "rm -rf /" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: "1" },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });

  it("allows safe commands", () => {
    const output = execSync(`node ${CLI} hook pre-bash --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { command: "echo hello && npm test" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });

  it("blocks rm -rf /", () => {
    try {
      execSync(`node ${CLI} hook pre-bash --path ${tempDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { command: "rm -rf /" } }),
        env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(2);
      const output = (err.stderr || "").toString();
      expect(output).toContain("Blocked");
      expect(output).toContain("destructive command");
    }
  });

  it("blocks git push --force to main", () => {
    try {
      execSync(`node ${CLI} hook pre-bash --path ${tempDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { command: "git push --force origin main" } }),
        env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(2);
      const output = (err.stderr || "").toString();
      expect(output).toContain("Blocked");
      expect(output).toContain("Force push to main");
    }
  });

  it("blocks git push -f to main (short flag)", () => {
    try {
      execSync(`node ${CLI} hook pre-bash --path ${tempDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { command: "git push -f origin main" } }),
        env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(2);
      const output = (err.stderr || "").toString();
      expect(output).toContain("Blocked");
    }
  });

  it("allows git push to main without force", () => {
    const output = execSync(`node ${CLI} hook pre-bash --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { command: "git push origin main" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });

  it("allows git push --force to feature branch", () => {
    const output = execSync(`node ${CLI} hook pre-bash --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: { command: "git push --force origin feat/my-branch" } }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });

  it("allows when command is missing from input", () => {
    const output = execSync(`node ${CLI} hook pre-bash --path ${tempDir}`, {
      encoding: "utf-8",
      input: JSON.stringify({ tool_input: {} }),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });

    expect(JSON.parse(output)).toEqual({ continue: true });
  });

  it("allows when no project root found", () => {
    const emptyDir = resolve(
      tmpdir(),
      `corgispec-hook-empty-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(emptyDir, { recursive: true });

    try {
      const output = execSync(`node ${CLI} hook pre-bash --path ${emptyDir}`, {
        encoding: "utf-8",
        input: JSON.stringify({ tool_input: { command: "rm -rf /" } }),
        env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
      });
      expect(JSON.parse(output)).toEqual({ continue: true });
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
