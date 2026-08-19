import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireWorkflowLock,
  advanceProposeIntent,
  loadProposeIntent,
  releaseWorkflowLock,
  writeProposeIntent,
  type ProposeIntent,
} from "../src/lib/workflow-intent.js";

describe("durable propose intent", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("persists an idempotent recovery checkpoint", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-intent-"));
    const intent: ProposeIntent = {
      schemaVersion: 1,
      operation: "propose",
      key: "a".repeat(64),
      deliveryRef: "RFC-0002-export/S-01-csv",
      changeName: "export-csv",
      headRevision: "deadbeef",
      stage: "prepared",
      updatedAt: new Date(0).toISOString(),
    };
    writeProposeIntent(root, intent);
    const advanced = advanceProposeIntent(root, intent, {
      stage: "tracker_sync_pending",
      issue: { id: "7", url: "https://example.test/issues/7" },
    });
    expect(loadProposeIntent(root, intent.key)).toEqual(advanced);
  });

  it("fails closed for a corrupt intent", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-intent-"));
    expect(() => loadProposeIntent(root, "bad")).toThrowError(
      expect.objectContaining({ code: "INTENT_INVALID_KEY" }),
    );
  });

  it("serializes the same workflow resource across CLI processes", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-intent-"));
    const first = acquireWorkflowLock(root, "propose:slice-a");
    expect(() => acquireWorkflowLock(root, "propose:slice-a")).toThrowError(
      expect.objectContaining({ code: "WORKFLOW_LOCKED" }),
    );
    const independent = acquireWorkflowLock(root, "propose:slice-b");
    releaseWorkflowLock(independent);
    releaseWorkflowLock(first);
    const recovered = acquireWorkflowLock(root, "propose:slice-a");
    releaseWorkflowLock(recovered);
  });

  it("shares locks across worktrees through the Git common directory", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-intent-git-"));
    const repository = resolve(root, "repository");
    const worktree = resolve(root, "worktree");
    mkdirSync(repository);
    const git = (cwd: string, args: string[]) =>
      execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
    git(repository, ["init", "-b", "main"]);
    git(repository, ["config", "user.email", "corgi@example.test"]);
    git(repository, ["config", "user.name", "Coding Corgi"]);
    writeFileSync(resolve(repository, "README.md"), "base\n");
    git(repository, ["add", "README.md"]);
    git(repository, ["commit", "-m", "base"]);
    git(repository, ["worktree", "add", "-b", "lock-test", worktree]);

    const held = acquireWorkflowLock(repository, "rfc-delivery:RFC-0002-example");
    expect(() => acquireWorkflowLock(worktree, "rfc-delivery:RFC-0002-example"))
      .toThrowError(expect.objectContaining({ code: "WORKFLOW_LOCKED" }));
    releaseWorkflowLock(held);
    const recovered = acquireWorkflowLock(worktree, "rfc-delivery:RFC-0002-example");
    releaseWorkflowLock(recovered);
  });
});
