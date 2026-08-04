import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, relative, resolve } from "node:path";
import {
  assertWritableArtifactPath,
  createArtifactResolver,
  type ArtifactResolver,
  type ResolvedChangeArtifacts,
} from "./artifact-resolver.js";
import type { OpenSpecConfig } from "./config.js";
import { findConfigPath, loadConfig } from "./config.js";
import {
  resolveOptionalTaskArtifactId,
  summarizeTaskGroups,
  type TaskGroupSummary,
} from "./lifecycle.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
  type OpenSpecCommandOptions,
} from "./openspec-adapter.js";
import { isPathInside } from "./planning-revision.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface SessionContext {
  schema: string;
  isolationMode: string;
  activeChanges: ActiveChange[];
  currentBranch: string;
  worktreePath: string;
}

export interface ActiveChange {
  name: string;
  worktreePath: string | null;
  currentGroup: string | null;
}

export interface ResolvedHookChange {
  name: string;
  /** Directory from which the authoritative OpenSpec query was made. */
  commandRoot: string;
  worktreePath: string | null;
  resolved: ResolvedChangeArtifacts;
  taskSummary: TaskGroupSummary | null;
}

type HookOpenSpecAdapter = Pick<OpenSpecAdapter, "listChanges" | "getStatus">;

/** Injectable process/filesystem seams used by hook contract tests. */
export interface HookPlanningDependencies {
  createAdapter?: (cwd: string) => HookOpenSpecAdapter;
  createResolver?: (adapter: HookOpenSpecAdapter) => ArtifactResolver;
  listWorktrees?: (cwd: string) => string[];
  currentBranch?: (cwd: string) => string;
}

export interface HookPlanningOptions extends Pick<OpenSpecCommandOptions, "store"> {}

export type HookPlanningErrorCode =
  | "worktree_discovery_failed"
  | "ambiguous_change"
  | "openspec_contract_mismatch"
  | "task_artifact_missing";

export class HookPlanningError extends Error {
  constructor(
    message: string,
    public readonly code: HookPlanningErrorCode,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HookPlanningError";
  }
}

export interface HookInput {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    command?: string;
  };
  stop_reason?: string;
  stop_hook_active?: boolean;
  session_id?: string;
  compact_trigger?: string;
}

// ─── Hooks Disabled Check ───────────────────────────────────────────────

/**
 * Check if hooks are disabled via environment variable.
 */
export function isHooksDisabled(): boolean {
  return process.env["CORGISPEC_HOOKS_DISABLE"] === "1";
}

// ─── Project Root Detection ─────────────────────────────────────────────

/**
 * Find the project root by walking up from cwd looking for openspec/config.yaml.
 */
export function findProjectRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 20; i++) {
    if (findConfigPath(dir)) {
      return dir;
    }
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ─── Context Gathering ──────────────────────────────────────────────────

/**
 * Gather full session context for a project.
 */
export async function gatherSessionContext(
  cwd: string,
  options: HookPlanningOptions = {},
  dependencies: HookPlanningDependencies = {},
): Promise<SessionContext | null> {
  const configPath = findConfigPath(cwd);
  if (!configPath) return null;

  const config = loadConfig(configPath);

  const isolationMode = config.isolation?.mode ?? "none";
  const resolvedChanges = await resolveHookChanges(cwd, config, options, dependencies);
  const activeChanges = resolvedChanges.map(({ name, worktreePath, taskSummary }) => ({
    name,
    worktreePath,
    currentGroup: formatCurrentGroup(taskSummary),
  }));
  const currentBranch = (dependencies.currentBranch ?? getCurrentBranch)(cwd);
  const worktreePath = resolveCurrentWorktreePath(cwd, config);

  return {
    schema: config.schema,
    isolationMode,
    activeChanges,
    currentBranch,
    worktreePath,
  };
}

// ─── Context Formatting ─────────────────────────────────────────────────

/**
 * Format session context as the standardized additionalContext Markdown string.
 */
export function formatContextMarkdown(ctx: SessionContext): string {
  const lines: string[] = [
    "## CorgiSpec Project Context",
    `- **Schema**: ${ctx.schema}`,
    `- **Isolation mode**: ${ctx.isolationMode}`,
  ];

  if (ctx.activeChanges.length > 0) {
    lines.push("- **Active changes**:");
    for (const change of ctx.activeChanges) {
      const path = change.worktreePath ?? "no worktree";
      const status = change.currentGroup ?? "planning";
      lines.push(`  - ${change.name} \u2192 ${path} (${status})`);
    }
  } else {
    lines.push("- **Active changes**: (none)");
  }

  lines.push(`- **Current branch**: ${ctx.currentBranch}`);
  lines.push(`- **Worktree path**: ${ctx.worktreePath}`);
  lines.push(
    "- **Hooks active**: SessionStart, PreToolUse, PostToolUse, Stop, PostCompact"
  );

  return lines.join("\n");
}

/**
 * Format session context as the full hookSpecificOutput JSON structure.
 */
export function formatHookOutput(
  eventName: string,
  ctx: SessionContext
): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: formatContextMarkdown(ctx),
    },
  });
}

// ─── Active Changes Scanning ────────────────────────────────────────────

/**
 * Resolve active changes from the current hook working directory through
 * OpenSpec's JSON list/status contracts.
 */
export async function scanActiveChanges(
  cwd: string,
  config: OpenSpecConfig,
  options: HookPlanningOptions = {},
  dependencies: HookPlanningDependencies = {},
): Promise<ActiveChange[]> {
  const changes = await resolveHookChanges(cwd, config, options, dependencies);
  return changes.map(({ name, worktreePath, taskSummary }) => ({
    name,
    worktreePath,
    currentGroup: formatCurrentGroup(taskSummary),
  }));
}

export async function resolveHookChanges(
  cwd: string,
  config: OpenSpecConfig,
  options: HookPlanningOptions = {},
  dependencies: HookPlanningDependencies = {},
): Promise<ResolvedHookChange[]> {
  return resolveHookChangesFromRoot(cwd, cwd, config, options, dependencies);
}

async function resolveHookChangesFromRoot(
  cwd: string,
  commandRoot: string,
  config: OpenSpecConfig,
  options: HookPlanningOptions,
  dependencies: HookPlanningDependencies,
): Promise<ResolvedHookChange[]> {
  const createAdapter = dependencies.createAdapter ?? defaultAdapterFactory;
  const createResolver =
    dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));
  const isolationMode = config.isolation?.mode ?? "none";
  const resolvedCwd = resolve(cwd);
  const resolvedCommandRoot = resolve(commandRoot);
  if (resolvedCommandRoot !== resolvedCwd && findConfigPath(resolvedCommandRoot) === null) {
    throw new HookPlanningError(
      "No trusted Git worktree could be resolved for hook planning context",
      "worktree_discovery_failed",
    );
  }

  const adapter = createAdapter(resolvedCommandRoot);
  const response = await adapter.listChanges(options);
  const seen = new Set<string>();
  for (const change of response.changes) {
    if (seen.has(change.name)) {
      throw new HookPlanningError(
        `Change '${change.name}' appears more than once in the OpenSpec list response for ${resolvedCommandRoot}`,
        "ambiguous_change",
        { changeName: change.name, worktreePaths: [resolvedCommandRoot] },
      );
    }
    seen.add(change.name);
  }
  const resolver = createResolver(adapter);

  const resolvedChanges = await Promise.all(
    response.changes.map(async ({ name }) => {
      const resolvedChange = await resolver.resolve(name, options);
      if (resolvedChange.changeName !== name) {
        throw new HookPlanningError(
          `OpenSpec status returned change '${resolvedChange.changeName}' for requested change '${name}'`,
          "openspec_contract_mismatch",
          { requested: name, received: resolvedChange.changeName },
        );
      }

      const taskArtifactId = resolveOptionalTaskArtifactId(config, resolvedChange.artifactPaths);
      if (
        taskArtifactId &&
        !Object.prototype.hasOwnProperty.call(resolvedChange.artifactPaths, taskArtifactId)
      ) {
        throw new HookPlanningError(
          `Configured task artifact '${taskArtifactId}' is not present in the OpenSpec artifact set for '${name}'`,
          "task_artifact_missing",
          { changeName: name, taskArtifactId },
        );
      }
      const taskSummary = taskArtifactId
        ? summarizeTaskGroups(resolvedChange.artifactPaths, taskArtifactId)
        : null;
      return {
        name,
        commandRoot: resolvedCommandRoot,
        worktreePath:
          isolationMode === "worktree"
            ? relative(resolvedCwd, resolvedCommandRoot) || "."
            : null,
        resolved: resolvedChange,
        taskSummary,
      } satisfies ResolvedHookChange;
    }),
  );

  return resolvedChanges.sort((left, right) =>
    compareCodeUnits(left.name, right.name) || compareCodeUnits(left.commandRoot, right.commandRoot)
  );
}

/**
 * Match a write to one authoritative OpenSpec change. A lexical match alone
 * is insufficient: the resolver's symlink-aware write guard must also accept
 * the target before PostToolUse is allowed to trigger validation.
 */
export async function resolveWrittenChange(
  filePath: string,
  cwd: string,
  config: OpenSpecConfig,
  options: HookPlanningOptions = {},
  dependencies: HookPlanningDependencies = {},
): Promise<ResolvedHookChange | null> {
  const candidate = isPortableAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  const commandRoot = resolveWriteCommandRoot(candidate, cwd, config, options, dependencies);
  if (!commandRoot) return null;
  const changes = await resolveHookChangesFromRoot(
    cwd,
    commandRoot,
    config,
    options,
    dependencies,
  );
  const lexicalMatches = changes.filter((change) =>
    isPathInside(change.resolved.changeRoot, candidate)
  );
  if (lexicalMatches.length === 0) return null;

  const uniqueRoots = new Set(lexicalMatches.map((change) => change.resolved.changeRoot));
  if (uniqueRoots.size > 1) {
    throw new HookPlanningError(
      `Written path '${filePath}' is ambiguous across OpenSpec change roots`,
      "ambiguous_change",
      { filePath, changeRoots: [...uniqueRoots].sort() },
    );
  }

  const match = lexicalMatches[0]!;
  await assertWritableArtifactPath(match.resolved, candidate);
  return match;
}

function resolveWriteCommandRoot(
  candidate: string,
  cwd: string,
  config: OpenSpecConfig,
  options: HookPlanningOptions,
  dependencies: HookPlanningDependencies,
): string | null {
  const resolvedCwd = resolve(cwd);
  if (options.store || config.isolation?.mode !== "worktree") {
    return resolvedCwd;
  }

  const managedRoot = resolve(resolvedCwd, config.isolation.root ?? ".worktrees");
  if (isPathInside(managedRoot, candidate)) {
    const listWorktrees = dependencies.listWorktrees ?? listGitWorktrees;
    const matchingWorktree = [...new Set(listWorktrees(resolvedCwd).map((path) => resolve(path)))]
      .filter((worktree) => dirname(worktree) === managedRoot)
      .filter((worktree) => findConfigPath(worktree) !== null)
      .filter((worktree) => isPathInside(worktree, candidate))
      .sort((left, right) => right.length - left.length || compareCodeUnits(left, right))[0];
    return matchingWorktree ?? null;
  }

  return isPathInside(resolvedCwd, candidate) ? resolvedCwd : null;
}

// ─── Stdin Reading ──────────────────────────────────────────────────────

/**
 * Read JSON from stdin (for PreToolUse and Stop hooks).
 */
export async function readStdinJson(): Promise<HookInput> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        if (!data.trim()) {
          resolve({});
          return;
        }
        resolve(JSON.parse(data) as HookInput);
      } catch {
        reject(new Error(`Failed to parse stdin JSON: ${data}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

// ─── Write Validation ───────────────────────────────────────────────────

/**
 * Check if a file_path is a valid write target given the current isolation config.
 * Returns null if allowed, or a rejection message if blocked.
 */
export function validateWriteTarget(
  filePath: string,
  cwd: string,
  config: OpenSpecConfig
): string | null {
  const isolation = config.isolation;

  // No isolation = all writes allowed
  if (!isolation || isolation.mode === "none") {
    return null;
  }

  // Worktree isolation: writes must be inside the active worktree
  if (isolation.mode === "worktree") {
    const root = isolation.root ?? ".worktrees";
    const absPath = resolve(cwd, filePath);
    const worktreeRoot = resolve(cwd, root);

    // Allow writes inside any worktree
    if (absPath.startsWith(worktreeRoot + "/") || absPath.startsWith(worktreeRoot + "\\")) {
      return null;
    }

    // Block writes outside worktrees
    return (
      `Blocked: Write to "${filePath}" is outside the worktree root "${root}". ` +
      "When isolation.mode is worktree, all writes must go to a worktree directory."
    );
  }

  return null;
}

// ─── Dangerous Command Detection ────────────────────────────────────────

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(-[a-zA-Z]*r[a-zA-Z]*\s+)?\/(\s|$)/,
    message: "Blocked: rm -rf / or equivalent destructive command detected.",
  },
  {
    pattern: /\bgit\s+push\s+.*--force\s+.*\bmain\b/,
    message:
      "Blocked: Force push to main branch detected. Use a feature branch instead.",
  },
  {
    // Short-form -f flag (not matched by --force pattern)
    pattern: /\bgit\s+push\s+(?!.*--force)(?=.*-f)\S.*\bmain\b/,
    message:
      "Blocked: Force push to main branch detected. Use a feature branch instead.",
  },
];

/**
 * Check if a bash command contains dangerous patterns.
 * Returns null if safe, or a rejection message if dangerous.
 */
export function checkDangerousCommand(command: string): string | null {
  for (const { pattern, message } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return message;
    }
  }
  return null;
}

// ─── Task Group Postcondition Check ─────────────────────────────────────

/**
 * Check postconditions for the current task group of a change.
 * Returns null if all pass, or a list of failure messages.
 */
export function checkTaskGroupPostconditions(
  summary: TaskGroupSummary | null,
): string[] | null {
  const current = summary?.currentGroup;
  if (!current) return null;
  // A completely untouched group is the expected successor immediately after
  // a one-group checkpoint. Only a group with work already in progress must
  // be completed before the session may stop.
  if (current.completedTasks === 0) return null;
  const incompleteTasks = current.tasks.filter((task) => !task.done);
  if (incompleteTasks.length > 0) {
    return [
      `Incomplete tasks in "${current.name}":`,
      ...incompleteTasks.map((task) => `  - ${task.id} ${task.description}`),
    ];
  }

  return null;
}

// ─── Hook Configuration Detection ───────────────────────────────────────

export interface HookConfigStatus {
  configured: boolean;
  platform: "claude" | "opencode" | "codex" | null;
  events: string[];
  configFile: string | null;
}

/**
 * Detect whether hook configuration is present for any supported platform.
 * Checks Claude Code, OpenCode (deep), and Codex configs in priority order.
 */
export function detectHookConfig(cwd: string): HookConfigStatus {
  // 1. Claude Code / OpenCode bridge: .claude/settings.json with "hooks" key
  const claudeSettingsPath = resolve(cwd, ".claude/settings.json");
  if (existsSync(claudeSettingsPath)) {
    try {
      const data = JSON.parse(readFileSync(claudeSettingsPath, "utf-8"));
      if (data.hooks && typeof data.hooks === "object") {
        const events = Object.keys(data.hooks);
        return {
          configured: true,
          platform: "claude",
          events,
          configFile: claudeSettingsPath,
        };
      }
    } catch (err: unknown) {
      console.error(`[hooks] Failed to parse ${claudeSettingsPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. OpenCode deep plugin: .opencode/plugins/corgispec-deep.ts
  const deepPluginPath = resolve(cwd, ".opencode/plugins/corgispec-deep.ts");
  if (existsSync(deepPluginPath)) {
    try {
      const content = readFileSync(deepPluginPath, "utf-8");
      if (content.includes("CorgiSpecDeep")) {
        return {
          configured: true,
          platform: "opencode",
          events: ["SessionStart", "PreToolUse", "PostToolUse", "Stop", "PostCompact"],
          configFile: deepPluginPath,
        };
      }
    } catch (err: unknown) {
      console.error(`[hooks] Failed to read ${deepPluginPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Codex: .codex/config.toml with hooks entries
  const codexConfigPath = resolve(cwd, ".codex/config.toml");
  if (existsSync(codexConfigPath)) {
    try {
      const content = readFileSync(codexConfigPath, "utf-8");
      if (content.includes("hooks = true") || content.includes("[[hooks.")) {
        const events: string[] = [];
        const eventPattern = /\[\[hooks\.(\w+)\]\]/g;
        let match: RegExpExecArray | null;
        while ((match = eventPattern.exec(content)) !== null) {
          const event = match[1]!;
          if (!events.includes(event)) {
            events.push(event);
          }
        }
        return {
          configured: true,
          platform: "codex",
          events,
          configFile: codexConfigPath,
        };
      }
    } catch (err: unknown) {
      console.error(`[hooks] Failed to read ${codexConfigPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { configured: false, platform: null, events: [], configFile: null };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function defaultAdapterFactory(cwd: string): OpenSpecAdapter {
  return createOpenSpecAdapter(cwd, undefined, {
    executable: process.env["CORGISPEC_OPENSPEC_BIN"] || "openspec",
  });
}

function getCurrentBranch(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "(unknown)";
  }
}

function resolveCurrentWorktreePath(cwd: string, config: OpenSpecConfig): string {
  if (!config.isolation || config.isolation.mode === "none") {
    return "N/A";
  }
  try {
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return relative(cwd, topLevel) || ".";
  } catch {
    return "N/A";
  }
}

function listGitWorktrees(cwd: string): string[] {
  try {
    const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const paths = output
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).trim())
      .filter(Boolean);
    if (paths.length === 0) throw new Error("Git returned no registered worktrees");
    return paths;
  } catch (error) {
    throw new HookPlanningError(
      `Failed to discover Git worktrees: ${error instanceof Error ? error.message : String(error)}`,
      "worktree_discovery_failed",
      {},
    );
  }
}

function formatCurrentGroup(summary: TaskGroupSummary | null): string | null {
  if (!summary) return null;
  if (summary.currentGroup) return `Group ${summary.currentGroup.number} in-progress`;
  return summary.groups.length > 0 ? "all groups done" : null;
}

function isPortableAbsolute(value: string): boolean {
  return resolve(value) === value || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]/.test(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
