import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  memoryStartup: readonly string[];
  runContracts: HookRunContractContext[];
  bridgeDrift: string[];
}

export interface HookRunContractContext {
  changeName: string;
  runId: string;
  worktreePath?: string;
  phase: string;
  stateRevision: number;
  currentGroupId: string | null;
  completedGroupIds?: string[];
  bridgeCheckpointHeads?: Record<string, string>;
  headRevision: string | null;
  nextAction: string;
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

export interface HookGitWorktreeLayout {
  primaryRoot: string;
  currentRoot: string;
  worktrees: string[];
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
  const runContracts = readHookRunContractContexts(cwd, dependencies);
  const bridgeDrift = compareSessionBridge(cwd, runContracts);

  return {
    schema: config.schema,
    isolationMode,
    activeChanges,
    currentBranch,
    worktreePath,
    memoryStartup: [
      "memory/session-bridge.md",
      "memory/MEMORY.md",
      "wiki/hot.md",
    ],
    runContracts,
    bridgeDrift,
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
    `- **Memory startup**: ${ctx.memoryStartup.join(" \u2192 ")} (read wiki/index.md on demand)`,
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
  if (ctx.runContracts.length > 0) {
    lines.push("- **Run Contract v3 (authoritative live state)**:");
    for (const run of ctx.runContracts) {
      lines.push(
        `  - ${run.changeName}: ${run.phase}; group ${run.currentGroupId ?? "none"}; revision ${run.stateRevision}`
        + `${run.worktreePath ? `; worktree ${run.worktreePath}` : ""}; next: ${run.nextAction}`,
      );
    }
  } else {
    lines.push("- **Run Contract v3**: (none active)");
  }
  if (ctx.bridgeDrift.length > 0) {
    lines.push("- **Session Bridge drift**:");
    for (const drift of ctx.bridgeDrift) lines.push(`  - ${drift}`);
  } else {
    lines.push("- **Session Bridge drift**: none detected");
  }
  lines.push(
    "- **Hooks active**: SessionStart, PreToolUse, PostToolUse, Stop, PostCompact"
  );

  return lines.join("\n");
}

export function readHookRunContractContexts(
  projectRoot: string,
  dependencies: Pick<HookPlanningDependencies, "listWorktrees"> = {},
): HookRunContractContext[] {
  const contexts = discoverHookProjectRoots(projectRoot, dependencies)
    .flatMap((root) => readRunContractContextsFromRoot(root).map((context) => ({
      ...context,
      worktreePath: root,
    })));
  return contexts.sort((left, right) =>
    compareCodeUnits(left.changeName, right.changeName)
    || compareCodeUnits(left.runId, right.runId)
  );
}

function readRunContractContextsFromRoot(projectRoot: string): HookRunContractContext[] {
  const loopRoot = resolve(projectRoot, ".corgi/loop");
  if (!existsSync(loopRoot)) return [];
  const contexts: HookRunContractContext[] = [];
  for (const entry of readdirSync(loopRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pointerPath = resolve(loopRoot, entry.name, "current.json");
    if (!existsSync(pointerPath)) continue;
    try {
      const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as Record<string, unknown>;
      if (pointer.schemaVersion !== 3 || typeof pointer.runId !== "string") continue;
      const statePath = resolve(loopRoot, entry.name, "runs", pointer.runId, "state.json");
      const state = JSON.parse(readFileSync(statePath, "utf8")) as Record<string, unknown>;
      if (
        state.schemaVersion !== 3
        || typeof state.changeName !== "string"
        || typeof state.runId !== "string"
        || typeof state.phase !== "string"
        || !Number.isInteger(state.stateRevision)
      ) continue;
      if (["archived", "invalidated", "corrupted"].includes(state.phase)) continue;
      const groups = state.groups && typeof state.groups === "object" && !Array.isArray(state.groups)
        ? Object.values(state.groups as Record<string, unknown>)
          .filter((group): group is Record<string, unknown> => Boolean(group) && typeof group === "object" && !Array.isArray(group))
          .filter((group) => group.status === "completed" && typeof group.id === "string")
          .sort((left, right) => Number(left.ordinal ?? 0) - Number(right.ordinal ?? 0))
        : [];
      const bridgeCheckpointHeads: Record<string, string> = {};
      for (const [index, group] of groups.entries()) {
        const prior = groups[index - 1];
        const head = typeof prior?.commitRevision === "string"
          ? prior.commitRevision
          : typeof state.baselineRevision === "string" ? state.baselineRevision : null;
        if (head) bridgeCheckpointHeads[group.id as string] = head;
      }
      contexts.push({
        changeName: state.changeName,
        runId: state.runId,
        phase: state.phase,
        stateRevision: state.stateRevision as number,
        currentGroupId: typeof state.currentGroupId === "string" ? state.currentGroupId : null,
        completedGroupIds: groups.map((group) => group.id as string),
        bridgeCheckpointHeads,
        headRevision: runHeadRevision(state),
        nextAction: nextRunAction(state.phase),
      });
    } catch {
      contexts.push({
        changeName: entry.name,
        runId: "unreadable",
        phase: "corrupted",
        stateRevision: -1,
        currentGroupId: null,
        headRevision: null,
        nextAction: "repair canonical Run Contract storage before continuing",
      });
    }
  }
  return contexts;
}

function runHeadRevision(state: Record<string, unknown>): string | null {
  if (typeof state.finalRevision === "string" && state.finalRevision.trim()) return state.finalRevision;
  if (state.groups && typeof state.groups === "object" && !Array.isArray(state.groups)) {
    const completed = Object.values(state.groups as Record<string, unknown>)
      .filter((group): group is Record<string, unknown> => Boolean(group) && typeof group === "object" && !Array.isArray(group))
      .filter((group) => typeof group.commitRevision === "string" && group.commitRevision.trim().length > 0)
      .sort((left, right) => Number(right.ordinal ?? 0) - Number(left.ordinal ?? 0));
    if (completed[0] && typeof completed[0].commitRevision === "string") return completed[0].commitRevision;
  }
  return typeof state.baselineRevision === "string" && state.baselineRevision.trim()
    ? state.baselineRevision
    : null;
}

function nextRunAction(phase: string): string {
  const actions: Record<string, string> = {
    planning_ready: "start Apply",
    applying: "continue the current Task Group",
    awaiting_verify: "run canonical Verify",
    awaiting_human_review: "request the human Review decision",
    awaiting_human_qa: "run Human QA",
    ready_for_archive: "run Archive",
    archiving: "resume the durable Archive intent",
    repair_required: "create the required implementation successor or RFC Amendment",
  };
  return actions[phase] ?? "inspect canonical lifecycle state";
}

function compareSessionBridge(
  projectRoot: string,
  runs: HookRunContractContext[],
): string[] {
  const path = resolve(projectRoot, "memory/session-bridge.md");
  if (!existsSync(path)) return ["memory/session-bridge.md is missing"];
  if (runs.length === 0) return [];
  const bridge = readFileSync(path, "utf8");
  const field = (label: string): string | null => {
    const match = bridge.match(new RegExp(`^- \\*\\*${label}\\*\\*: (.+)$`, "mu"));
    return match?.[1]?.trim() ?? null;
  };
  const checkpointChange = field("Change");
  const checkpointPhase = field("Phase at Checkpoint");
  const checkpointGroup = field("Task Group at Checkpoint");
  const checkpointRevision = field("Observed Run Revision");
  const checkpointHead = field("Last Verified HEAD");
  const drift: string[] = [];
  if (runs.length > 1) {
    drift.push(`bridge can point to one delivery, but ${runs.length} nonterminal Run Contracts exist`);
    return drift;
  }
  const live = runs[0]!;
  if (checkpointChange === null) drift.push("checkpoint Change is missing");
  else if (checkpointChange !== live.changeName) {
    drift.push(`checkpoint Change ${checkpointChange}; live Change ${live.changeName}`);
  }
  if (checkpointPhase === null) drift.push("checkpoint phase is missing");
  else if (checkpointPhase !== live.phase) {
    drift.push(`checkpoint phase ${checkpointPhase}; live phase ${live.phase}`);
  }
  const liveGroup = live.currentGroupId ?? "none";
  if (checkpointGroup === null) drift.push("checkpoint Task Group is missing");
  else if (checkpointGroup !== liveGroup && !live.completedGroupIds?.includes(checkpointGroup)) {
    drift.push(`checkpoint group ${checkpointGroup}; live group ${liveGroup}`);
  }
  if (checkpointRevision === null) drift.push("checkpoint revision is missing");
  else if (checkpointRevision !== String(live.stateRevision)) {
    drift.push(`checkpoint revision ${checkpointRevision}; live revision ${live.stateRevision}`);
  }
  const expectedCheckpointHead = checkpointRevision === String(live.stateRevision)
    && checkpointGroup
    ? live.bridgeCheckpointHeads?.[checkpointGroup] ?? live.headRevision
    : live.headRevision;
  const liveHead = expectedCheckpointHead ?? "none";
  if (checkpointHead === null) drift.push("checkpoint HEAD is missing");
  else if (checkpointHead !== liveHead) {
    drift.push(`checkpoint HEAD ${checkpointHead}; live HEAD ${liveHead}`);
  }
  return drift;
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
  config: OpenSpecConfig,
  dependencies: Pick<HookPlanningDependencies, "listWorktrees"> = {},
): string | null {
  const isolation = config.isolation;

  // No isolation = all writes allowed
  if (!isolation || isolation.mode === "none") {
    return null;
  }

  // Worktree isolation: writes must be inside the active worktree
  if (isolation.mode === "worktree") {
    const root = isolation.root ?? ".worktrees";
    let layout: HookGitWorktreeLayout;
    try {
      layout = discoverHookGitWorktrees(cwd, dependencies.listWorktrees);
    } catch (error) {
      return `Blocked: ${error instanceof Error ? error.message : String(error)}`;
    }
    const isolationRoot = resolve(layout.primaryRoot, root);
    const deliveryWorktrees = layout.worktrees.filter((worktree) =>
      worktree !== layout.primaryRoot && dirname(worktree) === isolationRoot
    );
    const currentDelivery = deliveryWorktrees.find((worktree) => worktree === layout.currentRoot);
    if (!currentDelivery) {
      return (
        `Blocked: The current Git worktree "${layout.currentRoot}" is not a registered delivery `
        + `worktree under "${root}". Enter the delivery worktree before writing.`
      );
    }

    const portablePath = /^[A-Za-z]:[\\/]|^\\\\/u.test(filePath)
      ? filePath
      : filePath.replaceAll("\\", "/");
    const absPath = isPortableAbsolute(portablePath)
      ? portablePath
      : resolve(cwd, portablePath);
    if (isPathInside(currentDelivery, absPath)) {
      return null;
    }

    const sibling = deliveryWorktrees.find((worktree) => isPathInside(worktree, absPath));
    if (sibling) {
      return (
        `Blocked: Write to "${filePath}" targets sibling worktree "${sibling}". `
        + `The active delivery worktree is "${currentDelivery}".`
      );
    }

    return (
      `Blocked: Write to "${filePath}" is outside the active delivery worktree `
      + `"${currentDelivery}" (primary isolation root "${root}").`
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

export function discoverHookGitWorktrees(
  cwd: string,
  listWorktrees: (cwd: string) => string[] = listGitWorktrees,
): HookGitWorktreeLayout {
  const worktrees = [...new Set(listWorktrees(cwd).map((path) => resolve(path)))];
  if (worktrees.length === 0) {
    throw new HookPlanningError(
      "Failed to discover Git worktrees: Git returned no registered worktrees",
      "worktree_discovery_failed",
    );
  }
  const resolvedCwd = resolve(cwd);
  const currentRoot = worktrees
    .filter((worktree) => isPathInside(worktree, resolvedCwd))
    .sort((left, right) => right.length - left.length || compareCodeUnits(left, right))[0];
  if (!currentRoot) {
    throw new HookPlanningError(
      `Failed to discover the registered Git worktree containing '${resolvedCwd}'`,
      "worktree_discovery_failed",
    );
  }
  return {
    primaryRoot: worktrees[0]!,
    currentRoot,
    worktrees,
  };
}

export function discoverHookProjectRoots(
  projectRoot: string,
  dependencies: Pick<HookPlanningDependencies, "listWorktrees"> = {},
): string[] {
  if (!dependencies.listWorktrees && !isInsideGitWorktree(projectRoot)) {
    return [resolve(projectRoot)];
  }
  return discoverHookGitWorktrees(projectRoot, dependencies.listWorktrees).worktrees
    .filter((worktree) => findConfigPath(worktree) !== null);
}

function isInsideGitWorktree(cwd: string): boolean {
  try {
    return execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() === "true";
  } catch {
    return false;
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
