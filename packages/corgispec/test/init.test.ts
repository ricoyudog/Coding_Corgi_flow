import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, cpSync, existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const CLI = resolve(__dirname, "../dist/corgispec.js");
const TEST_BASE = resolve(tmpdir(), "corgispec-init-test-" + Date.now());

describe("init command", () => {
  let targetDir: string;
  let commandEnv: NodeJS.ProcessEnv;
  let counter = 0;

  beforeEach(() => {
    counter++;
    targetDir = resolve(TEST_BASE, `test-${counter}`);
    mkdirSync(targetDir, { recursive: true });
    const binDir = resolve(TEST_BASE, "bin");
    const openspec = resolve(binDir, "openspec");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(openspec, [
      "#!/bin/sh",
      "if [ \"$1\" = \"--version\" ]; then printf '1.6.0\\n'; exit 0; fi",
      "if [ \"$1\" = \"list\" ]; then printf '{\"changes\":[],\"root\":{\"path\":\"/tmp\",\"source\":\"implicit\"}}\\n'; exit 0; fi",
      "if [ \"$1\" = \"schema\" ] && [ \"$2\" = \"validate\" ]; then printf '{\"valid\":true,\"issues\":[]}\\n'; exit 0; fi",
      "printf '{\"error\":{\"message\":\"unsupported fake invocation\"}}\\n'; exit 1",
    ].join("\n"));
    chmodSync(openspec, 0o755);
    for (const tracker of ["gh", "glab"]) {
      const executable = resolve(binDir, tracker);
      writeFileSync(executable, [
        "#!/bin/sh",
        `if [ \"$1\" = \"--version\" ]; then printf '${tracker} version 0.0.0\\n'; exit 0; fi`,
        "if [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then exit 0; fi",
        "exit 0",
      ].join("\n"));
      chmodSync(executable, 0o755);
    }
    commandEnv = {
      ...process.env,
      CORGISPEC_OPENSPEC_BIN: openspec,
      HOME: TEST_BASE,
      USERPROFILE: TEST_BASE,
      PATH: `${binDir}${delimiter}${process.env["PATH"] ?? ""}`,
    };
  });

  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true });
  });

  it("initializes in a fresh directory with default schema", () => {
    const result = runInit();

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
    const result = runInit(["--schema", "gitlab-tracked"]);

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
    runInit([
      "--schema", "team-flow",
      "--tracking-provider", "none",
      "--task-artifact", "execution-plan",
    ]);

    const config = readFileSync(resolve(targetDir, "openspec/config.yaml"), "utf-8");
    expect(config).toContain("schema: team-flow");
    expect(config).toContain("provider: none");
    expect(config).toContain("taskArtifactId: execution-plan");
  });

  it("does not silently migrate an existing v3 config", () => {
    const configDir = resolve(targetDir, "openspec");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(resolve(configDir, "config.yaml"), "schema: custom\n");

    expect(() => runInit()).toThrow();
    const config = readFileSync(resolve(configDir, "config.yaml"), "utf-8");
    expect(config).toBe("schema: custom\n");
  });

  it("routes --platform claude through bootstrap-managed project commands", () => {
    runInit(["--platform", "claude"]);

    expect(existsSync(resolve(targetDir, ".claude/commands/corgi"))).toBe(true);
    expect(existsSync(resolve(targetDir, ".opencode/commands"))).toBe(false);
  });

  it("routes --platform all through the same bootstrap writer", () => {
    runInit(["--platform", "all"]);

    expect(existsSync(resolve(targetDir, ".claude/commands/corgi"))).toBe(true);
    expect(existsSync(resolve(targetDir, ".opencode/commands"))).toBe(true);
    expect(existsSync(resolve(targetDir, "rfcs/RFC-0001-project-foundation"))).toBe(true);
  });

  it("generated config includes the complete RFC contract", () => {
    runInit();

    const config = readFileSync(resolve(targetDir, "openspec/config.yaml"), "utf-8");
    expect(config).toContain("contract: rfc-v1");
    expect(config).toContain("rfcRoot: rfcs");
    expect(config).toContain("foundation: RFC-0001-project-foundation");
    expect(config).toContain("integrationBranch: main");
  });

  it("exits with error for invalid --schema value", () => {
    try {
      runInit(["--schema", "Invalid Schema!"]);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).not.toBe(0);
      expect(err.stdout + err.stderr).toContain("Invalid schema");
    }
  });

  function runInit(args: string[] = []): string {
    return execFileSync(process.execPath, [CLI, "init", targetDir, ...args], {
      encoding: "utf-8",
      env: commandEnv,
    });
  }
});
