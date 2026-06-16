import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfigFromDir, type OpenSpecConfig } from "./config.js";
import yaml from "js-yaml";

// ─── Types ──────────────────────────────────────────────────────────────

export interface SchemaArtifact {
  id: string;
  generates: string;
  description: string;
  template: string;
  instruction: string;
  requires: string[];
}

export interface SchemaApply {
  requires: string[];
  tracks: string;
  instruction: string;
}

export interface WorkflowSchema {
  name: string;
  version: number;
  description: string;
  artifacts: SchemaArtifact[];
  apply: SchemaApply;
}

export interface ArtifactStatus {
  id: string;
  description: string;
  generates: string;
  exists: boolean;
  ready: boolean;
  blocked: boolean;
  blockedBy: string[];
}

export interface TaskGroup {
  number: number;
  name: string;
  tasks: Array<{ id: string; description: string; done: boolean }>;
  totalTasks: number;
  completedTasks: number;
  status: "done" | "in_progress" | "pending";
}

export type ChangeState =
  | "empty"
  | "proposing"
  | "specifying"
  | "designing"
  | "tasking"
  | "applying"
  | "all_done"
  | "blocked";

export interface ChangeInfo {
  name: string;
  directory: string;
  state: ChangeState;
  schemaName: string;
  artifacts: ArtifactStatus[];
  taskGroups: TaskGroup[];
  completedTasks: number;
  totalTasks: number;
  isComplete: boolean;
  lastModified: string;
}

// ─── Schema Loading ─────────────────────────────────────────────────────

/**
 * Validate that a parsed schema has the required shape before casting.
 * Throws a descriptive Error on failure.
 */
export function validateSchemaShape(data: unknown): void {
  if (!data || typeof data !== "object") {
    throw new Error("Schema file is not a valid YAML/JSON object");
  }

  const obj = data as Record<string, unknown>;

  if (!obj.name || typeof obj.name !== "string") {
    throw new Error("Schema missing required 'name' field (must be a string)");
  }

  if (obj.version == null || typeof obj.version !== "number") {
    throw new Error("Schema missing required 'version' field (must be a number)");
  }

  if (!Array.isArray(obj.artifacts)) {
    throw new Error("Schema missing required 'artifacts' field (must be an array)");
  }
}

/**
 * Load the active workflow schema based on config.yaml.
 */
export function loadWorkflowSchema(cwd: string): WorkflowSchema {
  const config = loadConfigFromDir(cwd);
  const schemaName = config.schema;
  const schemaPath = resolve(cwd, "openspec/schemas", schemaName, "schema.yaml");

  if (!existsSync(schemaPath)) {
    throw new Error(
      `Schema '${schemaName}' not found at ${schemaPath}. Check openspec/config.yaml.`
    );
  }

  const raw = readFileSync(schemaPath, "utf-8");
  const parsed = yaml.load(raw);
  validateSchemaShape(parsed);
  const schema = parsed as WorkflowSchema;

  // Ensure all artifacts have requires array
  for (const artifact of schema.artifacts) {
    if (!artifact.requires) {
      artifact.requires = [];
    }
  }

  return schema;
}

/**
 * Load a template file for a given artifact.
 */
export function loadTemplate(cwd: string, schemaName: string, templateFile: string): string {
  const templatePath = resolve(
    cwd,
    "openspec/schemas",
    schemaName,
    "templates",
    templateFile
  );

  if (!existsSync(templatePath)) {
    return "";
  }

  return readFileSync(templatePath, "utf-8");
}

// ─── Change Discovery ───────────────────────────────────────────────────

/**
 * Discover all active changes in openspec/changes/ at a given directory.
 */
export function discoverChanges(cwd: string): string[] {
  const changesDir = resolve(cwd, "openspec/changes");
  if (!existsSync(changesDir)) {
    return [];
  }

  return readdirSync(changesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

// ─── Worktree Discovery ──────────────────────────────────────────────────

/**
 * A change discovered in a specific worktree (or main repo).
 */
export interface DiscoveredChange {
  /** Change directory name */
  name: string;
  /** Absolute path to the worktree (or main repo) containing this change */
  path: string;
}

/**
 * Run `git worktree list --porcelain` from cwd and return all worktree paths.
 * Returns empty array if git is unavailable or the command fails.
 */
function getGitWorktreePaths(cwd: string): string[] {
  try {
    const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result.error || result.status !== 0) {
      return [];
    }
    const paths: string[] = [];
    for (const line of result.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        paths.push(line.slice("worktree ".length));
      }
    }
    return paths;
  } catch {
    return [];
  }
}

/**
 * Discover all active changes across all worktrees (when isolation mode is "worktree")
 * or only from the current working directory (when isolation mode is "none" or not configured).
 *
 * Uses `git worktree list --porcelain` to find all worktree directories,
 * then scans each for `openspec/changes/` subdirectories.
 */
export function discoverAllChanges(cwd: string): DiscoveredChange[] {
  // Check if worktree isolation is configured
  let config: OpenSpecConfig | null = null;
  try {
    config = loadConfigFromDir(cwd);
  } catch {
    // No config — fall through to cwd-only scan
  }

  if (config?.isolation?.mode === "worktree") {
    const worktreePaths = getGitWorktreePaths(cwd);
    const seen = new Set<string>();
    const allChanges: DiscoveredChange[] = [];

    for (const wtPath of worktreePaths) {
      const changesDir = resolve(wtPath, "openspec/changes");
      if (!existsSync(changesDir)) continue;

      const entries = readdirSync(changesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        // Deduplicate by change name (prefer first occurrence)
        if (seen.has(entry.name)) continue;
        seen.add(entry.name);
        allChanges.push({ name: entry.name, path: wtPath });
      }
    }

    return allChanges;
  }

  // Non-worktree mode: scan only the current working directory
  const changesDir = resolve(cwd, "openspec/changes");
  if (!existsSync(changesDir)) return [];

  return readdirSync(changesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, path: cwd }));
}

/**
 * Check if an artifact file exists for a given change.
 */
function artifactExists(changeDir: string, generates: string): boolean {
  if (generates.includes("*")) {
    // Glob pattern like "specs/**/*.md" — check if directory has any files
    const baseDir = generates.split("/")[0]!;
    const dir = resolve(changeDir, baseDir);
    if (!existsSync(dir)) return false;

    // Recursively check for .md files
    return hasMarkdownFiles(dir);
  }

  return existsSync(resolve(changeDir, generates));
}

function hasMarkdownFiles(dir: string): boolean {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) return true;
    if (entry.isDirectory()) {
      if (hasMarkdownFiles(resolve(dir, entry.name))) return true;
    }
  }
  return false;
}

// ─── Task Group Parsing ─────────────────────────────────────────────────

/**
 * Parse task groups from tasks.md content.
 */
export function parseTaskGroups(content: string): TaskGroup[] {
  const groups: TaskGroup[] = [];
  const lines = content.split("\n");
  let currentGroup: TaskGroup | null = null;

  for (const line of lines) {
    // Match ## N. Group Name
    const headingMatch = line.match(/^## (\d+)\.\s+(.+)/);
    if (headingMatch) {
      if (currentGroup) {
        finalizeGroup(currentGroup);
        groups.push(currentGroup);
      }
      currentGroup = {
        number: parseInt(headingMatch[1]!, 10),
        name: headingMatch[2]!.trim(),
        tasks: [],
        totalTasks: 0,
        completedTasks: 0,
        status: "pending",
      };
      continue;
    }

    // Match task items: - [ ] or - [x]
    if (currentGroup) {
      const taskMatch = line.match(/^\s*- \[([ x])\]\s+([\d.]+)\s+(.*)/);
      if (taskMatch) {
        const done = taskMatch[1] === "x";
        currentGroup.tasks.push({
          id: taskMatch[2]!,
          description: taskMatch[3]!.trim(),
          done,
        });
      }
    }
  }

  if (currentGroup) {
    finalizeGroup(currentGroup);
    groups.push(currentGroup);
  }

  return groups;
}

function finalizeGroup(group: TaskGroup): void {
  group.totalTasks = group.tasks.length;
  group.completedTasks = group.tasks.filter((t) => t.done).length;

  if (group.completedTasks === group.totalTasks && group.totalTasks > 0) {
    group.status = "done";
  } else if (group.completedTasks > 0) {
    group.status = "in_progress";
  } else {
    group.status = "pending";
  }
}

// ─── Change Status ──────────────────────────────────────────────────────

/**
 * Get full status information for a specific change.
 */
export function getChangeInfo(cwd: string, changeName: string): ChangeInfo {
  const changeDir = resolve(cwd, "openspec/changes", changeName);
  if (!existsSync(changeDir)) {
    throw new Error(`Change '${changeName}' not found at ${changeDir}`);
  }

  const schema = loadWorkflowSchema(cwd);

  // Determine artifact statuses
  const artifactStatuses: ArtifactStatus[] = [];
  const completedArtifacts = new Set<string>();

  for (const artifact of schema.artifacts) {
    const exists = artifactExists(changeDir, artifact.generates);
    if (exists) completedArtifacts.add(artifact.id);
  }

  for (const artifact of schema.artifacts) {
    const exists = completedArtifacts.has(artifact.id);
    const blockedBy = artifact.requires.filter(
      (dep) => !completedArtifacts.has(dep)
    );
    const blocked = blockedBy.length > 0;
    const ready = !exists && !blocked;

    artifactStatuses.push({
      id: artifact.id,
      description: artifact.description,
      generates: artifact.generates,
      exists,
      ready,
      blocked,
      blockedBy,
    });
  }

  // Parse task groups
  const tasksPath = resolve(changeDir, "tasks.md");
  let taskGroups: TaskGroup[] = [];
  let completedTasks = 0;
  let totalTasks = 0;

  if (existsSync(tasksPath)) {
    const content = readFileSync(tasksPath, "utf-8");
    taskGroups = parseTaskGroups(content);
    for (const g of taskGroups) {
      completedTasks += g.completedTasks;
      totalTasks += g.totalTasks;
    }
  }

  // Determine state
  const state = determineState(artifactStatuses, taskGroups, completedArtifacts);

  // Last modified
  const stat = statSync(changeDir);

  return {
    name: changeName,
    directory: changeDir,
    state,
    schemaName: schema.name,
    artifacts: artifactStatuses,
    taskGroups,
    completedTasks,
    totalTasks,
    isComplete: totalTasks > 0 && completedTasks === totalTasks,
    lastModified: stat.mtime.toISOString(),
  };
}

function determineState(
  artifacts: ArtifactStatus[],
  taskGroups: TaskGroup[],
  completedArtifacts: Set<string>
): ChangeState {
  // If no artifacts exist at all
  if (completedArtifacts.size === 0) return "empty";

  // If tasks exist and all done
  if (
    completedArtifacts.has("tasks") &&
    taskGroups.length > 0 &&
    taskGroups.every((g) => g.status === "done")
  ) {
    return "all_done";
  }

  // If tasks exist, we're in apply phase
  if (completedArtifacts.has("tasks")) return "applying";

  // Check which artifact we're working on
  if (!completedArtifacts.has("proposal")) return "proposing";
  if (!completedArtifacts.has("specs")) return "specifying";
  if (!completedArtifacts.has("design")) return "designing";
  if (!completedArtifacts.has("tasks")) return "tasking";

  return "applying";
}

/**
 * Find the next task group to work on (first with pending tasks).
 */
export function findNextTaskGroup(taskGroups: TaskGroup[]): TaskGroup | null {
  return taskGroups.find((g) => g.status !== "done") ?? null;
}
