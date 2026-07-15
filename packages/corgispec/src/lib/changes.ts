import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadConfigFromDir } from "./config.js";
import {
  findNextTaskGroup as findParsedNextTaskGroup,
  parseTaskGroupsDocument,
  type ParsedTaskGroup,
} from "./task-groups.js";

/** @deprecated Prefer ParsedTaskGroup from task-groups.ts. */
export type TaskGroup = ParsedTaskGroup;

export interface DiscoveredChange {
  name: string;
  /** Worktree root used only as Corgi isolation metadata. */
  path: string;
}
export class ChangeAmbiguityError extends Error {
  constructor(
    public readonly changeName: string,
    public readonly worktreePaths: string[],
  ) {
    super(`Change '${changeName}' is ambiguous across worktrees: ${worktreePaths.join(", ")}`);
    this.name = "ChangeAmbiguityError";
  }
}

/**
 * Legacy hook discovery only. Lifecycle commands use OpenSpecAdapter list/status
 * so this function must never be used as artifact or schema truth.
 */
export function discoverChanges(cwd: string): string[] {
  const changesDir = resolve(cwd, "openspec/changes");
  if (!existsSync(changesDir)) return [];
  return readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Enrich change names with worktree ownership and fail on duplicate ownership. */
export function discoverAllChanges(cwd: string): DiscoveredChange[] {
  let isolationMode: "worktree" | "none" = "none";
  try {
    isolationMode = loadConfigFromDir(cwd).isolation?.mode ?? "none";
  } catch {
    // Legacy hooks may run before config initialization.
  }

  if (isolationMode !== "worktree") {
    return discoverChanges(cwd).map((name) => ({ name, path: cwd }));
  }

  const changes = gitWorktreePaths(cwd).flatMap((worktreePath) =>
    discoverChanges(worktreePath).map((name) => ({ name, path: worktreePath })),
  );
  assertNoAmbiguousChanges(changes);
  return changes;
}

export function assertNoAmbiguousChanges(changes: DiscoveredChange[]): void {
  const byName = new Map<string, string[]>();
  for (const change of changes) {
    const paths = byName.get(change.name) ?? [];
    paths.push(change.path);
    byName.set(change.name, paths);
  }
  for (const [name, paths] of byName) {
    if (paths.length > 1) throw new ChangeAmbiguityError(name, paths);
  }
}

/** Compatibility wrapper backed by the canonical parser. */
export function parseTaskGroups(content: string): TaskGroup[] {
  return parseTaskGroupsDocument(content).groups;
}

/** Compatibility wrapper backed by the canonical parser. */
export function findNextTaskGroup(taskGroups: TaskGroup[]): TaskGroup | null {
  return findParsedNextTaskGroup(taskGroups);
}

function gitWorktreePaths(cwd: string): string[] {
  try {
    const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
      cwd,
      encoding: "utf8",
      timeout: 5_000,
    });
    if (result.error || result.status !== 0) return [];
    return result.stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length));
  } catch {
    return [];
  }
}
