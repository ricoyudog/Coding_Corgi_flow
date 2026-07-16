import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { IsolationConfig, SchemaType } from "./config.js";
import {
  CANONICAL_INSTALL_MANIFEST_PATH,
  INSTALL_MANIFEST_VERSION,
  createMigrationSummary,
  readInstallManifest,
  sha256File,
  type InstallManifest,
  type InstallManifestHookMetadata,
  type InstallManifestReadResult,
  type ManifestHookPlatform,
  type MigrationSummary,
} from "./install-assets.js";

export interface BootstrapCheck {
  name: string;
  status: "PASS" | "FAIL" | "SKIP";
  detail: string;
}

export interface WriteInstallManifestInput {
  targetDir: string;
  sourceRepo: string;
  packageVersion: string;
  schema: SchemaType;
  isolation: IsolationConfig;
  installedAt?: string;
  updatedAt: string;
  /** Absolute paths to project-local files that were synchronized. */
  files: string[];
  hooks?: Partial<Record<ManifestHookPlatform, InstallManifestHookMetadata>>;
  migration?: MigrationSummary;
  /** Optional preflight result prevents the writer from needing to rediscover it. */
  previousManifest?: InstallManifest | InstallManifestReadResult;
}

export interface WriteInstallReportInput {
  targetDir: string;
  sourceRepo: string;
  packageVersion?: string;
  mode: "fresh-install" | "managed-update" | "legacy-install" | "verify-only";
  timestamp: string;
  checks: BootstrapCheck[];
  actions: string[];
  overall: "PASS" | "FAIL";
  migration?: MigrationSummary;
  /** Defaults to openspec/.corgi-install-report.md under targetDir. */
  reportPath?: string;
}

export function writeInstallManifest(input: WriteInstallManifestInput): string {
  const manifestPath = resolve(input.targetDir, CANONICAL_INSTALL_MANIFEST_PATH);
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

  const previous = resolvePreviousManifest(input.targetDir, input.previousManifest);
  const migration = normalizeMigrationSummary(
    input.migration
      ?? createMigrationSummary(previous?.version ?? null)
  );
  const manifest: InstallManifest = {
    version: INSTALL_MANIFEST_VERSION,
    packageVersion: input.packageVersion,
    installedAt: input.installedAt ?? previous?.installedAt ?? input.updatedAt,
    updatedAt: input.updatedAt,
    sourceRepo: input.sourceRepo,
    schema: input.schema,
    isolation: input.isolation,
    files,
    hooks: normalizeHooks(input.hooks ?? previous?.hooks ?? {}),
    latestMigration: migration,
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

export function writeInstallReport(input: WriteInstallReportInput): string {
  const reportPath = input.reportPath
    ? resolve(input.reportPath)
    : resolve(input.targetDir, "openspec/.corgi-install-report.md");
  mkdirSync(dirname(reportPath), { recursive: true });

  const lines = [
    `- Mode: ${input.mode}`,
    `- Timestamp: ${input.timestamp}`,
    `- Source repo: ${input.sourceRepo}`,
    ...(input.packageVersion ? [`- Package version: ${input.packageVersion}`] : []),
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
  ];

  if (input.migration) {
    const migration = normalizeMigrationSummary(input.migration);
    lines.push(
      "",
      "## Migration summary",
      "",
      `- From manifest version: ${migration.fromManifestVersion ?? "none"}`,
      `- Repaired: ${formatSummaryItems(migration.repaired)}`,
      `- Updated: ${formatSummaryItems(migration.updated)}`,
      `- Removed: ${formatSummaryItems(migration.removed)}`,
      `- Preserved: ${formatSummaryItems(migration.preserved)}`,
      `- Conflicts: ${formatSummaryItems(migration.conflicts)}`,
      `- Backups: ${formatSummaryItems(migration.backups)}`
    );
  }

  lines.push("");
  writeFileSync(reportPath, `${lines.join("\n")}\n`);
  return reportPath;
}

function resolvePreviousManifest(
  targetDir: string,
  previous: InstallManifest | InstallManifestReadResult | undefined
): InstallManifest | undefined {
  if (previous && "status" in previous) {
    return previous.status === "valid" ? previous.manifest : undefined;
  }
  if (previous) {
    return previous;
  }
  const read = readInstallManifest(targetDir);
  return read.status === "valid" ? read.manifest : undefined;
}

function normalizeHooks(
  hooks: Partial<Record<ManifestHookPlatform, InstallManifestHookMetadata>>
): Partial<Record<ManifestHookPlatform, InstallManifestHookMetadata>> {
  const normalized: Partial<Record<ManifestHookPlatform, InstallManifestHookMetadata>> = {};
  for (const platform of ["claude", "opencode", "codex"] as const) {
    const metadata = hooks[platform];
    if (!metadata) {
      continue;
    }
    normalized[platform] = {
      owned: metadata.owned,
      format: metadata.format,
      files: Array.from(new Set(metadata.files.map(normalizeRelativePath))).sort(),
    };
  }
  return normalized;
}

function normalizeMigrationSummary(summary: MigrationSummary): MigrationSummary {
  return {
    fromManifestVersion: summary.fromManifestVersion,
    repaired: normalizeSummaryItems(summary.repaired),
    updated: normalizeSummaryItems(summary.updated),
    removed: normalizeSummaryItems(summary.removed),
    preserved: normalizeSummaryItems(summary.preserved),
    conflicts: normalizeSummaryItems(summary.conflicts),
    backups: normalizeSummaryItems(summary.backups),
  };
}

function normalizeSummaryItems(items: string[]): string[] {
  return Array.from(new Set(items.map(normalizeRelativePath))).sort();
}

function formatSummaryItems(items: string[]): string {
  return items.length > 0 ? items.join("; ") : "none";
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/");
}
