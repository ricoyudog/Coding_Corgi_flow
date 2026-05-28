import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { execSync } from "node:child_process";
import type { OpenSpecConfig } from "./config.js";
import { findConfigPath, loadConfig } from "./config.js";

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

export interface HookInput {
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    command?: string;
  };
  stop_reason?: string;
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
export function gatherSessionContext(cwd: string): SessionContext | null {
  const configPath = findConfigPath(cwd);
  if (!configPath) return null;

  let config: OpenSpecConfig;
  try {
    config = loadConfig(configPath);
  } catch {
    return null;
  }

  const isolationMode = config.isolation?.mode ?? "none";
  const activeChanges = scanActiveChanges(cwd, config);
  const currentBranch = getCurrentBranch();
  const worktreePath = resolveWorktreePath(cwd, config, currentBranch);

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
 * Scan openspec/changes/ for active change directories.
 */
export function scanActiveChanges(
  cwd: string,
  config: OpenSpecConfig
): ActiveChange[] {
  const changesDir = resolve(cwd, "openspec/changes");
  if (!existsSync(changesDir)) return [];

  const entries = readdirSync(changesDir, { withFileTypes: true });
  const changes: ActiveChange[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const changeName = entry.name;
    const worktreePath = resolveChangeWorktree(cwd, config, changeName);
    const currentGroup = resolveCurrentGroup(cwd, changeName);

    changes.push({
      name: changeName,
      worktreePath,
      currentGroup,
    });
  }

  return changes;
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
  cwd: string,
  changeName: string
): string[] | null {
  const tasksPath = resolve(cwd, "openspec/changes", changeName, "tasks.md");
  if (!existsSync(tasksPath)) return null;

  const content = readFileSync(tasksPath, "utf-8");
  const lines = content.split("\n");

  // Find the first group with incomplete tasks
  let inCurrentGroup = false;
  let currentGroupName = "";
  const incompleteTasks: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^## (\d+)\.\s+(.+)/);
    if (headingMatch) {
      // If we were in a group and found a new heading, stop
      if (inCurrentGroup && incompleteTasks.length === 0) {
        break;
      }
      if (inCurrentGroup) {
        break;
      }
      currentGroupName = headingMatch[2]!.trim();
      inCurrentGroup = true;
      incompleteTasks.length = 0;
      continue;
    }

    if (inCurrentGroup) {
      const taskMatch = line.match(/^\s*- \[ \]\s+(.*)/);
      if (taskMatch) {
        incompleteTasks.push(taskMatch[1]!.trim());
      }
    }
  }

  if (incompleteTasks.length > 0) {
    return [
      `Incomplete tasks in "${currentGroupName}":`,
      ...incompleteTasks.map((t) => `  - ${t}`),
    ];
  }

  return null;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getCurrentBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "(unknown)";
  }
}

function resolveWorktreePath(
  cwd: string,
  config: OpenSpecConfig,
  branch: string
): string {
  if (!config.isolation || config.isolation.mode === "none") {
    return "N/A";
  }
  const root = config.isolation.root ?? ".worktrees";
  // Try to match branch to worktree
  const prefix = config.isolation.branch_prefix ?? "feat/";
  const changeName = branch.startsWith(prefix)
    ? branch.slice(prefix.length)
    : branch;
  const wtPath = resolve(cwd, root, changeName);
  if (existsSync(wtPath)) {
    return relative(cwd, wtPath) || wtPath;
  }
  return "N/A";
}

function resolveChangeWorktree(
  cwd: string,
  config: OpenSpecConfig,
  changeName: string
): string | null {
  if (!config.isolation || config.isolation.mode === "none") {
    return null;
  }
  const root = config.isolation.root ?? ".worktrees";
  const wtPath = resolve(cwd, root, changeName);
  if (existsSync(wtPath)) {
    return relative(cwd, wtPath) || wtPath;
  }
  return null;
}

function resolveCurrentGroup(cwd: string, changeName: string): string | null {
  const tasksPath = resolve(cwd, "openspec/changes", changeName, "tasks.md");
  if (!existsSync(tasksPath)) return null;

  const content = readFileSync(tasksPath, "utf-8");
  const lines = content.split("\n");

  let inGroup = false;
  let groupName = "";
  let groupNum = "";

  for (const line of lines) {
    const headingMatch = line.match(/^## (\d+)\.\s+(.+)/);
    if (headingMatch) {
      groupNum = headingMatch[1]!;
      groupName = headingMatch[2]!.trim();
      inGroup = true;
      continue;
    }

    if (inGroup) {
      const taskMatch = line.match(/^\s*- \[ \]\s+/);
      if (taskMatch) {
        return `Group ${groupNum} in-progress`;
      }
      // If we hit a new heading without finding unchecked tasks, this group is done
      if (line.match(/^## /)) {
        inGroup = false;
      }
    }
  }

  // If all groups are done
  if (groupName) {
    return "all groups done";
  }

  return null;
}
