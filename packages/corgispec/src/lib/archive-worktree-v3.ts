import { spawnSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";

import { loadConfigFromDir } from "./config.js";

export interface ArchiveWorktreeCleanupV3 {
  removed: boolean;
  worktree: string;
  branch: string | null;
  reason: "removed" | "isolation-none" | "primary-worktree";
}

export class ArchiveWorktreeV3Error extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "ArchiveWorktreeV3Error";
  }
}

export function cleanupArchivedWorktreeV3(projectRoot: string): ArchiveWorktreeCleanupV3 {
  const root = resolve(projectRoot);
  const config = loadConfigFromDir(root);
  if (config.isolation?.mode !== "worktree") {
    return { removed: false, worktree: root, branch: currentBranch(root), reason: "isolation-none" };
  }
  const entries = parseWorktreeList(runGit(root, ["worktree", "list", "--porcelain"]));
  const current = entries.find((entry) => resolve(entry.path) === root);
  if (!current) {
    throw new ArchiveWorktreeV3Error("Current repository root is not a registered Git worktree", "ARCHIVE_WORKTREE_UNKNOWN");
  }
  const primary = entries[0];
  if (!primary || resolve(primary.path) === root) {
    return { removed: false, worktree: root, branch: current.branch, reason: "primary-worktree" };
  }
  const isolationRoot = resolve(primary.path, config.isolation.root ?? ".worktrees");
  const rel = relative(isolationRoot, root);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new ArchiveWorktreeV3Error(
      `Refusing to remove worktree outside configured isolation root '${isolationRoot}'`,
      "ARCHIVE_WORKTREE_OUTSIDE_ISOLATION",
    );
  }
  const status = runGit(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude).corgi/**",
  ]);
  if (status.trim()) {
    throw new ArchiveWorktreeV3Error(
      `Archive worktree still contains non-Corgi changes:\n${status}`,
      "ARCHIVE_WORKTREE_DIRTY",
    );
  }
  runGit(primary.path, ["worktree", "remove", root]);
  return { removed: true, worktree: root, branch: current.branch, reason: "removed" };
}

function currentBranch(root: string): string | null {
  const branch = runGit(root, ["branch", "--show-current"], true);
  return branch || null;
}

function parseWorktreeList(content: string): Array<{ path: string; branch: string | null }> {
  return content.trim().split(/\n\n+/u).filter(Boolean).map((block) => {
    const fields = new Map(block.split("\n").map((line) => {
      const separator = line.indexOf(" ");
      return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
    const path = fields.get("worktree");
    if (!path) throw new ArchiveWorktreeV3Error("Malformed git worktree list output", "ARCHIVE_WORKTREE_INVALID");
    const branch = fields.get("branch")?.replace(/^refs\/heads\//u, "") || null;
    return { path, branch };
  });
}

function runGit(root: string, args: string[], allowFailure = false): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    if (allowFailure) return "";
    throw new ArchiveWorktreeV3Error(
      result.stderr.trim() || `git ${args[0] ?? "command"} failed`,
      "ARCHIVE_WORKTREE_GIT_FAILED",
    );
  }
  return result.stdout.trimEnd();
}
