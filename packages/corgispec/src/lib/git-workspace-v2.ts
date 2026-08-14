import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import {
  NodeCommandRunner,
  type CommandResult,
  type CommandRunner,
} from "./openspec-runtime.js";

const FINGERPRINT_FORMAT = "corgispec-git-workspace-v2";

export type GitWorkspaceErrorCode =
  | "git_spawn_failed"
  | "git_command_failed"
  | "git_not_repository"
  | "git_repository_mismatch"
  | "git_unmerged_index"
  | "git_dirty_workspace"
  | "git_workspace_changed"
  | "git_commit_unchanged"
  | "git_commit_not_descendant";

export class GitWorkspaceError extends Error {
  constructor(
    message: string,
    public readonly code: GitWorkspaceErrorCode,
    public readonly details: Record<string, unknown> = {},
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GitWorkspaceError";
  }
}

export interface GitWorkspaceSnapshotV2 {
  headRevision: string;
  treeRevision: string;
  workspaceFingerprint: string;
  clean: boolean;
  status: string;
}

export interface GitCommitAcknowledgementV2 extends GitWorkspaceSnapshotV2 {
  commitTreeFingerprint: string;
}

export interface VerifyCommittedWorkspaceOptions {
  baselineRevision?: string;
}

export interface WorkspaceFingerprintOverlayV2 {
  /** Absolute path or repository-relative path for the virtual file. */
  path: string;
  /** Exact worktree bytes to hash in place of the file currently on disk. */
  content: string | Uint8Array;
}

interface FingerprintEntry {
  mode: string;
  path: string;
  objectId: string;
}

/**
 * Shell-free Git boundary for run-contract snapshots and commit acknowledgement.
 * Every invocation is an argv array and the runner is injectable for deterministic
 * contract tests.
 */
export class GitWorkspaceV2 {
  private verifiedRoot?: Promise<string>;

  constructor(
    public readonly root: string,
    private readonly runner: CommandRunner = new NodeCommandRunner(),
    private readonly executable = "git",
  ) {}

  async assertRepository(): Promise<string> {
    if (!this.verifiedRoot) {
      this.verifiedRoot = this.verifyRepository().catch((error: unknown) => {
        this.verifiedRoot = undefined;
        throw error;
      });
    }
    return await this.verifiedRoot;
  }

  async headRevision(): Promise<string> {
    await this.assertRepository();
    return nonEmpty(await this.git(["rev-parse", "--verify", "HEAD"]), "HEAD revision");
  }

  async treeRevision(revision = "HEAD"): Promise<string> {
    await this.assertRepository();
    return nonEmpty(
      await this.git(["rev-parse", "--verify", `${revision}^{tree}`]),
      `${revision} tree revision`,
    );
  }

  async commitParents(revision = "HEAD"): Promise<string[]> {
    await this.assertRepository();
    const line = nonEmpty(
      await this.git(["rev-list", "--parents", "-n", "1", revision]),
      `${revision} commit parents`,
    );
    const [commit, ...parents] = line.trim().split(/\s+/u);
    if (!commit) {
      throw new GitWorkspaceError("Git returned an invalid commit parent record", "git_command_failed");
    }
    return parents;
  }

  async statusPorcelain(): Promise<string> {
    await this.assertRepository();
    return await this.git([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=none",
      "--",
      ".",
      ":(exclude).corgi/loop/**",
    ]);
  }

  async changedPaths(fromRevision: string, toRevision = "HEAD"): Promise<string[]> {
    await this.assertRepository();
    if (!fromRevision.trim() || !toRevision.trim()) {
      throw new GitWorkspaceError("Git diff revisions must be non-empty", "git_command_failed");
    }
    const output = await this.git([
      "diff",
      "--name-only",
      "-z",
      `${fromRevision}..${toRevision}`,
      "--",
      ".",
      ":(exclude).corgi/loop/**",
    ]);
    return parseNulPaths(output).map(portable);
  }

  async isClean(): Promise<boolean> {
    return (await this.statusPorcelain()).length === 0;
  }

  async workspaceFingerprint(): Promise<string> {
    return await this.workspaceFingerprintWithOverlays([]);
  }

  /**
   * Compute the prospective workspace tree while virtually replacing selected
   * worktree files. This is read-only and is used to distinguish an expected
   * planning append from unrelated workspace changes during crash recovery.
   */
  async workspaceFingerprintWithOverlays(
    overlays: readonly WorkspaceFingerprintOverlayV2[],
  ): Promise<string> {
    await this.assertRepository();
    const normalizedOverlays = new Map<string, WorkspaceFingerprintOverlayV2>();
    for (const overlay of overlays) {
      const absolute = path.isAbsolute(overlay.path)
        ? path.resolve(overlay.path)
        : path.resolve(this.root, overlay.path);
      if (!isPathInside(this.root, absolute)) {
        throw new GitWorkspaceError(
          `Workspace fingerprint overlay escapes the repository: ${overlay.path}`,
          "git_command_failed",
          { path: overlay.path },
        );
      }
      const relativePath = portable(path.relative(this.root, absolute));
      if (!relativePath || relativePath === ".corgi/loop" || relativePath.startsWith(".corgi/loop/")) {
        throw new GitWorkspaceError(
          `Workspace fingerprint overlay path is not allowed: ${overlay.path}`,
          "git_command_failed",
          { path: overlay.path },
        );
      }
      if (normalizedOverlays.has(relativePath)) {
        throw new GitWorkspaceError(
          `Duplicate workspace fingerprint overlay: ${relativePath}`,
          "git_command_failed",
          { path: relativePath },
        );
      }
      normalizedOverlays.set(relativePath, { ...overlay, path: relativePath });
    }
    const [trackedOutput, untrackedOutput] = await Promise.all([
      this.git(["ls-files", "--stage", "-z", "--", ".", ":(exclude).corgi/loop/**"]),
      this.git([
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ".",
        ":(exclude).corgi/loop/**",
      ]),
    ]);
    const tracked = parseIndexEntries(trackedOutput);
    const entries: FingerprintEntry[] = [];

    for (const entry of tracked) {
      if (entry.stage !== 0) {
        throw new GitWorkspaceError(
          `Git index contains an unmerged entry at '${entry.path}'`,
          "git_unmerged_index",
          { path: entry.path, stage: entry.stage },
        );
      }
      if (entry.mode === "160000") {
        entries.push({ mode: entry.mode, path: entry.path, objectId: entry.objectId });
        continue;
      }
      const overlay = normalizedOverlays.get(portable(entry.path));
      const fingerprint = overlay
        ? await this.fingerprintOverlayPath(overlay.path, overlay.content, entry.mode)
        : await this.fingerprintWorkingPath(entry.path, entry.mode);
      normalizedOverlays.delete(portable(entry.path));
      // A missing tracked path represents a deletion in the workspace's
      // prospective tree. Omitting it makes the tested fingerprint identical
      // to the tree produced by committing that deletion.
      if (fingerprint) entries.push(fingerprint);
    }

    const trackedPaths = new Set(tracked.map((entry) => entry.path));
    for (const filePath of parseNulPaths(untrackedOutput)) {
      if (trackedPaths.has(filePath)) continue;
      const portablePath = portable(filePath);
      const overlay = normalizedOverlays.get(portablePath);
      const fingerprint = overlay
        ? await this.fingerprintOverlayPath(portablePath, overlay.content)
        : await this.fingerprintWorkingPath(filePath);
      normalizedOverlays.delete(portablePath);
      if (fingerprint) entries.push(fingerprint);
    }
    for (const overlay of normalizedOverlays.values()) {
      // An ignored file is absent from both Git enumerations and therefore did
      // not contribute to the original fingerprint. Preserve that behavior.
      const ignored = await this.gitResult(
        ["check-ignore", "-q", "--", overlay.path],
        [0, 1],
      );
      if (ignored.exitCode === 0) continue;
      entries.push(await this.fingerprintOverlayPath(overlay.path, overlay.content));
    }
    return hashEntries(entries);
  }

  async commitTreeFingerprint(revision = "HEAD"): Promise<string> {
    await this.assertRepository();
    const output = await this.git(["ls-tree", "-r", "-z", "--full-tree", revision]);
    return hashEntries(
      parseTreeEntries(output).filter((entry) => !entry.path.startsWith(".corgi/loop/")),
    );
  }

  async snapshot(): Promise<GitWorkspaceSnapshotV2> {
    const [headRevision, treeRevision, status, workspaceFingerprint] = await Promise.all([
      this.headRevision(),
      this.treeRevision(),
      this.statusPorcelain(),
      this.workspaceFingerprint(),
    ]);
    return {
      headRevision,
      treeRevision,
      workspaceFingerprint,
      clean: status.length === 0,
      status,
    };
  }

  async verifyCommittedWorkspace(
    expectedWorkspaceFingerprint: string,
    options: VerifyCommittedWorkspaceOptions = {},
  ): Promise<GitCommitAcknowledgementV2> {
    const snapshot = await this.snapshot();
    if (!snapshot.clean) {
      throw new GitWorkspaceError(
        "Cannot acknowledge a group commit while the Git workspace is dirty",
        "git_dirty_workspace",
        { status: snapshot.status },
      );
    }
    if (snapshot.workspaceFingerprint !== expectedWorkspaceFingerprint) {
      throw new GitWorkspaceError(
        "The committed workspace no longer matches the workspace that was evaluated",
        "git_workspace_changed",
        {
          expectedWorkspaceFingerprint,
          actualWorkspaceFingerprint: snapshot.workspaceFingerprint,
        },
      );
    }
    const commitTreeFingerprint = await this.commitTreeFingerprint(snapshot.headRevision);
    if (commitTreeFingerprint !== expectedWorkspaceFingerprint) {
      throw new GitWorkspaceError(
        "The commit tree does not match the workspace that was evaluated",
        "git_workspace_changed",
        { expectedWorkspaceFingerprint, commitTreeFingerprint },
      );
    }

    if (options.baselineRevision) {
      if (snapshot.headRevision === options.baselineRevision) {
        throw new GitWorkspaceError(
          "No new commit was created after the run baseline",
          "git_commit_unchanged",
          { baselineRevision: options.baselineRevision },
        );
      }
      const ancestor = await this.gitResult([
        "merge-base",
        "--is-ancestor",
        options.baselineRevision,
        snapshot.headRevision,
      ], [0, 1]);
      if (ancestor.exitCode !== 0) {
        throw new GitWorkspaceError(
          "The acknowledged commit is not a descendant of the run baseline",
          "git_commit_not_descendant",
          {
            baselineRevision: options.baselineRevision,
            headRevision: snapshot.headRevision,
          },
        );
      }
    }

    return { ...snapshot, commitTreeFingerprint };
  }

  private async verifyRepository(): Promise<string> {
    let topLevel: string;
    try {
      topLevel = nonEmpty(
        await this.gitUnchecked(["rev-parse", "--show-toplevel"]),
        "Git repository root",
      );
    } catch (error) {
      if (error instanceof GitWorkspaceError) throw error;
      throw new GitWorkspaceError(
        `Not a Git repository: ${this.root}`,
        "git_not_repository",
        { root: this.root },
        error,
      );
    }
    const [expected, actual] = await Promise.all([
      realpath(path.resolve(this.root)).catch(() => path.resolve(this.root)),
      realpath(topLevel).catch(() => path.resolve(topLevel)),
    ]);
    if (expected !== actual) {
      throw new GitWorkspaceError(
        `Git repository root mismatch: expected ${expected}, got ${actual}`,
        "git_repository_mismatch",
        { expected, actual },
      );
    }
    return actual;
  }

  private async fingerprintWorkingPath(
    relativePath: string,
    indexMode?: string,
  ): Promise<FingerprintEntry | null> {
    const absolute = path.resolve(this.root, relativePath);
    if (!isPathInside(this.root, absolute)) {
      throw new GitWorkspaceError(
        `Git returned a path outside the repository: ${relativePath}`,
        "git_command_failed",
        { path: relativePath },
      );
    }
    let fileStat;
    try {
      fileStat = await lstat(absolute);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (code === "ENOENT") return null;
      throw new GitWorkspaceError(
        `Cannot inspect Git workspace path '${relativePath}'`,
        "git_command_failed",
        { path: relativePath },
        error,
      );
    }
    if (fileStat.isDirectory()) {
      // A directory here can only be a checked-out gitlink. Preserve its index
      // identity; ordinary directories are never returned by git ls-files.
      return {
        mode: indexMode ?? "160000",
        path: portable(relativePath),
        objectId: "directory",
      };
    }
    const objectId = nonEmpty(
      await this.git(["hash-object", "--path", relativePath, "--", relativePath]),
      `Git object id for ${relativePath}`,
    );
    const mode = fileStat.isSymbolicLink()
      ? "120000"
      : fileStat.mode & 0o111
        ? "100755"
        : indexMode === "100755"
          ? "100755"
          : "100644";
    return { mode, path: portable(relativePath), objectId };
  }

  private async fingerprintOverlayPath(
    relativePath: string,
    content: string | Uint8Array,
    indexMode?: string,
  ): Promise<FingerprintEntry> {
    const absolute = path.resolve(this.root, relativePath);
    let mode = indexMode === "100755" ? "100755" : "100644";
    try {
      const fileStat = await lstat(absolute);
      if (!fileStat.isFile()) {
        throw new GitWorkspaceError(
          `Workspace fingerprint overlay requires a regular file: ${relativePath}`,
          "git_command_failed",
          { path: relativePath },
        );
      }
      mode = (fileStat.mode & 0o111) !== 0 || indexMode === "100755"
        ? "100755"
        : "100644";
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (error instanceof GitWorkspaceError) throw error;
      throw new GitWorkspaceError(
        code === "ENOENT"
          ? `Workspace fingerprint overlay file is missing: ${relativePath}`
          : `Cannot inspect workspace fingerprint overlay: ${relativePath}`,
        "git_command_failed",
        { path: relativePath },
        error,
      );
    }
    const objectId = nonEmpty(
      (await this.gitResult(
        ["hash-object", "--stdin", "--path", relativePath],
        [0],
        content,
      )).stdout,
      `Git overlay object id for ${relativePath}`,
    );
    return { mode, path: portable(relativePath), objectId };
  }

  private async git(args: readonly string[]): Promise<string> {
    return (await this.gitResult(args)).stdout;
  }

  private async gitUnchecked(args: readonly string[]): Promise<string> {
    return (await this.gitResult(args)).stdout;
  }

  private async gitResult(
    args: readonly string[],
    acceptedExitCodes: readonly number[] = [0],
    stdin?: string | Uint8Array,
  ): Promise<CommandResult> {
    let result: CommandResult;
    try {
      result = await this.runner.run({
        command: this.executable,
        args,
        cwd: this.root,
        timeoutMs: 15_000,
        env: { GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
        ...(stdin === undefined ? {} : { stdin }),
      });
    } catch (error) {
      throw new GitWorkspaceError(
        `Failed to start Git: ${error instanceof Error ? error.message : String(error)}`,
        "git_spawn_failed",
        { args },
        error,
      );
    }
    if (result.timedOut || result.exitCode === null || !acceptedExitCodes.includes(result.exitCode)) {
      const message = result.stderr.trim() || result.stdout.trim() || "Git command failed";
      const code = args[0] === "rev-parse" && args[1] === "--show-toplevel"
        ? "git_not_repository"
        : "git_command_failed";
      throw new GitWorkspaceError(message, code, {
        args,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }
    return { ...result, stdout: result.stdout.trimEnd() };
  }
}

export function createGitWorkspaceV2(
  root: string,
  runner?: CommandRunner,
  executable?: string,
): GitWorkspaceV2 {
  return new GitWorkspaceV2(root, runner, executable);
}

function parseIndexEntries(output: string): Array<{
  mode: string;
  objectId: string;
  stage: number;
  path: string;
}> {
  if (!output) return [];
  return output.split("\0").filter(Boolean).map((record) => {
    const match = record.match(/^(\d{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/u);
    if (!match) {
      throw new GitWorkspaceError(
        `Malformed git ls-files entry: ${JSON.stringify(record)}`,
        "git_command_failed",
        { record },
      );
    }
    return {
      mode: match[1]!,
      objectId: match[2]!,
      stage: Number(match[3]),
      path: match[4]!,
    };
  });
}

function parseTreeEntries(output: string): FingerprintEntry[] {
  if (!output) return [];
  return output.split("\0").filter(Boolean).map((record) => {
    const match = record.match(/^(\d{6}) (?:blob|commit) ([0-9a-f]+)\t([\s\S]+)$/u);
    if (!match) {
      throw new GitWorkspaceError(
        `Malformed git ls-tree entry: ${JSON.stringify(record)}`,
        "git_command_failed",
        { record },
      );
    }
    return { mode: match[1]!, objectId: match[2]!, path: portable(match[3]!) };
  });
}

function parseNulPaths(output: string): string[] {
  return output ? output.split("\0").filter(Boolean) : [];
}

function hashEntries(entries: FingerprintEntry[]): string {
  const hash = createHash("sha256");
  hash.update(`${FINGERPRINT_FORMAT}\0`);
  for (const entry of [...entries].sort((left, right) =>
    compareCodeUnits(portable(left.path), portable(right.path)))) {
    hash.update(`${entry.mode}\0${portable(entry.path)}\0${entry.objectId}\0`);
  }
  return `sha256:${hash.digest("hex")}`;
}

/** Locale-independent ordering keeps fingerprints identical across ICU builds. */
function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function nonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new GitWorkspaceError(`${label} is empty`, "git_command_failed", { label });
  }
  return normalized;
}

function portable(value: string): string {
  return value.replace(/\\/g, "/");
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
}
