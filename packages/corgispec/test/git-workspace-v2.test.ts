import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitWorkspaceError,
  createGitWorkspaceV2,
} from "../src/lib/git-workspace-v2.js";
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "../src/lib/openspec-runtime.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const root of cleanup.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repo(label: string): string {
  const root = resolve(
    tmpdir(),
    `corgispec-git-v2-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  cleanup.push(root);
  mkdirSync(root, { recursive: true });
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "corgi@example.test");
  git(root, "config", "user.name", "Corgi Test");
  writeFileSync(resolve(root, "README.md"), "baseline\n");
  git(root, "add", "README.md");
  git(root, "commit", "-m", "baseline");
  return root;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

describe("GitWorkspaceV2", () => {
  it("captures a clean snapshot whose workspace and commit tree fingerprints match", async () => {
    const root = repo("snapshot");
    const workspace = createGitWorkspaceV2(root);

    const snapshot = await workspace.snapshot();

    expect(snapshot.clean).toBe(true);
    expect(snapshot.headRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.treeRevision).toMatch(/^[0-9a-f]{40}$/);
    expect(snapshot.workspaceFingerprint).toBe(await workspace.commitTreeFingerprint());
  });

  it("acknowledges only a clean descendant commit matching the evaluated workspace", async () => {
    const root = repo("ack");
    const workspace = createGitWorkspaceV2(root);
    const baselineRevision = await workspace.headRevision();
    writeFileSync(resolve(root, "README.md"), "implemented\n");
    writeFileSync(resolve(root, "new file.txt"), "new\n");
    const observedWorkspaceFingerprint = await workspace.workspaceFingerprint();
    expect(await workspace.isClean()).toBe(false);

    git(root, "add", "README.md", "new file.txt");
    git(root, "commit", "-m", "implement group");
    const acknowledged = await workspace.verifyCommittedWorkspace(
      observedWorkspaceFingerprint,
      { baselineRevision },
    );

    expect(acknowledged.clean).toBe(true);
    expect(acknowledged.headRevision).not.toBe(baselineRevision);
    expect(acknowledged.commitTreeFingerprint).toBe(observedWorkspaceFingerprint);
  });

  it("binds a tested deletion to the commit tree that omits the deleted path", async () => {
    const root = repo("delete");
    const workspace = createGitWorkspaceV2(root);
    const baselineRevision = await workspace.headRevision();
    unlinkSync(resolve(root, "README.md"));
    const observedWorkspaceFingerprint = await workspace.workspaceFingerprint();

    git(root, "add", "-A");
    git(root, "commit", "-m", "delete tracked file");
    const acknowledged = await workspace.verifyCommittedWorkspace(
      observedWorkspaceFingerprint,
      { baselineRevision },
    );

    expect(acknowledged.commitTreeFingerprint).toBe(observedWorkspaceFingerprint);
  });

  it("rejects acknowledgement while the tree is dirty", async () => {
    const root = repo("dirty");
    const workspace = createGitWorkspaceV2(root);
    const fingerprint = await workspace.workspaceFingerprint();
    writeFileSync(resolve(root, "README.md"), "dirty\n");

    await expect(workspace.verifyCommittedWorkspace(fingerprint)).rejects.toMatchObject({
      code: "git_dirty_workspace",
    });
  });

  it("rejects a clean commit that differs from the evaluated workspace", async () => {
    const root = repo("stale");
    const workspace = createGitWorkspaceV2(root);
    writeFileSync(resolve(root, "README.md"), "evaluated\n");
    const evaluated = await workspace.workspaceFingerprint();
    writeFileSync(resolve(root, "README.md"), "changed after evaluation\n");
    git(root, "add", "README.md");
    git(root, "commit", "-m", "different content");

    await expect(workspace.verifyCommittedWorkspace(evaluated)).rejects.toMatchObject({
      code: "git_workspace_changed",
    });
  });

  it("rejects acknowledgement when HEAD did not advance beyond baseline", async () => {
    const root = repo("unchanged");
    const workspace = createGitWorkspaceV2(root);
    const baselineRevision = await workspace.headRevision();
    const fingerprint = await workspace.workspaceFingerprint();

    await expect(workspace.verifyCommittedWorkspace(fingerprint, {
      baselineRevision,
    })).rejects.toMatchObject({ code: "git_commit_unchanged" });
  });

  it("passes hostile filenames only as argv and never through a shell", async () => {
    const root = repo("argv");
    const hostile = "$(touch CORGI_PWNED).txt";
    writeFileSync(resolve(root, hostile), "safe\n");
    const workspace = createGitWorkspaceV2(root);

    await expect(workspace.workspaceFingerprint()).resolves.toMatch(/^sha256:/);
    expect(existsSync(resolve(root, "CORGI_PWNED"))).toBe(false);
  });

  it("computes a read-only overlay fingerprint and still detects unrelated changes", async () => {
    const root = repo("overlay");
    const workspace = createGitWorkspaceV2(root);
    const taskPath = resolve(root, "tasks.md");
    const originalTasks = "## 1. Work\n\n- [ ] 1.1 Existing\n";
    writeFileSync(taskPath, originalTasks);
    git(root, "add", "tasks.md");
    git(root, "commit", "-m", "add tasks");
    const before = await workspace.workspaceFingerprint();

    writeFileSync(taskPath, `${originalTasks}\n## 2. Follow-up\n`);
    await expect(workspace.workspaceFingerprintWithOverlays([{
      path: taskPath,
      content: originalTasks,
    }])).resolves.toBe(before);

    writeFileSync(resolve(root, "README.md"), "unrelated implementation tamper\n");
    await expect(workspace.workspaceFingerprintWithOverlays([{
      path: "tasks.md",
      content: Buffer.from(originalTasks),
    }])).resolves.not.toBe(before);
    expect(readFileSync(taskPath, "utf8")).toContain("Follow-up");
  });

  it("supports an untracked overlay and rejects duplicate or escaping paths", async () => {
    const root = repo("overlay-untracked");
    const workspace = createGitWorkspaceV2(root);
    const taskPath = resolve(root, "tasks.md");
    writeFileSync(taskPath, "before\n");
    const before = await workspace.workspaceFingerprint();
    writeFileSync(taskPath, "after\n");

    await expect(workspace.workspaceFingerprintWithOverlays([{
      path: taskPath,
      content: "before\n",
    }])).resolves.toBe(before);
    await expect(workspace.workspaceFingerprintWithOverlays([
      { path: "tasks.md", content: "before\n" },
      { path: taskPath, content: "before\n" },
    ])).rejects.toMatchObject({ code: "git_command_failed" });
    await expect(workspace.workspaceFingerprintWithOverlays([{
      path: resolve(root, "../outside.md"),
      content: "outside\n",
    }])).rejects.toMatchObject({ code: "git_command_failed" });
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlink as an overlay recovery boundary",
    async () => {
      const root = repo("overlay-symlink");
      const workspace = createGitWorkspaceV2(root);
      writeFileSync(resolve(root, "outside.md"), "outside\n");
      symlinkSync("outside.md", resolve(root, "tasks.md"));

      await expect(workspace.workspaceFingerprintWithOverlays([{
        path: "tasks.md",
        content: "trusted pre-bytes\n",
      }])).rejects.toMatchObject({ code: "git_command_failed" });
    },
  );

  it("orders mixed-case, numeric, and Unicode paths without localeCompare", async () => {
    const root = repo("portable-order");
    for (const name of ["A.txt", "a10.txt", "a2.txt", "é.txt", "中.txt"]) {
      writeFileSync(resolve(root, name), `${name}\n`);
    }
    const workspace = createGitWorkspaceV2(root);
    const expected = await workspace.workspaceFingerprint();
    const localeCompare = vi.spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => { throw new Error("localeCompare must not define a canonical hash"); });
    try {
      await expect(workspace.workspaceFingerprint()).resolves.toBe(expected);
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("always excludes canonical .corgi/loop runtime state without relying on .gitignore", async () => {
    const root = repo("runtime-state");
    const workspace = createGitWorkspaceV2(root);
    const before = await workspace.workspaceFingerprint();
    mkdirSync(resolve(root, ".corgi/loop/example/runs/run-1"), { recursive: true });
    writeFileSync(resolve(root, ".corgi/loop/example/current.json"), "{}\n");
    writeFileSync(resolve(root, ".corgi/loop/example/runs/run-1/state.json"), "{}\n");

    expect(await workspace.isClean()).toBe(true);
    expect(await workspace.workspaceFingerprint()).toBe(before);
    expect(await workspace.commitTreeFingerprint()).toBe(before);
  });

  it("uses injectable argv runner and surfaces non-zero Git errors", async () => {
    const root = repo("runner");
    const runner = new RecordingRunner(root, [
      result(root),
      result("", "fatal: bad revision", 128),
    ]);
    const workspace = createGitWorkspaceV2(root, runner);

    await expect(workspace.headRevision()).rejects.toBeInstanceOf(GitWorkspaceError);
    expect(runner.requests.map((request) => request.args)).toEqual([
      ["rev-parse", "--show-toplevel"],
      ["rev-parse", "--verify", "HEAD"],
    ]);
    expect(runner.requests.every((request) => request.command === "git")).toBe(true);
  });
});

class RecordingRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  constructor(
    private readonly root: string,
    private readonly responses: CommandResult[],
  ) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    return this.responses.shift() ?? result(this.root);
  }
}

function result(stdout: string, stderr = "", exitCode = 0): CommandResult {
  return {
    stdout,
    stderr,
    exitCode,
    signal: null,
    timedOut: false,
  };
}
