import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI = resolve(__dirname, "../dist/corgispec.js");
const TEST_BASE = resolve(tmpdir(), "corgispec-init-test-" + Date.now());

describe("init command", () => {
  let targetDir: string;
  let counter = 0;

  beforeEach(() => {
    counter++;
    targetDir = resolve(TEST_BASE, `test-${counter}`);
    mkdirSync(targetDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true });
  });

  it("initializes in a fresh directory with default schema", () => {
    const result = execSync(`node ${CLI} init ${targetDir}`, { encoding: "utf-8" });

    expect(result).toContain("Initialized Corgi");
    expect(existsSync(resolve(targetDir, "openspec/config.yaml"))).toBe(true);
    const config = readFileSync(resolve(targetDir, "openspec/config.yaml"), "utf-8");
    expect(config).toContain("schema: github-tracked");
    expect(config).toContain("provider: github");
    expect(config).toContain("taskArtifactId: tasks");
    expect(existsSync(resolve(targetDir, "openspec/changes"))).toBe(true);
    expect(existsSync(resolve(targetDir, "openspec/schemas"))).toBe(true);
    expect(existsSync(resolve(targetDir, "openspec/specs"))).toBe(true);
  });

  it("initializes with explicit gitlab-tracked schema", () => {
    const result = execSync(`node ${CLI} init ${targetDir} --schema gitlab-tracked`, { encoding: "utf-8" });

    const config = readFileSync(resolve(targetDir, "openspec/config.yaml"), "utf-8");
    expect(config).toContain("schema: gitlab-tracked");
    expect(config).toContain("provider: gitlab");
  });

  it("accepts a custom OpenSpec schema with explicit Corgi routing", () => {
    execSync(
      `node ${CLI} init ${targetDir} --schema team-flow --tracking-provider none --task-artifact execution-plan`,
      { encoding: "utf-8" },
    );

    const config = readFileSync(resolve(targetDir, "openspec/config.yaml"), "utf-8");
    expect(config).toContain("schema: team-flow");
    expect(config).toContain("provider: none");
    expect(config).toContain("taskArtifactId: execution-plan");
  });

  it("does not overwrite existing config", () => {
    const configDir = resolve(targetDir, "openspec");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(resolve(configDir, "config.yaml"), "schema: custom\n");

    const result = execSync(`node ${CLI} init ${targetDir}`, { encoding: "utf-8" });

    expect(result).toContain("Corgi already initialized");
    const config = readFileSync(resolve(configDir, "config.yaml"), "utf-8");
    expect(config).toBe("schema: custom\n");
  });

  it("creates .claude/skills/ with --platform claude", () => {
    execSync(`node ${CLI} init ${targetDir} --platform claude`, { encoding: "utf-8" });

    expect(existsSync(resolve(targetDir, ".claude/skills"))).toBe(true);
  });

  it("creates all platform skill directories with --platform all", () => {
    execSync(`node ${CLI} init ${targetDir} --platform all`, { encoding: "utf-8" });

    expect(existsSync(resolve(targetDir, ".claude/skills"))).toBe(true);
    expect(existsSync(resolve(targetDir, ".opencode/skills"))).toBe(true);
    expect(existsSync(resolve(targetDir, ".codex/skills"))).toBe(true);
  });

  it("generated config includes YAML comments", () => {
    execSync(`node ${CLI} init ${targetDir}`, { encoding: "utf-8" });

    const config = readFileSync(resolve(targetDir, "openspec/config.yaml"), "utf-8");
    const commentLines = config.split("\n").filter((line) => line.trimStart().startsWith("#"));
    expect(commentLines.length).toBeGreaterThan(0);
    // Check for expected comment topics
    const configText = config.toLowerCase();
    expect(
      configText.includes("isolation") ||
      configText.includes("context") ||
      configText.includes("rules")
    ).toBe(true);
  });

  it("exits with error for invalid --schema value", () => {
    try {
      execSync(`node ${CLI} init ${targetDir} --schema 'Invalid Schema!'`, {
        encoding: "utf-8",
      });
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).not.toBe(0);
      expect(err.stdout + err.stderr).toContain("Invalid schema");
    }
  });
});
