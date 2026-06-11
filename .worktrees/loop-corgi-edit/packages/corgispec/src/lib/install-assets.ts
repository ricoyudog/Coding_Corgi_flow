import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { IsolationConfig, SchemaType } from "./config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MANIFEST_PATHS = [
  "openspec/install-manifest.yaml",
  "openspec/.corgi-install.json",
] as const;

const LEGACY_MARKERS = [
  ".opencode/commands/corgi-install.md",
  ".claude/commands/corgi/install.md",
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

export interface InstallManifestFile {
  path: string;
  sha256?: string;
}

export interface InstallManifest {
  version: number;
  schema?: SchemaType;
  installedAt?: string;
  updatedAt?: string;
  managedFiles?: Array<string | InstallManifestFile>;
  files?: Record<string, { sha256?: string }>;
}

export interface TargetState {
  kind: TargetStateKind;
  hasConfig: boolean;
  hasManifest: boolean;
  configPath: string;
  manifestPath?: string;
  managedFiles: string[];
}

export interface InstallerConfigPatchInput {
  schema: SchemaType;
  isolation?: IsolationConfig;
  installer?: Record<string, unknown>;
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
  return path.replace(/\\/g, "/");
}

function parseMaybeYamlOrJson(filePath: string): unknown {
  const content = readFileSync(filePath, "utf-8");
  if (filePath.endsWith(".json")) {
    return JSON.parse(content);
  }
  return yaml.load(content);
}

function getManifestPath(targetDir: string): string | undefined {
  for (const relativePath of MANIFEST_PATHS) {
    const candidate = resolve(targetDir, relativePath);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function readSchemaFromConfig(configPath: string): SchemaType | undefined {
  if (!existsSync(configPath)) {
    return undefined;
  }

  const parsed = yaml.load(readFileSync(configPath, "utf-8"));
  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const schema = (parsed as Record<string, unknown>).schema;
  if (schema === "github-tracked" || schema === "gitlab-tracked") {
    return schema;
  }

  return undefined;
}

function getManifestManagedFiles(manifestPath: string): string[] {
  const parsed = parseMaybeYamlOrJson(manifestPath) as InstallManifest | null;
  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  const managedFiles = new Set<string>();

  for (const entry of parsed.managedFiles ?? []) {
    if (typeof entry === "string") {
      managedFiles.add(normalizeRelativePath(entry));
      continue;
    }

    if (entry && typeof entry === "object" && typeof entry.path === "string") {
      managedFiles.add(normalizeRelativePath(entry.path));
    }
  }

  for (const key of Object.keys(parsed.files ?? {})) {
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
  const manifestPath = getManifestPath(targetDir);
  const hasManifest = Boolean(manifestPath);
  const schema = readSchemaFromConfig(configPath);
  const manifestManagedFiles = manifestPath ? getManifestManagedFiles(manifestPath) : [];
  const managedFiles = findLegacyManagedFiles(targetDir, schema);

  if (hasConfig && manifestPath && manifestManagedFiles.length > 0) {
    return {
      kind: "managed-update",
      hasConfig,
      hasManifest,
      configPath,
      manifestPath,
      managedFiles: manifestManagedFiles,
    };
  }

  if (hasManifest) {
    return {
      kind: "inconsistent",
      hasConfig,
      hasManifest,
      configPath,
      manifestPath,
      managedFiles: manifestManagedFiles,
    };
  }

  if (hasConfig && managedFiles.length > 0) {
    return {
      kind: "legacy",
      hasConfig,
      hasManifest,
      configPath,
      managedFiles,
    };
  }

  if (managedFiles.length > 0) {
    return {
      kind: "inconsistent",
      hasConfig,
      hasManifest,
      configPath,
      managedFiles,
    };
  }

  return {
    kind: hasConfig ? "fresh" : "init-needed",
    hasConfig,
    hasManifest,
    configPath,
    managedFiles: [],
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
  const parsed = yaml.load(existingYaml);
  const existing =
    parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};

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

  return yaml.dump(next, {
    lineWidth: -1,
    noRefs: true,
  });
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function relativeManagedFiles(targetDir: string, files: string[]): string[] {
  return files.map((filePath) => normalizeRelativePath(relative(targetDir, filePath)));
}
