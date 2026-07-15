import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { assertWritableArtifactPath } from "./artifact-resolver.js";
import type { OpenSpecArtifactPath } from "./openspec-adapter.js";
import {
  parseTaskGroupsDocument,
  type ParsedTaskGroup,
} from "./task-groups.js";
import { computeConvergenceConfirmationTokenV2 } from "./convergence-intent-v2.js";

export type ConvergeStatusV2 = "converged" | "needs_work" | "blocked";

export interface ConvergencePlanningContextV2 {
  valid: boolean;
  ready: boolean;
  planningRevision: string;
  changeRoot: string;
  taskArtifactId: string;
  taskArtifactPath: string;
  taskGroups: ParsedTaskGroup[];
  issues: string[];
  /** Authoritative manifest needed for read-only virtual revision overlays. */
  revisionInput?: {
    schemaName: string;
    artifactPaths: Record<string, OpenSpecArtifactPath>;
  };
}

export interface ConvergenceGitContextV2 {
  revision: string;
  workspaceFingerprint: string;
}

export interface ConvergenceEvidenceV2 {
  id: string;
  planningRevision: string;
  observedGitRevision: string;
  workspaceFingerprint: string;
  status: "pass" | "fail";
  summary: string;
}

export interface ImplementationGapV2 {
  id: string;
  summary: string;
  details?: string;
  suggestedTasks?: string[];
}

export interface ConvergenceRunContextV2 {
  runId: string;
  stateRevision: number;
  nonce: string;
  sessionId: string;
  planningRevision: string;
  observedGitRevision: string;
  groupFingerprints: Record<string, string>;
  approvedEvidenceGroups: string[];
}

export interface TaskGroupDraftV2 {
  number: number;
  title: string;
  tasks: Array<{ id: string; description: string; gapId: string }>;
  markdown: string;
}

export interface ConvergenceEvaluationInputV2 {
  changeName: string;
  planning: ConvergencePlanningContextV2;
  git: ConvergenceGitContextV2;
  evidence: ConvergenceEvidenceV2[];
  gaps: ImplementationGapV2[];
  run?: ConvergenceRunContextV2;
}

export interface ConvergenceResultV2 {
  schemaVersion: 2;
  changeName: string;
  status: ConvergeStatusV2;
  planningRevision: string;
  gitRevision: string;
  workspaceFingerprint: string;
  evidence: ConvergenceEvidenceV2[];
  gaps: ImplementationGapV2[];
  reason?: {
    code: string;
    message: string;
    nextCommand?: string;
  };
  taskGroupDraft?: TaskGroupDraftV2;
  /** Exact token required by the mutating confirmation call. */
  confirmationToken?: `sha256:${string}`;
  originalGroupFingerprints: Record<string, string>;
  applied?: boolean;
  successor?: {
    supersedesRunId: string;
    reusableEvidenceGroups: string[];
    planningRevision: string;
    runId?: string;
  };
}

export type ConvergeErrorCode =
  | "converge_not_confirmed"
  | "converge_not_applicable"
  | "converge_planning_changed"
  | "converge_git_changed"
  | "converge_task_artifact_changed"
  | "converge_store_required"
  | "converge_temporary_conflict"
  | "converge_append_failed_after_invalidation"
  | "converge_post_append_planning_invalid"
  | "converge_post_append_revision_mismatch";

export class ConvergeErrorV2 extends Error {
  constructor(
    message: string,
    public readonly code: ConvergeErrorCode,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ConvergeErrorV2";
  }
}

/** Read-only convergence decision. This function never mutates planning or run state. */
export function evaluateConvergenceV2(
  input: ConvergenceEvaluationInputV2,
): ConvergenceResultV2 {
  const originalGroupFingerprints = fingerprintTaskGroupsV2(input.planning.taskGroups);
  const base = {
    schemaVersion: 2 as const,
    changeName: input.changeName,
    planningRevision: input.planning.planningRevision,
    gitRevision: input.git.revision,
    workspaceFingerprint: input.git.workspaceFingerprint,
    evidence: input.evidence,
    gaps: input.gaps,
    originalGroupFingerprints,
  };

  if (!input.planning.valid || !input.planning.ready) {
    return {
      ...base,
      status: "blocked",
      reason: {
        code: "planning_invalid",
        message: input.planning.issues.join("; ") || "Planning is not ready",
        nextCommand: `/corgi:update ${input.changeName}`,
      },
    };
  }

  if (input.run && input.run.planningRevision !== input.planning.planningRevision) {
    return {
      ...base,
      status: "blocked",
      reason: {
        code: "planning_revision_changed",
        message: "The active run was created from a different planning revision",
        nextCommand: `/corgi:update ${input.changeName}`,
      },
    };
  }
  if (input.run && input.run.observedGitRevision !== input.git.revision) {
    return {
      ...base,
      status: "blocked",
      reason: {
        code: "run_git_revision_stale",
        message: "The active run no longer matches the current Git revision",
      },
    };
  }

  if (input.evidence.length === 0) {
    return {
      ...base,
      status: "blocked",
      reason: {
        code: "evidence_missing",
        message: "Convergence requires fresh implementation evidence",
      },
    };
  }
  const staleEvidence = input.evidence.filter((entry) =>
    entry.planningRevision !== input.planning.planningRevision ||
    entry.observedGitRevision !== input.git.revision ||
    entry.workspaceFingerprint !== input.git.workspaceFingerprint
  );
  if (staleEvidence.length > 0) {
    return {
      ...base,
      status: "blocked",
      reason: {
        code: "evidence_stale",
        message: `Evidence is stale: ${staleEvidence.map((entry) => entry.id).join(", ")}`,
      },
    };
  }
  if (input.evidence.some((entry) => entry.status === "fail") && input.gaps.length === 0) {
    return {
      ...base,
      status: "blocked",
      reason: {
        code: "evidence_failed_without_gap",
        message: "Failing evidence must be explained by an implementation gap",
      },
    };
  }

  if (input.gaps.length === 0) {
    return { ...base, status: "converged" };
  }

  const taskGroupDraft = createConvergenceTaskGroupDraftV2(
    input.planning.taskGroups,
    input.gaps,
  );
  return {
    ...base,
    status: "needs_work",
    taskGroupDraft,
    confirmationToken: computeConvergenceConfirmationTokenV2({
      changeName: input.changeName,
      planningRevision: input.planning.planningRevision,
      gitRevision: input.git.revision,
      workspaceFingerprint: input.git.workspaceFingerprint,
      originalGroupFingerprints,
      taskGroupDraft,
      evidence: input.evidence,
    }),
  };
}

export interface ApplyConvergenceDependenciesV2 {
  /** Re-resolve planning immediately before mutation. */
  inspectPlanning(changeName: string): Promise<ConvergencePlanningContextV2>;
  /** Re-read Git immediately before invalidating a run or appending planning. */
  inspectGit?(): Promise<ConvergenceGitContextV2>;
  invalidateRun?(input: {
    changeName: string;
    runId: string;
    sessionId: string;
    expectedStateRevision: number;
    expectedNonce: string;
    reason: string;
  }): Promise<void>;
  createSuccessorRun?(input: {
    changeName: string;
    supersedesRunId: string;
    planningRevision: string;
    reusableEvidenceGroups: string[];
  }): Promise<{ runId: string }>;
  refreshPlanningRevision?(changeName: string): Promise<string>;
  appendTaskGroup?(taskArtifactPath: string, expectedContent: string, markdown: string): Promise<void>;
}

export interface ConvergenceAppendFaultsV2 {
  afterTemporaryOpen?(): void | Promise<void>;
  afterTemporaryChmod?(): void | Promise<void>;
  afterTemporaryTruncate?(): void | Promise<void>;
  afterTemporaryWrite?(): void | Promise<void>;
  afterTemporaryFsync?(): void | Promise<void>;
  afterTemporaryClose?(): void | Promise<void>;
  beforeRename?(): void | Promise<void>;
  afterRename?(): void | Promise<void>;
  afterDirectoryFsync?(): void | Promise<void>;
}

/**
 * Confirm and append exactly one Task Group. Existing bytes and group
 * fingerprints are checked again before the old run is invalidated and the
 * append is performed.
 */
export async function applyConfirmedConvergenceV2(
  evaluation: ConvergenceResultV2,
  confirmationToken: string | false,
  dependencies: ApplyConvergenceDependenciesV2,
  run?: ConvergenceRunContextV2,
): Promise<ConvergenceResultV2> {
  if (
    !confirmationToken ||
    !evaluation.confirmationToken ||
    confirmationToken !== evaluation.confirmationToken
  ) {
    throw new ConvergeErrorV2(
      "Convergence changes require the exact confirmation token from the read-only evaluation",
      "converge_not_confirmed",
      {
        expected: evaluation.confirmationToken ?? null,
        received: confirmationToken || null,
      },
    );
  }
  if (evaluation.status !== "needs_work" || !evaluation.taskGroupDraft) {
    throw new ConvergeErrorV2(
      `Cannot apply a convergence result with status '${evaluation.status}'`,
      "converge_not_applicable",
    );
  }

  const current = await dependencies.inspectPlanning(evaluation.changeName);
  if (
    !current.valid ||
    !current.ready ||
    current.planningRevision !== evaluation.planningRevision
  ) {
    throw new ConvergeErrorV2(
      "Planning changed after convergence evaluation; re-run converge",
      "converge_planning_changed",
      {
        expected: evaluation.planningRevision,
        actual: current.planningRevision,
      },
    );
  }
  const currentFingerprints = fingerprintTaskGroupsV2(current.taskGroups);
  if (!sameRecord(currentFingerprints, evaluation.originalGroupFingerprints)) {
    throw new ConvergeErrorV2(
      "Existing Task Groups changed after convergence evaluation",
      "converge_task_artifact_changed",
      { expected: evaluation.originalGroupFingerprints, actual: currentFingerprints },
    );
  }
  const expectedNumber = Math.max(0, ...current.taskGroups.map((group) => group.number)) + 1;
  if (evaluation.taskGroupDraft.number !== expectedNumber) {
    throw new ConvergeErrorV2(
      "The proposed convergence Task Group number is no longer available",
      "converge_task_artifact_changed",
      { expectedNumber, draftNumber: evaluation.taskGroupDraft.number },
    );
  }

  await assertWritableArtifactPath(
    { changeRoot: current.changeRoot },
    current.taskArtifactPath,
  );
  const originalContent = await readFile(current.taskArtifactPath, "utf8");
  const parsed = parseTaskGroupsDocument(originalContent);
  if (!sameRecord(fingerprintTaskGroupsV2(parsed.groups), currentFingerprints)) {
    throw new ConvergeErrorV2(
      "The authoritative task artifact changed during convergence",
      "converge_task_artifact_changed",
    );
  }

  if (dependencies.inspectGit) {
    const currentGit = await dependencies.inspectGit();
    if (
      currentGit.revision !== evaluation.gitRevision ||
      currentGit.workspaceFingerprint !== evaluation.workspaceFingerprint
    ) {
      throw new ConvergeErrorV2(
        "Git changed after convergence evaluation; re-run converge",
        "converge_git_changed",
        {
          expectedRevision: evaluation.gitRevision,
          actualRevision: currentGit.revision,
          expectedWorkspaceFingerprint: evaluation.workspaceFingerprint,
          actualWorkspaceFingerprint: currentGit.workspaceFingerprint,
        },
      );
    }
  }

  if (run) {
    if (!dependencies.invalidateRun) {
      throw new ConvergeErrorV2(
        "An active run must be invalidated before convergence can modify planning",
        "converge_store_required",
      );
    }
    await dependencies.invalidateRun({
      changeName: evaluation.changeName,
      runId: run.runId,
      sessionId: run.sessionId,
      expectedStateRevision: run.stateRevision,
      expectedNonce: run.nonce,
      reason: "convergence appended a successor Task Group",
    });
  }

  const append = dependencies.appendTaskGroup ?? appendConvergenceTaskGroupAtomicallyV2;
  try {
    await append(
      current.taskArtifactPath,
      originalContent,
      evaluation.taskGroupDraft.markdown,
    );
  } catch (error) {
    if (run) {
      throw new ConvergeErrorV2(
        "The old run was safely invalidated, but the Task Group append failed; re-run converge to recover",
        "converge_append_failed_after_invalidation",
        {
          runId: run.runId,
          recovery: `/corgi:converge ${evaluation.changeName}`,
          cause: error instanceof Error ? error.message : String(error),
        },
      );
    }
    throw error;
  }
  const refreshedRevision = dependencies.refreshPlanningRevision
    ? await dependencies.refreshPlanningRevision(evaluation.changeName)
    : undefined;
  const verifiedPlanning = await dependencies.inspectPlanning(evaluation.changeName);
  if (!verifiedPlanning.valid || !verifiedPlanning.ready) {
    throw new ConvergeErrorV2(
      "Planning is not strictly valid and ready after the convergence append",
      "converge_post_append_planning_invalid",
      { issues: verifiedPlanning.issues },
    );
  }
  if (
    refreshedRevision !== undefined &&
    refreshedRevision !== verifiedPlanning.planningRevision
  ) {
    throw new ConvergeErrorV2(
      "Refreshed planning revision disagrees with authoritative post-append planning",
      "converge_post_append_revision_mismatch",
      {
        refreshedRevision,
        authoritativeRevision: verifiedPlanning.planningRevision,
      },
    );
  }
  const planningRevision = verifiedPlanning.planningRevision;

  let successor: ConvergenceResultV2["successor"];
  if (run) {
    const approved = new Set(run.approvedEvidenceGroups);
    const reusableEvidenceGroups: string[] = [];
    for (const group of [...current.taskGroups].sort((left, right) => left.number - right.number)) {
      const groupId = String(group.number);
      if (
        !approved.has(groupId) ||
        currentFingerprints[groupId] === undefined ||
        currentFingerprints[groupId] !== run.groupFingerprints[groupId]
      ) {
        break;
      }
      reusableEvidenceGroups.push(groupId);
    }
    const created = dependencies.createSuccessorRun
      ? await dependencies.createSuccessorRun({
          changeName: evaluation.changeName,
          supersedesRunId: run.runId,
          planningRevision,
          reusableEvidenceGroups,
        })
      : undefined;
    successor = {
      supersedesRunId: run.runId,
      reusableEvidenceGroups,
      planningRevision,
      ...(created ? { runId: created.runId } : {}),
    };
  }

  return {
    ...evaluation,
    applied: true,
    ...(successor ? { successor } : {}),
  };
}

export function createConvergenceTaskGroupDraftV2(
  groups: ParsedTaskGroup[],
  gaps: ImplementationGapV2[],
): TaskGroupDraftV2 {
  const number = Math.max(0, ...groups.map((group) => group.number)) + 1;
  const tasks = gaps.flatMap((gap) => {
    const descriptions = gap.suggestedTasks?.length ? gap.suggestedTasks : [gap.summary];
    return descriptions.map((description) => ({ description, gapId: gap.id }));
  }).map((task, index) => ({
    id: `${number}.${index + 1}`,
    description: oneLine(task.description),
    gapId: task.gapId,
  }));
  const title = "Convergence follow-up";
  const markdown = [
    `## ${number}. ${title}`,
    "",
    ...tasks.map((task) => `- [ ] ${task.id} ${task.description} (gap: ${task.gapId})`),
    "",
  ].join("\n");
  return { number, title, tasks, markdown };
}

export function fingerprintTaskGroupV2(group: ParsedTaskGroup): string {
  const hash = createHash("sha256");
  hash.update("corgispec-task-group-v2\0");
  hash.update(`${group.number}\0${group.name}\0`);
  for (const task of group.tasks) {
    // Completion is implementation progress, not planning semantics. A normal
    // [ ] -> [x] update must not invalidate evidence or an active run.
    hash.update(`${task.id}\0${task.description}\0`);
  }
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Run-contract planning revision. It is byte-sensitive for every planning
 * artifact except checkbox completion markers in the configured task artifact.
 */
export async function computeRunPlanningRevisionV2(input: {
  schemaName: string;
  changeRoot: string;
  artifactPaths: Record<string, OpenSpecArtifactPath>;
  taskArtifactId: string;
  reader?: { read(filePath: string): Promise<Uint8Array> };
}): Promise<ArtifactHashLike> {
  const hash = createHash("sha256");
  appendRevisionField(hash, "corgispec-run-planning-revision-v2");
  appendRevisionField(hash, input.schemaName);
  // A run and its confirmation token must identify the authoritative OpenSpec
  // target, not merely a byte-identical copy with the same change name.
  appendRevisionField(hash, path.resolve(input.changeRoot).replace(/\\/g, "/"));
  for (const artifactId of Object.keys(input.artifactPaths).sort()) {
    const artifact = input.artifactPaths[artifactId]!;
    appendRevisionField(hash, artifactId);
    appendRevisionField(hash, artifact.outputPath.replace(/\\/g, "/"));
    for (const filePath of [...new Set(artifact.existingOutputPaths)].sort()) {
      appendRevisionField(
        hash,
        path.relative(input.changeRoot, filePath).replace(/\\/g, "/"),
      );
      let content = Buffer.from(
        input.reader ? await input.reader.read(filePath) : await readFile(filePath),
      );
      if (artifactId === input.taskArtifactId) {
        content = Buffer.from(normalizeTaskCompletion(content.toString("utf8")), "utf8");
      }
      hash.update(`${content.byteLength}:`);
      hash.update(content);
      hash.update(";");
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

type ArtifactHashLike = `sha256:${string}`;

function normalizeTaskCompletion(content: string): string {
  return content.replace(
    /^(\s*[-*]\s+)\[[ xX]\](\s+[0-9]+(?:\.[0-9A-Za-z_-]+)+\s+)/gmu,
    "$1[ ]$2",
  );
}

function appendRevisionField(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  hash.update(`${bytes.byteLength}:`);
  hash.update(bytes);
  hash.update(";");
}

export function fingerprintTaskGroupsV2(
  groups: ParsedTaskGroup[],
): Record<string, string> {
  return Object.fromEntries(
    [...groups]
      .sort((left, right) => left.number - right.number)
      .map((group) => [String(group.number), fingerprintTaskGroupV2(group)]),
  );
}

/** Exact append rendering shared by intent preparation and crash recovery. */
export function renderConvergenceTaskContentV2(
  current: string,
  markdown: string,
): string {
  const separator = current.length === 0 || current.endsWith("\n\n")
    ? ""
    : current.endsWith("\n")
      ? "\n"
      : "\n\n";
  return `${current}${separator}${markdown}`;
}

export async function appendConvergenceTaskGroupAtomicallyV2(
  taskArtifactPath: string,
  expectedContent: string,
  markdown: string,
  faults: ConvergenceAppendFaultsV2 = {},
): Promise<void> {
  const current = await readFile(taskArtifactPath, "utf8");
  if (current !== expectedContent) {
    throw new ConvergeErrorV2(
      "Task artifact changed before the atomic append",
      "converge_task_artifact_changed",
    );
  }
  const next = renderConvergenceTaskContentV2(current, markdown);
  const originalMode = (await stat(taskArtifactPath)).mode & 0o777;
  const temporary = await convergenceTemporaryPathV2(
    taskArtifactPath,
    expectedContent,
    next,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let handleClosed = false;
  let ownsTemporary = false;
  try {
    try {
      handle = await open(temporary, "wx", originalMode);
      ownsTemporary = true;
    } catch (error) {
      if (!hasFileSystemCode(error, "EEXIST")) throw error;
      handle = await openRecoverableConvergenceTemporaryV2(temporary, next);
      ownsTemporary = true;
    }
    await faults.afterTemporaryOpen?.();
    await handle.chmod(originalMode);
    await faults.afterTemporaryChmod?.();
    await handle.truncate(0);
    await faults.afterTemporaryTruncate?.();
    await writeFileHandleExactlyV2(handle, Buffer.from(next, "utf8"));
    await faults.afterTemporaryWrite?.();
    await handle.sync();
    await faults.afterTemporaryFsync?.();
    await handle.close();
    handleClosed = true;
    await faults.afterTemporaryClose?.();
    await faults.beforeRename?.();
    await rename(temporary, taskArtifactPath);
    await faults.afterRename?.();
    await syncContainingDirectory(path.dirname(taskArtifactPath));
    if (path.dirname(temporary) !== path.dirname(taskArtifactPath)) {
      await syncContainingDirectory(path.dirname(temporary));
    }
    await faults.afterDirectoryFsync?.();
  } finally {
    if (handle && !handleClosed) await handle.close().catch(() => undefined);
    if (ownsTemporary) {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

const CONVERGENCE_TEMP_FORMAT = "corgispec-convergence-temporary-v2";

/**
 * Return an operation-specific temporary path. When the task artifact belongs
 * to a Git worktree, the file lives below `.corgi/loop`, which is already
 * excluded from the canonical workspace fingerprint. External OpenSpec Stores
 * and worktree mount points fall back to a sibling on the target filesystem so
 * rename remains atomic.
 */
async function convergenceTemporaryPathV2(
  taskArtifactPath: string,
  expectedContent: string,
  nextContent: string,
): Promise<string> {
  const targetDirectory = path.dirname(taskArtifactPath);
  const repositoryRoot = await findNearestRepositoryRootV2(targetDirectory);
  let temporaryDirectory = targetDirectory;
  if (repositoryRoot) {
    const managedDirectory = await ensureConvergenceTemporaryDirectoryV2(repositoryRoot);
    const [targetDevice, managedDevice] = await Promise.all([
      stat(targetDirectory),
      stat(managedDirectory),
    ]);
    // rename is atomic only within one filesystem. A worktree may contain a
    // mount point, so retain the sibling fallback in that uncommon layout.
    if (targetDevice.dev === managedDevice.dev) temporaryDirectory = managedDirectory;
  }
  const hash = createHash("sha256");
  appendTemporaryHashField(hash, CONVERGENCE_TEMP_FORMAT);
  appendTemporaryHashField(hash, path.resolve(taskArtifactPath));
  appendTemporaryHashField(hash, expectedContent);
  appendTemporaryHashField(hash, nextContent);
  return path.join(
    temporaryDirectory,
    `.corgispec-converge-v2-${hash.digest("hex")}.tmp`,
  );
}

async function findNearestRepositoryRootV2(start: string): Promise<string | undefined> {
  let cursor = path.resolve(start);
  while (true) {
    try {
      const marker = await lstat(path.join(cursor, ".git"));
      if (!marker.isSymbolicLink() && (marker.isDirectory() || marker.isFile())) {
        return cursor;
      }
      return undefined;
    } catch (error) {
      if (!hasFileSystemCode(error, "ENOENT")) return undefined;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

async function ensureConvergenceTemporaryDirectoryV2(
  repositoryRoot: string,
): Promise<string> {
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  let parent = repositoryRoot;
  for (const segment of [".corgi", "loop", ".converge-tmp"]) {
    const directory = path.join(parent, segment);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!hasFileSystemCode(error, "EEXIST")) throw error;
    }
    const entry = await lstat(directory);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw temporaryConflict(
        directory,
        "the managed temporary directory is not a real directory",
      );
    }
    const canonicalDirectory = await realpath(directory);
    if (!isNativePathInside(canonicalRepositoryRoot, canonicalDirectory)) {
      throw temporaryConflict(
        directory,
        "the managed temporary directory escapes the repository",
      );
    }
    parent = directory;
  }
  return parent;
}

async function openRecoverableConvergenceTemporaryV2(
  temporary: string,
  nextContent: string,
): Promise<Awaited<ReturnType<typeof open>>> {
  const beforeOpen = await lstat(temporary);
  if (beforeOpen.isSymbolicLink() || !beforeOpen.isFile()) {
    throw temporaryConflict(temporary, "the managed path is not a regular file");
  }
  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  const handle = await open(temporary, constants.O_RDWR | noFollow);
  try {
    const [opened, afterOpen] = await Promise.all([
      handle.stat(),
      lstat(temporary),
    ]);
    if (
      !opened.isFile() ||
      afterOpen.isSymbolicLink() ||
      !afterOpen.isFile() ||
      !sameFileIdentityV2(beforeOpen, opened) ||
      !sameFileIdentityV2(opened, afterOpen)
    ) {
      throw temporaryConflict(temporary, "the managed path changed while it was opened");
    }
    const existing = await readFileHandleExactlyV2(handle, opened.size, temporary);
    const afterRead = await handle.stat();
    if (!sameFileIdentityV2(opened, afterRead) || afterRead.size !== opened.size) {
      throw temporaryConflict(temporary, "the managed file changed while it was inspected");
    }
    const expected = Buffer.from(nextContent, "utf8");
    if (
      existing.byteLength > expected.byteLength ||
      !expected.subarray(0, existing.byteLength).equals(existing)
    ) {
      throw temporaryConflict(
        temporary,
        "the managed file does not contain a recoverable prefix",
      );
    }
    return handle;
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
}

async function readFileHandleExactlyV2(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
  temporary: string,
): Promise<Buffer> {
  const content = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(content, offset, size - offset, offset);
    if (bytesRead === 0) {
      throw temporaryConflict(temporary, "the managed file became truncated while reading");
    }
    offset += bytesRead;
  }
  return content;
}

async function writeFileHandleExactlyV2(
  handle: Awaited<ReturnType<typeof open>>,
  content: Buffer,
): Promise<void> {
  let offset = 0;
  while (offset < content.byteLength) {
    const { bytesWritten } = await handle.write(
      content,
      offset,
      content.byteLength - offset,
      offset,
    );
    if (bytesWritten === 0) {
      throw new Error("Failed to make progress writing convergence temporary");
    }
    offset += bytesWritten;
  }
}

function sameFileIdentityV2(
  left: { dev: number; ino: number },
  right: { dev: number; ino: number },
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function temporaryConflict(temporary: string, reason: string): ConvergeErrorV2 {
  return new ConvergeErrorV2(
    `Cannot recover convergence temporary file '${temporary}': ${reason}`,
    "converge_temporary_conflict",
    { temporary, reason },
  );
}

function appendTemporaryHashField(
  hash: ReturnType<typeof createHash>,
  value: string,
): void {
  const bytes = Buffer.from(value, "utf8");
  hash.update(`${bytes.byteLength}:`);
  hash.update(bytes);
  hash.update(";");
}

function isNativePathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function hasFileSystemCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    String(error.code) === code
  );
}

async function syncContainingDirectory(directory: string): Promise<void> {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
    // Windows does not consistently support opening/fsyncing directories.
    if (process.platform !== "win32" || !["EACCES", "EBADF", "EISDIR", "EPERM"].includes(code)) {
      throw error;
    }
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

function sameRecord(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort();
  const rightEntries = Object.entries(right).sort();
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
