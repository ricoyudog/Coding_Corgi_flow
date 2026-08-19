import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import type {
  IsolationConfig,
  SchemaType,
  TrackingProvider,
} from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const INSTALL_MANIFEST_VERSION = 2 as const;
export const CANONICAL_INSTALL_MANIFEST_PATH =
  "openspec/.corgi-install.json" as const;
export const LEGACY_INSTALL_MANIFEST_PATHS = [
  "openspec/install-manifest.yaml",
  "openspec/install-manifest.yml",
  "openspec/.opsx-install.json",
] as const;

const MANIFEST_PATHS = [
  CANONICAL_INSTALL_MANIFEST_PATH,
  ...LEGACY_INSTALL_MANIFEST_PATHS,
] as const;

const LEGACY_MARKERS = [
  ".opencode/commands/corgi-install.md",
  ".claude/commands/corgi/install.md",
] as const;

/**
 * Known paths alone never establish ownership. Callers must also require all
 * signatures to match before scheduling removal of one of these files.
 */
export interface LegacyProjectAssetCatalogEntry {
  path: string;
  kind: "manifest" | "command";
  signatures: readonly string[];
}

export const LEGACY_PROJECT_ASSET_CATALOG: readonly LegacyProjectAssetCatalogEntry[] = [
  {
    path: "openspec/install-manifest.yaml",
    kind: "manifest",
    signatures: ["version:", "managedFiles:"],
  },
  {
    path: "openspec/install-manifest.yml",
    kind: "manifest",
    signatures: ["version:", "managedFiles:"],
  },
  {
    path: "openspec/.opsx-install.json",
    kind: "manifest",
    signatures: ["\"version\"", "\"files\""],
  },
  {
    path: ".opencode/commands/opsx-install.md",
    kind: "command",
    signatures: ["opsx", "install"],
  },
  {
    path: ".claude/commands/opsx/install.md",
    kind: "command",
    signatures: ["opsx", "install"],
  },
  {
    path: ".opencode/commands/corgi-loop.md",
    kind: "command",
    signatures: ["corgispec-loop", ".corgi/loop"],
  },
  {
    path: ".claude/commands/corgi/loop.md",
    kind: "command",
    signatures: ["corgispec-loop", ".corgi/loop"],
  },
  {
    path: ".opencode/commands/corgi-converge.md",
    kind: "command",
    signatures: ["corgispec-converge", "confirmation token"],
  },
  {
    path: ".claude/commands/corgi/converge.md",
    kind: "command",
    signatures: ["corgispec-converge", "confirmation token"],
  },
] as const;

/**
 * Historical project-local skill prefixes. A prefix match is only a discovery
 * hint; ownership still requires a Corgi/OpenSpec signature in each file.
 */
export const LEGACY_PROJECT_SKILL_PREFIXES = [
  ".claude/skills/openspec-",
  ".opencode/skills/openspec-",
  ".codex/skills/openspec-",
] as const;

export type BootstrapMode =
  | "auto"
  | "fresh"
  | "update"
  | "legacy"
  | "verify";

export type TargetStateKind =
  | "init-needed"
  | "fresh"
  | "managed-update"
  | "legacy"
  | "inconsistent";

export type ManifestHookPlatform = "claude" | "opencode" | "codex";

export interface MigrationSummary {
  fromManifestVersion: number | null;
  repaired: string[];
  updated: string[];
  removed: string[];
  preserved: string[];
  conflicts: string[];
  backups: string[];
}

export interface InstallManifestHookMetadata {
  /** True only when the generator has positively identified Corgi ownership. */
  owned: boolean;
  /** Stable generator format identifier, for example `claude-settings-v2`. */
  format: string;
  /** Project-relative files used by this platform's hook integration. */
  files: string[];
}

export interface InstallManifestFile {
  /** Legacy managedFiles entries carry their path in the entry itself. */
  path?: string;
  sha256?: string;
}

/**
 * The in-memory shape intentionally accepts v1 fields so callers can migrate
 * JSON and YAML manifests without maintaining a second compatibility type.
 * Writers always emit version 2.
 */
export interface InstallManifest {
  version: number;
  packageVersion?: string;
  sourceRepo?: string;
  schema?: SchemaType;
  isolation?: IsolationConfig;
  installedAt?: string;
  updatedAt?: string;
  managedFiles?: Array<string | InstallManifestFile>;
  files?: Record<string, InstallManifestFile>;
  hooks?: Partial<Record<ManifestHookPlatform, InstallManifestHookMetadata>>;
  latestMigration?: MigrationSummary;
}

export type InstallManifestReadStatus =
  | "missing"
  | "valid"
  | "invalid"
  | "ambiguous";

export interface InstallManifestReadResult {
  status: InstallManifestReadStatus;
  manifest?: InstallManifest;
  manifestPath?: string;
  sourceFormat?: "json" | "yaml";
  sourceVersion?: number;
  /** Legacy manifests that remain and can be retired after a successful write. */
  legacyPaths: string[];
  errors: string[];
}

export interface TargetState {
  kind: TargetStateKind;
  hasConfig: boolean;
  hasManifest: boolean;
  configPath: string;
  manifestPath?: string;
  managedFiles: string[];
  manifestRead: InstallManifestReadResult;
}

export interface InstallerConfigPatchInput {
  schema: SchemaType;
  isolation?: IsolationConfig;
  installer?: Record<string, unknown>;
  /** Adds only corgi.tracking.provider and preserves all sibling Corgi fields. */
  trackingProvider?: TrackingProvider;
  rfc?: {
    contract: "rfc-v1";
    rfcRoot: string;
    foundation: string;
    integrationBranch: string;
  };
}

export type ManagedProjectFileState =
  | "current"
  | "missing"
  | "outdated"
  | "locally-modified"
  | "obsolete"
  | "ambiguous";

export interface ExpectedManagedProjectFile {
  /** Project-relative destination path. */
  path: string;
  /** Either a precomputed hash or a readable source file is required. */
  sha256?: string;
  sourcePath?: string;
}

export interface ManagedProjectFileClassification {
  path: string;
  state: ManagedProjectFileState;
  currentSha256?: string;
  expectedSha256?: string;
  installedSha256?: string;
  reason: string;
}

export interface ClassifyManagedProjectFilesInput {
  targetDir: string;
  expectedFiles: readonly ExpectedManagedProjectFile[];
  manifest?: InstallManifest;
  /** Only exact catalog entries with matching signatures may become obsolete. */
  obsoleteCandidates?: readonly LegacyProjectAssetCatalogEntry[];
}

function getAssetsRoot(assetsRoot?: string): string {
  if (assetsRoot) {
    return assetsRoot;
  }

  const fromDist = resolve(__dirname, "../assets");
  if (existsSync(fromDist)) {
    return fromDist;
  }

  const fromSrc = resolve(__dirname, "../../assets");
  if (existsSync(fromSrc)) {
    return fromSrc;
  }

  throw new Error(
    "Assets directory not found. Run 'npm run build' or 'node scripts/bundle-assets.js'."
  );
}

function listFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
      continue;
    }
    if (entry.isFile() || statSync(fullPath).isFile()) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isSafeRelativePath(path: string): boolean {
  const normalized = normalizeRelativePath(path);
  return (
    normalized.length > 0
    && !isAbsolute(path)
    && normalized !== ".."
    && !normalized.startsWith("../")
    && !normalized.includes("/../")
  );
}

function parseMaybeYamlOrJson(filePath: string): unknown {
  const content = readFileSync(filePath, "utf-8");
  if (filePath.endsWith(".json")) {
    return JSON.parse(content);
  }
  return yaml.load(content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeManifest(parsed: unknown): InstallManifest {
  if (!isRecord(parsed)) {
    throw new Error("manifest must be an object");
  }

  const version = parsed.version === undefined ? 1 : parsed.version;
  if (!Number.isInteger(version) || (version as number) < 1) {
    throw new Error("manifest version must be a positive integer");
  }
  if ((version as number) > INSTALL_MANIFEST_VERSION) {
    throw new Error(`unsupported manifest version ${String(version)}`);
  }

  if (parsed.files !== undefined && !isRecord(parsed.files)) {
    throw new Error("manifest files must be an object");
  }
  if (parsed.managedFiles !== undefined && !Array.isArray(parsed.managedFiles)) {
    throw new Error("manifest managedFiles must be an array");
  }

  const files: Record<string, InstallManifestFile> = {};
  for (const [rawPath, rawEntry] of Object.entries(parsed.files ?? {})) {
    const path = normalizeRelativePath(rawPath);
    if (!isSafeRelativePath(path) || !isRecord(rawEntry)) {
      throw new Error(`invalid managed file entry '${rawPath}'`);
    }
    const sha256 = rawEntry.sha256;
    if (sha256 !== undefined && (typeof sha256 !== "string" || !isSha256(sha256))) {
      throw new Error(`invalid sha256 for managed file '${rawPath}'`);
    }
    files[path] = sha256 === undefined ? {} : { sha256 };
  }

  const managedFiles: Array<string | InstallManifestFile> = [];
  for (const rawEntry of parsed.managedFiles ?? []) {
    const rawPath = typeof rawEntry === "string"
      ? rawEntry
      : isRecord(rawEntry) && typeof rawEntry.path === "string"
        ? rawEntry.path
        : undefined;
    if (!rawPath || !isSafeRelativePath(rawPath)) {
      throw new Error("invalid legacy managedFiles entry");
    }
    const path = normalizeRelativePath(rawPath);
    const sha256 = typeof rawEntry === "string" ? undefined : rawEntry.sha256;
    if (sha256 !== undefined && (typeof sha256 !== "string" || !isSha256(sha256))) {
      throw new Error(`invalid sha256 for managed file '${rawPath}'`);
    }
    managedFiles.push(sha256 === undefined ? path : { path, sha256 });
    if (!(path in files)) {
      files[path] = sha256 === undefined ? {} : { sha256 };
    }
  }

  const manifest = parsed as unknown as InstallManifest;
  return {
    ...manifest,
    version: version as number,
    files,
    managedFiles: managedFiles.length > 0 ? managedFiles : manifest.managedFiles,
  };
}

export function readInstallManifest(targetDir: string): InstallManifestReadResult {
  const present = MANIFEST_PATHS
    .map((relativePath) => ({
      relativePath,
      path: resolve(targetDir, relativePath),
    }))
    .filter(({ path }) => existsSync(path));
  const legacyPaths = present
    .filter(({ relativePath }) => relativePath !== CANONICAL_INSTALL_MANIFEST_PATH)
    .map(({ path }) => path);

  if (present.length === 0) {
    return { status: "missing", legacyPaths: [], errors: [] };
  }

  const canonical = present.find(
    ({ relativePath }) => relativePath === CANONICAL_INSTALL_MANIFEST_PATH
  );
  if (!canonical && present.length > 1) {
    return {
      status: "ambiguous",
      legacyPaths,
      errors: ["Multiple legacy install manifests exist; ownership is ambiguous."],
    };
  }

  const selected = canonical ?? present[0]!;
  try {
    const manifest = normalizeManifest(parseMaybeYamlOrJson(selected.path));
    return {
      status: "valid",
      manifest,
      manifestPath: selected.path,
      sourceFormat: selected.path.endsWith(".json") ? "json" : "yaml",
      sourceVersion: manifest.version,
      legacyPaths,
      errors: [],
    };
  } catch (error) {
    return {
      status: "invalid",
      manifestPath: selected.path,
      sourceFormat: selected.path.endsWith(".json") ? "json" : "yaml",
      legacyPaths,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function readSchemaFromConfig(configPath: string): SchemaType | undefined {
  if (!existsSync(configPath)) {
    return undefined;
  }

  try {
    const parsed = yaml.load(readFileSync(configPath, "utf-8"));
    if (!isRecord(parsed)) {
      return undefined;
    }
    const schema = parsed.schema;
    return typeof schema === "string" && schema.trim().length > 0
      ? schema.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function getManifestManagedFiles(manifest: InstallManifest | undefined): string[] {
  if (!manifest) {
    return [];
  }

  const managedFiles = new Set<string>();
  for (const entry of manifest.managedFiles ?? []) {
    if (typeof entry === "string") {
      managedFiles.add(normalizeRelativePath(entry));
      continue;
    }
    if (typeof entry.path === "string") {
      managedFiles.add(normalizeRelativePath(entry.path));
    }
  }
  for (const key of Object.keys(manifest.files ?? {})) {
    managedFiles.add(normalizeRelativePath(key));
  }
  return Array.from(managedFiles).sort();
}

function findLegacyManagedFiles(targetDir: string, schema?: SchemaType): string[] {
  const candidates = new Set<string>(LEGACY_MARKERS);
  if (schema) {
    candidates.add(`openspec/schemas/${schema}/schema.yaml`);
  }

  return Array.from(candidates)
    .filter((relativePath) => existsSync(resolve(targetDir, relativePath)))
    .sort();
}

export function classifyTargetState(targetDir: string): TargetState {
  const configPath = resolve(targetDir, "openspec/config.yaml");
  const hasConfig = existsSync(configPath);
  const manifestRead = readInstallManifest(targetDir);
  const hasManifest = manifestRead.status !== "missing";
  const schema = readSchemaFromConfig(configPath);
  const manifestManagedFiles = getManifestManagedFiles(manifestRead.manifest);
  const managedFiles = findLegacyManagedFiles(targetDir, schema);

  if (
    hasConfig
    && manifestRead.status === "valid"
    && manifestManagedFiles.length > 0
  ) {
    return {
      kind: "managed-update",
      hasConfig,
      hasManifest,
      configPath,
      manifestPath: manifestRead.manifestPath,
      managedFiles: manifestManagedFiles,
      manifestRead,
    };
  }

  if (hasManifest) {
    return {
      kind: "inconsistent",
      hasConfig,
      hasManifest,
      configPath,
      manifestPath: manifestRead.manifestPath,
      managedFiles: manifestManagedFiles,
      manifestRead,
    };
  }

  if (hasConfig && managedFiles.length > 0) {
    return {
      kind: "legacy",
      hasConfig,
      hasManifest,
      configPath,
      managedFiles,
      manifestRead,
    };
  }

  if (managedFiles.length > 0) {
    return {
      kind: "inconsistent",
      hasConfig,
      hasManifest,
      configPath,
      managedFiles,
      manifestRead,
    };
  }

  return {
    kind: hasConfig ? "fresh" : "init-needed",
    hasConfig,
    hasManifest,
    configPath,
    managedFiles: [],
    manifestRead,
  };
}

export function getManagedProjectFiles(
  schema: SchemaType,
  assetsRoot?: string
): string[] {
  const root = getAssetsRoot(assetsRoot);
  return [
    ...listFiles(resolve(root, "commands/opencode")),
    ...listFiles(resolve(root, "commands/claude/corgi")),
    ...listFiles(resolve(root, "schemas", schema)),
  ].sort();
}

export function patchInstallerConfig(
  existingYaml: string,
  input: InstallerConfigPatchInput
): string {
  const parsed = existingYaml.trim().length > 0 ? yaml.load(existingYaml) : undefined;
  const existing = isRecord(parsed) ? parsed : {};

  const next: Record<string, unknown> = {
    ...existing,
    schema: input.schema,
  };

  if (input.isolation !== undefined) {
    next.isolation = input.isolation;
  }

  if (input.installer !== undefined) {
    next.installer = input.installer;
  }

  if (input.trackingProvider !== undefined) {
    const existingCorgi = isRecord(existing.corgi) ? existing.corgi : {};
    const existingTracking = isRecord(existingCorgi.tracking)
      ? existingCorgi.tracking
      : {};
    next.corgi = {
      ...existingCorgi,
      tracking: {
        ...existingTracking,
        provider: input.trackingProvider,
      },
    };
  }

  if (input.rfc !== undefined) {
    const existingCorgi = isRecord(next.corgi)
      ? next.corgi
      : isRecord(existing.corgi)
        ? existing.corgi
        : {};
    const existingGovernance = isRecord(existingCorgi.governance)
      ? existingCorgi.governance
      : {};
    next.corgi = {
      ...existingCorgi,
      contract: input.rfc.contract,
      rfcRoot: input.rfc.rfcRoot,
      foundation: input.rfc.foundation,
      governance: {
        ...existingGovernance,
        integrationBranch: input.rfc.integrationBranch,
      },
    };
  }

  return yaml.dump(next, {
    lineWidth: -1,
    noRefs: true,
  });
}

export function createMigrationSummary(
  fromManifestVersion: number | null = null
): MigrationSummary {
  return {
    fromManifestVersion,
    repaired: [],
    updated: [],
    removed: [],
    preserved: [],
    conflicts: [],
    backups: [],
  };
}

export function matchesLegacyAssetSignature(
  targetDir: string,
  entry: LegacyProjectAssetCatalogEntry
): boolean {
  const filePath = resolve(targetDir, entry.path);
  if (!existsSync(filePath) || !isSafeRelativePath(entry.path)) {
    return false;
  }
  try {
    if (!lstatSync(filePath).isFile()) {
      return false;
    }
    const content = readFileSync(filePath, "utf-8").toLowerCase();
    return entry.signatures.every((signature) =>
      content.includes(signature.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function classifyManagedProjectFiles(
  input: ClassifyManagedProjectFilesInput
): ManagedProjectFileClassification[] {
  const classifications: ManagedProjectFileClassification[] = [];
  const expectedPaths = new Set<string>();
  const duplicatePaths = new Set<string>();

  for (const expected of input.expectedFiles) {
    const path = normalizeRelativePath(expected.path);
    if (expectedPaths.has(path)) {
      duplicatePaths.add(path);
    }
    expectedPaths.add(path);
  }

  for (const expected of input.expectedFiles) {
    const path = normalizeRelativePath(expected.path);
    const installedSha256 = input.manifest?.files?.[path]?.sha256;
    if (!isSafeRelativePath(path)) {
      classifications.push({
        path,
        state: "ambiguous",
        installedSha256,
        reason: "managed path is not a safe project-relative path",
      });
      continue;
    }
    if (duplicatePaths.has(path)) {
      classifications.push({
        path,
        state: "ambiguous",
        installedSha256,
        reason: "managed path is declared more than once",
      });
      duplicatePaths.delete(path);
      continue;
    }

    let expectedSha256 = expected.sha256;
    if (!expectedSha256 && expected.sourcePath) {
      try {
        expectedSha256 = sha256File(expected.sourcePath);
      } catch {
        // Reported as ambiguous below.
      }
    }
    if (!expectedSha256 || !isSha256(expectedSha256)) {
      classifications.push({
        path,
        state: "ambiguous",
        installedSha256,
        reason: "expected asset hash is unavailable or invalid",
      });
      continue;
    }

    const targetPath = resolve(input.targetDir, path);
    if (!existsSync(targetPath)) {
      classifications.push({
        path,
        state: "missing",
        expectedSha256,
        installedSha256,
        reason: "managed project file is missing",
      });
      continue;
    }

    let currentSha256: string;
    try {
      if (!lstatSync(targetPath).isFile()) {
        throw new Error("not a regular file");
      }
      currentSha256 = sha256File(targetPath);
    } catch {
      classifications.push({
        path,
        state: "ambiguous",
        expectedSha256,
        installedSha256,
        reason: "managed path cannot be read as a regular file",
      });
      continue;
    }

    if (currentSha256 === expectedSha256) {
      classifications.push({
        path,
        state: "current",
        currentSha256,
        expectedSha256,
        installedSha256,
        reason: "project file matches the bundled asset",
      });
      continue;
    }

    if (!installedSha256 || !isSha256(installedSha256)) {
      classifications.push({
        path,
        state: "ambiguous",
        currentSha256,
        expectedSha256,
        installedSha256,
        reason: "no trustworthy installed hash distinguishes an update from a local edit",
      });
      continue;
    }

    classifications.push({
      path,
      state: currentSha256 === installedSha256 ? "outdated" : "locally-modified",
      currentSha256,
      expectedSha256,
      installedSha256,
      reason: currentSha256 === installedSha256
        ? "project file matches the prior install but the bundled asset changed"
        : "project file differs from both the prior install and the bundled asset",
    });
  }

  const candidates = input.obsoleteCandidates ?? LEGACY_PROJECT_ASSET_CATALOG;
  for (const candidate of candidates) {
    const path = normalizeRelativePath(candidate.path);
    if (expectedPaths.has(path) || !existsSync(resolve(input.targetDir, path))) {
      continue;
    }
    classifications.push({
      path,
      state: matchesLegacyAssetSignature(input.targetDir, candidate)
        ? "obsolete"
        : "ambiguous",
      currentSha256: safeSha256File(resolve(input.targetDir, path)),
      installedSha256: input.manifest?.files?.[path]?.sha256,
      reason: matchesLegacyAssetSignature(input.targetDir, candidate)
        ? "known legacy path and Corgi signature both match"
        : "legacy path exists but its contents do not prove Corgi ownership",
    });
  }

  return classifications.sort((left, right) => left.path.localeCompare(right.path));
}

function safeSha256File(filePath: string): string | undefined {
  try {
    return lstatSync(filePath).isFile() ? sha256File(filePath) : undefined;
  } catch {
    return undefined;
  }
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function relativeManagedFiles(targetDir: string, files: string[]): string[] {
  return files.map((filePath) => normalizeRelativePath(relative(targetDir, filePath)));
}
