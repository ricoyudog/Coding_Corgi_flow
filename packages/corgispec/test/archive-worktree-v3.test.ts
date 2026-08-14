import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { cleanupArchivedWorktreeV3 } from "../src/lib/archive-worktree-v3.js";

describe("Archive v3 worktree cleanup", () => {
  let root = "";

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("removes only the clean configured linked worktree and preserves its branch", () => {
    const setup = linkedWorktree();
    mkdirSync(resolve(setup.worktree, ".corgi/loop/change-a"), { recursive: true });
    writeFileSync(resolve(setup.worktree, ".corgi/loop/change-a/state.json"), "{}\n");

    const result = cleanupArchivedWorktreeV3(setup.worktree);

    expect(result).toMatchObject({ removed: true, branch: "feature/archive-a", reason: "removed" });
    expect(existsSync(setup.worktree)).toBe(false);
    expect(git(root, ["branch", "--list", "feature/archive-a"])).toContain("feature/archive-a");
  });

  it("refuses cleanup when unrelated work remains", () => {
    const setup = linkedWorktree();
    writeFileSync(resolve(setup.worktree, "user-notes.txt"), "keep me\n");

    expect(() => cleanupArchivedWorktreeV3(setup.worktree)).toThrowError(
      expect.objectContaining({ code: "ARCHIVE_WORKTREE_DIRTY" }),
    );
    expect(existsSync(resolve(setup.worktree, "user-notes.txt"))).toBe(true);
  });

  function linkedWorktree(): { worktree: string } {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-archive-worktree-"));
    mkdirSync(resolve(root, "openspec"), { recursive: true });
    writeFileSync(resolve(root, "openspec/config.yaml"), [
      "schema: custom",
      "isolation:",
      "  mode: worktree",
      "  root: .worktrees",
      "",
    ].join("\n"));
    writeFileSync(resolve(root, ".gitignore"), ".corgi/\n");
    git(root, ["init", "-b", "main"]);
    git(root, ["config", "user.email", "human@example.test"]);
    git(root, ["config", "user.name", "Human Reviewer"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);
    const worktree = resolve(root, ".worktrees/archive-a");
    mkdirSync(resolve(root, ".worktrees"), { recursive: true });
    git(root, ["worktree", "add", "-b", "feature/archive-a", worktree]);
    return { worktree };
  }
});

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
