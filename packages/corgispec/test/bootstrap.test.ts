import { execSync, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBootstrap } from "../src/lib/bootstrap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const PACKAGE_VERSION = (JSON.parse(
  readFileSync(resolve(PACKAGE_ROOT, "package.json"), "utf8"),
) as { version: string }).version;
const CLI = resolve(PACKAGE_ROOT, "dist/corgispec.js");
const ASSETS_ROOT = resolve(PACKAGE_ROOT, "assets");
const TEST_ROOT = resolve(tmpdir(), `corgispec-bootstrap-${Date.now()}`);
const ORIGINAL_OPENSPEC_BIN = process.env["CORGISPEC_OPENSPEC_BIN"];
const ORIGINAL_PATH = process.env["PATH"];

function bootstrapEnv(pathValue: string | undefined): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: TEST_ROOT,
    USERPROFILE: TEST_ROOT,
    PATH: pathValue ?? process.env["PATH"] ?? "",
  };
}

function createFakeGhBin(root: string): string {
  const binDir = resolve(root, "fake-bin");
  const ghPath = resolve(binDir, "gh");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    ghPath,
    "#!/usr/bin/env bash\nif [ \"$1\" = \"--version\" ]; then\n  printf 'gh version 0.0.0\\n'\n  exit 0\nfi\nif [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then\n  exit 0\nfi\nexit 0\n"
  );
  chmodSync(ghPath, 0o755);
  return binDir;
}

function createFakeOpenSpecBin(root: string): string {
  const binDir = resolve(root, "fake-openspec-bin");
  const openspecPath = resolve(binDir, "openspec");
  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    openspecPath,
    [
      "#!/bin/sh",
      "if [ -n \"$CORGISPEC_FAKE_LOG\" ]; then printf '%s|%s\\n' \"$PWD\" \"$*\" >> \"$CORGISPEC_FAKE_LOG\"; fi",
      "if [ \"$1\" = \"--version\" ]; then printf '1.6.0\\n'; exit 0; fi",
      "if [ \"$1\" = \"list\" ]; then printf '{\"changes\":[],\"root\":{\"path\":\"/tmp\",\"source\":\"implicit\"}}\\n'; exit 0; fi",
      "if [ \"$1\" = \"schema\" ] && [ \"$2\" = \"validate\" ] && [ \"$4\" = \"--json\" ]; then",
      "  if [ \"$CORGISPEC_FAKE_SCHEMA_RESULT\" = \"invalid\" ]; then printf '{\"valid\":false,\"issues\":[{\"message\":\"schema not found\"}]}\\n'; exit 1; fi",
      "  if [ \"$CORGISPEC_FAKE_SCHEMA_RESULT\" = \"malformed\" ]; then printf 'not-json\\n'; exit 0; fi",
      "  if [ \"$CORGISPEC_FAKE_SCHEMA_RESULT\" = \"nonzero\" ]; then printf '{\"valid\":true}\\n'; printf 'validator failed\\n' >&2; exit 7; fi",
      "  printf '{\"valid\":true,\"issues\":[],\"futureField\":{\"accepted\":true}}\\n'; exit 0",
      "fi",
      "printf '{\"error\":{\"message\":\"unsupported fake invocation\"}}\\n'; exit 1",
    ].join("\n"),
  );
  chmodSync(openspecPath, 0o755);
  return openspecPath;
}

function userSkillDirs(userSkillRoot: string) {
  return {
    claude: resolve(userSkillRoot, "claude"),
    opencode: resolve(userSkillRoot, "opencode"),
    codex: resolve(userSkillRoot, "codex"),
  };
}

function listDirEntries(root: string): string[] {
  const entries: string[] = [];
  if (!existsSync(root)) {
    return entries;
  }

  const walk = (dir: string, prefix = "") => {
    for (const entry of readdirSync(dir)) {
      const fullPath = resolve(dir, entry);
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath, relativePath);
      } else {
        entries.push(relativePath);
      }
    }
  };

  walk(root);
  return entries;
}

function writeLegacyTarget(targetDir: string): void {
  mkdirSync(resolve(targetDir, "openspec"), { recursive: true });
  writeFileSync(resolve(targetDir, "README.md"), "# Legacy Project\n\nBootstrap target.\n");
  writeFileSync(resolve(targetDir, "openspec/config.yaml"), "schema: github-tracked\n");
  mkdirSync(resolve(targetDir, ".opencode/commands"), { recursive: true });
  writeFileSync(resolve(targetDir, ".opencode/commands/corgi-install.md"), "# legacy install\n");
}

describe("bootstrap library", () => {
  let targetDir: string;
  let userSkillRoot: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    targetDir = resolve(TEST_ROOT, `case-${counter}`);
    userSkillRoot = resolve(TEST_ROOT, `user-skills-${counter}`);
    mkdirSync(targetDir, { recursive: true });
    mkdirSync(userSkillRoot, { recursive: true });
    delete process.env["CORGISPEC_FAKE_SCHEMA_RESULT"];
    delete process.env["CORGISPEC_FAKE_LOG"];
    process.env["CORGISPEC_OPENSPEC_BIN"] = createFakeOpenSpecBin(TEST_ROOT);
    process.env["PATH"] = `${createFakeGhBin(TEST_ROOT)}${delimiter}${ORIGINAL_PATH ?? ""}`;
  });

  afterEach(() => {
    if (ORIGINAL_OPENSPEC_BIN === undefined) {
      delete process.env["CORGISPEC_OPENSPEC_BIN"];
    } else {
      process.env["CORGISPEC_OPENSPEC_BIN"] = ORIGINAL_OPENSPEC_BIN;
    }
    delete process.env["CORGISPEC_FAKE_SCHEMA_RESULT"];
    delete process.env["CORGISPEC_FAKE_LOG"];
    if (ORIGINAL_PATH === undefined) {
      delete process.env["PATH"];
    } else {
      process.env["PATH"] = ORIGINAL_PATH;
    }
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("includes the repo-level install dispatcher source document", () => {
    expect(existsSync(resolve(PACKAGE_ROOT, "../../.opencode/INSTALL.md"))).toBe(true);
  });

  it("includes bootstrap in CLI help output", () => {
    const output = execSync(`node ${CLI} --help`, { encoding: "utf-8" });

    expect(output).toContain("bootstrap");
    expect(output).toMatch(/^\s+apply\b/mu);
    expect(output).not.toMatch(/^\s+loop\b/mu);
  });

  it("prints pure JSON for a fresh local bootstrap", () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Json CLI Project\n\nBootstrap target.\n");
    const fakeBin = createFakeGhBin(targetDir);

    const command = spawnSync(
      process.execPath,
      [CLI, "bootstrap", "--target", targetDir, "--scope", "local", "--yes", "--json"],
      {
        encoding: "utf-8",
        env: bootstrapEnv(`${fakeBin}:${process.env["PATH"] ?? ""}`),
      },
    );

    expect(command.status).toBe(0);
    expect(command.stderr).toBe("");
    const parsed = JSON.parse(command.stdout) as Record<string, unknown>;
    expect(parsed.status).toBe("success");
    expect(parsed.mode).toBe("fresh");
    expect(parsed).toHaveProperty("reportPath");
  });

  it("prints pure JSON for a fresh bootstrap using the default scope", () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Default Json CLI Project\n");
    const fakeBin = createFakeGhBin(targetDir);

    const output = execSync(
      `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --yes --json`,
      {
        encoding: "utf-8",
        env: bootstrapEnv(`${fakeBin}:${process.env["PATH"] ?? ""}`),
      },
    );

    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.status).toBe("success");
    expect(parsed.mode).toBe("fresh");
  });

  it("prints summary output and sets non-zero exit code when bootstrap stops", () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Stop CLI Project\n\nBootstrap target.\n");
    const fakeBin = createFakeGhBin(targetDir);

    try {
      execSync(
        `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --mode update`,
        {
          encoding: "utf-8",
          env: bootstrapEnv(`${fakeBin}:${process.env["PATH"] ?? ""}`),
        }
      );
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stdout).toContain("Status: stopped");
      expect(err.stdout).toContain("Mode: update");
      expect(err.stdout).toContain("Message:");
      expect(err.stdout).toContain("Report:");
    }
  });

  it("rejects an invalid schema before running bootstrap", () => {
    try {
      execSync(
        `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --schema 'Invalid Schema!'`,
        {
          encoding: "utf-8",
          env: bootstrapEnv(process.env["PATH"]),
        }
      );
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stdout).toContain("Invalid schema");
      expect(existsSync(resolve(targetDir, "openspec"))).toBe(false);
    }
  });

  it("bootstraps an arbitrary OpenSpec schema without requiring a tracker CLI", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Custom Workflow\n");
    mkdirSync(resolve(targetDir, "openspec/schemas/team-flow"), { recursive: true });
    writeFileSync(
      resolve(targetDir, "openspec/schemas/team-flow/schema.yaml"),
      "name: team-flow\nversion: 1\nartifacts: []\n",
    );
    const invocationLog = resolve(TEST_ROOT, "custom-schema-invocations.log");
    process.env["CORGISPEC_FAKE_LOG"] = invocationLog;
    const result = await runBootstrap({
      target: targetDir,
      schema: "team-flow",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      scope: "local",
    });

    expect(result.status).toBe("success");
    const config = readFileSync(resolve(targetDir, "openspec/config.yaml"), "utf-8");
    expect(config).toContain("schema: team-flow");
    expect(config).toContain("provider: none");
    expect(config).not.toContain("taskArtifactId:");
    const schemaInvocation = readFileSync(invocationLog, "utf-8")
      .split(/\r?\n/)
      .find((line) => line.includes("schema validate team-flow --json"));
    expect(schemaInvocation?.startsWith(`${targetDir}|`)).toBe(true);
  });

  it("validates a not-yet-installed bundled schema in an isolated staging project", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Bundled Schema\n");
    const invocationLog = resolve(TEST_ROOT, "bundled-schema-invocations.log");
    process.env["CORGISPEC_FAKE_LOG"] = invocationLog;

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      scope: "local",
    });

    expect(result.status).toBe("success");
    const schemaInvocation = readFileSync(invocationLog, "utf-8")
      .split(/\r?\n/)
      .find((line) => line.includes("schema validate github-tracked --json"));
    expect(schemaInvocation).toBeDefined();
    expect(schemaInvocation?.startsWith(`${targetDir}|`)).toBe(false);
    expect(schemaInvocation).toContain("corgispec-schema-validate-");
    expect(existsSync(schemaInvocation!.split("|", 1)[0]!)).toBe(false);
  });

  it.each([
    ["invalid", "missing-team-flow", "schema not found"],
    ["malformed", "github-tracked", "malformed JSON"],
    ["nonzero", "github-tracked", "validator failed"],
  ])(
    "rejects %s schema validation before mutating the target",
    async (fakeResult, schema, expectedMessage) => {
      writeFileSync(resolve(targetDir, "README.md"), "# Invalid Schema\n");
      const before = listDirEntries(targetDir);
      process.env["CORGISPEC_FAKE_SCHEMA_RESULT"] = fakeResult;

      const result = await runBootstrap({
        target: targetDir,
        schema,
        mode: "auto",
        yes: true,
        noMemory: true,
        json: false,
        assetsRoot: ASSETS_ROOT,
        userSkillDirs: userSkillDirs(userSkillRoot),
        scope: "local",
      });

      expect(result.status).toBe("failed");
      expect(result.message).toContain(expectedMessage);
      expect(listDirEntries(targetDir)).toEqual(before);
      expect(existsSync(result.reportPath)).toBe(false);
    },
  );

  it("rejects an invalid mode before running bootstrap", () => {
    try {
      execSync(
        `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --mode invalid-mode`,
        {
          encoding: "utf-8",
          env: bootstrapEnv(process.env["PATH"]),
        }
      );
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stdout).toContain("Invalid mode");
      expect(existsSync(resolve(targetDir, "openspec"))).toBe(false);
    }
  });

  it("bootstraps a fresh target and writes the install report", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Demo Project\n\nBootstrap target.\n");

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("success");
    expect(result.mode).toBe("fresh");
    expect(existsSync(resolve(targetDir, "openspec/.corgi-install-report.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "openspec/.corgi-install.json"))).toBe(true);

    const report = readFileSync(resolve(targetDir, "openspec/.corgi-install-report.md"), "utf-8");
    expect(report).toContain("Mode: fresh-install");
    expect(report).toContain("Overall: PASS");
  });

  it("stops managed update when a tracked file has local modifications", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Managed Project\n\nBootstrap target.\n");

    await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    const userSkillsBeforeStop = listDirEntries(userSkillRoot);

    writeFileSync(
      resolve(targetDir, ".opencode/commands/corgi-install.md"),
      "# locally modified\n"
    );

    const result = await runBootstrap({
      target: targetDir,
      mode: "update",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("stopped");
    expect(result.mode).toBe("update");
    expect(result.message.toLowerCase()).toContain("local modifications");
    expect(listDirEntries(userSkillRoot)).toEqual(userSkillsBeforeStop);
    expect(result.migration.backups.some((path) => path.includes(".corgi-backups"))).toBe(true);

    const report = readFileSync(resolve(targetDir, "openspec/.corgi-install-report.md"), "utf-8");
    expect(report).toContain("Managed files");
    expect(report).toContain("FAIL");
  });

  it("verify mode checks a managed install without changing any files", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Verify Project\n\nBootstrap target.\n");
    const installed = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      scope: "local",
    });
    expect(installed.status).toBe("success");
    const reportPath = resolve(targetDir, "openspec/.corgi-install-report.md");
    writeFileSync(reportPath, "sentinel report\n");
    const before = listDirEntries(targetDir);

    const result = await runBootstrap({
      target: targetDir,
      mode: "verify",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("success");
    expect(result.mode).toBe("verify");
    expect(listDirEntries(targetDir)).toEqual(before);
    expect(readFileSync(reportPath, "utf-8")).toBe("sentinel report\n");
  });

  it("verify mode rejects an unmanaged empty directory without writing", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Unmanaged Verify Project\n");
    const before = listDirEntries(targetDir);

    const result = await runBootstrap({
      target: targetDir,
      mode: "verify",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("stopped");
    expect(result.message).toContain("managed bootstrap state");
    expect(listDirEntries(targetDir)).toEqual(before);
    expect(existsSync(result.reportPath)).toBe(false);
  });

  it("verify mode fails closed on a managed hash mismatch without rewriting it", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Modified Managed Project\n");
    const installed = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      scope: "local",
    });
    expect(installed.status).toBe("success");
    const modifiedPath = resolve(targetDir, ".opencode/commands/corgi-propose.md");
    writeFileSync(modifiedPath, "locally modified\n");

    const result = await runBootstrap({
      target: targetDir,
      mode: "verify",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("stopped");
    expect(result.message).toContain("hashes do not match");
    expect(readFileSync(modifiedPath, "utf-8")).toBe("locally modified\n");
  });

  it("stops when explicit update mode is incompatible with an init-needed target", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Explicit Update Project\n\nBootstrap target.\n");

    const result = await runBootstrap({
      target: targetDir,
      mode: "update",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("stopped");
    expect(result.mode).toBe("update");
    expect(result.message.toLowerCase()).toContain("update");
    expect(existsSync(resolve(targetDir, "openspec/.corgi-install.json"))).toBe(false);
    expect(existsSync(resolve(targetDir, ".opencode/commands/corgi-propose.md"))).toBe(false);
  });

  it("returns JSON-safe output with stable status fields", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Json Project\n\nBootstrap target.\n");

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: true,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    const parsed = JSON.parse(JSON.stringify(result)) as Record<string, unknown>;

    expect(parsed).toHaveProperty("status");
    expect(parsed).toHaveProperty("mode");
    expect(parsed).toHaveProperty("reportPath");
    expect(parsed.status).toBe("success");
  });

  it("stops legacy migration for approval after creating a backup when yes is false", async () => {
    writeLegacyTarget(targetDir);

    const result = await runBootstrap({
      target: targetDir,
      mode: "auto",
      yes: false,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("needs-approval");
    expect(result.mode).toBe("legacy");
    expect(result.message.toLowerCase()).toContain("approval");
    expect(existsSync(resolve(targetDir, "openspec/.corgi-install.json"))).toBe(false);
    expect(existsSync(resolve(targetDir, ".opencode/commands/corgi-propose.md"))).toBe(false);
    expect(existsSync(resolve(userSkillRoot, "claude/corgispec-install"))).toBe(false);
    expect(existsSync(resolve(userSkillRoot, "opencode/corgispec-install"))).toBe(false);
    expect(existsSync(resolve(userSkillRoot, "codex/corgispec-install"))).toBe(false);

    const backupDir = resolve(targetDir, "openspec/.corgi-backups");
    expect(existsSync(backupDir)).toBe(true);

    const report = readFileSync(resolve(targetDir, "openspec/.corgi-install-report.md"), "utf-8");
    expect(report).toContain("Mode: legacy-install");
    expect(report).toContain("Overall: FAIL");
  });

  it("backs up the full overwrite set during legacy migration", async () => {
    writeLegacyTarget(targetDir);
    mkdirSync(resolve(targetDir, ".claude/commands/corgi"), { recursive: true });
    writeFileSync(resolve(targetDir, ".claude/commands/corgi/install.md"), "# legacy claude install\n");
    writeFileSync(resolve(targetDir, ".opencode/commands/corgi-propose.md"), "# existing propose\n");

    const result = await runBootstrap({
      target: targetDir,
      mode: "legacy",
      yes: false,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("needs-approval");

    const backupRoot = resolve(targetDir, "openspec/.corgi-backups");
    expect(existsSync(backupRoot)).toBe(true);

    const backupDirName = result.actions
      .find((action) => action.startsWith("created legacy backup at "))
      ?.replace(`created legacy backup at ${backupRoot}/`, "")
      .replace(`created legacy backup at ${backupRoot}`, "");

    expect(backupDirName).toBeTruthy();
    expect(
      existsSync(resolve(backupRoot, backupDirName!, ".opencode/commands/corgi-propose.md"))
    ).toBe(true);
  });

  it("proceeds with legacy migration after backup when yes is true", async () => {
    writeLegacyTarget(targetDir);

    const result = await runBootstrap({
      target: targetDir,
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("success");
    expect(result.mode).toBe("legacy");
    expect(existsSync(resolve(targetDir, "openspec/.corgi-install.json"))).toBe(true);
    expect(existsSync(resolve(targetDir, ".opencode/commands/corgi-propose.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "openspec/.corgi-backups"))).toBe(true);

    const report = readFileSync(resolve(targetDir, "openspec/.corgi-install-report.md"), "utf-8");
    expect(report).toContain("Mode: legacy-install");
    expect(report).toContain("Overall: PASS");
  });

  it("fails prerequisite checks before mutation when schema-specific cli is unavailable", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# GitLab Project\n\nBootstrap target.\n");

    const originalPath = process.env["PATH"];
    process.env["PATH"] = "";

    try {
      const result = await runBootstrap({
        target: targetDir,
        schema: "gitlab-tracked",
        mode: "auto",
        yes: true,
        noMemory: true,
        json: false,
        assetsRoot: ASSETS_ROOT,
        userSkillDirs: userSkillDirs(userSkillRoot),
      });

      expect(result.status).toBe("failed");
      expect(result.message.toLowerCase()).toContain("glab");
      expect(existsSync(resolve(targetDir, "openspec/.corgi-install.json"))).toBe(false);
      expect(existsSync(resolve(targetDir, ".opencode/commands/corgi-propose.md"))).toBe(false);
      expect(existsSync(result.reportPath)).toBe(false);
    } finally {
      process.env["PATH"] = originalPath;
    }
  });

  it("fails a nonexistent target before creating openspec structure", async () => {
    const missingTarget = resolve(TEST_ROOT, "missing-target");

    const result = await runBootstrap({
      target: missingTarget,
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("failed");
    expect(result.message.toLowerCase()).toContain("does not exist");
    expect(existsSync(resolve(missingTarget, "openspec"))).toBe(false);
    expect(existsSync(resolve(missingTarget))).toBe(false);
  });

  it("rejects an invalid platform before running bootstrap", () => {
    try {
      execSync(
        `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --platform invalid-platform`,
        {
          encoding: "utf-8",
          env: bootstrapEnv(process.env["PATH"]),
        }
      );
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stdout).toContain("Invalid platform");
    }
  });

  it("shows --platform option in bootstrap help output", () => {
    const output = execSync(`node ${CLI} bootstrap --help`, { encoding: "utf-8" });

    expect(output).toContain("--platform");
  });

  it("passes platforms option through to runBootstrap", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Platform Project\n\nBootstrap target.\n");

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      platforms: ["claude", "opencode"],
    });

    expect(result.status).toBe("success");
  });

  it("defaults to all platforms when not specified", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Default Platform Project\n\nBootstrap target.\n");

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("success");
  });

  it("rejects an invalid scope before running bootstrap", () => {
    try {
      execSync(
        `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --scope invalid-scope`,
        {
          encoding: "utf-8",
          env: bootstrapEnv(process.env["PATH"]),
        }
      );
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(1);
      expect(err.stdout).toContain("Invalid scope");
    }
  });

  it("shows --scope option in bootstrap help output", () => {
    const output = execSync(`node ${CLI} bootstrap --help`, { encoding: "utf-8" });

    expect(output).toContain("--scope");
  });

  it("passes scope option through to runBootstrap", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Scope Project\n\nBootstrap target.\n");

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      scope: "local",
    });

    expect(result.status).toBe("success");
  });

  it("defaults to both scopes when not specified", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Default Scope Project\n\nBootstrap target.\n");

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
    });

    expect(result.status).toBe("success");

  });
  it("installs to specific platform with local scope", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Platform+Scope\n\nTest.\n");

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      platforms: ["opencode"],
      scope: "local",
    });

    expect(result.status).toBe("success");
    expect(existsSync(resolve(targetDir, ".opencode/commands/corgi-propose.md"))).toBe(true);
  });

  it("global scope does not sync project-local files", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Global\n\nTest.\n");

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      platforms: ["claude"],
      scope: "global",
    });

    expect(result.status).toBe("success");
    expect(existsSync(resolve(targetDir, ".opencode/commands/corgi-propose.md"))).toBe(false);
  });

  it("runs bootstrap CLI with platform and scope flags", () => {
    writeFileSync(resolve(targetDir, "README.md"), "# CLI Platform+Scope\n\nTest.\n");
    const fakeBin = createFakeGhBin(targetDir);
    const env = bootstrapEnv(`${fakeBin}:${process.env["PATH"] ?? ""}`);

    execSync(
      `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --platform claude,opencode --scope local --yes --json`,
      { encoding: "utf-8", env },
    );

    const output = execSync(
      `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --platform claude,opencode --scope local --mode verify --json`,
      {
        encoding: "utf-8",
        env,
      }
    );

    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.status).toBe("success");
  });

  it("both scope installs to user and project", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Both\n\nTest.\n");

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      platforms: ["claude"],
      scope: "both",
    });

    expect(result.status).toBe("success");
  });

  it("migrates a v1 manifest to v2, preserves installedAt, and repairs missing files", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# V1 Repair\n");
    const installed = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      scope: "local",
    });
    expect(installed.status).toBe("success");

    const manifestPath = resolve(targetDir, "openspec/.corgi-install.json");
    const current = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      files: Record<string, { sha256: string }>;
    };
    const installedAt = "2025-01-02T03:04:05.000Z";
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        version: 1,
        installedAt,
        schema: "github-tracked",
        files: current.files,
      }, null, 2)}\n`,
    );
    const missing = ".opencode/commands/corgi-propose.md";
    rmSync(resolve(targetDir, missing));

    const result = await runBootstrap({
      target: targetDir,
      mode: "update",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      scope: "local",
    });

    expect(result.status).toBe("success");
    expect(result.migration.fromManifestVersion).toBe(1);
    expect(result.migration.repaired).toContain(missing);
    expect(existsSync(resolve(targetDir, missing))).toBe(true);
    const migrated = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    expect(migrated.version).toBe(2);
    expect(migrated.packageVersion).toBe(PACKAGE_VERSION);
    expect(migrated.installedAt).toBe(installedAt);
  });

  it("migrates existing Claude hooks but preserves hookless opt-in", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Hook Migration\n");
    mkdirSync(resolve(targetDir, ".claude"), { recursive: true });
    writeFileSync(
      resolve(targetDir, ".claude/settings.json"),
      `${JSON.stringify({
        permissions: { allow: ["Read"] },
        hooks: {
          PreToolUse: [{ hooks: [{ type: "command", command: "npx corgispec hook pre-write" }] }],
          Stop: [{ hooks: [{ type: "command", command: "npx corgispec hook stop-check" }] }],
        },
      }, null, 2)}\n`,
    );

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      scope: "local",
      platforms: ["claude", "opencode"],
      binaryPath: "npx corgispec",
    });

    expect(result.status).toBe("success");
    const settings = readFileSync(resolve(targetDir, ".claude/settings.json"), "utf8");
    expect(settings).toContain('"allow": [');
    expect(settings).not.toContain("hook pre-write");
    expect(settings).not.toContain("hook stop-check");
    expect(settings).toContain("hook session-start");
    expect(existsSync(resolve(targetDir, ".opencode/plugins/corgispec-deep.ts"))).toBe(false);
    const manifest = JSON.parse(
      readFileSync(resolve(targetDir, "openspec/.corgi-install.json"), "utf8"),
    ) as { hooks?: Record<string, unknown> };
    expect(manifest.hooks).toHaveProperty("claude");
    expect(manifest.hooks).not.toHaveProperty("opencode");
  });

  it("retires a signature-proven YAML manifest after writing the canonical v2 manifest", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# YAML Manifest\n");
    const first = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      scope: "local",
    });
    expect(first.status).toBe("success");
    const canonical = resolve(targetDir, "openspec/.corgi-install.json");
    const current = JSON.parse(readFileSync(canonical, "utf8")) as {
      files: Record<string, { sha256: string }>;
    };
    rmSync(canonical);
    const legacy = resolve(targetDir, "openspec/install-manifest.yaml");
    writeFileSync(
      legacy,
      [
        "version: 1",
        "installedAt: '2025-02-03T04:05:06.000Z'",
        "schema: github-tracked",
        "managedFiles:",
        ...Object.entries(current.files).flatMap(([path, entry]) => [
          `  - path: ${path}`,
          `    sha256: ${entry.sha256}`,
        ]),
        "",
      ].join("\n"),
    );

    const result = await runBootstrap({
      target: targetDir,
      mode: "update",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      scope: "local",
    });

    expect(result.status).toBe("success");
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(result.migration.removed).toContain("openspec/install-manifest.yaml");
  });

  it("preflights both scopes before any managed project or user writes", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Conflict\n");
    const customSkill = resolve(userSkillRoot, "claude/corgispec-ready");
    mkdirSync(customSkill, { recursive: true });
    writeFileSync(resolve(customSkill, "SKILL.md"), "# unrelated local skill\n");

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      userStateDir: resolve(TEST_ROOT, "user-state"),
      scope: "both",
    });

    expect(result.status).toBe("stopped");
    expect(existsSync(resolve(targetDir, "openspec/.corgi-install.json"))).toBe(false);
    expect(existsSync(resolve(targetDir, ".opencode/commands/corgi-propose.md"))).toBe(false);
    expect(existsSync(resolve(userSkillRoot, "codex/corgispec-ready"))).toBe(false);
    expect(readFileSync(resolve(customSkill, "SKILL.md"), "utf8")).toBe("# unrelated local skill\n");
    expect(result.migration.backups.some((path) => path.includes("user-state/backups"))).toBe(true);
  });

  it("global scope synchronizes skills and commands without touching project state", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Global Assets\n");
    const result = await runBootstrap({
      target: targetDir,
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      userSkillDirs: userSkillDirs(userSkillRoot),
      userStateDir: resolve(TEST_ROOT, "global-state"),
      scope: "global",
    });

    expect(result.status).toBe("success");
    expect(existsSync(resolve(userSkillRoot, "claude/corgispec-ready/SKILL.md"))).toBe(true);
    expect(existsSync(resolve(userSkillRoot, "opencode/corgispec-ready/SKILL.md"))).toBe(true);
    expect(existsSync(resolve(userSkillRoot, "codex/corgispec-ready/SKILL.md"))).toBe(true);
    expect(existsSync(resolve(userSkillRoot, "claude-commands/propose.md"))).toBe(true);
    expect(existsSync(resolve(userSkillRoot, "opencode-commands/corgi-propose.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "openspec"))).toBe(false);
    expect(result.reportPath).toBe(resolve(TEST_ROOT, "global-state/install-report.md"));
  });

  it("is idempotent after a complete local migration", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Idempotent\n");
    const first = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      scope: "local",
    });
    expect(first.status).toBe("success");

    const second = await runBootstrap({
      target: targetDir,
      mode: "update",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      scope: "local",
    });

    expect(second.status).toBe("success");
    expect(second.migration.conflicts).toEqual([]);
    expect(second.migration.backups).toEqual([]);
    expect(second.migration.preserved.length).toBeGreaterThan(0);
  });

  it("removes only signature-proven legacy project skill trees", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Legacy Skills\n");
    const owned = resolve(targetDir, ".claude/skills/openspec-apply");
    mkdirSync(owned, { recursive: true });
    writeFileSync(
      resolve(owned, "SKILL.md"),
      "---\nname: openspec-apply\n---\nUse OpenSpec to apply a Corgi change.\n",
    );

    const result = await runBootstrap({
      target: targetDir,
      schema: "github-tracked",
      mode: "auto",
      yes: true,
      noMemory: true,
      json: false,
      assetsRoot: ASSETS_ROOT,
      scope: "local",
      platforms: ["claude"],
    });

    expect(result.status).toBe("success");
    expect(existsSync(owned)).toBe(false);
    expect(result.migration.removed).toContain(".claude/skills/openspec-apply");
  });
});
