import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { chmodSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { buildClaudeConfig } from "../src/lib/hook-install.js";

const CLI = resolve(__dirname, "../dist/corgispec.js");
const ORIGINAL_OPENSPEC_BIN = process.env["CORGISPEC_OPENSPEC_BIN"];

describe("doctor command", () => {
  let tempDir: string;

  function testCorgispecBinary(): string {
    const binDir = resolve(tempDir, "test-bin");
    const name = process.platform === "win32" ? "corgispec.cmd" : "corgispec";
    const binary = resolve(binDir, name);
    mkdirSync(binDir, { recursive: true });
    writeFileSync(binary, process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\nexit 0\n");
    if (process.platform !== "win32") chmodSync(binary, 0o755);
    return binary;
  }

  function commandEnv(): NodeJS.ProcessEnv {
    const home = resolve(tempDir, "home");
    mkdirSync(home, { recursive: true });
    const binary = testCorgispecBinary();
    return {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: resolve(home, ".config"),
      PATH: `${dirname(binary)}${delimiter}${process.env["PATH"] ?? ""}`,
    };
  }

  function runDoctor(extra = ""): string {
    return execSync(`node ${CLI} doctor --path ${tempDir} ${extra}`, {
      encoding: "utf-8",
      env: commandEnv(),
    });
  }

  beforeEach(() => {
    tempDir = resolve(tmpdir(), `corgispec-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    const openspec = resolve(tempDir, "fake-openspec");
    writeFileSync(
      openspec,
      [
        "#!/usr/bin/env bash",
        "if [ \"$1\" = \"--version\" ]; then printf '1.6.0\\n'; exit 0; fi",
        "if [ \"$1\" = \"schema\" ] && [ \"$2\" = \"validate\" ]; then",
        "  if [ \"$3\" = \"bad-schema\" ]; then printf '{\"valid\":false,\"issues\":[{\"message\":\"schema is invalid\"}]}\\n'; exit 1; fi",
        "  printf '{\"valid\":true,\"issues\":[]}\\n'; exit 0",
        "fi",
        "printf '{\"error\":\"unsupported fake invocation\"}\\n'; exit 1",
      ].join("\n"),
    );
    chmodSync(openspec, 0o755);
    process.env["CORGISPEC_OPENSPEC_BIN"] = openspec;
  });

  afterEach(() => {
    if (ORIGINAL_OPENSPEC_BIN === undefined) {
      delete process.env["CORGISPEC_OPENSPEC_BIN"];
    } else {
      process.env["CORGISPEC_OPENSPEC_BIN"] = ORIGINAL_OPENSPEC_BIN;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("passes with a valid project", () => {
    mkdirSync(resolve(tempDir, "openspec/schemas/github-tracked"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    writeFileSync(
      resolve(tempDir, "openspec/schemas/github-tracked/schema.yaml"),
      "name: github-tracked\nversion: 1\ndescription: Test\nartifacts: []\n"
    );

    const output = runDoctor();
    expect(output).toContain("Node.js");
    expect(output.toLowerCase()).toContain("pass");
    expect(output).toContain("Config: valid");
  });

  it("fails with invalid config", () => {
    mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/config.yaml"),
      "schema: custom\ncorgi:\n  tracking:\n    provider: jira\n",
    );

    try {
      runDoctor();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stdout + err.stderr).toContain("FAIL");
    }
  });

  it("handles missing config gracefully", () => {
    const output = runDoctor();
    expect(output).toContain("not found (not in a Corgi project)");
  });

  it("outputs valid JSON with --json flag", () => {
    mkdirSync(resolve(tempDir, "openspec/schemas/github-tracked"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
    writeFileSync(
      resolve(tempDir, "openspec/schemas/github-tracked/schema.yaml"),
      "name: github-tracked\nversion: 1\ndescription: Test\nartifacts: []\n"
    );

    const output = runDoctor("--json");
    const parsed = JSON.parse(output);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    for (const item of parsed) {
      expect(item).toHaveProperty("name");
      expect(item).toHaveProperty("passed");
      expect(item).toHaveProperty("message");
    }
  });

  it("reports Claude, OpenCode, and Codex hooks independently", () => {
    const binaryPath = testCorgispecBinary();
    mkdirSync(resolve(tempDir, ".claude"), { recursive: true });
    writeFileSync(
      resolve(tempDir, ".claude/settings.json"),
      `${JSON.stringify(buildClaudeConfig(binaryPath), null, 2)}\n`,
    );
    mkdirSync(resolve(tempDir, ".opencode/plugins"), { recursive: true });
    writeFileSync(
      resolve(tempDir, ".opencode/plugins/corgispec.ts"),
      "// locally edited file at a historical Corgi path\nexport default {};\n",
    );

    try {
      runDoctor("--json");
      expect.fail("doctor should report the stale OpenCode hook independently");
    } catch (err: any) {
      const parsed = JSON.parse(String(err.stdout)) as Array<{
        name: string;
        passed: boolean;
        message: string;
      }>;
      expect(parsed.find((item) => item.name === "Hooks (claude)")).toEqual(
        expect.objectContaining({ passed: true }),
      );
      expect(parsed.find((item) => item.name === "Hooks (opencode)")).toEqual(
        expect.objectContaining({ passed: false }),
      );
      expect(parsed.find((item) => item.name === "Hooks (codex)")).toEqual(
        expect.objectContaining({ passed: true, message: expect.stringContaining("opt-in") }),
      );
    }
  });

  it("includes the current Node version in output", () => {
    const output = runDoctor();
    expect(output).toContain(process.version);
  });

  it("detects corrupted schema files", () => {
    mkdirSync(resolve(tempDir, "openspec/schemas/bad-schema"), { recursive: true });
    writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: bad-schema\n");
    // Write invalid YAML that has no 'name' or 'artifacts' fields
    writeFileSync(
      resolve(tempDir, "openspec/schemas/bad-schema/schema.yaml"),
      "just: a string\nnothing: useful\n"
    );

    try {
      runDoctor();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
      const output = err.stdout + err.stderr;
      expect(output).toContain("FAIL");
      expect(output).toContain("schema is invalid");
    }
  });

  it("validates a Codex-only managed skill installation", () => {
    const env = commandEnv();
    mkdirSync(resolve(env.HOME!, ".codex"), { recursive: true });
    execSync(`node ${CLI} install --platform codex`, { encoding: "utf-8", env });

    const parsed = JSON.parse(runDoctor("--json")) as Array<{
      name: string;
      passed: boolean;
      message: string;
    }>;
    const skillChecks = parsed.filter((item) => item.name.endsWith(" skills"));
    expect(skillChecks).toEqual([
      expect.objectContaining({ name: "codex skills", passed: true }),
    ]);
  });

  it("rejects an empty detected platform skill directory", () => {
    const env = commandEnv();
    mkdirSync(resolve(env.HOME!, ".codex/skills"), { recursive: true });

    try {
      runDoctor("--json");
      expect.fail("doctor should reject an empty managed skill directory");
    } catch (err: any) {
      expect(err.status).toBe(1);
      const parsed = JSON.parse(String(err.stdout)) as Array<{
        name: string;
        passed: boolean;
        message: string;
      }>;
      expect(parsed).toContainEqual(
        expect.objectContaining({ name: "codex skills", passed: false }),
      );
      expect(parsed.find((item) => item.name === "codex skills")?.message).toContain("missing");
    }
  });

  it("rejects a modified managed skill checksum", () => {
    const env = commandEnv();
    mkdirSync(resolve(env.HOME!, ".codex"), { recursive: true });
    execSync(`node ${CLI} install --platform codex`, { encoding: "utf-8", env });
    writeFileSync(
      resolve(env.HOME!, ".codex/skills/corgispec-ready/SKILL.md"),
      "# modified\n",
    );

    try {
      runDoctor("--json");
      expect.fail("doctor should reject a modified managed skill");
    } catch (err: any) {
      const parsed = JSON.parse(String(err.stdout)) as Array<{
        name: string;
        passed: boolean;
        message: string;
      }>;
      expect(parsed.find((item) => item.name === "codex skills")?.message).toContain(
        "differs from bundled checksum",
      );
    }
  });
});
