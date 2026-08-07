import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { initializeOpenSpec } from "../commands/init.js";
import type { CommandPlatform, Platform } from "./platform.js";
import type { SchemaType, TrackingProvider } from "./config.js";
import { loadConfigFromDir } from "./config.js";
import {
  CANONICAL_INSTALL_MANIFEST_PATH,
  LEGACY_INSTALL_MANIFEST_PATHS,
  LEGACY_PROJECT_ASSET_CATALOG,
  LEGACY_PROJECT_SKILL_PREFIXES,
  classifyManagedProjectFiles,
  classifyTargetState,
  createMigrationSummary,
  getManagedProjectFiles,
  patchInstallerConfig,
  relativeManagedFiles,
  sha256File,
  type BootstrapMode,
  type InstallManifest,
  type InstallManifestHookMetadata,
  type ManagedProjectFileClassification,
  type MigrationSummary,
} from "./install-assets.js";
import { initializeMemoryStructure } from "./memory-init.js";
import { type BootstrapCheck, writeInstallManifest, writeInstallReport } from "./bootstrap-report.js";
import {
  inspectOpenSpecRuntime,
  NodeCommandRunner,
} from "./openspec-runtime.js";
import { resolveTrackingProvider } from "./config.js";
import { createOpenSpecAdapter } from "./openspec-adapter.js";
import {
  BootstrapFileTransaction,
  createPersistentBackup,
  type BackupEntry,
} from "./bootstrap-transaction.js";
import {
  applyUserAssetPlan,
  planUserAssets,
  type UserAssetPlan,
} from "./user-assets.js";
import {
  applyHookMigrationPlan,
  planHookMigration,
  type HookMigrationPlan,
  type HookPlatform,
} from "./hook-install.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BootstrapOptions {
  target: string;
  schema?: SchemaType;
  mode: BootstrapMode;
  yes: boolean;
  noMemory: boolean;
  json: boolean;
  assetsRoot?: string;
  userSkillDirs?: Partial<Record<Platform, string>>;
  userCommandDirs?: Partial<Record<CommandPlatform, string>>;
  /** Test/embedding override for ~/.corgispec reports and backups. */
  userStateDir?: string;
  packageVersion?: string;
  binaryPath?: string;
  cliEntry?: string;
  platforms?: string[];
  scope?: string;
}

export interface BootstrapResult {
  status: "success" | "failed" | "needs-approval" | "stopped";
  mode: "fresh" | "update" | "legacy" | "verify";
  target: string;
  actions: string[];
  reportPath: string;
  manifestPath?: string;
  message: string;
  migration: MigrationSummary;
}

interface BootstrapContext {
  assetsRoot: string;
  sourceRepo: string;
  checks: BootstrapCheck[];
  actions: string[];
  reportMode: "fresh-install" | "managed-update" | "legacy-install" | "verify-only";
  schema: SchemaType;
  resultMode: BootstrapResult["mode"];
  timestamp: string;
  managedFiles: string[];
  reportPath?: string;
  manifestPath?: string;
  prerequisitesPassed: boolean;
  quiet: boolean;
  packageVersion: string;
  migration: MigrationSummary;
  reportOverride?: string;
}

const REQUIRED_PROJECT_ASSET_DIRS = ["commands", "schemas", "skills", "memory-init"] as const;

export async function runBootstrap(opts: BootstrapOptions): Promise<BootstrapResult> {
  const target = resolve(opts.target);
  const platforms = selectedPlatforms(opts.platforms);
  const scope = normalizeScope(opts.scope);
  const localScope = scope === "local" || scope === "both";
  const globalScope = scope === "global" || scope === "both";
  const state = classifyTargetState(target);
  const mode = resolveBootstrapMode(opts.mode, state.kind);
  const assetsRoot = resolveAssetsRoot(opts.assetsRoot);
  const timestamp = new Date().toISOString();
  const schema = opts.schema ?? safelyDetectSchema(target) ?? state.manifestRead.manifest?.schema ?? "github-tracked";
  const packageVersion = opts.packageVersion ?? resolvePackageVersion(assetsRoot);
  const userStateDir = resolve(opts.userStateDir ?? resolve(homedir(), ".corgispec"));
  const userCommandDirs = opts.userCommandDirs ?? deriveUserCommandDirs(opts.userSkillDirs);

  const context: BootstrapContext = {
    assetsRoot,
    sourceRepo: dirname(assetsRoot),
    checks: [],
    actions: [],
    reportMode:
      mode === "fresh"
        ? "fresh-install"
        : mode === "update"
          ? "managed-update"
          : mode === "legacy"
            ? "legacy-install"
            : "verify-only",
    schema,
    resultMode: mode,
    timestamp,
    managedFiles: [],
    prerequisitesPassed: false,
    quiet: opts.json,
    packageVersion,
    migration: createMigrationSummary(state.manifestRead.sourceVersion ?? null),
    reportOverride: localScope
      ? undefined
      : resolve(userStateDir, "install-report.md"),
  };

  try {
    if (mode === "verify" && localScope) {
      const verificationError = verifyManagedBootstrapState(target, state);
      if (verificationError) {
        context.checks.push({
          name: "Managed files",
          status: "FAIL",
          detail: verificationError,
        });
        return finalize(context, target, "stopped", verificationError);
      }
    }

    if (localScope) {
      await runPrerequisiteChecks(context, target, schema);
    } else {
      runGlobalPrerequisiteChecks(context, target);
    }
    context.prerequisitesPassed = true;

    const explicitModeMismatch = localScope
      ? getExplicitModeMismatch(opts.mode, state.kind)
      : null;
    if (explicitModeMismatch) {
      context.checks.push({
        name: "Managed files",
        status: "SKIP",
        detail: explicitModeMismatch,
      });
      return finalize(context, target, "stopped", explicitModeMismatch);
    }

    if (localScope && state.kind === "inconsistent") {
      const conflictPaths = [state.configPath, state.manifestPath, ...state.manifestRead.legacyPaths]
        .filter((entry): entry is string => Boolean(entry));
      context.migration.conflicts.push(...conflictPaths.map((entry) => projectLabel(target, entry)));
      backupProjectPaths(target, conflictPaths, context);
      return finalize(context, target, "stopped", "Target project is in an inconsistent bootstrap state; its configuration was backed up without mutation.");
    }

    if (mode === "verify") {
      context.checks.push({
        name: "Managed files",
        status: "PASS",
        detail: "Verification only. No managed files were mutated.",
      });
      return finalize(context, target, "success", "Bootstrap verification completed without mutations.");
    }

    const effectiveSchema = safelyDetectSchema(target) ?? schema;
    context.schema = effectiveSchema;
    const previousManifest = state.manifestRead.status === "valid"
      ? state.manifestRead.manifest
      : undefined;
    const sourceFiles = localScope
      ? getSelectedManagedProjectFiles(effectiveSchema, assetsRoot, platforms)
      : [];
    const expectedFiles = sourceFiles.map((sourcePath) => ({
      path: projectRelativePathFromAsset(assetsRoot, effectiveSchema, sourcePath),
      sourcePath,
    }));
    let projectPlan = localScope
      ? classifyManagedProjectFiles({
          targetDir: target,
          expectedFiles,
          manifest: previousManifest,
          obsoleteCandidates: LEGACY_PROJECT_ASSET_CATALOG,
        })
      : [];
    if (localScope) {
      projectPlan.push(...classifyLegacyProjectSkillTrees(target));
      projectPlan.sort((left, right) => left.path.localeCompare(right.path));
    }
    if (state.kind === "legacy") {
      const expected = new Set(expectedFiles.map((entry) => entry.path));
      projectPlan = projectPlan.map((entry) =>
        expected.has(entry.path) && entry.state === "ambiguous"
          ? { ...entry, state: "outdated", reason: "legacy Corgi path will be replaced after explicit approval" }
          : entry
      );
    }

    const userPlan = globalScope
      ? planUserAssets({
          assetsRoot,
          platforms,
          userSkillDirs: opts.userSkillDirs,
          userCommandDirs,
        })
      : emptyUserAssetPlan();
    const hookPlan = localScope
      ? planHookMigration({
          root: target,
          platforms,
          binaryPath: opts.binaryPath ?? resolveBootstrapBinaryPath(),
          cliEntry: opts.cliEntry ?? resolveRunningCliEntry(),
        })
      : emptyHookPlan(target);

    if (localScope) {
      try {
        preflightPatchedConfig(target, effectiveSchema, context.timestamp);
      } catch (error) {
        const configPath = resolve(target, "openspec/config.yaml");
        context.migration.conflicts.push("openspec/config.yaml");
        backupProjectPaths(target, [configPath], context);
        context.checks.push({
          name: "Managed config",
          status: "FAIL",
          detail: error instanceof Error ? error.message : String(error),
        });
        return finalize(context, target, "stopped", "Bootstrap stopped because openspec/config.yaml could not be migrated safely.");
      }
    }
    recordMigrationPlan(context, target, projectPlan, userPlan, hookPlan);
    preflightWritableTargets([
      ...(localScope ? expectedFiles.map((entry) => resolve(target, entry.path)) : []),
      ...(localScope ? [
        resolve(target, "openspec/config.yaml"),
        resolve(target, CANONICAL_INSTALL_MANIFEST_PATH),
        context.reportOverride ?? resolve(target, "openspec/.corgi-install-report.md"),
        ...hookPlan.touchedPaths,
      ] : []),
      ...userPlan.actions.map((entry) => entry.target),
      ...(globalScope ? [context.reportOverride ?? resolve(userStateDir, "install-report.md")] : []),
    ]);
    context.checks.push({
      name: "Write permissions",
      status: "PASS",
      detail: "All selected managed targets passed writable-parent preflight.",
    });

    const projectConflicts = projectPlan
      .filter((entry) => entry.state === "locally-modified" || entry.state === "ambiguous")
      .map((entry) => resolve(target, entry.path));
    const allProjectConflicts = [...projectConflicts, ...hookPlan.conflicts.map((entry) => entry.path)];
    const allUserConflicts = userPlan.actions.filter((entry) => entry.status === "ambiguous");
    if (allProjectConflicts.length > 0 || allUserConflicts.length > 0) {
      backupProjectPaths(target, allProjectConflicts, context);
      backupUserAssets(allUserConflicts, userStateDir, context);
      context.checks.push({
        name: "Managed files",
        status: "FAIL",
        detail: `Conflicts detected: ${context.migration.conflicts.join(", ")}`,
      });
      return finalize(context, target, "stopped", "Bootstrap stopped because local modifications or ambiguous Corgi assets were backed up.");
    }

    if (state.kind === "legacy") {
      const overwriteFiles = [
        ...expectedFiles.map((entry) => resolve(target, entry.path)),
        ...hookPlan.touchedPaths,
      ];
      backupProjectPaths(target, overwriteFiles, context, true);
      if (!opts.yes) {
        context.checks.push({
          name: "Managed files",
          status: "SKIP",
          detail: "Legacy migration paused pending explicit approval.",
        });
        return finalize(
          context,
          target,
          "needs-approval",
          "Legacy migration requires explicit approval after backup. Re-run with yes=true to proceed."
        );
      }
    }

    backupUserAssets(
      userPlan.actions.filter((entry) => entry.status === "outdated" || entry.status === "obsolete"),
      userStateDir,
      context,
    );

    const transaction = new BootstrapFileTransaction("bootstrap");
    transaction.capture(getTransactionPaths({
      target,
      localScope,
      userPlan,
      hookPlan,
      projectPlan,
      reportPath: context.reportOverride ?? resolve(target, "openspec/.corgi-install-report.md"),
    }));
    try {
      if (globalScope) {
        const applied = applyUserAssetPlan(userPlan, {
          assetsRoot,
          platforms,
          userSkillDirs: opts.userSkillDirs,
          userCommandDirs,
          quiet: context.quiet,
        });
        context.actions.push(`synchronized ${applied.installedSkills} user-level skills and ${applied.installedCommands} commands`);
      }

      if (localScope) {
        if (state.kind === "init-needed") {
          initializeOpenSpec({
            target,
            schema: effectiveSchema,
            bundledSchemasDir: resolve(assetsRoot, "schemas"),
          });
          context.actions.push("initialized openspec project structure");
        }

        context.managedFiles = syncManagedProjectFiles(target, sourceFiles, effectiveSchema, assetsRoot, context);
        removeObsoleteProjectAssets(target, projectPlan, context);
        const hooks = applyHookMigrationPlan(hookPlan);
        if (hooks.written.length > 0 || hooks.removed.length > 0) {
          context.actions.push(`migrated existing hooks (${hooks.written.length} written, ${hooks.removed.length} removed)`);
        }
        updateConfigSchema(target, effectiveSchema, context.timestamp);

        if (!opts.noMemory) {
          const memory = initializeMemoryStructure({ targetDir: target, assetsRoot });
          if (memory.createdFiles.length > 0 || memory.injectedSessionMemoryProtocol) {
            context.actions.push("initialized project memory files");
          }
        }

        context.managedFiles = mergePreservedManagedFiles(target, context.managedFiles, previousManifest, expectedFiles);
        context.manifestPath = writeInstallManifest({
          targetDir: target,
          sourceRepo: context.sourceRepo,
          packageVersion: context.packageVersion,
          schema: effectiveSchema,
          isolation: readIsolation(target),
          installedAt: previousManifest?.installedAt,
          updatedAt: context.timestamp,
          files: context.managedFiles,
          hooks: buildManifestHookMetadata(target, hookPlan, previousManifest, platforms),
          migration: context.migration,
          previousManifest: state.manifestRead,
        });
        context.actions.push("wrote install manifest v2");
        context.checks.push({
          name: "Managed files",
          status: "PASS",
          detail: `${context.managedFiles.length}/${context.managedFiles.length} project-local files synced`,
        });
      } else {
        context.checks.push({
          name: "User-level assets",
          status: "PASS",
          detail: `Synchronized requested platforms without modifying project-local assets.`,
        });
      }

      const result = finalize(context, target, "success", "Bootstrap completed successfully.");
      transaction.dispose();
      return result;
    } catch (error) {
      transaction.rollback();
      transaction.dispose();
      throw error;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    context.checks.push({
      name: "Managed files",
      status: "FAIL",
      detail,
    });
    return finalize(context, target, "failed", detail);
  }
}

function normalizeScope(scope: string | undefined): "global" | "local" | "both" {
  if (scope === undefined) return "both";
  if (scope === "global" || scope === "local" || scope === "both") return scope;
  throw new Error(`Unsupported bootstrap scope '${scope}'.`);
}

function selectedPlatforms(platforms: string[] | undefined): HookPlatform[] {
  const supported: HookPlatform[] = ["claude", "opencode", "codex"];
  if (platforms === undefined) return supported;
  const invalid = platforms.filter((platform) => !supported.includes(platform as HookPlatform));
  if (invalid.length > 0) {
    throw new Error(`Unsupported bootstrap platform(s): ${invalid.join(", ")}`);
  }
  return supported.filter((platform) => platforms.includes(platform));
}

function resolvePackageVersion(assetsRoot: string): string {
  const packagePath = resolve(dirname(assetsRoot), "package.json");
  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Development embeddings can provide packageVersion explicitly.
  }
  return "0.0.0-development";
}

function resolveRunningCliEntry(): string {
  return process.argv[1] ? resolve(process.argv[1]) : "corgispec";
}

function resolveBootstrapBinaryPath(): string {
  const names = process.platform === "win32"
    ? ["corgispec.cmd", "corgispec.exe", "corgispec.bat", "corgispec"]
    : ["corgispec"];
  for (const directory of (process.env["PATH"] ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = resolve(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "npx corgispec";
}

function deriveUserCommandDirs(
  skillDirs: Partial<Record<Platform, string>> | undefined,
): Partial<Record<CommandPlatform, string>> | undefined {
  if (!skillDirs) return undefined;
  const derived: Partial<Record<CommandPlatform, string>> = {};
  if (skillDirs.claude) derived.claude = resolve(dirname(skillDirs.claude), "claude-commands");
  if (skillDirs.opencode) derived.opencode = resolve(dirname(skillDirs.opencode), "opencode-commands");
  return derived;
}

function runGlobalPrerequisiteChecks(context: BootstrapContext, target: string): void {
  ensureProjectAssets(context.assetsRoot, context);
  if (!existsSync(target)) {
    throw new Error(`Target directory does not exist: ${target}`);
  }
  context.checks.push({
    name: "Global scope",
    status: "PASS",
    detail: "Project-local schema, config, manifest, and hooks are outside global scope.",
  });
}

function preflightWritableTargets(paths: string[]): void {
  for (const requestedPath of new Set(paths.map((path) => resolve(path)))) {
    let candidate = existsSync(requestedPath) ? requestedPath : dirname(requestedPath);
    while (!existsSync(candidate)) {
      const parent = dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
    accessSync(candidate, constants.W_OK);
    const parent = dirname(requestedPath);
    if (existsSync(parent)) accessSync(parent, constants.W_OK);
  }
}

function getSelectedManagedProjectFiles(
  schema: SchemaType,
  assetsRoot: string,
  platforms: readonly HookPlatform[],
): string[] {
  const claudeRoot = resolve(assetsRoot, "commands/claude/corgi");
  const opencodeRoot = resolve(assetsRoot, "commands/opencode");
  const schemaRoot = resolve(assetsRoot, "schemas", schema);
  return getManagedProjectFiles(schema, assetsRoot).filter((source) =>
    source.startsWith(schemaRoot)
    || (platforms.includes("claude") && source.startsWith(claudeRoot))
    || (platforms.includes("opencode") && source.startsWith(opencodeRoot))
  );
}

function emptyUserAssetPlan(): UserAssetPlan {
  return { actions: [], conflicts: [] };
}

function emptyHookPlan(target: string): HookMigrationPlan {
  return planHookMigration({ root: target, platforms: [] });
}

function preflightPatchedConfig(target: string, schema: SchemaType, timestamp: string): void {
  const configPath = resolve(target, "openspec/config.yaml");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  patchInstallerConfig(existing, {
    schema,
    installer: { version: 2, managed_at: timestamp },
    isolation: readIsolation(target),
    trackingProvider: trackingProviderFor(target, schema),
  });
}

function trackingProviderFor(target: string, schema: SchemaType): TrackingProvider {
  try {
    return resolveTrackingProvider(loadConfigFromDir(target)).provider;
  } catch {
    return schema === "github-tracked"
      ? "github"
      : schema === "gitlab-tracked"
        ? "gitlab"
        : "none";
  }
}

function recordMigrationPlan(
  context: BootstrapContext,
  target: string,
  projectPlan: ManagedProjectFileClassification[],
  userPlan: UserAssetPlan,
  hookPlan: HookMigrationPlan,
): void {
  for (const item of projectPlan) {
    const label = item.path;
    if (item.state === "current") context.migration.preserved.push(label);
    if (item.state === "missing") context.migration.repaired.push(label);
    if (item.state === "outdated") context.migration.updated.push(label);
    if (item.state === "obsolete") context.migration.removed.push(label);
    if (item.state === "locally-modified" || item.state === "ambiguous") {
      context.migration.conflicts.push(label);
    }
  }
  for (const item of userPlan.actions) {
    const label = `user:${item.platform}:${item.kind}:${item.name}`;
    if (item.status === "current") context.migration.preserved.push(label);
    if (item.status === "missing") context.migration.repaired.push(label);
    if (item.status === "outdated") context.migration.updated.push(label);
    if (item.status === "obsolete") context.migration.removed.push(label);
    if (item.status === "ambiguous") context.migration.conflicts.push(label);
  }
  for (const platform of ["claude", "opencode", "codex"] as const) {
    const inspection = hookPlan.platforms[platform];
    if (!inspection.enabled) {
      context.migration.preserved.push(`hooks:${platform}:not-installed`);
    }
  }
  for (const action of hookPlan.actions) {
    const label = `hooks:${action.platform}:${projectLabel(target, action.path)}`;
    if (action.status === "missing") context.migration.repaired.push(label);
    if (action.status === "outdated") context.migration.updated.push(label);
    if (action.status === "obsolete") context.migration.removed.push(label);
  }
  for (const conflict of hookPlan.conflicts) {
    context.migration.conflicts.push(`hooks:${conflict.platform}:${projectLabel(target, conflict.path)}`);
  }
}

function projectLabel(target: string, path: string): string {
  const label = relative(target, path).replace(/\\/g, "/");
  return label.startsWith("../") ? path.replace(/\\/g, "/") : label;
}

function backupProjectPaths(
  target: string,
  paths: Array<string | undefined>,
  context: BootstrapContext,
  legacy = false,
): void {
  const entries: BackupEntry[] = [];
  for (const path of paths) {
    if (!path || !existsSync(path)) continue;
    const relativePath = projectLabel(target, path);
    if (relativePath.startsWith("../") || relativePath === path.replace(/\\/g, "/")) continue;
    entries.push({ source: path, relativePath });
  }
  if (entries.length === 0) return;
  const backupRoot = resolve(
    target,
    "openspec/.corgi-backups",
    safeTimestamp(context.timestamp),
    "project",
  );
  const written = createPersistentBackup(backupRoot, entries);
  context.migration.backups.push(...written);
  context.actions.push(`${legacy ? "created legacy backup" : "backed up conflicting project assets"} at ${backupRoot}`);
}

function backupUserAssets(
  actions: UserAssetPlan["actions"],
  userStateDir: string,
  context: BootstrapContext,
): void {
  for (const platform of ["claude", "opencode", "codex"] as const) {
    const entries = actions
      .filter((action) => action.platform === platform && existsSync(action.target))
      .map((action) => ({
        source: action.target,
        relativePath: `${action.kind === "skill" ? "skills" : "commands"}/${action.name}`,
      }));
    if (entries.length === 0) continue;
    const backupRoot = resolve(userStateDir, "backups", safeTimestamp(context.timestamp), platform);
    const written = createPersistentBackup(backupRoot, entries);
    context.migration.backups.push(...written);
    context.actions.push(`backed up ${platform} user assets at ${backupRoot}`);
  }
}

function safeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

function getTransactionPaths(input: {
  target: string;
  localScope: boolean;
  userPlan: UserAssetPlan;
  hookPlan: HookMigrationPlan;
  projectPlan: ManagedProjectFileClassification[];
  reportPath: string;
}): string[] {
  const paths = [input.reportPath, ...input.userPlan.actions.map((action) => action.target)];
  if (input.localScope) {
    paths.push(
      resolve(input.target, "openspec"),
      resolve(input.target, ".opencode/commands"),
      resolve(input.target, ".claude/commands/corgi"),
      resolve(input.target, "memory"),
      resolve(input.target, "wiki"),
      ...input.hookPlan.touchedPaths,
      ...input.projectPlan
        .filter((entry) => entry.state === "obsolete")
        .map((entry) => resolve(input.target, entry.path)),
    );
  }
  return paths;
}

function classifyLegacyProjectSkillTrees(target: string): ManagedProjectFileClassification[] {
  const classifications: ManagedProjectFileClassification[] = [];
  for (const prefix of LEGACY_PROJECT_SKILL_PREFIXES) {
    const prefixPath = resolve(target, prefix);
    const parent = dirname(prefixPath);
    const namePrefix = basename(prefixPath);
    if (!existsSync(parent)) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.name.startsWith(namePrefix)) continue;
      const path = resolve(parent, entry.name);
      const relativePath = projectLabel(target, path);
      let owned = false;
      try {
        if (entry.isDirectory() && lstatSync(path).isDirectory()) {
          const skillPath = resolve(path, "SKILL.md");
          if (existsSync(skillPath)) {
            const content = readFileSync(skillPath, "utf8");
            owned = /^name:\s*["']?openspec-[a-z0-9-]+["']?\s*$/mu.test(content)
              && /(?:OpenSpec|Corgi)/u.test(content);
          }
        }
      } catch {
        owned = false;
      }
      classifications.push({
        path: relativePath,
        state: owned ? "obsolete" : "ambiguous",
        reason: owned
          ? "known legacy project skill prefix and Corgi/OpenSpec signature both match"
          : "legacy project skill path exists but ownership is ambiguous",
      });
    }
  }
  return classifications;
}

function removeObsoleteProjectAssets(
  target: string,
  plan: ManagedProjectFileClassification[],
  context: BootstrapContext,
): void {
  const removed: string[] = [];
  for (const item of plan) {
    if (item.state !== "obsolete") continue;
    const path = resolve(target, item.path);
    rmSync(path, { recursive: true, force: true });
    removed.push(item.path);
  }
  if (removed.length > 0) context.actions.push(`removed ${removed.length} obsolete Corgi assets`);
}

function mergePreservedManagedFiles(
  target: string,
  written: string[],
  previous: InstallManifest | undefined,
  selected: Array<{ path: string }>,
): string[] {
  const selectedPaths = new Set(selected.map((entry) => entry.path));
  const obsoletePaths = new Set([
    CANONICAL_INSTALL_MANIFEST_PATH,
    ...LEGACY_INSTALL_MANIFEST_PATHS,
    ...LEGACY_PROJECT_ASSET_CATALOG.map((entry) => entry.path),
  ]);
  const files = new Set(written);
  for (const relativePath of Object.keys(previous?.files ?? {})) {
    if (
      selectedPaths.has(relativePath)
      || obsoletePaths.has(relativePath)
      || LEGACY_PROJECT_SKILL_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
    ) continue;
    const path = resolve(target, relativePath);
    if (existsSync(path)) files.add(path);
  }
  return [...files].sort();
}

function buildManifestHookMetadata(
  target: string,
  hookPlan: HookMigrationPlan,
  previous: InstallManifest | undefined,
  selected: readonly HookPlatform[],
): Partial<Record<HookPlatform, InstallManifestHookMetadata>> {
  const metadata: Partial<Record<HookPlatform, InstallManifestHookMetadata>> = {
    ...(previous?.hooks ?? {}),
  };
  const formats: Record<HookPlatform, string> = {
    claude: "claude-settings-v2",
    opencode: "opencode-plugin-v2",
    codex: "codex-config-toml-v2",
  };
  for (const platform of selected) {
    const inspection = hookPlan.platforms[platform];
    if (!inspection.enabled) {
      delete metadata[platform];
      continue;
    }
    const files = new Set([
      ...inspection.ownedPaths,
      ...inspection.actions.filter((action) => action.kind === "write").map((action) => action.path),
    ]);
    metadata[platform] = {
      owned: true,
      format: formats[platform],
      files: [...files].filter(existsSync).map((path) => projectLabel(target, path)).sort(),
    };
  }
  return metadata;
}

function resolveAssetsRoot(assetsRoot?: string): string {
  const root = assetsRoot ? resolve(assetsRoot) : resolve(__dirname, "../../assets");
  for (const relativeDir of REQUIRED_PROJECT_ASSET_DIRS) {
    const fullPath = resolve(root, relativeDir);
    if (!existsSync(fullPath)) {
      throw new Error(`Bootstrap assets missing: ${fullPath}`);
    }
  }
  return root;
}

async function runPrerequisiteChecks(
  context: BootstrapContext,
  target: string,
  schema: SchemaType,
): Promise<void> {
  ensureProjectAssets(context.assetsRoot, context);

  if (!existsSync(target)) {
    throw new Error(`Target directory does not exist: ${target}`);
  }

  const executable = process.env["CORGISPEC_OPENSPEC_BIN"] || "openspec";
  const runtime = await inspectOpenSpecRuntime({
    cwd: target,
    executable,
  });
  const capability = await createOpenSpecAdapter(target, undefined, {
    executable,
    verifyRuntime: false,
  }).listChanges();
  context.checks.push({
    name: "openspec CLI",
    status: "PASS",
    detail: `OpenSpec ${runtime.version.raw} native JSON contract (${capability.changes.length} active change(s)) for ${basename(target) || target}`,
  });

  await validateOpenSpecSchema(context, target, schema, executable);

  let provider = schema === "gitlab-tracked" ? "gitlab" : schema === "github-tracked" ? "github" : "none";
  try {
    provider = resolveTrackingProvider(loadConfigFromDir(target)).provider;
  } catch {
    // Fresh projects do not have a config yet; infer only bundled legacy schemas.
  }
  if (provider === "none") {
    context.checks.push({
      name: "gh/glab CLI",
      status: "PASS",
      detail: "No issue tracker configured.",
    });
    return;
  }

  const cliRequirement = provider === "gitlab" ? "glab" : "gh";
  const cliStatus = checkCliAvailability(cliRequirement);
  if (!cliStatus.ok) {
    context.checks.push({
      name: "gh/glab CLI",
      status: "FAIL",
      detail: cliStatus.detail,
    });
    throw new Error(cliStatus.detail);
  }

  context.checks.push({
    name: "gh/glab CLI",
    status: "PASS",
    detail: cliStatus.detail,
  });
}

async function validateOpenSpecSchema(
  context: BootstrapContext,
  target: string,
  schema: SchemaType,
  executable: string,
): Promise<void> {
  const projectSchema = resolve(target, "openspec/schemas", schema);
  const bundledSchema = resolve(context.assetsRoot, "schemas", schema);
  let cwd = target;
  let stagingRoot: string | undefined;

  try {
    if (!existsSync(projectSchema) && existsSync(bundledSchema)) {
      stagingRoot = mkdtempSync(resolve(tmpdir(), "corgispec-schema-validate-"));
      const stagingOpenSpec = resolve(stagingRoot, "openspec");
      mkdirSync(resolve(stagingOpenSpec, "schemas"), { recursive: true });
      cpSync(bundledSchema, resolve(stagingOpenSpec, "schemas", schema), {
        recursive: true,
      });
      writeFileSync(resolve(stagingOpenSpec, "config.yaml"), `schema: ${schema}\n`);
      cwd = stagingRoot;
    }

    const result = await new NodeCommandRunner().run({
      command: executable,
      args: ["schema", "validate", schema, "--json"],
      cwd,
      timeoutMs: 15_000,
      env: { OPENSPEC_TELEMETRY: "0" },
    });

    if (result.timedOut) {
      throw new Error(`OpenSpec schema validation for '${schema}' timed out.`);
    }

    let parsed: { valid?: unknown; issues?: unknown } | null = null;
    try {
      const value = JSON.parse(result.stdout) as unknown;
      parsed = value !== null && typeof value === "object"
        ? (value as { valid?: unknown; issues?: unknown })
        : null;
    } catch {
      // Reported below as a native JSON contract violation.
    }

    if (result.exitCode !== 0 || parsed?.valid !== true) {
      const issues = formatSchemaIssues(parsed?.issues);
      const detail = issues
        || result.stderr.trim()
        || (parsed === null
          ? "OpenSpec schema validation returned malformed JSON."
          : `OpenSpec rejected schema '${schema}'.`);
      throw new Error(detail);
    }

    context.checks.push({
      name: "OpenSpec schema",
      status: "PASS",
      detail: `${schema} validated through the native JSON contract`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    context.checks.push({
      name: "OpenSpec schema",
      status: "FAIL",
      detail,
    });
    throw new Error(`Schema '${schema}' failed OpenSpec validation: ${detail}`, {
      cause: error,
    });
  } finally {
    if (stagingRoot) {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

function formatSchemaIssues(issues: unknown): string {
  if (!Array.isArray(issues)) {
    return "";
  }

  return issues
    .map((issue) => {
      if (issue !== null && typeof issue === "object" && "message" in issue) {
        return String((issue as { message: unknown }).message);
      }
      return String(issue);
    })
    .filter(Boolean)
    .join("; ");
}

function ensureProjectAssets(assetsRoot: string, context: BootstrapContext): void {
  const missing: string[] = [];
  for (const relativeDir of REQUIRED_PROJECT_ASSET_DIRS) {
    const fullPath = resolve(assetsRoot, relativeDir);
    if (!existsSync(fullPath)) {
      missing.push(relativeDir);
    }
  }

  if (missing.length > 0) {
    const detail = `Bootstrap assets missing: ${missing.join(", ")}`;
    context.checks.push({
      name: "Bundled assets",
      status: "FAIL",
      detail,
    });
    throw new Error(detail);
  }

  const commandCount = readdirSync(resolve(assetsRoot, "commands/opencode"), {
    withFileTypes: true,
  }).filter((entry) => entry.isFile()).length;

  if (commandCount === 0) {
    const detail = "Bootstrap assets are incomplete: no OpenCode command assets were bundled.";
    context.checks.push({
      name: "Bundled assets",
      status: "FAIL",
      detail,
    });
    throw new Error(detail);
  }

  context.checks.push({
    name: "Bundled assets",
    status: "PASS",
    detail: `Verified bundled commands, schemas, skills, and memory templates under ${assetsRoot}`,
  });
}

function checkCliAvailability(command: "gh" | "glab"): { ok: boolean; detail: string } {
  const version = spawnSync(command, ["--version"], {
    encoding: "utf-8",
  });

  if (version.error || version.status !== 0) {
    return {
      ok: false,
      detail: `${command} CLI is required for this schema but is unavailable.`,
    };
  }

  const authArgs = command === "gh" ? ["auth", "status"] : ["auth", "status"];
  const auth = spawnSync(command, authArgs, {
    encoding: "utf-8",
  });

  if (auth.error || auth.status !== 0) {
    return {
      ok: false,
      detail: `${command} CLI is installed but not authenticated.`,
    };
  }

  const versionLine = `${version.stdout}${version.stderr}`.split(/\r?\n/).find(Boolean) ?? `${command} available`;
  return {
    ok: true,
    detail: versionLine.trim(),
  };
}

function syncManagedProjectFiles(
  target: string,
  sourceFiles: string[],
  schema: SchemaType,
  assetsRoot: string,
  context: BootstrapContext
): string[] {
  const written: string[] = [];

  for (const sourceFile of sourceFiles) {
    const relativePath = projectRelativePathFromAsset(assetsRoot, schema, sourceFile);
    const targetFile = resolve(target, relativePath);
    mkdirSync(dirname(targetFile), { recursive: true });
    cpSync(sourceFile, targetFile);
    written.push(targetFile);
  }

  context.actions.push(`synced ${written.length} managed project files`);
  context.checks.push({
    name: "Schema directory",
    status: "PASS",
    detail: `Copied bundled schema assets for ${schema}.`,
  });
  return written;
}

function projectRelativePathFromAsset(assetsRoot: string, schema: SchemaType, sourceFile: string): string {
  const commandsOpencodeRoot = resolve(assetsRoot, "commands/opencode");
  const commandsClaudeRoot = resolve(assetsRoot, "commands/claude/corgi");
  const schemaRoot = resolve(assetsRoot, "schemas", schema);

  if (sourceFile.startsWith(commandsOpencodeRoot)) {
    return `.opencode/commands/${relativeManagedFiles(commandsOpencodeRoot, [sourceFile])[0]}`;
  }
  if (sourceFile.startsWith(commandsClaudeRoot)) {
    return `.claude/commands/corgi/${relativeManagedFiles(commandsClaudeRoot, [sourceFile])[0]}`;
  }
  if (sourceFile.startsWith(schemaRoot)) {
    return `openspec/schemas/${schema}/${relativeManagedFiles(schemaRoot, [sourceFile])[0]}`;
  }

  throw new Error(`Unsupported managed asset path: ${sourceFile}`);
}

function verifyManagedBootstrapState(
  target: string,
  state: ReturnType<typeof classifyTargetState>,
): string | null {
  if (state.kind !== "managed-update" || !state.hasConfig || !state.manifestPath) {
    return "Verify mode requires a managed bootstrap state with config, manifest, and managed file hashes.";
  }

  const manifest = state.manifestRead.manifest;
  if (state.manifestRead.status !== "valid" || !manifest) {
    return `Managed bootstrap manifest is unreadable: ${state.manifestRead.errors.join("; ")}`;
  }

  const entries = Object.entries(manifest.files ?? {});
  if (entries.length === 0) {
    return "Verify mode requires at least one managed file hash in the bootstrap manifest.";
  }

  const schema = detectSchema(target);
  if (!schema || manifest.schema !== schema) {
    return "Managed bootstrap config and manifest do not identify the same schema.";
  }

  const invalidHashes: string[] = [];
  for (const [relativePath, entry] of entries) {
    if (
      entry === null
      || typeof entry !== "object"
      || typeof entry.sha256 !== "string"
      || !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      invalidHashes.push(relativePath);
      continue;
    }
    const filePath = resolve(target, relativePath);
    if (!existsSync(filePath) || sha256File(filePath) !== entry.sha256) {
      invalidHashes.push(relativePath);
    }
  }

  if (invalidHashes.length > 0) {
    return `Managed file hashes do not match: ${invalidHashes.join(", ")}`;
  }

  return null;
}

function updateConfigSchema(target: string, schema: SchemaType, timestamp: string): void {
  const configPath = resolve(target, "openspec/config.yaml");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const patched = patchInstallerConfig(existing, {
    schema,
    installer: {
      version: 2,
      managed_at: timestamp,
    },
    isolation: readIsolation(target),
    trackingProvider: trackingProviderFor(target, schema),
  });
  writeFileSync(configPath, patched);
}

function readIsolation(target: string): { mode: "none" | "worktree"; root?: string; branch_prefix?: string } {
  try {
    const config = loadConfigFromDir(target);
    return config.isolation ?? { mode: "none" };
  } catch {
    return { mode: "none" };
  }
}

function safelyDetectSchema(target: string): SchemaType | undefined {
  try {
    return detectSchema(target);
  } catch {
    return undefined;
  }
}

function detectSchema(target: string): SchemaType | undefined {
  const configPath = resolve(target, "openspec/config.yaml");
  if (!existsSync(configPath)) {
    return undefined;
  }
  const parsed = yaml.load(readFileSync(configPath, "utf-8")) as { schema?: unknown } | null;
  return typeof parsed?.schema === "string" && parsed.schema.trim().length > 0
    ? parsed.schema.trim()
    : undefined;
}

function resolveBootstrapMode(requested: BootstrapMode, targetState: ReturnType<typeof classifyTargetState>["kind"]): BootstrapResult["mode"] {
  if (requested === "fresh") return "fresh";
  if (requested === "update") return "update";
  if (requested === "legacy") return "legacy";
  if (requested === "verify") return "verify";

  switch (targetState) {
    case "managed-update":
      return "update";
    case "legacy":
      return "legacy";
    default:
      return "fresh";
  }
}

function getExplicitModeMismatch(
  requested: BootstrapMode,
  targetState: ReturnType<typeof classifyTargetState>["kind"]
): string | null {
  if (requested === "auto" || requested === "verify") {
    return null;
  }

  const compatibleStates: Record<Exclude<BootstrapMode, "auto" | "verify">, Array<ReturnType<typeof classifyTargetState>["kind"]>> = {
    fresh: ["fresh", "init-needed"],
    update: ["managed-update"],
    legacy: ["legacy"],
  };

  if (compatibleStates[requested].includes(targetState)) {
    return null;
  }

  return `Explicit mode '${requested}' is incompatible with target state '${targetState}'.`;
}

function finalize(
  context: BootstrapContext,
  target: string,
  status: BootstrapResult["status"],
  message: string
): BootstrapResult {
  const shouldWriteReport =
    context.resultMode !== "verify"
    && context.prerequisitesPassed
    && existsSync(target);
  const reportPath = shouldWriteReport
      ? writeInstallReport({
        targetDir: target,
        sourceRepo: context.sourceRepo,
        packageVersion: context.packageVersion,
        mode: context.reportMode,
        timestamp: context.timestamp,
        checks: context.checks,
        actions: context.actions,
        overall: status === "success" ? "PASS" : "FAIL",
        migration: context.migration,
        reportPath: context.reportOverride,
      })
    : context.reportOverride ?? resolve(target, "openspec/.corgi-install-report.md");

  return {
    status,
    mode: context.resultMode,
    target,
    actions: context.actions,
    reportPath,
    manifestPath: context.manifestPath,
    message,
    migration: context.migration,
  };
}
