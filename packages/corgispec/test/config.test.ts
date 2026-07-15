import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  loadConfig,
  loadConfigFromDir,
  findConfigPath,
  ConfigError,
  resolveTaskArtifactId,
  resolveTrackingProvider,
} from "../src/lib/config.js";

const TEST_DIR = resolve(tmpdir(), "corgispec-config-test-" + Date.now());

beforeEach(() => {
  mkdirSync(resolve(TEST_DIR, "openspec"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("findConfigPath", () => {
  it("returns path when config.yaml exists", () => {
    writeFileSync(resolve(TEST_DIR, "openspec/config.yaml"), "schema: gitlab-tracked\n");
    const result = findConfigPath(TEST_DIR);
    expect(result).toBe(resolve(TEST_DIR, "openspec/config.yaml"));
  });

  it("returns null when config.yaml does not exist", () => {
    const result = findConfigPath(TEST_DIR);
    expect(result).toBeNull();
  });
});

describe("loadConfig", () => {
  it("loads a valid minimal config", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, "schema: gitlab-tracked\n");

    const config = loadConfig(configPath);
    expect(config.schema).toBe("gitlab-tracked");
    expect(config.isolation).toBeUndefined();
    expect(config.context).toBeUndefined();
    expect(config.rules).toBeUndefined();
  });

  it("loads github-tracked schema", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, "schema: github-tracked\n");

    const config = loadConfig(configPath);
    expect(config.schema).toBe("github-tracked");
  });

  it("loads full config with all optional fields", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(
      configPath,
      `schema: gitlab-tracked
isolation:
  mode: worktree
  root: .worktrees
  branch_prefix: feat/
context: |
  Tech stack: TypeScript
rules:
  proposal:
    - Keep under 500 words
  tasks:
    - Max 2 hours per task
`
    );

    const config = loadConfig(configPath);
    expect(config.schema).toBe("gitlab-tracked");
    expect(config.isolation).toEqual({
      mode: "worktree",
      root: ".worktrees",
      branch_prefix: "feat/",
    });
    expect(config.context).toContain("Tech stack: TypeScript");
    expect(config.rules).toEqual({
      proposal: ["Keep under 500 words"],
      tasks: ["Max 2 hours per task"],
    });
  });

  it("loads config with isolation mode none", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, "schema: gitlab-tracked\nisolation:\n  mode: none\n");

    const config = loadConfig(configPath);
    expect(config.isolation).toEqual({ mode: "none", root: undefined, branch_prefix: undefined });
  });

  it("throws on missing file", () => {
    expect(() => loadConfig("/nonexistent/path.yaml")).toThrow(ConfigError);
    expect(() => loadConfig("/nonexistent/path.yaml")).toThrow("Config file not found");
  });

  it("throws on invalid YAML", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, ":\n  :\n    [invalid");

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
    expect(() => loadConfig(configPath)).toThrow("Failed to parse config YAML");
  });

  it("throws on empty file", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, "");

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
    expect(() => loadConfig(configPath)).toThrow("empty or not a YAML mapping");
  });

  it("throws on missing schema field", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, "context: hello\n");

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
    expect(() => loadConfig(configPath)).toThrow("Missing required field: 'schema'");
  });

  it("accepts arbitrary OpenSpec schema names", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, "schema: product-release-v2\n");

    expect(loadConfig(configPath).schema).toBe("product-release-v2");
  });

  it("loads explicit Corgi tracking and task artifact configuration", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(
      configPath,
      `schema: custom-flow
corgi:
  tracking:
    provider: none
  taskArtifactId: delivery-checklist
`
    );

    const config = loadConfig(configPath);
    expect(config.corgi).toEqual({
      tracking: { provider: "none" },
      taskArtifactId: "delivery-checklist",
    });
    expect(resolveTrackingProvider(config)).toEqual({ provider: "none", source: "explicit" });
    expect(resolveTaskArtifactId(config, ["tasks", "delivery-checklist"])).toBe(
      "delivery-checklist"
    );
  });

  it.each([
    ["corgi: true", "Field 'corgi' must be a mapping"],
    ["corgi:\n  tracking: github", "Field 'corgi.tracking' must be a mapping"],
    [
      "corgi:\n  tracking: {}",
      "Field 'corgi.tracking.provider' is required when tracking is specified",
    ],
    [
      "corgi:\n  tracking:\n    provider: jira",
      "Invalid corgi.tracking.provider 'jira'",
    ],
    ["corgi:\n  taskArtifactId: '  '", "Field 'corgi.taskArtifactId' must be a non-empty string"],
  ])("rejects invalid Corgi configuration: %s", (body, message) => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, `schema: custom-flow\n${body}\n`);

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
    expect(() => loadConfig(configPath)).toThrow(message);
  });

  it("throws on invalid isolation mode", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, "schema: gitlab-tracked\nisolation:\n  mode: invalid\n");

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
    expect(() => loadConfig(configPath)).toThrow("Invalid isolation.mode 'invalid'");
  });

  it("throws when isolation is not a mapping", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, "schema: gitlab-tracked\nisolation: true\n");

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
    expect(() => loadConfig(configPath)).toThrow("'isolation' must be a mapping");
  });

  it("throws when rules value is not an array", () => {
    const configPath = resolve(TEST_DIR, "openspec/config.yaml");
    writeFileSync(configPath, "schema: gitlab-tracked\nrules:\n  proposal: not-array\n");

    expect(() => loadConfig(configPath)).toThrow(ConfigError);
    expect(() => loadConfig(configPath)).toThrow("'rules.proposal' must be an array");
  });
});

describe("legacy config resolution", () => {
  it.each([
    ["github-tracked", "github"],
    ["gitlab-tracked", "gitlab"],
  ] as const)("infers %s tracking without coupling all schemas", (schema, provider) => {
    expect(resolveTrackingProvider({ schema })).toEqual({
      provider,
      source: "legacy-schema",
    });
  });

  it("defaults custom schemas to no tracker", () => {
    expect(resolveTrackingProvider({ schema: "custom-flow" })).toEqual({
      provider: "none",
      source: "default",
    });
  });

  it("only defaults taskArtifactId when the schema exposes tasks", () => {
    const config = { schema: "custom-flow" };
    expect(resolveTaskArtifactId(config, ["proposal", "tasks"])).toBe("tasks");
    expect(resolveTaskArtifactId(config, ["proposal", "work-items"])).toBeNull();
  });
});

describe("loadConfigFromDir", () => {
  it("loads config from a directory with openspec/config.yaml", () => {
    writeFileSync(resolve(TEST_DIR, "openspec/config.yaml"), "schema: github-tracked\n");

    const config = loadConfigFromDir(TEST_DIR);
    expect(config.schema).toBe("github-tracked");
  });

  it("throws when directory has no config", () => {
    rmSync(resolve(TEST_DIR, "openspec"), { recursive: true, force: true });

    expect(() => loadConfigFromDir(TEST_DIR)).toThrow(ConfigError);
    expect(() => loadConfigFromDir(TEST_DIR)).toThrow("No openspec/config.yaml found");
  });
});
