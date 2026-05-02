import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBootstrap } from "../src/lib/bootstrap.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const CLI = resolve(PACKAGE_ROOT, "dist/corgispec.js");
const ASSETS_ROOT = resolve(PACKAGE_ROOT, "assets");
const TEST_ROOT = resolve(tmpdir(), `corgispec-bootstrap-${Date.now()}`);

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
  writeFileSync(resolve(targetDir, ".opencode/commands/opsx-install.md"), "# legacy install\n");
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
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("includes the repo-level install dispatcher source document", () => {
    expect(existsSync(resolve(PACKAGE_ROOT, "../../.opencode/INSTALL.md"))).toBe(true);
  });

  it("includes bootstrap in CLI help output", () => {
    const output = execSync(`node ${CLI} --help`, { encoding: "utf-8" });

    expect(output).toContain("bootstrap");
  });

  it("prints JSON output for bootstrap command", () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Json CLI Project\n\nBootstrap target.\n");
    const fakeBin = createFakeGhBin(targetDir);

    const output = execSync(
      `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --mode verify --json`,
      {
        encoding: "utf-8",
        env: bootstrapEnv(`${fakeBin}:${process.env["PATH"] ?? ""}`),
      }
    );

    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed.status).toBe("success");
    expect(parsed.mode).toBe("verify");
    expect(parsed).toHaveProperty("reportPath");
  });

  it("prints summary output and sets non-zero exit code when bootstrap stops", () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Stop CLI Project\n\nBootstrap target.\n");
    const fakeBin = createFakeGhBin(targetDir);

    try {
      execSync(
        `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --mode update --no-memory`,
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
        `node ${CLI} bootstrap --target ${JSON.stringify(targetDir)} --schema invalid-schema`,
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
    expect(existsSync(resolve(targetDir, "openspec/.opsx-install-report.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "openspec/.opsx-install.json"))).toBe(true);

    const report = readFileSync(resolve(targetDir, "openspec/.opsx-install-report.md"), "utf-8");
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
      resolve(targetDir, ".opencode/commands/opsx-install.md"),
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

    const report = readFileSync(resolve(targetDir, "openspec/.opsx-install-report.md"), "utf-8");
    expect(report).toContain("Managed files");
    expect(report).toContain("FAIL");
  });

  it("verify mode is non-mutating and writes no install artifacts", async () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Verify Project\n\nBootstrap target.\n");
    mkdirSync(resolve(targetDir, "openspec"), { recursive: true });
    writeFileSync(resolve(targetDir, "openspec/config.yaml"), "schema: github-tracked\n");

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
    expect(existsSync(resolve(targetDir, "openspec/.opsx-install.json"))).toBe(false);
    expect(existsSync(resolve(targetDir, ".opencode/commands/opsx-propose.md"))).toBe(false);

    const report = readFileSync(resolve(targetDir, "openspec/.opsx-install-report.md"), "utf-8");
    expect(report).toContain("Mode: verify-only");
    expect(report).toContain("none (verify-only)");
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
    expect(existsSync(resolve(targetDir, "openspec/.opsx-install.json"))).toBe(false);
    expect(existsSync(resolve(targetDir, ".opencode/commands/opsx-propose.md"))).toBe(false);
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
    expect(existsSync(resolve(targetDir, "openspec/.opsx-install.json"))).toBe(false);
    expect(existsSync(resolve(targetDir, ".opencode/commands/opsx-propose.md"))).toBe(false);
    expect(existsSync(resolve(userSkillRoot, "claude/openspec-install"))).toBe(false);
    expect(existsSync(resolve(userSkillRoot, "opencode/openspec-install"))).toBe(false);
    expect(existsSync(resolve(userSkillRoot, "codex/openspec-install"))).toBe(false);

    const backupDir = resolve(targetDir, "openspec/.opsx-backups");
    expect(existsSync(backupDir)).toBe(true);

    const report = readFileSync(resolve(targetDir, "openspec/.opsx-install-report.md"), "utf-8");
    expect(report).toContain("Mode: legacy-install");
    expect(report).toContain("Overall: FAIL");
  });

  it("backs up the full overwrite set during legacy migration", async () => {
    writeLegacyTarget(targetDir);
    mkdirSync(resolve(targetDir, ".claude/commands/opsx"), { recursive: true });
    writeFileSync(resolve(targetDir, ".claude/commands/opsx/install.md"), "# legacy claude install\n");
    writeFileSync(resolve(targetDir, ".opencode/commands/opsx-propose.md"), "# existing propose\n");

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

    const backupRoot = resolve(targetDir, "openspec/.opsx-backups");
    expect(existsSync(backupRoot)).toBe(true);

    const backupDirName = result.actions
      .find((action) => action.startsWith("created legacy backup at "))
      ?.replace(`created legacy backup at ${backupRoot}/`, "")
      .replace(`created legacy backup at ${backupRoot}`, "");

    expect(backupDirName).toBeTruthy();
    expect(
      existsSync(resolve(backupRoot, backupDirName!, ".opencode/commands/opsx-propose.md"))
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
    expect(existsSync(resolve(targetDir, "openspec/.opsx-install.json"))).toBe(true);
    expect(existsSync(resolve(targetDir, ".opencode/commands/opsx-propose.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "openspec/.opsx-backups"))).toBe(true);

    const report = readFileSync(resolve(targetDir, "openspec/.opsx-install-report.md"), "utf-8");
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
      expect(existsSync(resolve(targetDir, "openspec/.opsx-install.json"))).toBe(false);
      expect(existsSync(resolve(targetDir, ".opencode/commands/opsx-propose.md"))).toBe(false);

      const report = readFileSync(resolve(targetDir, "openspec/.opsx-install-report.md"), "utf-8");
      expect(report).toContain("gh/glab CLI");
      expect(report).toContain("FAIL");
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
});
