import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inspectMigrationWorktreesV4 } from "../src/lib/migration-preflight-v4.js";

describe("v4 migration worktree preflight", () => {
  let root = "";

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("finds active Changes and Run Contracts in sibling worktrees", async () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-migration-worktrees-"));
    writeFileSync(resolve(root, "README.md"), "# Project\n");
    git(root, ["init", "-b", "main"]);
    git(root, ["config", "user.email", "human@example.test"]);
    git(root, ["config", "user.name", "Human Reviewer"]);
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "base"]);
    const sibling = resolve(root, ".worktrees/feature-a");
    mkdirSync(resolve(root, ".worktrees"), { recursive: true });
    git(root, ["worktree", "add", "-b", "feature/a", sibling]);
    const runRoot = resolve(sibling, ".corgi/loop/change-a/runs/run-a");
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(resolve(runRoot, "state.json"), `${JSON.stringify({
      schemaVersion: 2,
      phase: "awaiting_group_result",
      changeName: "change-a",
      runId: "run-a",
    })}\n`);

    const result = await inspectMigrationWorktreesV4(root, "openspec", {
      listChanges: async (worktree) => worktree === sibling ? ["change-a"] : [],
    });

    expect(result.worktrees).toContain(sibling);
    expect(result.changes).toEqual([".worktrees/feature-a:change-a"]);
    expect(result.runs).toEqual([".worktrees/feature-a:change-a/run-a/v2"]);
  });
});

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
