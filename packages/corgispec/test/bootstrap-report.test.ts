import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  writeInstallManifest,
  writeInstallReport,
} from "../src/lib/bootstrap-report.js";
import type { InstallManifest } from "../src/lib/install-assets.js";

const TEST_ROOT = resolve(tmpdir(), `corgispec-bootstrap-report-${process.pid}`);

function writeFile(path: string, content: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

describe("bootstrap manifest and report", () => {
  let targetDir: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    targetDir = resolve(TEST_ROOT, `case-${counter}`);
    mkdirSync(targetDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("writes manifest v2 and preserves installedAt from legacy YAML", () => {
    const managedFile = resolve(targetDir, ".opencode/commands/corgi-install.md");
    writeFile(managedFile, "# managed\n");
    writeFile(
      resolve(targetDir, "openspec/install-manifest.yaml"),
      "version: 1\ninstalledAt: 2025-01-02T03:04:05.000Z\nmanagedFiles:\n  - .opencode/commands/corgi-install.md\n"
    );

    const manifestPath = writeInstallManifest({
      targetDir,
      sourceRepo: "/source/repo",
      packageVersion: "3.1.0",
      schema: "github-tracked",
      isolation: { mode: "worktree", root: ".worktrees" },
      updatedAt: "2026-07-16T10:00:00.000Z",
      files: [managedFile],
      hooks: {
        claude: {
          owned: true,
          format: "claude-settings-v2",
          files: [".claude\\settings.json", ".claude/settings.json"],
        },
      },
      migration: {
        fromManifestVersion: 1,
        repaired: ["missing.md"],
        updated: ["old.md"],
        removed: ["openspec/install-manifest.yaml"],
        preserved: ["custom.md"],
        conflicts: [],
        backups: ["openspec/.corgi-backups/run/project"],
      },
    });

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as InstallManifest;
    expect(manifest).toMatchObject({
      version: 2,
      packageVersion: "3.1.0",
      installedAt: "2025-01-02T03:04:05.000Z",
      updatedAt: "2026-07-16T10:00:00.000Z",
      sourceRepo: "/source/repo",
      schema: "github-tracked",
      isolation: { mode: "worktree", root: ".worktrees" },
      hooks: {
        claude: {
          owned: true,
          format: "claude-settings-v2",
          files: [".claude/settings.json"],
        },
      },
      latestMigration: {
        fromManifestVersion: 1,
        repaired: ["missing.md"],
        updated: ["old.md"],
        removed: ["openspec/install-manifest.yaml"],
        preserved: ["custom.md"],
        conflicts: [],
        backups: ["openspec/.corgi-backups/run/project"],
      },
    });
    expect(manifest.files?.[".opencode/commands/corgi-install.md"]?.sha256).toMatch(
      /^[a-f0-9]{64}$/
    );
  });

  it("preserves installedAt across subsequent v2 writes", () => {
    const managedFile = resolve(targetDir, "openspec/schemas/custom/schema.yaml");
    writeFile(managedFile, "name: custom\n");
    writeInstallManifest({
      targetDir,
      sourceRepo: "/source/repo",
      packageVersion: "3.1.0",
      schema: "custom",
      isolation: { mode: "none" },
      installedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      files: [managedFile],
    });

    const manifestPath = writeInstallManifest({
      targetDir,
      sourceRepo: "/source/repo",
      packageVersion: "3.2.0",
      schema: "custom",
      isolation: { mode: "none" },
      updatedAt: "2026-07-16T11:00:00.000Z",
      files: [managedFile],
    });
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as InstallManifest;

    expect(manifest.installedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(manifest.updatedAt).toBe("2026-07-16T11:00:00.000Z");
    expect(manifest.packageVersion).toBe("3.2.0");
  });

  it("can write a global-only report outside the target project", () => {
    const reportPath = resolve(TEST_ROOT, "home/.corgispec/install-report.md");
    const written = writeInstallReport({
      targetDir,
      sourceRepo: "/source/repo",
      packageVersion: "3.1.0",
      mode: "managed-update",
      timestamp: "2026-07-16T10:00:00.000Z",
      checks: [{ name: "User assets", status: "PASS", detail: "all current" }],
      actions: ["updated global skills"],
      overall: "PASS",
      reportPath,
      migration: {
        fromManifestVersion: 1,
        repaired: [],
        updated: ["claude/corgispec-install"],
        removed: [],
        preserved: ["custom-skill"],
        conflicts: [],
        backups: [],
      },
    });

    expect(written).toBe(reportPath);
    const report = readFileSync(reportPath, "utf-8");
    expect(report).toContain("Package version: 3.1.0");
    expect(report).toContain("## Migration summary");
    expect(report).toContain("From manifest version: 1");
    expect(report).toContain("Updated: claude/corgispec-install");
    expect(report).toContain("Preserved: custom-skill");
  });
});
