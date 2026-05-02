import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { initializeOpenSpec } from "../commands/init.js";
import { getBundledSkillsDir, installSkillsTo } from "../commands/install.js";
import type { Platform } from "./platform.js";
import { getSkillDir } from "./platform.js";
import type { SchemaType } from "./config.js";
import { loadConfigFromDir } from "./config.js";
import {
  classifyTargetState,
  getManagedProjectFiles,
  patchInstallerConfig,
  relativeManagedFiles,
  sha256File,
  type BootstrapMode,
  type InstallManifest,
} from "./install-assets.js";
import { initializeMemoryStructure } from "./memory-init.js";
import { type BootstrapCheck, writeInstallManifest, writeInstallReport } from "./bootstrap-report.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface BootstrapOptions {
  target: string;
  schema?: SchemaType;
  mode: BootstrapMode;
  yes: boolean;
  noMemory: boolean;
  json: boolean;
  assetsRoot?: string;
  userSkillDirs?: Record<Platform, string>;
}

export interface BootstrapResult {
  status: "success" | "failed" | "needs-approval" | "stopped";
  mode: "fresh" | "update" | "legacy" | "verify";
  target: string;
  actions: string[];
  reportPath: string;
  manifestPath?: string;
  message: string;
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
}

const REQUIRED_PROJECT_ASSET_DIRS = ["commands", "schemas", "skills", "memory-init"] as const;

export async function runBootstrap(opts: BootstrapOptions): Promise<BootstrapResult> {
  const target = resolve(opts.target);
  const state = classifyTargetState(target);
  const mode = resolveBootstrapMode(opts.mode, state.kind);
  const assetsRoot = resolveAssetsRoot(opts.assetsRoot);
  const timestamp = new Date().toISOString();
  const schema = opts.schema ?? detectSchema(target) ?? "github-tracked";

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
  };

  try {
    runPrerequisiteChecks(context, target, schema);

    const explicitModeMismatch = getExplicitModeMismatch(opts.mode, state.kind);
    if (explicitModeMismatch) {
      context.checks.push({
        name: "Managed files",
        status: "SKIP",
        detail: explicitModeMismatch,
      });
      return finalize(context, target, "stopped", explicitModeMismatch);
    }

    if (state.kind === "inconsistent") {
      return finalize(context, target, "stopped", "Target project is in an inconsistent bootstrap state.");
    }

    if (mode === "verify") {
      context.checks.push({
        name: "Managed files",
        status: "PASS",
        detail: "Verification only. No managed files were mutated.",
      });
      return finalize(context, target, "success", "Bootstrap verification completed without mutations.");
    }

    if (state.kind === "init-needed") {
      initializeOpenSpec({
        target,
        schema,
        bundledSchemasDir: resolve(assetsRoot, "schemas"),
      });
      context.actions.push("initialized openspec project structure");
    }

    const effectiveSchema = detectSchema(target) ?? schema;
    context.schema = effectiveSchema;
    const overwriteFiles = getOverwriteTargets(target, effectiveSchema, assetsRoot);

    if (state.kind === "legacy") {
      createLegacyBackup(target, overwriteFiles, context);
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

    if (state.kind === "managed-update") {
      const localModifications = detectManagedFileModifications(target, state.manifestPath);
      if (localModifications.length > 0) {
        context.checks.push({
          name: "Managed files",
          status: "FAIL",
          detail: `Local modifications detected: ${localModifications.join(", ")}`,
        });
        return finalize(context, target, "stopped", "Managed update stopped because tracked files have local modifications.");
      }
    }

    installUserSkills(context, assetsRoot, opts.userSkillDirs);

    context.managedFiles = syncManagedProjectFiles(target, effectiveSchema, assetsRoot, context);

    updateConfigSchema(target, effectiveSchema, context.timestamp);

    if (!opts.noMemory) {
      const memory = initializeMemoryStructure({
        targetDir: target,
        assetsRoot,
      });
      if (memory.createdFiles.length > 0 || memory.injectedSessionMemoryProtocol) {
        context.actions.push("initialized project memory files");
      }
    }

    context.manifestPath = writeInstallManifest({
      targetDir: target,
      sourceRepo: context.sourceRepo,
      schema: effectiveSchema,
      isolation: readIsolation(target),
      updatedAt: context.timestamp,
      files: context.managedFiles,
    });
    context.actions.push("wrote install manifest");

    context.checks.push({
      name: "Managed files",
      status: "PASS",
      detail: `${context.managedFiles.length}/${context.managedFiles.length} project-local files synced`,
    });

    return finalize(context, target, "success", "Bootstrap completed successfully.");
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

function runPrerequisiteChecks(context: BootstrapContext, target: string, schema: SchemaType): void {
  ensureProjectAssets(context.assetsRoot, context);

  if (!existsSync(target)) {
    throw new Error(`Target directory does not exist: ${target}`);
  }

  context.checks.push({
    name: "openspec CLI",
    status: "PASS",
    detail: `runBootstrap available for ${basename(target) || target}`,
  });

  const cliRequirement = schema === "gitlab-tracked" ? "glab" : "gh";
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

function installUserSkills(
  context: BootstrapContext,
  assetsRoot: string,
  userSkillDirs?: Record<Platform, string>
): void {
  const sourceDir = getBundledSkillsDirFromAssets(assetsRoot);
  const platforms: Platform[] = ["claude", "opencode", "codex"];
  let installedCount = 0;

  for (const platform of platforms) {
    const targetDir = userSkillDirs?.[platform] ?? getSkillDir(platform);
    installedCount += installSkillsTo(sourceDir, targetDir, false).length;
  }

  context.actions.push(`installed ${installedCount} user-level skills`);
  context.checks.push({
    name: "User-level skills",
    status: "PASS",
    detail: `Installed bundled skills across ${platforms.length} platform targets.`,
  });
}

function getBundledSkillsDirFromAssets(assetsRoot: string): string {
  const skillsRoot = resolve(assetsRoot, "skills");
  if (!existsSync(skillsRoot)) {
    return getBundledSkillsDir();
  }
  return skillsRoot;
}

function syncManagedProjectFiles(
  target: string,
  schema: SchemaType,
  assetsRoot: string,
  context: BootstrapContext
): string[] {
  const sourceFiles = getManagedProjectFiles(schema, assetsRoot);
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

function getOverwriteTargets(target: string, schema: SchemaType, assetsRoot: string): string[] {
  return getManagedProjectFiles(schema, assetsRoot).map((sourceFile) =>
    resolve(target, projectRelativePathFromAsset(assetsRoot, schema, sourceFile))
  );
}

function projectRelativePathFromAsset(assetsRoot: string, schema: SchemaType, sourceFile: string): string {
  const commandsOpencodeRoot = resolve(assetsRoot, "commands/opencode");
  const commandsClaudeRoot = resolve(assetsRoot, "commands/claude/opsx");
  const schemaRoot = resolve(assetsRoot, "schemas", schema);

  if (sourceFile.startsWith(commandsOpencodeRoot)) {
    return `.opencode/commands/${relativeManagedFiles(commandsOpencodeRoot, [sourceFile])[0]}`;
  }
  if (sourceFile.startsWith(commandsClaudeRoot)) {
    return `.claude/commands/opsx/${relativeManagedFiles(commandsClaudeRoot, [sourceFile])[0]}`;
  }
  if (sourceFile.startsWith(schemaRoot)) {
    return `openspec/schemas/${schema}/${relativeManagedFiles(schemaRoot, [sourceFile])[0]}`;
  }

  throw new Error(`Unsupported managed asset path: ${sourceFile}`);
}

function detectManagedFileModifications(
  target: string,
  manifestPath: string | undefined
): string[] {
  if (!manifestPath || !existsSync(manifestPath)) {
    return [];
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as InstallManifest;
  const modified: string[] = [];
  for (const [relativePath, entry] of Object.entries(manifest.files ?? {})) {
    const targetFile = resolve(target, relativePath);
    if (!existsSync(targetFile)) {
      modified.push(relativePath);
      continue;
    }

    const currentHash = sha256File(targetFile);
    if (entry.sha256 && currentHash !== entry.sha256) {
      modified.push(relativePath);
    }
  }
  return modified;
}

function createLegacyBackup(target: string, managedFiles: string[], context: BootstrapContext): void {
  const backupRoot = resolve(target, "openspec/.opsx-backups", context.timestamp.replace(/[:.]/g, "-"));
  for (const source of managedFiles) {
    if (!existsSync(source)) {
      continue;
    }
    const destination = resolve(backupRoot, relativeManagedFiles(target, [source])[0]);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
  }
  context.actions.push(`created legacy backup at ${backupRoot}`);
}

function updateConfigSchema(target: string, schema: SchemaType, timestamp: string): void {
  const configPath = resolve(target, "openspec/config.yaml");
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const patched = patchInstallerConfig(existing, {
    schema,
    installer: {
      version: 1,
      managed_at: timestamp,
    },
    isolation: readIsolation(target),
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

function detectSchema(target: string): SchemaType | undefined {
  const configPath = resolve(target, "openspec/config.yaml");
  if (!existsSync(configPath)) {
    return undefined;
  }
  const parsed = yaml.load(readFileSync(configPath, "utf-8")) as { schema?: unknown } | null;
  return parsed?.schema === "gitlab-tracked" || parsed?.schema === "github-tracked"
    ? parsed.schema
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
  const shouldWriteReport = existsSync(target);
  const reportPath = shouldWriteReport
    ? writeInstallReport({
        targetDir: target,
        sourceRepo: context.sourceRepo,
        mode: context.reportMode,
        timestamp: context.timestamp,
        checks: context.checks,
        actions: context.actions,
        overall: status === "success" ? "PASS" : "FAIL",
      })
    : resolve(target, "openspec/.opsx-install-report.md");

  return {
    status,
    mode: context.resultMode,
    target,
    actions: context.actions,
    reportPath,
    manifestPath: context.manifestPath,
    message,
  };
}
