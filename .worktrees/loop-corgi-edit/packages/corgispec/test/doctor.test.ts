import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI = resolve(__dirname, "../dist/corgispec.js");

describe("doctor command", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(tmpdir(), `corgispec-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("passes with a valid project", () => {
    mkdirSync(resolve(tempDir, "openspec/schemas/github-tracked"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    writeFileSync(
      resolve(tempDir, "openspec/schemas/github-tracked/schema.yaml"),
      "name: github-tracked\nversion: 1\ndescription: Test\nartifacts: []\n"
    );

    const output = execSync(`node ${CLI} doctor --path ${tempDir}`, { encoding: "utf-8" });
    expect(output).toContain("Node.js");
    expect(output.toLowerCase()).toContain("pass");
    expect(output).toContain("Config: valid");
  });

  it("fails with invalid config", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: invalid-stuff\n");

    try {
      execSync(`node ${CLI} doctor --path ${tempDir}`, { encoding: "utf-8" });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stdout + err.stderr).toContain("FAIL");
    }
  });

  it("handles missing config gracefully", () => {
    const output = execSync(`node ${CLI} doctor --path ${tempDir}`, { encoding: "utf-8" });
    expect(output).toContain("not found (not in a Corgi project)");
  });

  it("outputs valid JSON with --json flag", () => {
    mkdirSync(resolve(tempDir, "openspec/schemas/github-tracked"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    writeFileSync(
      resolve(tempDir, "openspec/schemas/github-tracked/schema.yaml"),
      "name: github-tracked\nversion: 1\ndescription: Test\nartifacts: []\n"
    );

    const output = execSync(`node ${CLI} doctor --path ${tempDir} --json`, { encoding: "utf-8" });
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    for (const item of parsed) {
      expect(item).toHaveProperty("name");
      expect(item).toHaveProperty("passed");
      expect(item).toHaveProperty("message");
    }
  });

  it("includes the current Node version in output", () => {
    const output = execSync(`node ${CLI} doctor --path ${tempDir}`, { encoding: "utf-8" });
    expect(output).toContain(process.version);
  });

  it("detects corrupted schema files", () => {
    mkdirSync(resolve(tempDir, "openspec/schemas/bad-schema"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    // Write invalid YAML that has no 'name' or 'artifacts' fields
    writeFileSync(
      resolve(tempDir, "openspec/schemas/bad-schema/schema.yaml"),
      "just: a string\nnothing: useful\n"
    );

    try {
      execSync(`node ${CLI} doctor --path ${tempDir}`, { encoding: "utf-8" });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
      const output = err.stdout + err.stderr;
      expect(output).toContain("FAIL");
      expect(output).toContain("missing required");
    }
  });
});
