import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { Command } from "commander";
import {
  assertWritableArtifactPath,
  createArtifactResolver,
} from "../lib/artifact-resolver.js";
import {
  deriveCanonicalConvergenceEvidenceV2,
  type CanonicalSuccessorSourceV2,
  type DeriveCanonicalConvergenceEvidenceV2Input,
} from "../lib/canonical-convergence-evidence-v2.js";
import {
  appendConvergenceTaskGroupAtomicallyV2,
  computeRunPlanningRevisionV2,
  evaluateConvergenceV2,
  fingerprintTaskGroupsV2,
  renderConvergenceTaskContentV2,
  type ConvergenceEvidenceV2,
  type ConvergencePlanningContextV2,
  type ConvergenceResultV2,
  type ConvergenceRunContextV2,
  type ImplementationGapV2,
} from "../lib/converge-v2.js";
import {
  assertConvergenceIntentV2,
  assertExactConvergenceIntentV2,
  createConvergenceIntentV2,
  hashConvergenceOriginalGroupFingerprintsV2,
  hashConvergenceTaskArtifactPathV2,
  hashConvergenceTaskBytesV2,
  hashConvergenceTaskGroupDraftV2,
  stableConvergenceJsonV2,
  type ConvergenceIntentV2,
} from "../lib/convergence-intent-v2.js";
import { withConvergenceLockV2 } from "../lib/convergence-lock-v2.js";
import { createGitWorkspaceV2, type GitWorkspaceV2 } from "../lib/git-workspace-v2.js";
import { loadConfigFromDir } from "../lib/config.js";
import { buildLifecycleReadyReport } from "../lib/lifecycle.js";
import { createRunInitializedEventV2 } from "../lib/loop-reducer-v2.js";
import { verifyLegacyMigrationArchiveV2 } from "../lib/loop-migration-v2.js";
import { LoopStoreV2, type LoopStoreInspectionV2 } from "../lib/loop-store-v2.js";
import { createSuccessorRunV2 } from "../lib/loop-successor-v2.js";
import { createOpenSpecAdapter } from "../lib/openspec-adapter.js";
import { parseTaskGroupsDocument } from "../lib/task-groups.js";
import type {
  ArtifactHashV2,
  LoopStateV2,
} from "../lib/run-contract-v2.js";
import { executeLoopV2, type LoopV2Dependencies } from "./loop-v2.js";

export interface ConvergenceAssessmentV2 {
  evidence: ConvergenceEvidenceV2[];
  gaps: ImplementationGapV2[];
}

export interface ConvergeCommandRequestV2 {
  projectRoot: string;
  changeName: string;
  store?: string;
  /** Optional explicit supplement; canonical run state is the default source. */
  assessment?: ConvergenceAssessmentV2;
  confirmationToken?: string;
}

export interface ConvergeExecutionV2 {
  exitCode: 0 | 1 | 2;
  output: ConvergenceResultV2;
}

export type ConvergeFaultPointV2 =
  | "after_run_invalidated"
  | "after_task_rename"
  | "after_task_directory_fsync"
  | "after_post_append_ready"
  | "after_successor_initialized";

export interface ConvergeFaultContextV2 {
  changeName: string;
  sourceRunId: string;
  successorRunId: string;
}

export type ConvergeFaultInjectorV2 = (
  point: ConvergeFaultPointV2,
  context: ConvergeFaultContextV2,
) => void | Promise<void>;

export interface ConvergeCommandDependenciesV2 {
  inspectPlanning?: (
    projectRoot: string,
    changeName: string,
    store?: string,
  ) => Promise<ConvergencePlanningContextV2>;
  createGit?: (projectRoot: string) => GitWorkspaceV2;
  createLoopStore?: (projectRoot: string) => LoopStoreV2;
  inspectRun?: (projectRoot: string, changeName: string) => Promise<LoopStoreInspectionV2>;
  executeLoop?: typeof executeLoopV2;
  loopDependencies?: LoopV2Dependencies;
  createSuccessorRun?: (input: {
    changeName: string;
    supersedesRunId: string;
    planningRevision: string;
    reusableEvidenceGroups: string[];
  }) => Promise<{ runId: string }>;
  newRunId?: () => string;
  newNonce?: () => string;
  now?: () => string;
  /** Injectable authoritative preview used by non-OpenSpec test adapters. */
  previewPostPlanningRevision?: (
    planning: ConvergencePlanningContextV2,
    postTaskBytes: Uint8Array,
  ) => Promise<string>;
  withConvergenceLock?: typeof withConvergenceLockV2;
  faults?: ConvergeFaultInjectorV2;
  /** Internal recursion marker: confirmation is already inside the wide lock. */
  confirmationLockHeld?: boolean;
  deriveCanonicalAssessment?: (
    input: DeriveCanonicalConvergenceEvidenceV2Input,
  ) => Promise<ConvergenceAssessmentV2 & { reusableEvidenceGroupIds?: string[] }>;
}

export async function executeConvergeV2(
  request: ConvergeCommandRequestV2,
  dependencies: ConvergeCommandDependenciesV2 = {},
): Promise<ConvergeExecutionV2> {
  const projectRoot = resolve(request.projectRoot);
  try {
    const loopStore = (dependencies.createLoopStore ?? ((root) =>
      new LoopStoreV2({ projectRoot: root })))(projectRoot);
    if (request.confirmationToken) {
      const recovery = await discoverConvergenceRecoveryV2(
        loopStore,
        request.changeName,
      );
      if (recovery) {
        requireConfirmationToken(recovery.intent, request.confirmationToken);
        return await runConfirmedWithLockV2(
          { ...request, confirmationToken: request.confirmationToken },
          dependencies,
          projectRoot,
          loopStore,
        );
      }
    }

    const evaluation = await evaluateConvergeReadOnlyV2(
      { ...request, confirmationToken: undefined },
      dependencies,
    );
    if (!request.confirmationToken || evaluation.output.status !== "needs_work") {
      return evaluation;
    }
    if (
      !evaluation.output.confirmationToken ||
      request.confirmationToken !== evaluation.output.confirmationToken
    ) {
      throw commandError(
        "converge_not_confirmed",
        "Convergence changes require the exact token from the read-only evaluation",
      );
    }
    const current = await loopStore.peek(request.changeName);
    if (!current.state) {
      throw commandError(
        "converge_run_required",
        "Confirmed convergence requires one canonical source run to invalidate",
      );
    }
    return await runConfirmedWithLockV2(
      { ...request, confirmationToken: request.confirmationToken },
      dependencies,
      projectRoot,
      loopStore,
    );
  } catch (error) {
    return blockedConvergeExecution(request, error);
  }
}

async function evaluateConvergeReadOnlyV2(
  request: ConvergeCommandRequestV2,
  dependencies: ConvergeCommandDependenciesV2 = {},
): Promise<ConvergeExecutionV2> {
  const projectRoot = resolve(request.projectRoot);
  try {
    const inspectPlanning = dependencies.inspectPlanning ?? inspectConvergencePlanningDefault;
    const createGit = dependencies.createGit ?? createGitWorkspaceV2;
    const loopStore = (dependencies.createLoopStore ?? ((root) =>
      new LoopStoreV2({ projectRoot: root })))(projectRoot);
    const inspectRun = dependencies.inspectRun ?? (async (_root, changeName) =>
      await loopStore.peek(changeName));
    const planning = await inspectPlanning(projectRoot, request.changeName, request.store);
    const git = createGit(projectRoot);
    const gitSnapshot = await git.snapshot();
    const inspection = await inspectRun(projectRoot, request.changeName);
    const runPaths = loopStore.paths(
      request.changeName,
      inspection.state?.runId ?? "canonical-no-run",
    );
    const provenance = inspection.state
      ? await resolveCanonicalProvenanceV2(
          loopStore,
          projectRoot,
          request.changeName,
          inspection,
          [],
          16,
        )
      : {};
    const canonicalAssessment = await (
      dependencies.deriveCanonicalAssessment ?? deriveCanonicalConvergenceEvidenceV2
    )({
      inspection,
      attemptsRoot: runPaths.attempts!,
      reviewTriagePath: runPaths.reviewTriage,
      currentGit: {
        revision: gitSnapshot.headRevision,
        workspaceFingerprint: gitSnapshot.workspaceFingerprint,
      },
      ...provenance,
    });
    const run = runContext(inspection, canonicalAssessment.reusableEvidenceGroupIds ?? []);
    const finalizedCanonicalHistory = inspection.state?.phase === "done" ||
      inspection.events.some((record) => record.event.type === "run_finalized");
    const convergenceCanonicalAssessment = inspection.state && !finalizedCanonicalHistory
      ? {
          ...canonicalAssessment,
          // Approved prefix attempts are intentionally bound to their tested
          // pre-commit workspace. Reuse is verified cross-run at finalize;
          // they must not make a fresh failed attempt look Git-stale here.
          evidence: canonicalAssessment.evidence.filter((entry) => entry.status === "fail"),
        }
      : canonicalAssessment;
    const assessment = resolveAssessment(
      inspection.state !== null,
      convergenceCanonicalAssessment,
      request.assessment,
    );
    validateAssessment(assessment);
    const evaluation = evaluateConvergenceV2({
      changeName: request.changeName,
      planning,
      git: {
        revision: gitSnapshot.headRevision,
        workspaceFingerprint: gitSnapshot.workspaceFingerprint,
      },
      evidence: assessment.evidence,
      gaps: assessment.gaps,
      ...(run ? { run } : {}),
    });
    return {
      exitCode: evaluation.status === "converged" ? 0 : 1,
      output: evaluation,
    };
  } catch (error) {
    return {
      exitCode: 2,
      output: {
        schemaVersion: 2,
        changeName: request.changeName,
        status: "blocked",
        planningRevision: "",
        gitRevision: "",
        workspaceFingerprint: "",
        evidence: Array.isArray(request.assessment?.evidence) ? request.assessment.evidence : [],
        gaps: Array.isArray(request.assessment?.gaps) ? request.assessment.gaps : [],
        originalGroupFingerprints: {},
        reason: {
          code: errorCode(error),
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }
}

interface DurableConvergenceRecoveryV2 {
  intent: ConvergenceIntentV2;
  source: LoopStoreInspectionV2;
  current: LoopStoreInspectionV2;
}

interface TaskBytesV2 {
  bytes: Buffer;
  text: string;
}

async function runConfirmedWithLockV2(
  request: ConvergeCommandRequestV2 & { confirmationToken: string },
  dependencies: ConvergeCommandDependenciesV2,
  projectRoot: string,
  loopStore: LoopStoreV2,
): Promise<ConvergeExecutionV2> {
  const lock = dependencies.withConvergenceLock ?? withConvergenceLockV2;
  return await lock({ projectRoot, changeName: request.changeName }, async () => {
    const recovery = await discoverConvergenceRecoveryV2(loopStore, request.changeName);
    if (recovery) {
      requireConfirmationToken(recovery.intent, request.confirmationToken);
      return await recoverConfirmedConvergenceV2(
        request,
        dependencies,
        projectRoot,
        loopStore,
        recovery,
      );
    }

    const evaluation = await evaluateConvergeReadOnlyV2(
      { ...request, confirmationToken: undefined },
      dependencies,
    );
    if (evaluation.exitCode === 2) return evaluation;
    if (
      evaluation.output.status !== "needs_work" ||
      !evaluation.output.confirmationToken ||
      request.confirmationToken !== evaluation.output.confirmationToken
    ) {
      throw commandError(
        "converge_not_confirmed",
        "Convergence state changed before the confirmation lock was acquired",
      );
    }
    return await beginConfirmedConvergenceV2(
      request,
      dependencies,
      projectRoot,
      loopStore,
      evaluation.output,
    );
  });
}

async function beginConfirmedConvergenceV2(
  request: ConvergeCommandRequestV2 & { confirmationToken: string },
  dependencies: ConvergeCommandDependenciesV2,
  projectRoot: string,
  loopStore: LoopStoreV2,
  readOnlyEvaluation: ConvergenceResultV2,
): Promise<ConvergeExecutionV2> {
  const source = await loopStore.peek(request.changeName);
  if (source.recoveryRequired || !source.state) {
    throw commandError(
      "converge_run_required",
      "Confirmed convergence requires one healthy canonical source run",
    );
  }
  if (source.state.phase === "invalidated") {
    throw commandError(
      "converge_recovery_intent_missing",
      "The invalidated source run has no valid durable convergence intent",
    );
  }

  const inspectPlanning = dependencies.inspectPlanning ?? inspectConvergencePlanningDefault;
  const git = (dependencies.createGit ?? createGitWorkspaceV2)(projectRoot);
  const planning = await inspectPlanning(projectRoot, request.changeName, request.store);
  const gitSnapshot = await git.snapshot();
  const canonical = await canonicalAssessmentForInspectionV2(
    loopStore,
    projectRoot,
    request.changeName,
    source,
    {
      revision: gitSnapshot.headRevision,
      workspaceFingerprint: gitSnapshot.workspaceFingerprint,
    },
    dependencies,
  );
  const assessment = resolveAssessment(true, canonical.assessment, request.assessment);
  validateAssessment(assessment);
  const run = runContext(source, canonical.reusableEvidenceGroupIds);
  if (!run) {
    throw commandError("converge_run_required", "Canonical source run disappeared");
  }
  const evaluation = evaluateConvergenceV2({
    changeName: request.changeName,
    planning,
    git: {
      revision: gitSnapshot.headRevision,
      workspaceFingerprint: gitSnapshot.workspaceFingerprint,
    },
    evidence: assessment.evidence,
    gaps: assessment.gaps,
    run,
  });
  if (
    evaluation.status !== "needs_work" ||
    !evaluation.taskGroupDraft ||
    evaluation.confirmationToken !== request.confirmationToken ||
    stableConvergenceJsonV2(evaluation) !== stableConvergenceJsonV2(readOnlyEvaluation)
  ) {
    throw commandError(
      "converge_confirmation_stale",
      "Canonical planning, Git, evidence, or source state changed before invalidation",
    );
  }

  await assertWritableArtifactPath(
    { changeRoot: planning.changeRoot },
    planning.taskArtifactPath,
  );
  assertPlanningArtifactIdentityV2(planning, undefined);
  const preTask = await readExactUtf8TaskV2(planning.taskArtifactPath);
  assertPreAppendPlanningV2(planning, evaluation, preTask.text);
  const postTask = renderConvergenceTaskContentV2(
    preTask.text,
    evaluation.taskGroupDraft.markdown,
  );
  const expectedPostPlanningRevision = await expectedPostPlanningRevisionV2(
    planning,
    Buffer.from(postTask, "utf8"),
    dependencies,
  );
  const reusableEvidenceGroups = reusableEvidenceGroupsV2(run, planning);
  const intent = createConvergenceIntentV2({
    changeName: request.changeName,
    sourceRunId: source.state.runId,
    sourceSessionId: source.state.sessionId,
    sourceStateRevision: source.state.stateRevision,
    sourceNonce: source.state.nonce,
    expectedPostPlanningRevision,
    preTaskBytes: preTask.bytes,
    postTaskBytes: Buffer.from(postTask, "utf8"),
    taskArtifactId: planning.taskArtifactId,
    taskArtifactPath: portableTaskArtifactPathV2(planning),
    successor: {
      runId: dependencies.newRunId?.() ?? `run-${randomUUID()}`,
      nonce: dependencies.newNonce?.() ?? randomUUID(),
      startedAt: dependencies.now?.() ?? new Date().toISOString(),
    },
    reusableEvidenceGroups,
    evaluation,
  });

  const executeLoop = dependencies.executeLoop ?? executeLoopV2;
  const invalidated = await executeLoop({
    operation: "invalidate",
    projectRoot,
    changeName: request.changeName,
    runId: source.state.runId,
    sessionId: source.state.sessionId,
    stateRevision: source.state.stateRevision,
    nonce: source.state.nonce,
    reason: "convergence appended a successor Task Group",
    reasonCode: "planning_invalidated",
    reasonDetails: {
      operation: "converge",
      convergenceIntent: intent,
    },
  }, dependencies.loopDependencies);
  if (invalidated.exitCode !== 0) {
    throw commandError(
      invalidated.output.error?.code ?? "run_invalidation_failed",
      invalidated.output.error?.message ?? "Failed to durably invalidate the source run",
    );
  }
  const recovery = await discoverConvergenceRecoveryV2(loopStore, request.changeName);
  if (!recovery) {
    throw commandError(
      "converge_intent_not_durable",
      "Source invalidation did not persist the exact convergence intent",
    );
  }
  assertExactConvergenceIntentV2(recovery.intent, intent);
  await injectConvergeFaultV2(dependencies, "after_run_invalidated", intent);
  return await recoverConfirmedConvergenceV2(
    request,
    dependencies,
    projectRoot,
    loopStore,
    recovery,
  );
}

async function discoverConvergenceRecoveryV2(
  loopStore: LoopStoreV2,
  changeName: string,
): Promise<DurableConvergenceRecoveryV2 | undefined> {
  const current = await loopStore.peek(changeName);
  if (current.recoveryRequired) {
    throw commandError(
      "converge_source_recovery_required",
      "Canonical loop state requires recovery before convergence can continue",
    );
  }
  const state = current.state;
  if (!state) return undefined;
  const direct = convergenceIntentFromStateV2(state);
  if (direct) return { intent: direct, source: current, current };
  if (!state.supersedesRunId) return undefined;
  const persistedSource = await loopStore.peek(changeName, { runId: state.supersedesRunId });
  // An explicit historical run is expected not to match current.json once its
  // successor is current. Canonical replay and artifact validation below still
  // fail closed on state, event, triage, or attempt corruption.
  const source = { ...persistedSource, recoveryRequired: false };
  if (!source.state) return undefined;
  const intent = convergenceIntentFromStateV2(source.state);
  if (!intent) return undefined;
  if (intent.successorRunId !== state.runId) {
    throw commandError(
      "converge_successor_identity_conflict",
      "Current successor does not match the durable convergence intent",
    );
  }
  return { intent, source, current };
}

function convergenceIntentFromStateV2(state: LoopStateV2): ConvergenceIntentV2 | undefined {
  if (state.phase !== "invalidated") return undefined;
  const details = state.blockedReason?.details;
  if (!details || details["operation"] !== "converge") return undefined;
  const value = details["convergenceIntent"];
  assertConvergenceIntentV2(value);
  if (
    value.changeName !== state.changeName ||
    value.sourceRunId !== state.runId ||
    value.sourceSessionId !== state.sessionId
  ) {
    throw commandError(
      "converge_intent_source_mismatch",
      "Durable convergence intent is bound to a different canonical source",
    );
  }
  return value;
}

function requireConfirmationToken(intent: ConvergenceIntentV2, token: string): void {
  if (token !== intent.confirmationToken) {
    throw commandError(
      "converge_not_confirmed",
      "Confirmation token does not match the durable convergence intent",
    );
  }
}

async function recoverConfirmedConvergenceV2(
  request: ConvergeCommandRequestV2 & { confirmationToken: string },
  dependencies: ConvergeCommandDependenciesV2,
  projectRoot: string,
  loopStore: LoopStoreV2,
  recovery: DurableConvergenceRecoveryV2,
): Promise<ConvergeExecutionV2> {
  const { intent } = recovery;
  requireConfirmationToken(intent, request.confirmationToken);
  validateInvalidationRecordV2(recovery.source, intent);
  await validateCanonicalIntentSourceV2(
    loopStore,
    projectRoot,
    request.changeName,
    recovery.source,
    intent,
    dependencies,
  );

  const inspectPlanning = dependencies.inspectPlanning ?? inspectConvergencePlanningDefault;
  const git = (dependencies.createGit ?? createGitWorkspaceV2)(projectRoot);
  let planning = await inspectPlanning(projectRoot, request.changeName, request.store);
  assertPlanningArtifactIdentityV2(planning, intent);
  await assertWritableArtifactPath(
    { changeRoot: planning.changeRoot },
    planning.taskArtifactPath,
  );
  let task = await readExactUtf8TaskV2(planning.taskArtifactPath);
  let taskState = classifyRecoveryTaskBytesV2(task, intent);

  if (taskState === "pre") {
    assertPreAppendPlanningV2(planning, intent.evaluation, task.text);
    await assertRecoveryGitV2(git, projectRoot, planning.taskArtifactPath, task, intent, false);
    await appendConvergenceTaskGroupAtomicallyV2(
      planning.taskArtifactPath,
      task.text,
      intent.evaluation.taskGroupDraft!.markdown,
      {
        afterRename: async () => {
          await injectConvergeFaultV2(dependencies, "after_task_rename", intent);
        },
        afterDirectoryFsync: async () => {
          await injectConvergeFaultV2(
            dependencies,
            "after_task_directory_fsync",
            intent,
          );
        },
      },
    );
    task = await readExactUtf8TaskV2(planning.taskArtifactPath);
    taskState = classifyRecoveryTaskBytesV2(task, intent);
    if (taskState !== "post") {
      throw commandError(
        "converge_append_not_exact",
        "The authoritative task artifact is not the exact persisted post-append content",
      );
    }
  }

  await assertRecoveryGitV2(git, projectRoot, planning.taskArtifactPath, task, intent, true);
  planning = await inspectPlanning(projectRoot, request.changeName, request.store);
  assertPlanningArtifactIdentityV2(planning, intent);
  assertPostAppendPlanningV2(planning, intent, task.text);
  await assertRecoveryGitV2(git, projectRoot, planning.taskArtifactPath, task, intent, true);
  await injectConvergeFaultV2(dependencies, "after_post_append_ready", intent);

  const successorRunId = await initializeExactSuccessorV2(
    loopStore,
    recovery.source,
    planning,
    git,
    intent,
  );
  await injectConvergeFaultV2(dependencies, "after_successor_initialized", intent);
  return {
    exitCode: 0,
    output: {
      ...structuredClone(intent.evaluation),
      applied: true,
      successor: {
        supersedesRunId: intent.sourceRunId,
        reusableEvidenceGroups: [...intent.reusableEvidenceGroups],
        planningRevision: planning.planningRevision,
        runId: successorRunId,
      },
    },
  };
}

async function canonicalAssessmentForInspectionV2(
  loopStore: LoopStoreV2,
  projectRoot: string,
  changeName: string,
  inspection: LoopStoreInspectionV2,
  currentGit: { revision: string; workspaceFingerprint: string },
  dependencies: ConvergeCommandDependenciesV2,
): Promise<{
  assessment: ConvergenceAssessmentV2;
  reusableEvidenceGroupIds: string[];
}> {
  if (!inspection.state) {
    return { assessment: { evidence: [], gaps: [] }, reusableEvidenceGroupIds: [] };
  }
  const paths = loopStore.paths(changeName, inspection.state.runId);
  const provenance = await resolveCanonicalProvenanceV2(
    loopStore,
    projectRoot,
    changeName,
    inspection,
    [],
    16,
  );
  const canonical = await (
    dependencies.deriveCanonicalAssessment ?? deriveCanonicalConvergenceEvidenceV2
  )({
    inspection,
    attemptsRoot: paths.attempts!,
    reviewTriagePath: paths.reviewTriage,
    currentGit,
    ...provenance,
  });
  const finalized = inspection.state.phase === "done" ||
    inspection.events.some((record) => record.event.type === "run_finalized");
  return {
    assessment: finalized
      ? { evidence: canonical.evidence, gaps: canonical.gaps }
      : {
          evidence: canonical.evidence.filter((entry) => entry.status === "fail"),
          gaps: canonical.gaps,
        },
    reusableEvidenceGroupIds: canonical.reusableEvidenceGroupIds ?? [],
  };
}

async function validateCanonicalIntentSourceV2(
  loopStore: LoopStoreV2,
  projectRoot: string,
  changeName: string,
  source: LoopStoreInspectionV2,
  intent: ConvergenceIntentV2,
  dependencies: ConvergeCommandDependenciesV2,
): Promise<void> {
  if (source.state?.planningRevision !== intent.prePlanningRevision) {
    throw commandError(
      "converge_source_planning_mismatch",
      "Canonical source planning revision differs from the durable convergence intent",
    );
  }
  const sourcePaths = loopStore.paths(changeName, intent.sourceRunId);
  await assertCompleteJsonlV2(sourcePaths.reviewTriage!, "canonical review triage");
  const canonical = await canonicalAssessmentForInspectionV2(
    loopStore,
    projectRoot,
    changeName,
    source,
    {
      revision: intent.preGitRevision,
      workspaceFingerprint: intent.preWorkspaceFingerprint,
    },
    dependencies,
  );
  if (!isDeepStrictEqual(canonical.assessment.evidence, intent.evaluation.evidence)) {
    throw commandError(
      "converge_canonical_evidence_changed",
      "Canonical source evidence no longer matches the durable convergence intent",
    );
  }
  assertCanonicalGapsPreservedV2(canonical.assessment.gaps, intent.evaluation.gaps);
  const sourceRun = runContext(source, canonical.reusableEvidenceGroupIds);
  if (!sourceRun) {
    throw commandError("converge_source_missing", "Canonical convergence source is missing");
  }
  const groupNumbers = Object.values(source.state!.groups)
    .sort((left, right) => left.ordinal - right.ordinal)
    .map((group) => Number(group.id));
  const reusable = reusableEvidenceGroupsFromFingerprintsV2(
    sourceRun,
    intent.evaluation.originalGroupFingerprints,
    groupNumbers,
  );
  if (!isDeepStrictEqual(reusable, intent.reusableEvidenceGroups)) {
    throw commandError(
      "converge_reusable_evidence_changed",
      "Canonical reusable evidence prefix no longer matches the durable intent",
    );
  }
}

function assertCanonicalGapsPreservedV2(
  canonical: readonly ImplementationGapV2[],
  persisted: readonly ImplementationGapV2[],
): void {
  const byId = new Map(persisted.map((gap) => [gap.id, gap]));
  for (const gap of canonical) {
    const actual = byId.get(gap.id);
    if (
      !actual ||
      actual.summary !== gap.summary ||
      actual.details !== gap.details ||
      (
        gap.suggestedTasks !== undefined &&
        !isDeepStrictEqual(actual.suggestedTasks, gap.suggestedTasks)
      )
    ) {
      throw commandError(
        "converge_canonical_gap_changed",
        `Canonical implementation gap '${gap.id}' no longer matches the durable intent`,
      );
    }
  }
}

function validateInvalidationRecordV2(
  source: LoopStoreInspectionV2,
  intent: ConvergenceIntentV2,
): void {
  const record = source.events.at(-1);
  const event = record?.event;
  if (
    !source.state ||
    source.state.phase !== "invalidated" ||
    !record ||
    !event ||
    event.type !== "run_invalidated" ||
    event.expectedStateRevision !== intent.sourceStateRevision ||
    event.expectedNonce !== intent.sourceNonce ||
    event.runId !== intent.sourceRunId ||
    event.reason.code !== "planning_invalidated" ||
    event.reason.details["operation"] !== "converge"
  ) {
    throw commandError(
      "converge_invalidation_record_mismatch",
      "Canonical invalidation event does not match the durable convergence intent",
    );
  }
  assertExactConvergenceIntentV2(event.reason.details["convergenceIntent"], intent);
}

function assertPlanningArtifactIdentityV2(
  planning: ConvergencePlanningContextV2,
  intent: ConvergenceIntentV2 | undefined,
): void {
  if (!planning.taskArtifactId.trim() || !planning.taskArtifactPath.trim()) {
    throw commandError(
      "converge_task_artifact_missing",
      "Convergence requires exactly one authoritative task artifact",
    );
  }
  if (!intent) return;
  if (
    planning.taskArtifactId !== intent.taskArtifactId ||
    hashConvergenceTaskArtifactPathV2(portableTaskArtifactPathV2(planning)) !==
      intent.taskArtifactPathHash
  ) {
    throw commandError(
      "converge_task_artifact_identity_changed",
      "The authoritative task artifact changed after convergence confirmation",
    );
  }
}

function portableTaskArtifactPathV2(planning: ConvergencePlanningContextV2): string {
  const changeRoot = resolve(planning.changeRoot);
  const taskPath = resolve(planning.taskArtifactPath);
  const rel = relative(changeRoot, taskPath);
  if (
    !rel ||
    isAbsolute(rel) ||
    rel === ".." ||
    rel.startsWith(`..${sep}`)
  ) {
    throw commandError(
      "converge_task_artifact_path_unsafe",
      "The authoritative task artifact must be contained by the resolved change root",
    );
  }
  return rel.split(sep).join("/");
}

async function readExactUtf8TaskV2(path: string): Promise<TaskBytesV2> {
  const bytes = Buffer.from(await readFile(path));
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) {
    throw commandError(
      "converge_task_artifact_encoding_invalid",
      "The authoritative task artifact is not exact UTF-8",
    );
  }
  return { bytes, text };
}

function classifyRecoveryTaskBytesV2(
  task: TaskBytesV2,
  intent: ConvergenceIntentV2,
): "pre" | "post" {
  const digest = hashConvergenceTaskBytesV2(task.bytes);
  if (digest === intent.preTaskBytesHash) return "pre";
  if (digest !== intent.postTaskBytesHash) {
    throw commandError(
      "converge_task_artifact_tampered",
      "Task artifact bytes match neither the persisted pre-append nor post-append state",
    );
  }
  const markdown = intent.evaluation.taskGroupDraft!.markdown;
  const candidates = new Set<string>();
  for (const separator of ["", "\n", "\n\n"]) {
    const suffix = `${separator}${markdown}`;
    if (!task.text.endsWith(suffix)) continue;
    const candidate = task.text.slice(0, -suffix.length);
    if (
      hashConvergenceTaskBytesV2(Buffer.from(candidate, "utf8")) ===
        intent.preTaskBytesHash &&
      renderConvergenceTaskContentV2(candidate, markdown) === task.text
    ) {
      candidates.add(candidate);
    }
  }
  if (candidates.size !== 1) {
    throw commandError(
      "converge_task_artifact_post_state_ambiguous",
      "Exact post-append bytes cannot be uniquely reduced to the persisted pre-append bytes",
    );
  }
  return "post";
}

function assertPreAppendPlanningV2(
  planning: ConvergencePlanningContextV2,
  evaluation: ConvergenceResultV2,
  taskContent: string,
): void {
  if (
    !planning.valid ||
    !planning.ready ||
    planning.planningRevision !== evaluation.planningRevision ||
    !isDeepStrictEqual(
      fingerprintTaskGroupsV2(planning.taskGroups),
      evaluation.originalGroupFingerprints,
    ) ||
    !isDeepStrictEqual(
      fingerprintTaskGroupsV2(parseTaskGroupsDocument(taskContent).groups),
      evaluation.originalGroupFingerprints,
    )
  ) {
    throw commandError(
      "converge_planning_changed",
      "Planning or existing Task Groups changed before the convergence append",
    );
  }
  const next = Math.max(0, ...planning.taskGroups.map((group) => group.number)) + 1;
  if (evaluation.taskGroupDraft?.number !== next) {
    throw commandError(
      "converge_task_group_number_changed",
      "The persisted convergence Task Group number is no longer the next group",
    );
  }
}

function assertPostAppendPlanningV2(
  planning: ConvergencePlanningContextV2,
  intent: ConvergenceIntentV2,
  taskContent: string,
): void {
  if (!planning.valid || !planning.ready) {
    throw commandError(
      "converge_post_append_planning_invalid",
      planning.issues.join("; ") || "Post-append planning is not strictly valid and ready",
    );
  }
  requireArtifactHash(planning.planningRevision, "post-append planningRevision");
  if (planning.planningRevision !== intent.expectedPostPlanningRevision) {
    throw commandError(
      "converge_post_append_revision_mismatch",
      "Post-append planning revision differs from the precomputed virtual revision",
    );
  }
  const parsed = parseTaskGroupsDocument(taskContent).groups;
  const parsedFingerprints = fingerprintTaskGroupsV2(parsed);
  const planningFingerprints = fingerprintTaskGroupsV2(planning.taskGroups);
  if (!isDeepStrictEqual(parsedFingerprints, planningFingerprints)) {
    throw commandError(
      "converge_post_append_task_mismatch",
      "Ready planning does not describe the exact authoritative task artifact",
    );
  }
  const originalIds = Object.keys(intent.evaluation.originalGroupFingerprints);
  if (
    parsed.length !== originalIds.length + 1 ||
    originalIds.some((id) =>
      parsedFingerprints[id] !== intent.evaluation.originalGroupFingerprints[id]
    ) ||
    parsed.at(-1)?.number !== intent.evaluation.taskGroupDraft!.number ||
    hashConvergenceTaskGroupDraftV2(intent.evaluation.taskGroupDraft!) !== intent.draftHash ||
    hashConvergenceOriginalGroupFingerprintsV2(
      intent.evaluation.originalGroupFingerprints,
    ) !== intent.originalGroupFingerprintsHash
  ) {
    throw commandError(
      "converge_post_append_task_mismatch",
      "Post-append planning is not the exact original groups plus the persisted draft",
    );
  }
}

async function expectedPostPlanningRevisionV2(
  planning: ConvergencePlanningContextV2,
  postTaskBytes: Uint8Array,
  dependencies: ConvergeCommandDependenciesV2,
): Promise<string> {
  if (dependencies.previewPostPlanningRevision) {
    return requireArtifactHash(
      await dependencies.previewPostPlanningRevision(planning, postTaskBytes),
      "expected post-append planningRevision",
    );
  }
  const input = planning.revisionInput;
  if (!input) {
    throw commandError(
      "converge_planning_overlay_unavailable",
      "Confirmed convergence requires the authoritative planning artifact manifest",
    );
  }
  const taskPath = resolve(planning.taskArtifactPath);
  const base = {
    schemaName: input.schemaName,
    changeRoot: planning.changeRoot,
    artifactPaths: input.artifactPaths,
    taskArtifactId: planning.taskArtifactId,
  };
  const actualPre = await computeRunPlanningRevisionV2(base);
  if (actualPre !== planning.planningRevision) {
    throw commandError(
      "converge_planning_revision_mismatch",
      "Authoritative planning revision does not match its artifact manifest",
    );
  }
  return await computeRunPlanningRevisionV2({
    ...base,
    reader: {
      async read(filePath: string): Promise<Uint8Array> {
        return resolve(filePath) === taskPath ? postTaskBytes : await readFile(filePath);
      },
    },
  });
}

async function assertRecoveryGitV2(
  git: GitWorkspaceV2,
  projectRoot: string,
  taskPath: string,
  task: TaskBytesV2,
  intent: ConvergenceIntentV2,
  postAppend: boolean,
): Promise<void> {
  const snapshot = await git.snapshot();
  if (snapshot.headRevision !== intent.preGitRevision) {
    throw commandError(
      "converge_git_revision_changed",
      "Git HEAD changed after convergence confirmation",
    );
  }
  let preWorkspace = snapshot.workspaceFingerprint;
  if (postAppend && isContainedPathV2(projectRoot, taskPath)) {
    const preContent = recoverPreTaskTextV2(task.text, intent);
    preWorkspace = await git.workspaceFingerprintWithOverlays([{
      path: taskPath,
      content: Buffer.from(preContent, "utf8"),
    }]);
  }
  if (preWorkspace !== intent.preWorkspaceFingerprint) {
    throw commandError(
      "converge_workspace_changed",
      "Workspace bytes other than the exact convergence task append changed",
    );
  }
}

function recoverPreTaskTextV2(postContent: string, intent: ConvergenceIntentV2): string {
  const markdown = intent.evaluation.taskGroupDraft!.markdown;
  const candidates = new Set<string>();
  for (const separator of ["", "\n", "\n\n"]) {
    const suffix = `${separator}${markdown}`;
    if (!postContent.endsWith(suffix)) continue;
    const candidate = postContent.slice(0, -suffix.length);
    if (
      hashConvergenceTaskBytesV2(Buffer.from(candidate, "utf8")) ===
        intent.preTaskBytesHash &&
      renderConvergenceTaskContentV2(candidate, markdown) === postContent
    ) candidates.add(candidate);
  }
  if (candidates.size !== 1) {
    throw commandError(
      "converge_task_artifact_post_state_ambiguous",
      "Cannot construct the read-only pre-append workspace overlay",
    );
  }
  return [...candidates][0]!;
}

function isContainedPathV2(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function reusableEvidenceGroupsV2(
  run: ConvergenceRunContextV2,
  planning: ConvergencePlanningContextV2,
): string[] {
  return reusableEvidenceGroupsFromFingerprintsV2(
    run,
    fingerprintTaskGroupsV2(planning.taskGroups),
    planning.taskGroups.map((group) => group.number),
  );
}

function reusableEvidenceGroupsFromFingerprintsV2(
  run: ConvergenceRunContextV2,
  fingerprints: Record<string, string>,
  groupNumbers: readonly number[],
): string[] {
  const approved = new Set(run.approvedEvidenceGroups);
  const reusable: string[] = [];
  for (const number of [...groupNumbers].sort((left, right) => left - right)) {
    const id = String(number);
    if (
      !approved.has(id) ||
      fingerprints[id] === undefined ||
      fingerprints[id] !== run.groupFingerprints[id]
    ) break;
    reusable.push(id);
  }
  return reusable;
}

async function initializeExactSuccessorV2(
  loopStore: LoopStoreV2,
  sourceInspection: LoopStoreInspectionV2,
  planning: ConvergencePlanningContextV2,
  git: GitWorkspaceV2,
  intent: ConvergenceIntentV2,
): Promise<string> {
  const previousState = sourceInspection.state;
  if (!previousState || previousState.phase !== "invalidated") {
    throw commandError(
      "successor_source_unavailable",
      "The durable convergence source is not exactly invalidated",
    );
  }
  const snapshot = await git.snapshot();
  if (snapshot.headRevision !== intent.preGitRevision) {
    throw commandError(
      "successor_git_revision_changed",
      "Git HEAD changed before successor initialization",
    );
  }
  const fingerprints = fingerprintTaskGroupsV2(planning.taskGroups);
  const successor = createSuccessorRunV2({
    previousState,
    runId: intent.successorRunId,
    sessionId: previousState.sessionId,
    owner: previousState.owner,
    nonce: intent.successorNonce,
    startedAt: intent.successorStartedAt,
    planningRevision: requireArtifactHash(planning.planningRevision, "planningRevision"),
    baselineGitRevision: snapshot.headRevision,
    workspaceFingerprint: requireArtifactHash(
      snapshot.workspaceFingerprint,
      "workspaceFingerprint",
    ),
    groups: planning.taskGroups.map((group) => ({
      id: String(group.number),
      taskGroupFingerprint: requireArtifactHash(
        fingerprints[String(group.number)]!,
        `Task Group ${group.number} fingerprint`,
      ),
    })),
    reusableEvidenceGroupIds: intent.reusableEvidenceGroups,
  });
  if (!isDeepStrictEqual(successor.reusableEvidenceGroups, intent.reusableEvidenceGroups)) {
    throw commandError(
      "successor_reuse_mismatch",
      "Deterministic successor reuse differs from the durable convergence intent",
    );
  }
  const event = createRunInitializedEventV2(successor.state);
  const successorPaths = loopStore.paths(intent.changeName, intent.successorRunId);
  const successorExists = await pathEntryExistsV2(successorPaths.runRoot!);
  if (successorExists) {
    const existing = await loopStore.peek(intent.changeName, { runId: intent.successorRunId });
    if (
      !existing.state ||
      existing.events.length !== 1 ||
      !isDeepStrictEqual(existing.state, successor.state) ||
      !isDeepStrictEqual(existing.events[0]?.event, event)
    ) {
      throw commandError(
        "successor_identity_conflict",
        "Persisted deterministic successor differs from the durable convergence intent",
      );
    }
    const triage = await readFile(successorPaths.reviewTriage!).catch((error: unknown) => {
      if (isMissingPathV2(error)) return Buffer.alloc(0);
      throw error;
    });
    const attempts = await readdir(successorPaths.attempts!).catch((error: unknown) => {
      if (isMissingPathV2(error)) return [];
      throw error;
    });
    if (triage.byteLength !== 0 || attempts.length !== 0) {
      throw commandError(
        "successor_identity_conflict",
        "Persisted deterministic successor contains unexpected attempt or triage artifacts",
      );
    }
    const current = await loopStore.peek(intent.changeName);
    if (
      current.state?.runId === successor.state.runId &&
      isDeepStrictEqual(current.state, successor.state)
    ) return successor.state.runId;
  }
  await loopStore.initialize({ state: successor.state, event });
  return successor.state.runId;
}

async function pathEntryExistsV2(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissingPathV2(error)) return false;
    throw error;
  }
}

async function assertCompleteJsonlV2(path: string, label: string): Promise<void> {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(await readFile(path));
  } catch (error) {
    throw commandError(
      "converge_canonical_log_incomplete",
      `${label} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (bytes.byteLength > 0 && bytes.at(-1) !== 0x0a) {
    throw commandError(
      "converge_canonical_log_incomplete",
      `${label} has a non-durable trailing record`,
    );
  }
}

function isMissingPathV2(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT",
  );
}

async function injectConvergeFaultV2(
  dependencies: ConvergeCommandDependenciesV2,
  point: ConvergeFaultPointV2,
  intent: ConvergenceIntentV2,
): Promise<void> {
  await dependencies.faults?.(point, {
    changeName: intent.changeName,
    sourceRunId: intent.sourceRunId,
    successorRunId: intent.successorRunId,
  });
}

function blockedConvergeExecution(
  request: ConvergeCommandRequestV2,
  error: unknown,
): ConvergeExecutionV2 {
  return {
    exitCode: 2,
    output: {
      schemaVersion: 2,
      changeName: request.changeName,
      status: "blocked",
      planningRevision: "",
      gitRevision: "",
      workspaceFingerprint: "",
      evidence: Array.isArray(request.assessment?.evidence) ? request.assessment.evidence : [],
      gaps: Array.isArray(request.assessment?.gaps) ? request.assessment.gaps : [],
      originalGroupFingerprints: {},
      reason: {
        code: errorCode(error),
        message: error instanceof Error ? error.message : String(error),
      },
    },
  };
}

async function inspectConvergencePlanningDefault(
  projectRoot: string,
  changeName: string,
  store?: string,
): Promise<ConvergencePlanningContextV2> {
  const config = loadConfigFromDir(projectRoot);
  const adapter = createOpenSpecAdapter(projectRoot);
  const resolved = await createArtifactResolver(adapter).resolve(changeName, { store });
  const { report } = await buildLifecycleReadyReport(
    adapter,
    resolved,
    config,
    true,
    { store },
  );
  const taskPaths = resolved.artifactPaths[report.taskArtifactId]?.existingOutputPaths ?? [];
  return {
    valid: report.checks.every((check) => check.code !== "OPENSPEC_STRICT_VALIDATION" || check.status === "pass"),
    ready: report.status === "ready",
    planningRevision: await computeRunPlanningRevisionV2({
      schemaName: resolved.schemaName,
      changeRoot: resolved.changeRoot,
      artifactPaths: resolved.artifactPaths,
      taskArtifactId: report.taskArtifactId,
    }),
    changeRoot: resolved.changeRoot,
    taskArtifactId: report.taskArtifactId,
    taskArtifactPath: taskPaths.length === 1 ? taskPaths[0]! : "",
    taskGroups: report.taskGroups,
    revisionInput: {
      schemaName: resolved.schemaName,
      artifactPaths: resolved.artifactPaths,
    },
    issues: report.checks
      .filter((check) => check.status !== "pass")
      .map((check) => `${check.code}: ${check.message}`),
  };
}

function runContext(
  inspection: LoopStoreInspectionV2,
  reusableEvidenceGroupIds: readonly string[],
): ConvergenceRunContextV2 | undefined {
  const state = inspection.state;
  if (!state) return undefined;
  const groups = Object.values(state.groups);
  const latestObserved = groups
    .filter((group) => group.bundle.observedGitRevision)
    .sort((left, right) => right.ordinal - left.ordinal)[0]?.bundle.observedGitRevision;
  return {
    runId: state.runId,
    stateRevision: state.stateRevision,
    nonce: state.nonce,
    sessionId: state.sessionId,
    planningRevision: state.planningRevision,
    observedGitRevision: state.git.finalRevision ?? latestObserved ?? state.git.baselineRevision,
    groupFingerprints: Object.fromEntries(
      groups.map((group) => [group.id, group.taskGroupFingerprint]),
    ),
    approvedEvidenceGroups: [...reusableEvidenceGroupIds],
  };
}

interface ResolvedCanonicalProvenanceV2 {
  trustedLegacyGroupIds?: string[];
  successorSource?: CanonicalSuccessorSourceV2;
}

async function resolveCanonicalProvenanceV2(
  store: LoopStoreV2,
  projectRoot: string,
  changeName: string,
  inspection: LoopStoreInspectionV2,
  ancestors: string[],
  remainingDepth: number,
): Promise<ResolvedCanonicalProvenanceV2> {
  const state = inspection.state;
  if (!state) return {};
  if (ancestors.includes(state.runId)) {
    throw commandError(
      "canonical_provenance_cycle",
      `Canonical provenance cycle: ${[...ancestors, state.runId].join(" -> ")}`,
    );
  }
  if (remainingDepth <= 0) {
    throw commandError("canonical_provenance_depth", "Canonical provenance exceeds depth 16");
  }
  const nextAncestors = [...ancestors, state.runId];
  const trustedLegacyGroupIds = await resolveTrustedLegacyGroupsV2(
    projectRoot,
    changeName,
    state,
  );
  const localAttemptGroups = new Set(
    inspection.events
      .filter((record) => record.event.type === "bundle_submitted")
      .map((record) => record.event.type === "bundle_submitted" ? record.event.groupId : ""),
  );
  const needsSource = Object.values(state.groups).some((group) =>
    group.status === "completed" &&
    !group.bundle.bundleId?.startsWith("legacy-v1-") &&
    !localAttemptGroups.has(group.id)
  );
  let successorSource: CanonicalSuccessorSourceV2 | undefined;
  if (needsSource) {
    if (!state.supersedesRunId) {
      return trustedLegacyGroupIds.length > 0 ? { trustedLegacyGroupIds } : {};
    }
    const sourceInspection = await store.peek(changeName, { runId: state.supersedesRunId });
    if (!sourceInspection.state) {
      return trustedLegacyGroupIds.length > 0 ? { trustedLegacyGroupIds } : {};
    }
    const sourceProvenance = await resolveCanonicalProvenanceV2(
      store,
      projectRoot,
      changeName,
      { ...sourceInspection, recoveryRequired: false },
      nextAncestors,
      remainingDepth - 1,
    );
    const sourcePaths = store.paths(changeName, state.supersedesRunId);
    successorSource = {
      inspection: { ...sourceInspection, recoveryRequired: false },
      attemptsRoot: sourcePaths.attempts!,
      reviewTriagePath: sourcePaths.reviewTriage,
      ...sourceProvenance,
    };
  }
  return {
    ...(trustedLegacyGroupIds.length > 0 ? { trustedLegacyGroupIds } : {}),
    ...(successorSource ? { successorSource } : {}),
  };
}

async function resolveTrustedLegacyGroupsV2(
  projectRoot: string,
  changeName: string,
  state: LoopStateV2,
): Promise<string[]> {
  const legacyGroups = Object.values(state.groups)
    .filter((group) => group.bundle.bundleId?.startsWith("legacy-v1-") === true)
    .sort((left, right) => left.ordinal - right.ordinal);
  if (legacyGroups.length === 0) return [];
  const verified = await verifyLegacyMigrationArchiveV2({
    projectRoot,
    changeName,
    runId: state.runId,
  });
  const mapped = verified.trustedLegacyGroupIds.map((ordinal) =>
    Object.values(state.groups).find((group) => group.ordinal === Number(ordinal))
  );
  if (
    mapped.some((group) => !group) ||
    mapped.some((group, index) =>
      group!.ordinal !== index + 1 ||
      group!.status !== "completed" ||
      !group!.bundle.bundleId?.startsWith("legacy-v1-")
    ) ||
    JSON.stringify(mapped.map((group) => group!.id)) !==
      JSON.stringify(legacyGroups.map((group) => group.id))
  ) {
    throw commandError(
      "legacy_migration_verification_mismatch",
      "Verified migration groups do not match the completed legacy prefix",
    );
  }
  return mapped.map((group) => group!.id);
}

function requireArtifactHash(value: string, label: string): ArtifactHashV2 {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw commandError("successor_hash_invalid", `${label} is not a sha256 artifact hash`);
  }
  return value as ArtifactHashV2;
}

function validateAssessment(value: ConvergenceAssessmentV2): void {
  if (!value || !Array.isArray(value.evidence) || !Array.isArray(value.gaps)) {
    throw commandError("assessment_invalid", "Converge input requires evidence[] and gaps[]");
  }
  const evidenceIds = new Set<string>();
  for (const [index, entry] of value.evidence.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw commandError("assessment_invalid", `evidence[${index}] must be an object`);
    }
    requireAssessmentString(entry.id, `evidence[${index}].id`, true);
    requireAssessmentString(entry.planningRevision, `evidence[${index}].planningRevision`);
    requireAssessmentString(entry.observedGitRevision, `evidence[${index}].observedGitRevision`);
    requireAssessmentString(entry.workspaceFingerprint, `evidence[${index}].workspaceFingerprint`);
    requireAssessmentString(entry.summary, `evidence[${index}].summary`);
    if (entry.status !== "pass" && entry.status !== "fail") {
      throw commandError(
        "assessment_invalid",
        `evidence[${index}].status must be 'pass' or 'fail'`,
      );
    }
    if (evidenceIds.has(entry.id)) {
      throw commandError("assessment_invalid", `Duplicate evidence id: '${entry.id}'`);
    }
    evidenceIds.add(entry.id);
  }

  const gapIds = new Set<string>();
  for (const [index, gap] of value.gaps.entries()) {
    if (!gap || typeof gap !== "object" || Array.isArray(gap)) {
      throw commandError("assessment_invalid", `gaps[${index}] must be an object`);
    }
    const id = requireAssessmentString(gap.id, `gaps[${index}].id`, true);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id)) {
      throw commandError(
        "assessment_invalid",
        `gaps[${index}].id must be a portable safe segment`,
      );
    }
    if (gapIds.has(id)) {
      throw commandError("assessment_invalid", `Duplicate gap id: '${id}'`);
    }
    gapIds.add(id);
    requireAssessmentString(gap.summary, `gaps[${index}].summary`, true);
    if (gap.details !== undefined && typeof gap.details !== "string") {
      throw commandError("assessment_invalid", `gaps[${index}].details must be a string`);
    }
    if (gap.suggestedTasks !== undefined) {
      if (!Array.isArray(gap.suggestedTasks) || gap.suggestedTasks.length === 0) {
        throw commandError(
          "assessment_invalid",
          `gaps[${index}].suggestedTasks must be a non-empty array when provided`,
        );
      }
      for (const [taskIndex, task] of gap.suggestedTasks.entries()) {
        requireAssessmentString(
          task,
          `gaps[${index}].suggestedTasks[${taskIndex}]`,
          true,
        );
      }
    }
  }
}

function resolveAssessment(
  hasCanonicalRun: boolean,
  canonical: ConvergenceAssessmentV2,
  supplement: ConvergenceAssessmentV2 | undefined,
): ConvergenceAssessmentV2 {
  validateAssessment(canonical);
  if (!hasCanonicalRun) {
    if (supplement) validateAssessment(supplement);
    return supplement ?? canonical;
  }
  if (!supplement) return canonical;
  validateAssessment(supplement);
  if (supplement.evidence.length > 0) {
    throw commandError(
      "assessment_evidence_authoritative",
      "Explicit evidence cannot replace canonical run evidence; submit only supplemental gaps",
    );
  }
  const gaps = canonical.gaps.map((gap) => structuredClone(gap));
  const byId = new Map(gaps.map((gap) => [gap.id, gap]));
  for (const supplemental of supplement.gaps) {
    const existing = byId.get(supplemental.id);
    if (!existing) {
      const cloned = structuredClone(supplemental);
      gaps.push(cloned);
      byId.set(cloned.id, cloned);
      continue;
    }
    if (
      existing.summary !== supplemental.summary ||
      (existing.details ?? undefined) !== (supplemental.details ?? undefined) ||
      (
        existing.suggestedTasks !== undefined &&
        supplemental.suggestedTasks !== undefined &&
        JSON.stringify(existing.suggestedTasks) !== JSON.stringify(supplemental.suggestedTasks)
      )
    ) {
      throw commandError(
        "assessment_gap_conflict",
        `Supplemental gap '${supplemental.id}' conflicts with canonical gap content`,
      );
    }
    if (existing.suggestedTasks === undefined && supplemental.suggestedTasks !== undefined) {
      existing.suggestedTasks = structuredClone(supplemental.suggestedTasks);
    }
  }
  return { evidence: canonical.evidence, gaps };
}

function requireAssessmentString(
  value: unknown,
  label: string,
  singleLine = false,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw commandError("assessment_invalid", `${label} must be a non-empty string`);
  }
  if (singleLine && /[\r\n]/u.test(value)) {
    throw commandError("assessment_invalid", `${label} must be a single line`);
  }
  return value;
}

function commandError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : error instanceof Error
      ? error.name
      : "converge_contract_error";
}

export function createConvergeCommand(
  dependencies: ConvergeCommandDependenciesV2 = {},
): Command {
  return new Command("converge")
    .description("Evaluate or confirm implementation convergence")
    .argument("<change>")
    .option("--input <file>", "JSON assessment; defaults to stdin")
    .option("--confirm <token>", "Exact confirmationToken from needs_work output")
    .option("--store <id>", "OpenSpec Store id")
    .option("--path <dir>", "Working directory", ".")
    .option("--json")
    .action(async (change: string, opts: {
      input?: string;
      confirm?: string;
      store?: string;
      path: string;
      json?: boolean;
    }) => {
      let execution: ConvergeExecutionV2;
      try {
        const assessment = opts.input
          ? JSON.parse(await readFile(resolve(opts.path, opts.input), "utf8"))
          : await readAssessmentStdin();
        execution = await executeConvergeV2({
          projectRoot: opts.path,
          changeName: change,
          store: opts.store,
          assessment,
          confirmationToken: opts.confirm,
        }, dependencies);
      } catch (error) {
        execution = inputErrorExecution(change, error);
      }
      if (opts.json) process.stdout.write(`${JSON.stringify(execution.output)}\n`);
      else if (execution.exitCode === 2) process.stderr.write(`${execution.output.reason?.message}\n`);
      else process.stdout.write(`${execution.output.status}\n`);
      process.exitCode = execution.exitCode;
    });
}

async function readAssessmentStdin(): Promise<ConvergenceAssessmentV2 | undefined> {
  if (process.stdin.isTTY) return undefined;
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  if (!input.trim()) return undefined;
  return JSON.parse(input) as ConvergenceAssessmentV2;
}

function inputErrorExecution(changeName: string, error: unknown): ConvergeExecutionV2 {
  return {
    exitCode: 2,
    output: {
      schemaVersion: 2,
      changeName,
      status: "blocked",
      planningRevision: "",
      gitRevision: "",
      workspaceFingerprint: "",
      evidence: [],
      gaps: [],
      originalGroupFingerprints: {},
      reason: {
        code: "input_invalid",
        message: error instanceof Error ? error.message : String(error),
      },
    },
  };
}
