import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
    expect(config).toContain("contract: rfc-v1");
    expect(config).toContain("integrationBranch: main");
    expect(existsSync(resolve(targetDir, "openspec/changes"))).toBe(true);
    expect(existsSync(resolve(targetDir, "openspec/schemas"))).toBe(true);
    expect(existsSync(resolve(targetDir, "openspec/specs"))).toBe(true);
    expect(existsSync(resolve(targetDir, "rfcs/RFC-0001-project-foundation/rfc.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "memory/MEMORY.md"))).toBe(true);
  });

  it("initializes with explicit gitlab-tracked schema", () => {
    const result = execSync(`node ${CLI} init ${targetDir} --schema gitlab-tracked`, { encoding: "utf-8" });

    const config = readFileSync(resolve(targetDir, "openspec/config.yaml"), "utf-8");
    expect(config).toContain("schema: gitlab-tracked");
    expect(config).toContain("provider: gitlab");
  });

  it("accepts a custom OpenSpec schema with explicit Corgi routing", () => {
    const source = resolve(__dirname, "../assets/schemas/github-tracked");
    const destination = resolve(targetDir, "openspec/schemas/team-flow");
    mkdirSync(resolve(targetDir, "openspec/schemas"), { recursive: true });
    cpSync(source, destination, { recursive: true });
    const schemaPath = resolve(destination, "schema.yaml");
    writeFileSync(
      schemaPath,
      readFileSync(schemaPath, "utf8").replace("name: github-tracked", "name: team-flow"),
    );
    execSync(
      `node ${CLI} init ${targetDir} --schema team-flow --tracking-provider none --task-artifact execution-plan`,
      { encoding: "utf-8" },
    );

    const config = readFileSync(resolve(targetDir, "openspec/config.yaml"), "utf-8");
    expect(config).toContain("schema: team-flow");
    expect(config).toContain("provider: none");
    expect(config).toContain("taskArtifactId: execution-plan");
  });

  it("does not silently migrate an existing v3 config", () => {
    const configDir = resolve(targetDir, "openspec");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(resolve(configDir, "config.yaml"), "schema: custom\n");

    expect(() => execSync(`node ${CLI} init ${targetDir}`, { encoding: "utf-8" })).toThrow();
    const config = readFileSync(resolve(configDir, "config.yaml"), "utf-8");
    expect(config).toBe("schema: custom\n");
  });

  it("routes --platform claude through bootstrap-managed project commands", () => {
    execSync(`node ${CLI} init ${targetDir} --platform claude`, { encoding: "utf-8" });

    expect(existsSync(resolve(targetDir, ".claude/commands/corgi"))).toBe(true);
    expect(existsSync(resolve(targetDir, ".opencode/commands"))).toBe(false);
  });

  it("routes --platform all through the same bootstrap writer", () => {
    execSync(`node ${CLI} init ${targetDir} --platform all`, { encoding: "utf-8" });

    expect(existsSync(resolve(targetDir, ".claude/commands/corgi"))).toBe(true);
    expect(existsSync(resolve(targetDir, ".opencode/commands"))).toBe(true);
    expect(existsSync(resolve(targetDir, "rfcs/RFC-0001-project-foundation"))).toBe(true);
  });

  it("generated config includes the complete RFC contract", () => {
    execSync(`node ${CLI} init ${targetDir}`, { encoding: "utf-8" });

    const config = readFileSync(resolve(targetDir, "openspec/config.yaml"), "utf-8");
    expect(config).toContain("contract: rfc-v1");
    expect(config).toContain("rfcRoot: rfcs");
    expect(config).toContain("foundation: RFC-0001-project-foundation");
    expect(config).toContain("integrationBranch: main");
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
