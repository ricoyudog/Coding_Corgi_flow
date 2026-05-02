import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { InstallManifest } from "./install-assets.js";
import { sha256File } from "./install-assets.js";

export interface BootstrapCheck {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

export interface WriteInstallManifestInput {
  targetDir: string;
  sourceRepo: string;
  schema: "gitlab-tracked" | "github-tracked";
  isolation: { mode: "none" | "worktree"; root?: string; branch_prefix?: string };
  installedAt?: string;
  updatedAt: string;
  files: string[];
}

export interface WriteInstallReportInput {
  targetDir: string;
  sourceRepo: string;
  mode: "fresh-install" | "managed-update" | "legacy-install" | "verify-only";
  timestamp: string;
  checks: BootstrapCheck[];
  actions: string[];
  overall: "PASS" | "FAIL";
}

export function writeInstallManifest(input: WriteInstallManifestInput): string {
  const manifestPath = resolve(input.targetDir, "openspec/.opsx-install.json");
  mkdirSync(dirname(manifestPath), { recursive: true });

  const files = Object.fromEntries(
    input.files
      .slice()
      .sort()
      .map((filePath) => [
        normalizeRelativePath(relative(input.targetDir, filePath)),
        { sha256: sha256File(filePath) },
      ])
  );

  const existingInstalledAt = readInstalledAtIfPresent(manifestPath);
  const manifest: InstallManifest = {
    version: 1,
    installedAt: input.installedAt ?? existingInstalledAt ?? input.updatedAt,
    updatedAt: input.updatedAt,
    sourceRepo: input.sourceRepo,
    schema: input.schema,
    isolation: input.isolation,
    files,
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

export function writeInstallReport(input: WriteInstallReportInput): string {
  const reportPath = resolve(input.targetDir, "openspec/.opsx-install-report.md");
  mkdirSync(dirname(reportPath), { recursive: true });

  const lines = [
    `- Mode: ${input.mode}`,
    `- Timestamp: ${input.timestamp}`,
    `- Source repo: ${input.sourceRepo}`,
    `- Target project: ${input.targetDir}`,
    "",
    "| Check | Status | Detail |",
    "|---|---|---|",
    ...input.checks.map(
      (check) =>
        `| ${escapeTableCell(check.name)} | ${check.status} | ${escapeTableCell(check.detail)} |`
    ),
    "",
    `- Overall: ${input.overall}`,
    `- Actions taken: ${input.actions.length > 0 ? input.actions.join("; ") : "none (verify-only)"}`,
    "",
  ];

  writeFileSync(reportPath, `${lines.join("\n")}\n`);
  return reportPath;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function readInstalledAtIfPresent(manifestPath: string): string | undefined {
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as InstallManifest;
    return parsed.installedAt;
  } catch {
    return undefined;
  }
}
