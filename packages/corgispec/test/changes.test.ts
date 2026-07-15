import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  assertNoAmbiguousChanges,
  discoverAllChanges,
  discoverChanges,
  findNextTaskGroup,
  parseTaskGroups,
} from "../src/lib/changes.js";

describe("change worktree enrichment", () => {
  let root: string;

  beforeEach(() => {
    root = resolve(tmpdir(), `corgispec-changes-${Date.now()}-${Math.random()}`);
    mkdirSync(resolve(root, "openspec"), { recursive: true });
    writeFileSync(resolve(root, "openspec/config.yaml"), "schema: custom\n");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("discovers only local change directories for legacy hooks", () => {
    mkdirSync(resolve(root, "openspec/changes/b-change"), { recursive: true });
    mkdirSync(resolve(root, "openspec/changes/a-change"), { recursive: true });
    writeFileSync(resolve(root, "openspec/changes/README.md"), "ignored");
    expect(discoverChanges(root)).toEqual(["a-change", "b-change"]);
    expect(discoverAllChanges(root)).toEqual([
      { name: "a-change", path: root },
      { name: "b-change", path: root },
    ]);
  });

  it("returns an empty list before changes exist", () => {
    expect(discoverChanges(root)).toEqual([]);
  });

  it("fails instead of choosing the first duplicate worktree change", () => {
    expect(() => assertNoAmbiguousChanges([
      { name: "duplicate", path: "/repo/a" },
      { name: "other", path: "/repo/b" },
      { name: "duplicate", path: "/repo/c" },
    ])).toThrow("Change 'duplicate' is ambiguous across worktrees: /repo/a, /repo/c");
  });
});
describe("task-group compatibility wrappers", () => {
  it("delegates parsing and next-group selection to the canonical parser", () => {
    const groups = parseTaskGroups([
      "## 1. Done",
      "- [x] 1.1 complete",
      "",
      "## 2. Next",
      "- [ ] 2.1 pending",
      "",
    ].join("\n"));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ number: 1, status: "done", completedTasks: 1 });
    expect(findNextTaskGroup(groups)).toMatchObject({ number: 2, status: "pending" });
  });

  it("returns no groups for non-task Markdown", () => {
    expect(parseTaskGroups("# Notes\nNothing actionable")).toEqual([]);
    expect(findNextTaskGroup([])).toBeNull();
  });
});

describe("real Git worktree ambiguity", () => {
  it("fails closed when the same change exists in two registered worktrees", () => {
    const parent = mkdtempSync(resolve(tmpdir(), "corgispec-worktree-ambiguity-"));
    const repo = resolve(parent, "repo");
    const secondary = resolve(parent, "secondary");
    mkdirSync(resolve(repo, "openspec/changes/duplicate"), { recursive: true });
    writeFileSync(
      resolve(repo, "openspec/config.yaml"),
      "schema: custom\nisolation:\n  mode: worktree\n",
    );
    writeFileSync(resolve(repo, "README.md"), "fixture\n");

    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, stdio: "pipe", encoding: "utf8" });
    try {
      git("init");
      git("config", "user.email", "tests@corgispec.invalid");
      git("config", "user.name", "CorgiSpec Tests");
      git("add", ".");
      git("commit", "-m", "fixture");
      git("branch", "secondary");
      git("worktree", "add", secondary, "secondary");
      mkdirSync(resolve(secondary, "openspec/changes/duplicate"), { recursive: true });

      expect(() => discoverAllChanges(repo)).toThrow(
        "Change 'duplicate' is ambiguous across worktrees",
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
