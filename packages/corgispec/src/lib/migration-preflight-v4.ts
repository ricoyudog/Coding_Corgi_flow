import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";

import { createOpenSpecAdapter } from "./openspec-adapter.js";

export interface MigrationWorktreeBlockersV4 {
  worktrees: string[];
  changes: string[];
  runs: string[];
}

export interface MigrationPreflightV4Dependencies {
  listChanges?: (worktree: string) => Promise<string[]>;
}

const ACTIVE_V2 = new Set([
  "awaiting_group_result",
  "awaiting_evaluation",
  "fixing",
  "awaiting_group_commit",
  "awaiting_tracker_sync",
  "awaiting_finalize",
]);

const ACTIVE_V3 = new Set([
  "planning_ready",
  "applying",
  "awaiting_verify",
  "awaiting_human_review",
  "awaiting_human_qa",
  "ready_for_archive",
  "archiving",
]);

export async function inspectMigrationWorktreesV4(
  target: string,
  executable: string,
  dependencies: MigrationPreflightV4Dependencies = {},
): Promise<MigrationWorktreeBlockersV4> {
  const root = resolve(target);
  const worktrees = listRepositoryWorktrees(root);
  const listChanges = dependencies.listChanges ?? (async (worktree: string) => {
    if (!existsSync(resolve(worktree, "openspec/config.yaml"))) return [];
    const result = await createOpenSpecAdapter(worktree, undefined, {
      executable,
      verifyRuntime: false,
    }).listChanges();
    return result.changes.map((change) => change.name);
  });
  const changes: string[] = [];
  const runs: string[] = [];
  for (const worktree of worktrees) {
    const label = worktreeLabel(root, worktree);
    for (const change of await listChanges(worktree)) changes.push(`${label}:${change}`);
    for (const run of activeRuns(worktree)) runs.push(`${label}:${run}`);
  }
  return {
    worktrees,
    changes: changes.sort(),
    runs: runs.sort(),
  };
}

export function listRepositoryWorktrees(target: string): string[] {
  const root = resolve(target);
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) return [root];
  const paths = result.stdout.split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => resolve(line.slice("worktree ".length)));
  return [...new Set(paths.length > 0 ? paths : [root])];
}

function activeRuns(worktree: string): string[] {
  const loopRoot = resolve(worktree, ".corgi", "loop");
  if (!existsSync(loopRoot)) return [];
  const result: string[] = [];
  const visit = (directory: string): void => {
    if (lstatSync(directory).isSymbolicLink()) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (!entry.isFile() || entry.name !== "state.json") continue;
      try {
        const state = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        const schema = Number(state.schemaVersion);
        const phase = String(state.phase ?? "");
        if ((schema === 2 && ACTIVE_V2.has(phase)) || (schema === 3 && ACTIVE_V3.has(phase))) {
          result.push(`${String(state.changeName ?? "unknown")}/${String(state.runId ?? "unknown")}/v${schema}`);
        }
      } catch {
        result.push(`corrupt:${relative(worktree, path).replace(/\\/gu, "/")}`);
      }
    }
  };
  visit(loopRoot);
  return result;
}

function worktreeLabel(target: string, worktree: string): string {
  if (resolve(target) === resolve(worktree)) return ".";
  const rel = relative(target, worktree).replace(/\\/gu, "/");
  return rel && !rel.startsWith("../") ? rel : worktree.replace(/\\/gu, "/");
}
