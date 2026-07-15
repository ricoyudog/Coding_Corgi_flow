import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat } from "node:fs/promises";
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
  const temporary = path.join(
    path.dirname(taskArtifactPath),
    `.${path.basename(taskArtifactPath)}.${randomUUID()}.tmp`,
  );
  let handle;
  try {
    handle = await open(temporary, "wx", originalMode);
    await handle.chmod(originalMode);
    await handle.writeFile(next, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, taskArtifactPath);
    await faults.afterRename?.();
    await syncContainingDirectory(path.dirname(taskArtifactPath));
    await faults.afterDirectoryFsync?.();
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
  }
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
