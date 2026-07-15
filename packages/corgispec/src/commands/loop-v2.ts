import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Command } from "commander";
import { createArtifactResolver } from "../lib/artifact-resolver.js";
import {
  assertCanonicalFinalizationEvidenceV2,
  type CanonicalSuccessorSourceV2,
} from "../lib/canonical-convergence-evidence-v2.js";
import { loadConfigFromDir } from "../lib/config.js";
import {
  assertEvidenceBundleV2,
  createEvidenceBundleV2,
  createReviewFindingV2,
  hashArtifactBytesV2,
  hashCanonicalArtifactV2,
  hashReviewFindingsV2,
  validateFindingTriageV2,
  validateReviewFindingV2,
  type EvidenceBundleV2,
  type EvidenceBindingV2,
  type EvidenceEntryV2,
  type EvidenceVerdictV2,
  type FindingTriageV2,
  type ReviewFindingInputV2,
  type ReviewFindingV2,
} from "../lib/evidence-v2.js";
import {
  computeRunPlanningRevisionV2,
  fingerprintTaskGroupV2,
} from "../lib/converge-v2.js";
import {
  createGitWorkspaceV2,
  type GitWorkspaceV2,
} from "../lib/git-workspace-v2.js";
import {
  buildLifecycleReadyReport,
} from "../lib/lifecycle.js";
import { inspectLegacyLoop } from "../lib/legacy-loop.js";
import {
  migrateLegacyLoopV2,
  verifyLegacyMigrationArchiveV2,
  type LegacyMigrationResultV2,
  type MigrateLegacyLoopV2Options,
} from "../lib/loop-migration-v2.js";
import {
  createInitialLoopStateV2,
  createRunInitializedEventV2,
  isEventAllowedInPhaseV2,
  reduceLoopEventV2,
} from "../lib/loop-reducer-v2.js";
import {
  LoopStoreV2,
  type AttemptBundleV2,
  type LoopStoreInspectionV2,
} from "../lib/loop-store-v2.js";
import { createOpenSpecAdapter } from "../lib/openspec-adapter.js";
import { isActiveLoopPhaseV2 } from "../lib/run-contract-v2.js";
import type {
  ActiveLoopPhaseV2,
  ArtifactHashV2,
  BlockedReasonV2,
  LoopEventActorV2,
  LoopRunModeV2,
  LoopStateV2,
} from "../lib/run-contract-v2.js";

export interface LoopPlanningSnapshotV2 {
  ready: boolean;
  planningRevision: ArtifactHashV2;
  groups: Array<{ id: string; fingerprint: ArtifactHashV2 }>;
  blockers: string[];
}

export interface LoopSubmissionBundleV2 {
  schemaVersion: 2;
  evidence: EvidenceBundleV2 | EvidenceBundleDraftV2;
  review: {
    /** Fingerprint is optional at the public CLI boundary and generated here. */
    findings: Array<ReviewFindingInputV2 & { fingerprint?: ArtifactHashV2 }>;
  };
  triage?: FindingTriageV2[];
  artifacts: Record<string, string | Uint8Array | object>;
}

export interface EvidenceBundleDraftV2 {
  schemaVersion?: 2;
  verdict: EvidenceVerdictV2;
  evidence: Array<Record<string, unknown>>;
  bundleId?: string;
  /** Generated fields must be wholly absent for a draft. Partial claims fail. */
  binding?: Partial<EvidenceBindingV2>;
  evidenceHash?: ArtifactHashV2;
  bundleHash?: ArtifactHashV2;
}

interface NormalizedLoopSubmissionBundleV2 extends Omit<LoopSubmissionBundleV2, "review" | "evidence"> {
  evidence: EvidenceBundleV2;
  review: { findings: ReviewFindingV2[] };
}

interface ReviewNormalizedLoopSubmissionBundleV2 extends Omit<LoopSubmissionBundleV2, "review"> {
  review: { findings: ReviewFindingV2[] };
}

interface LoopRequestBaseV2 {
  projectRoot: string;
  changeName: string;
}

export type LoopRequestV2 =
  | (LoopRequestBaseV2 & {
      operation: "init";
      sessionId: string;
      ownerId: string;
      ownerKind?: "human" | "agent" | "automation";
      mode?: LoopRunModeV2;
      runId?: string;
      supersedesRunId?: string;
      requirePush?: boolean;
      maxGroups?: number;
      maxAttemptsPerGroup?: number;
      maxEvents?: number;
      store?: string;
    })
  | (LoopRequestBaseV2 & { operation: "inspect"; runId?: string })
  | (LoopRequestBaseV2 & LoopCasRequestV2 & {
      operation: "submit";
      bundle: LoopSubmissionBundleV2;
      store?: string;
    })
  | (LoopRequestBaseV2 & LoopCasRequestV2 & {
      operation: "ack-commit";
      pushStatus?: "not_required" | "pushed";
      remoteRevision?: string;
    })
  | (LoopRequestBaseV2 & LoopCasRequestV2 & {
      operation: "finalize";
      store?: string;
    })
  | (LoopRequestBaseV2 & LoopCasRequestV2 & {
      operation: "invalidate";
      reason: string;
      reasonCode?: "planning_invalidated" | "manual";
      /** Internal structured provenance; public CLI invalidation leaves this empty. */
      reasonDetails?: Record<string, unknown>;
    })
  | (LoopRequestBaseV2 & LoopCasRequestV2 & {
      operation: "resume";
      newSessionId?: string;
      targetPhase?: ActiveLoopPhaseV2;
      maxAttemptsPerGroup?: number;
    });

export interface LoopCasRequestV2 {
  runId: string;
  sessionId: string;
  stateRevision: number;
  nonce: string;
}

export interface LoopCommandOutputV2 {
  schemaVersion: 2;
  operation: LoopRequestV2["operation"];
  status: "ok" | "blocked" | "not_found" | "error";
  changeName: string;
  state?: LoopStateV2;
  current?: LoopStoreInspectionV2["current"];
  recovered?: boolean;
  repairedTrailingEvent?: boolean;
  recoveryRequired?: boolean;
  migrated?: boolean;
  staleArtifacts?: string[];
  normalizedReviewFindings?: ReviewFindingV2[];
  normalizedReviewTriage?: FindingTriageV2[];
  normalizedEvidence?: EvidenceBundleV2;
  submissionContext?: EvidenceBindingV2;
  token?: { stateRevision: number; nonce: string };
  action?: LoopActionV2;
  message?: string;
  idempotent?: boolean;
  error?: { code: string; message: string };
}

export type LoopActionV2 =
  | { type: "dispatch_group"; groupId: string; attempt: number }
  | { type: "fix_group"; groupId: string; attempt: number; reason: BlockedReasonV2 | null }
  | { type: "awaiting_evaluation"; groupId: string; attempt: number }
  | { type: "commit_group"; groupId: string; attempt: number }
  | { type: "finalize" }
  | { type: "blocked"; reason: { code: string; message: string } }
  | { type: "terminal"; phase: LoopStateV2["phase"]; reason: BlockedReasonV2 | null };

export interface LoopExecutionResultV2 {
  exitCode: 0 | 1 | 2;
  output: LoopCommandOutputV2;
}

export interface LoopStorePortV2 {
  paths(changeName: string, runId?: string): ReturnType<LoopStoreV2["paths"]>;
  initialize(input: Parameters<LoopStoreV2["initialize"]>[0]): ReturnType<LoopStoreV2["initialize"]>;
  inspect(changeName: string, options?: { runId?: string }): ReturnType<LoopStoreV2["inspect"]>;
  peek(changeName: string, options?: { runId?: string }): ReturnType<LoopStoreV2["peek"]>;
  transition(input: Parameters<LoopStoreV2["transition"]>[0]): ReturnType<LoopStoreV2["transition"]>;
  writeAttemptBundle(input: Parameters<LoopStoreV2["writeAttemptBundle"]>[0]): ReturnType<LoopStoreV2["writeAttemptBundle"]>;
  submitAttemptTransaction(input: Parameters<LoopStoreV2["submitAttemptTransaction"]>[0]): ReturnType<LoopStoreV2["submitAttemptTransaction"]>;
  appendReviewTriage(input: Parameters<LoopStoreV2["appendReviewTriage"]>[0]): ReturnType<LoopStoreV2["appendReviewTriage"]>;
}

export interface LoopV2Dependencies {
  createStore?: (projectRoot: string) => LoopStorePortV2;
  inspectPlanning?: (
    projectRoot: string,
    changeName: string,
    store?: string,
  ) => Promise<LoopPlanningSnapshotV2>;
  createGit?: (projectRoot: string) => GitWorkspaceV2;
  now?: () => string;
  newRunId?: () => string;
  newNonce?: () => string;
  migrateLegacy?: (options: MigrateLegacyLoopV2Options) => Promise<LegacyMigrationResultV2>;
  /** Must verify the immutable v1 marker, sources, and archive without writes. */
  verifyLegacyMigration?: (input: {
    projectRoot: string;
    changeName: string;
    runId: string;
    groupIds: string[];
  }) => Promise<{ trustedLegacyGroupIds: string[] }>;
}

export async function executeLoopV2(
  request: LoopRequestV2,
  dependencies: LoopV2Dependencies = {},
): Promise<LoopExecutionResultV2> {
  try {
    const output = await executeLoopOperationV2(request, dependencies);
    const exitCode = output.status === "ok" ? 0 : output.status === "error" ? 2 : 1;
    return { exitCode, output };
  } catch (error) {
    return {
      exitCode: 2,
      output: {
        schemaVersion: 2,
        operation: request.operation,
        status: "error",
        changeName: request.changeName,
        error: errorShape(error),
      },
    };
  }
}

async function executeLoopOperationV2(
  request: LoopRequestV2,
  dependencies: LoopV2Dependencies,
): Promise<LoopCommandOutputV2> {
  const projectRoot = resolve(request.projectRoot);
  const store = (dependencies.createStore ?? ((root) => new LoopStoreV2({ projectRoot: root })))(projectRoot);
  const planningInspector = dependencies.inspectPlanning ?? inspectPlanningDefault;
  const git = (dependencies.createGit ?? createGitWorkspaceV2)(projectRoot);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const newNonce = dependencies.newNonce ?? (() => randomUUID());
  const actor = (state: LoopStateV2): LoopEventActorV2 => ({ ...state.owner });

  if (request.operation === "inspect") {
    let inspection = await store.inspect(
      request.changeName,
      request.runId ? { runId: request.runId } : {},
    );
    let migration: LegacyMigrationResultV2 | undefined;
    if (!inspection.state && legacyExists(projectRoot, request.changeName)) {
      const planning = await planningInspector(projectRoot, request.changeName);
      const baseline = await git.snapshot();
      migration = await (dependencies.migrateLegacy ?? migrateLegacyLoopV2)({
        projectRoot,
        changeName: request.changeName,
        planningRevision: planning.planningRevision,
        baselineGitRevision: baseline.headRevision,
        baselineGitTree: baseline.treeRevision,
        workspaceFingerprint: asHash(baseline.workspaceFingerprint),
        taskGroups: planning.groups.map((group, index) => ({
          id: group.id,
          ordinal: index + 1,
          taskGroupFingerprint: group.fingerprint,
        })),
      });
      inspection = await store.inspect(
        request.changeName,
        migration.state ? { runId: migration.state.runId } : {},
      );
    }
    if (!inspection.state) {
      return {
        schemaVersion: 2,
        operation: "inspect",
        status: "not_found",
        changeName: request.changeName,
        current: inspection.current,
        recovered: inspection.recovered,
        repairedTrailingEvent: inspection.repairedTrailingEvent,
        recoveryRequired: inspection.recoveryRequired,
      };
    }
    return successOutput("inspect", request.changeName, inspection.state, {
      current: inspection.current,
      recovered: inspection.recovered,
      repairedTrailingEvent: inspection.repairedTrailingEvent,
      recoveryRequired: inspection.recoveryRequired,
      migrated: migration?.status === "migrated",
      staleArtifacts: migration?.staleArtifacts ?? [],
    });
  }

  if (request.operation === "init") {
    requireNonEmpty(request.sessionId, "sessionId");
    requireNonEmpty(request.ownerId, "ownerId");
    await peekForMutation(store, request.changeName);
    const planning = await planningInspector(projectRoot, request.changeName, request.store);
    if (!planning.ready) {
      return {
        schemaVersion: 2,
        operation: "init",
        status: "blocked",
        changeName: request.changeName,
        action: {
          type: "blocked",
          reason: {
            code: "planning_not_ready",
            message: planning.blockers.join("; ") || "Planning is not ready",
          },
        },
        message: "Run corgispec ready and repair planning before loop init",
        error: {
          code: "planning_not_ready",
          message: planning.blockers.join("; ") || "Planning is not ready",
        },
      };
    }
    if (planning.groups.length === 0) throw commandError("task_groups_missing", "No Task Groups found");
    const baseline = await git.snapshot();
    if (!baseline.clean) {
      throw commandError("git_baseline_dirty", "Loop init requires a clean Git baseline");
    }
    if (legacyExists(projectRoot, request.changeName)) {
      const migration = await (dependencies.migrateLegacy ?? migrateLegacyLoopV2)({
        projectRoot,
        changeName: request.changeName,
        planningRevision: planning.planningRevision,
        baselineGitRevision: baseline.headRevision,
        baselineGitTree: baseline.treeRevision,
        workspaceFingerprint: asHash(baseline.workspaceFingerprint),
        taskGroups: planning.groups.map((group, index) => ({
          id: group.id,
          ordinal: index + 1,
          taskGroupFingerprint: group.fingerprint,
        })),
        sessionId: request.sessionId,
        owner: { id: request.ownerId, kind: request.ownerKind ?? "agent" },
        mode: request.mode ?? "hook-driven",
      });
      if (migration.state) {
        return successOutput("init", request.changeName, migration.state, {
          migrated: migration.status === "migrated",
          staleArtifacts: migration.staleArtifacts,
        });
      }
    }
    const startedAt = now();
    const state = createInitialLoopStateV2({
      changeName: request.changeName,
      runId: request.runId ?? (dependencies.newRunId?.() ?? `run-${randomUUID()}`),
      supersedesRunId: request.supersedesRunId,
      owner: { id: request.ownerId, kind: request.ownerKind ?? "agent" },
      sessionId: request.sessionId,
      mode: request.mode ?? "hook-driven",
      nonce: newNonce(),
      planningRevision: planning.planningRevision,
      baselineGitRevision: baseline.headRevision,
      workspaceFingerprint: asHash(baseline.workspaceFingerprint),
      policy: {
        requireCleanReview: true,
        requireCliPass: true,
        requireCleanWorktreeForCommit: true,
        requirePush: request.requirePush ?? false,
      },
      limits: {
        maxGroups: request.maxGroups ?? Math.max(100, planning.groups.length),
        maxAttemptsPerGroup: request.maxAttemptsPerGroup ?? 3,
        maxEvents: request.maxEvents ?? 1_000,
      },
      groups: planning.groups.map((group) => ({
        id: group.id,
        taskGroupFingerprint: group.fingerprint,
      })),
      startedAt,
    });
    const event = createRunInitializedEventV2(state);
    const persisted = await store.initialize({ state, event });
    return successOutput("init", request.changeName, persisted);
  }

  const inspection = await peekForMutation(store, request.changeName, request.runId);
  const state = requireRunState(inspection, request);
  if (
    request.operation === "resume" &&
    isExactCurrentResumeReplay(inspection, state, request)
  ) {
    return successOutput("resume", request.changeName, state, { idempotent: true });
  }
  requireRunSession(state, request);
  let reviewNormalizedRequestBundle: ReviewNormalizedLoopSubmissionBundleV2 | undefined;
  let normalizedRequestBundle: NormalizedLoopSubmissionBundleV2 | undefined;
  let resumePartialSubmit = false;
  if (!tokenMatches(state, request)) {
    if (request.operation === "submit") {
      reviewNormalizedRequestBundle = normalizeReviewBundle(request.bundle);
      normalizedRequestBundle = normalizeClaimedEvidence(reviewNormalizedRequestBundle);
      if (!normalizedRequestBundle) {
        const historical = inspection.events.find((record) =>
          record.event.type === "bundle_submitted" &&
          record.event.expectedStateRevision === request.stateRevision &&
          record.event.expectedNonce === request.nonce
        );
        if (historical?.event.type === "bundle_submitted") {
          normalizedRequestBundle = normalizeDraftEvidence(
            reviewNormalizedRequestBundle!,
            state,
            historical.event.groupId,
            historical.event.attempt,
            historical.event.bundleId,
            historical.event.observedGitRevision,
            historical.event.workspaceFingerprint,
          );
        }
      }
      if (!normalizedRequestBundle) {
        throw commandError(
          "stale_state_token",
          "A draft submit cannot be reconstructed from this stale state token",
        );
      }
      const identity = submissionHashes(normalizedRequestBundle!);
      const submittedRecord = inspection.events.find((record) =>
        record.event.type === "bundle_submitted" &&
        record.event.expectedStateRevision === request.stateRevision &&
        record.event.expectedNonce === request.nonce &&
        record.event.bundleId === normalizedRequestBundle!.evidence.binding.bundleId &&
        record.event.bundleHash === identity.fullBundleHash
      );
      if (submittedRecord) {
        const evaluated = inspection.events.some((record) =>
          record.event.type === "evaluation_completed" &&
          record.event.expectedStateRevision === submittedRecord.postState.stateRevision &&
          record.event.expectedNonce === submittedRecord.postState.nonce &&
          record.event.groupId === normalizedRequestBundle!.evidence.binding.groupId &&
          record.event.attempt === normalizedRequestBundle!.evidence.binding.attempt &&
          record.event.evidenceHash === normalizedRequestBundle!.evidence.evidenceHash &&
          record.event.reviewHash === identity.reviewHash
        );
        if (evaluated) {
          return successOutput("submit", request.changeName, state, {
            idempotent: true,
            normalizedReviewFindings: normalizedRequestBundle!.review.findings,
            normalizedReviewTriage: normalizedRequestBundle!.triage ?? [],
            normalizedEvidence: normalizedRequestBundle!.evidence,
            submissionContext: normalizedRequestBundle!.evidence.binding,
          });
        }
        if (
          state.phase === "awaiting_evaluation" &&
          state.stateRevision === submittedRecord.postState.stateRevision &&
          state.nonce === submittedRecord.postState.nonce
        ) {
          resumePartialSubmit = true;
        }
      }
    }
    if (request.operation === "ack-commit") {
      const replayed = inspection.events.some((record) =>
        record.event.type === "group_commit_acknowledged" &&
        record.event.expectedStateRevision === request.stateRevision &&
        record.event.expectedNonce === request.nonce &&
        record.event.pushStatus === (request.pushStatus ?? (state.policy.requirePush ? "pushed" : "not_required")) &&
        record.event.remoteRevision === (request.remoteRevision ?? null)
      );
      if (replayed) {
        return successOutput("ack-commit", request.changeName, state, { idempotent: true });
      }
    }
    if (!resumePartialSubmit) {
      throw commandError("stale_state_token", "stateRevision/nonce token is stale");
    }
  }
  const eventCost = request.operation === "submit" && state.phase !== "awaiting_evaluation" ? 2 : 1;
  const operationTerminatesRun = request.operation === "finalize" || request.operation === "invalidate";
  const operationEndSeq = state.lastEventSeq + eventCost;
  // An active post-state must never consume the final event slot: doing so
  // makes both normal finalization and a durable circuit-breaker impossible.
  // Finalize/invalidate already produce a terminal event and may use that slot.
  if (
    operationEndSeq > state.limits.maxEvents ||
    (!operationTerminatesRun && operationEndSeq === state.limits.maxEvents)
  ) {
    if (
      state.lastEventSeq + 1 <= state.limits.maxEvents &&
      isEventAllowedInPhaseV2(state.phase, "run_blocked")
    ) {
      return await persistBlockedRun(
        store,
        state,
        request.operation,
        "circuit_breaker",
        {
          code: "circuit_breaker",
          message: "The next operation would exhaust limits.maxEvents without a terminal event",
          details: { maxEvents: state.limits.maxEvents, eventCost },
        },
        now,
        newNonce,
        actor(state),
      );
    }
    throw commandError("event_limit", "Run event limit is exhausted and cannot persist a terminal event");
  }

  if (request.operation === "submit") {
    const planning = await planningInspector(projectRoot, request.changeName, request.store);
    const planningFailure = planningFreshnessFailure(state, planning);
    if (planningFailure) {
      const event = {
        ...eventBase(state, "run_invalidated", now(), newNonce, actor(state)),
        reason: planningFailure,
      } as const;
      const nextState = reduceLoopEventV2(state, event).postState;
      const persisted = await store.transition({ ...casFromState(state), event, nextState });
      return successOutput("submit", request.changeName, persisted, { status: "blocked" });
    }
    reviewNormalizedRequestBundle ??= normalizeReviewBundle(request.bundle);
    normalizedRequestBundle ??= normalizeClaimedEvidence(reviewNormalizedRequestBundle);
    const currentGroup = requireCurrentGroup(state);
    let gitSnapshot;
    try {
      gitSnapshot = await git.snapshot();
    } catch (error) {
      if (!isWorktreeFailure(error)) throw error;
      return await persistBlockedRun(
        store,
        state,
        "submit",
        "worktree_missing",
        worktreeMissingReason(error),
        now,
        newNonce,
        actor(state),
      );
    }
    if (!normalizedRequestBundle) {
      normalizedRequestBundle = normalizeDraftEvidence(
        reviewNormalizedRequestBundle!,
        state,
        currentGroup.id,
        state.currentAttempt,
        undefined,
        gitSnapshot.headRevision,
        asHash(gitSnapshot.workspaceFingerprint),
      );
    }
    const submission = validateSubmission(normalizedRequestBundle, state, currentGroup.id);
    if (
      submission.evidence.binding.observedGitRevision !== gitSnapshot.headRevision ||
      submission.evidence.binding.workspaceFingerprint !== gitSnapshot.workspaceFingerprint
    ) {
      throw commandError(
        "evidence_git_stale",
        "Evidence Git revision or workspace fingerprint does not match the current workspace",
      );
    }
    const {
      reviewHash,
      artifactHash,
      artifactManifest,
      artifactFiles,
      fullBundleHash,
    } = submissionHashes(submission);
    const evaluation = evaluationFor(submission);
    const timestamp = now();

    if (state.phase === "awaiting_group_commit" || isTerminalState(state)) {
      const idempotent = inspection.events.some((record) =>
        record.event.type === "bundle_submitted" &&
        record.event.bundleId === submission.evidence.binding.bundleId &&
        record.event.bundleHash === fullBundleHash
      );
      if (idempotent) return successOutput("submit", request.changeName, state, {
        idempotent: true,
        normalizedReviewFindings: submission.review.findings,
        normalizedReviewTriage: submission.triage ?? [],
        normalizedEvidence: submission.evidence,
        submissionContext: submission.evidence.binding,
      });
      throw commandError("invalid_phase", `submit is not allowed in ${state.phase}`);
    }

    let submittedState = state;
    let bundleEvent: ReturnType<typeof makeBundleSubmittedEvent> | undefined;
    if (state.phase === "awaiting_group_result" || state.phase === "fixing") {
      bundleEvent = makeBundleSubmittedEvent(
        state,
        submission,
        artifactHash,
        fullBundleHash,
        timestamp,
        distinctNonce(state.nonce, newNonce),
        actor(state),
      );
      submittedState = reduceLoopEventV2(state, bundleEvent).postState;
    } else if (state.phase === "awaiting_evaluation") {
      if (
        currentGroup.bundle.bundleId !== submission.evidence.binding.bundleId ||
        currentGroup.bundle.bundleHash !== fullBundleHash
      ) {
        throw commandError("bundle_mismatch", "awaiting_evaluation is bound to another bundle");
      }
    } else {
      throw commandError("invalid_phase", `submit is not allowed in ${state.phase}`);
    }

    const evaluationEvent = {
      schemaVersion: 2 as const,
      type: "evaluation_completed" as const,
      runId: submittedState.runId,
      seq: submittedState.lastEventSeq + 1,
      expectedStateRevision: submittedState.stateRevision,
      expectedNonce: submittedState.nonce,
      nextNonce: distinctNonce(submittedState.nonce, newNonce),
      occurredAt: timestamp,
      actor: actor(submittedState),
      groupId: currentGroup.id,
      attempt: submittedState.currentAttempt,
      result: evaluation.result,
      evidenceHash: submission.evidence.evidenceHash,
      reviewHash,
      reviewClean: evaluation.reviewClean,
      reason: evaluation.reason,
    };
    const evaluatedState = reduceLoopEventV2(submittedState, evaluationEvent).postState;

    const marker: AttemptBundleV2 = {
      schemaVersion: 2,
      runId: state.runId,
      groupId: currentGroup.id,
      attempt: state.currentAttempt,
      bundleId: submission.evidence.binding.bundleId,
      bundleHash: fullBundleHash,
      artifactHash,
      artifactManifest,
      evidenceHash: submission.evidence.evidenceHash,
      reviewHash,
      observedGitRevision: submission.evidence.binding.observedGitRevision,
      workspaceFingerprint: submission.evidence.binding.workspaceFingerprint,
    };
    const transaction = await store.submitAttemptTransaction({
      ...casFromState(state),
      files: {
        ...artifactFiles,
        "evidence.json": submission.evidence,
        "review.json": {
          findings: submission.review.findings,
          triage: submission.triage ?? [],
        },
      },
      bundle: marker,
      groupId: currentGroup.id,
      attempt: state.currentAttempt,
      transitions: [
        ...(bundleEvent ? [{ event: bundleEvent, nextState: submittedState }] : []),
        { event: evaluationEvent, nextState: evaluatedState },
      ],
      triageEntries: (submission.triage ?? []).map((entry) => ({
        schemaVersion: 2 as const,
        runId: state.runId,
        groupId: currentGroup.id,
        attempt: state.currentAttempt,
        bundleId: submission.evidence.binding.bundleId,
        findingFingerprint: entry.findingFingerprint,
        action: entry.disposition as "dismissed" | "accepted-risk",
        actor: { kind: "human" as const, id: entry.actor.id },
        reason: entry.reason!,
        occurredAt: entry.occurredAt,
      })),
    });
    const persisted = transaction.state;
    return successOutput("submit", request.changeName, persisted, {
      idempotent: transaction.idempotent,
      status: isTerminalState(persisted) ? "blocked" : "ok",
      normalizedReviewFindings: submission.review.findings,
      normalizedReviewTriage: submission.triage ?? [],
      normalizedEvidence: submission.evidence,
      submissionContext: submission.evidence.binding,
    });
  }

  if (request.operation === "ack-commit") {
    if (state.phase !== "awaiting_group_commit") {
      throw commandError("invalid_phase", `ack-commit is not allowed in ${state.phase}`);
    }
    const group = requireCurrentGroup(state);
    const expected = group.bundle.workspaceFingerprint;
    if (!expected) throw commandError("bundle_incomplete", "Approved bundle has no workspace fingerprint");
    let acknowledged;
    try {
      acknowledged = await git.verifyCommittedWorkspace(expected, {
        baselineRevision: await previousGroupRevision(state, store),
      });
    } catch (error) {
      if (!isWorktreeFailure(error)) throw error;
      return await persistBlockedRun(
        store,
        state,
        "ack-commit",
        "worktree_missing",
        worktreeMissingReason(error),
        now,
        newNonce,
        actor(state),
      );
    }
    const pushStatus = request.pushStatus ?? (state.policy.requirePush ? "pushed" : "not_required");
    const event = {
      ...eventBase(state, "group_commit_acknowledged", now(), newNonce, actor(state)),
      groupId: group.id,
      attempt: state.currentAttempt,
      commitRevision: acknowledged.headRevision,
      commitTree: acknowledged.treeRevision,
      workspaceFingerprint: asHash(acknowledged.workspaceFingerprint),
      pushStatus,
      remoteRevision: pushStatus === "pushed" ? requireNonEmpty(request.remoteRevision, "remoteRevision") : null,
    } as const;
    const nextState = reduceLoopEventV2(state, event).postState;
    const persisted = await store.transition({ ...casFromState(state), event, nextState });
    return successOutput("ack-commit", request.changeName, persisted);
  }

  if (request.operation === "finalize") {
    if (state.phase !== "awaiting_finalize") {
      throw commandError("invalid_phase", `finalize is not allowed in ${state.phase}`);
    }
    const planning = await planningInspector(projectRoot, request.changeName, request.store);
    const planningFailure = planningFreshnessFailure(state, planning);
    if (planningFailure) {
      const event = {
        ...eventBase(state, "run_invalidated", now(), newNonce, actor(state)),
        reason: planningFailure,
      } as const;
      const nextState = reduceLoopEventV2(state, event).postState;
      const persisted = await store.transition({ ...casFromState(state), event, nextState });
      return successOutput("finalize", request.changeName, persisted, { status: "blocked" });
    }
    if (Object.values(state.groups).some((group) =>
      group.status !== "completed" ||
      group.bundle.status !== "approved" ||
      group.commit.status !== "acknowledged"
    )) {
      throw commandError("groups_incomplete", "Every group must have approved evidence and an acknowledged commit");
    }
    let snapshot;
    try {
      snapshot = await git.snapshot();
    } catch (error) {
      if (!isWorktreeFailure(error)) throw error;
      return await persistBlockedRun(
        store,
        state,
        "finalize",
        "worktree_missing",
        worktreeMissingReason(error),
        now,
        newNonce,
        actor(state),
      );
    }
    if (!snapshot.clean) throw commandError("git_dirty_workspace", "Finalize requires a clean Git workspace");
    const finalGroupRevision = lastAcknowledgedRevision(state);
    if (!finalGroupRevision || snapshot.headRevision !== finalGroupRevision) {
      throw commandError(
        "git_revision_changed",
        "Finalize requires HEAD to equal the last acknowledged Task Group commit",
      );
    }
    if (snapshot.workspaceFingerprint !== await git.commitTreeFingerprint(snapshot.headRevision)) {
      throw commandError("git_tree_mismatch", "Final Git workspace does not match its commit tree");
    }
    const runPaths = store.paths(request.changeName, state.runId);
    const provenance = await resolveLoopCanonicalProvenanceV2(
      store,
      projectRoot,
      request.changeName,
      inspection,
      dependencies,
      [],
      16,
    );
    await assertCanonicalFinalizationEvidenceV2({
      inspection,
      attemptsRoot: runPaths.attempts!,
      reviewTriagePath: runPaths.reviewTriage,
      currentGit: {
        revision: snapshot.headRevision,
        workspaceFingerprint: snapshot.workspaceFingerprint,
      },
      ...provenance,
    });
    const event = {
      ...eventBase(state, "run_finalized", now(), newNonce, actor(state)),
      finalGitRevision: snapshot.headRevision,
      workspaceFingerprint: asHash(snapshot.workspaceFingerprint),
    } as const;
    const nextState = reduceLoopEventV2(state, event).postState;
    const persisted = await store.transition({ ...casFromState(state), event, nextState });
    return successOutput("finalize", request.changeName, persisted);
  }

  if (request.operation === "invalidate") {
    const reason: BlockedReasonV2 = {
      code: request.reasonCode ?? "manual",
      message: requireNonEmpty(request.reason, "reason"),
      details: structuredClone(request.reasonDetails ?? {}),
    };
    const event = {
      ...eventBase(state, "run_invalidated", now(), newNonce, actor(state)),
      reason,
    } as const;
    const nextState = reduceLoopEventV2(state, event).postState;
    const persisted = await store.transition({ ...casFromState(state), event, nextState });
    return successOutput("invalidate", request.changeName, persisted);
  }

  const event = {
    ...eventBase(state, "run_resumed", now(), newNonce, actor(state)),
    sessionId: request.newSessionId ?? request.sessionId,
    targetPhase: request.targetPhase ?? inferResumeTarget(state),
    maxAttemptsPerGroup: request.maxAttemptsPerGroup ?? state.limits.maxAttemptsPerGroup,
  } as const;
  const nextState = reduceLoopEventV2(state, event).postState;
  const persisted = await store.transition({ ...casFromState(state), event, nextState });
  return successOutput("resume", request.changeName, persisted);
}

function inferResumeTarget(state: LoopStateV2): ActiveLoopPhaseV2 {
  const previousPhase = state.blockedReason?.details.previousPhase;
  if (isActiveLoopPhaseV2(previousPhase)) return previousPhase;
  if (state.currentGroupId === null) return "awaiting_finalize";
  const group = state.groups[state.currentGroupId];
  if (!group) throw commandError("group_missing", "Run has no durable current Task Group");
  switch (group.bundle.status) {
    case "approved":
      return "awaiting_group_commit";
    case "submitted":
      return "awaiting_evaluation";
    case "rejected":
      return "fixing";
    case "none":
      return "awaiting_group_result";
  }
}

function makeBundleSubmittedEvent(
  state: LoopStateV2,
  submission: NormalizedLoopSubmissionBundleV2,
  artifactHash: ArtifactHashV2,
  fullBundleHash: ArtifactHashV2,
  occurredAt: string,
  nextNonce: string,
  actor: LoopEventActorV2,
) {
  const binding = submission.evidence.binding;
  return {
    schemaVersion: 2 as const,
    type: "bundle_submitted" as const,
    runId: state.runId,
    seq: state.lastEventSeq + 1,
    expectedStateRevision: state.stateRevision,
    expectedNonce: state.nonce,
    nextNonce,
    occurredAt,
    actor,
    groupId: binding.groupId,
    attempt: binding.attempt,
    bundleId: binding.bundleId,
    bundleHash: fullBundleHash,
    artifactHash,
    observedGitRevision: binding.observedGitRevision,
    workspaceFingerprint: binding.workspaceFingerprint,
  };
}

function eventBase<T extends "group_commit_acknowledged" | "run_finalized" | "run_invalidated" | "run_resumed">(
  state: LoopStateV2,
  type: T,
  occurredAt: string,
  newNonce: () => string,
  actor: LoopEventActorV2,
) {
  return {
    schemaVersion: 2 as const,
    type,
    runId: state.runId,
    seq: state.lastEventSeq + 1,
    expectedStateRevision: state.stateRevision,
    expectedNonce: state.nonce,
    nextNonce: distinctNonce(state.nonce, newNonce),
    occurredAt,
    actor,
  };
}

async function persistBlockedRun(
  store: LoopStorePortV2,
  state: LoopStateV2,
  operation: LoopRequestV2["operation"],
  terminalPhase: "circuit_breaker" | "corrupted" | "worktree_missing",
  reason: BlockedReasonV2,
  now: () => string,
  newNonce: () => string,
  actor: LoopEventActorV2,
): Promise<LoopCommandOutputV2> {
  const event = {
    schemaVersion: 2 as const,
    type: "run_blocked" as const,
    runId: state.runId,
    seq: state.lastEventSeq + 1,
    expectedStateRevision: state.stateRevision,
    expectedNonce: state.nonce,
    nextNonce: distinctNonce(state.nonce, newNonce),
    occurredAt: now(),
    actor,
    terminalPhase,
    reason: {
      ...reason,
      details: {
        ...reason.details,
        previousPhase: state.phase,
        operation,
      },
    },
  };
  const nextState = reduceLoopEventV2(state, event).postState;
  const persisted = await store.transition({ ...casFromState(state), event, nextState });
  return successOutput(operation, state.changeName, persisted, { status: "blocked" });
}

function isWorktreeFailure(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return [
    "git_not_repository",
    "git_repository_mismatch",
    "git_spawn_failed",
  ].includes(String(error.code));
}

function worktreeMissingReason(error: unknown): BlockedReasonV2 {
  return {
    code: "worktree_missing",
    message: error instanceof Error ? error.message : "Git worktree is unavailable",
    details: {},
  };
}

function evaluationFor(
  submission: NormalizedLoopSubmissionBundleV2,
): {
  result: "pass" | "verification_failed" | "review_failed";
  reviewClean: boolean;
  reason: BlockedReasonV2 | null;
} {
  const triaged = new Set((submission.triage ?? []).map((entry) => entry.findingFingerprint));
  const openFindings = submission.review.findings.filter((finding) => !triaged.has(finding.fingerprint));
  if (submission.evidence.verdict === "FAIL") {
    return {
      result: "verification_failed",
      reviewClean: openFindings.length === 0,
      reason: {
        code: "verification_failed",
        message: "Verification evidence contains a failure",
        details: {},
      },
    };
  }
  if (openFindings.length > 0) {
    return {
      result: "review_failed",
      reviewClean: false,
      reason: {
        code: "review_findings",
        message: "Review contains unresolved findings",
        details: { findings: openFindings.length },
      },
    };
  }
  return { result: "pass", reviewClean: true, reason: null };
}

function normalizeReviewBundle(
  submission: LoopSubmissionBundleV2,
): ReviewNormalizedLoopSubmissionBundleV2 {
  if (!submission || submission.schemaVersion !== 2) {
    throw commandError("bundle_invalid", "Submission bundle schemaVersion must equal 2");
  }
  if (!submission.review || !Array.isArray(submission.review.findings)) {
    throw commandError("review_invalid", "Submission review.findings must be an array");
  }
  const findings = submission.review.findings.map((finding) => {
    const { fingerprint, ...input } = finding;
    if (fingerprint === undefined) return createReviewFindingV2(input);
    const normalized = { ...input, fingerprint } as ReviewFindingV2;
    const validation = validateReviewFindingV2(normalized);
    if (!validation.valid) throw commandError("review_invalid", validation.errors.join("; "));
    return normalized;
  });
  return {
    ...structuredClone(submission),
    review: { findings },
  };
}

function normalizeClaimedEvidence(
  submission: ReviewNormalizedLoopSubmissionBundleV2,
): NormalizedLoopSubmissionBundleV2 | undefined {
  const evidence = submission.evidence as EvidenceBundleV2 | EvidenceBundleDraftV2;
  const record = evidence as unknown as Record<string, unknown>;
  const entries = Array.isArray(record.evidence) ? record.evidence : [];
  const claimsGeneratedBinding =
    record.binding !== undefined ||
    record.evidenceHash !== undefined ||
    record.bundleHash !== undefined ||
    entries.some((entry) =>
      entry !== null && typeof entry === "object" && "binding" in entry
    );
  if (!claimsGeneratedBinding) return undefined;
  try {
    assertEvidenceBundleV2(evidence);
  } catch (error) {
    throw commandError(
      "evidence_claim_invalid",
      `Provided evidence binding/hash must be complete and exact: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    ...structuredClone(submission),
    evidence: structuredClone(evidence) as EvidenceBundleV2,
  };
}

function normalizeDraftEvidence(
  submission: ReviewNormalizedLoopSubmissionBundleV2,
  state: LoopStateV2,
  groupId: string,
  attempt: number,
  historicalBundleId: string | undefined,
  observedGitRevision: string,
  workspaceFingerprint: ArtifactHashV2,
): NormalizedLoopSubmissionBundleV2 {
  const draft = submission.evidence as EvidenceBundleDraftV2;
  if (!draft || !["PASS", "FAIL"].includes(String(draft.verdict)) || !Array.isArray(draft.evidence)) {
    throw commandError("evidence_draft_invalid", "Evidence draft requires verdict and evidence[]");
  }
  if (draft.evidence.length === 0) {
    throw commandError("evidence_draft_invalid", "Evidence draft must contain at least one entry");
  }
  const group = state.groups[groupId];
  if (!group) throw commandError("group_missing", `Task Group '${groupId}' does not exist`);
  const deterministicBundleId = `bundle-${hashCanonicalArtifactV2({
    runId: state.runId,
    groupId,
    attempt,
    verdict: draft.verdict,
    evidence: draft.evidence,
    review: submission.review,
    triage: submission.triage ?? [],
    artifacts: submission.artifacts,
  }).slice("sha256:".length, "sha256:".length + 32)}`;
  if (historicalBundleId && draft.bundleId && historicalBundleId !== draft.bundleId) {
    throw commandError("evidence_draft_invalid", "Provided bundleId conflicts with historical submit");
  }
  const bundleId = historicalBundleId ?? draft.bundleId ?? deterministicBundleId;
  if (!bundleId.trim()) throw commandError("evidence_draft_invalid", "bundleId must be non-empty");
  const binding: EvidenceBindingV2 = {
    runId: state.runId,
    groupId,
    attempt,
    bundleId,
    planningRevision: state.planningRevision,
    taskGroupFingerprint: group.taskGroupFingerprint,
    baselineGitRevision: state.git.baselineRevision,
    observedGitRevision,
    workspaceFingerprint,
  };
  const entries = draft.evidence.map((entry) => ({
    ...structuredClone(entry),
    binding,
  })) as EvidenceEntryV2[];
  let evidence: EvidenceBundleV2;
  try {
    evidence = createEvidenceBundleV2({
      binding,
      verdict: draft.verdict,
      evidence: entries,
    });
  } catch (error) {
    throw commandError(
      "evidence_draft_invalid",
      error instanceof Error ? error.message : String(error),
    );
  }
  return {
    ...structuredClone(submission),
    evidence,
  };
}

function validateSubmission(
  submission: NormalizedLoopSubmissionBundleV2,
  state: LoopStateV2,
  groupId: string,
): NormalizedLoopSubmissionBundleV2 {
  if (!submission || submission.schemaVersion !== 2) {
    throw commandError("bundle_invalid", "Submission bundle schemaVersion must equal 2");
  }
  assertEvidenceBundleV2(submission.evidence);
  if (!submission.review || !Array.isArray(submission.review.findings)) {
    throw commandError("review_invalid", "Submission review.findings must be an array");
  }
  const findingFingerprints = new Set<string>();
  for (const finding of submission.review.findings) {
    const validation = validateReviewFindingV2(finding);
    if (!validation.valid) throw commandError("review_invalid", validation.errors.join("; "));
    if (findingFingerprints.has(finding.fingerprint)) {
      throw commandError("review_invalid", `Duplicate review finding fingerprint: ${finding.fingerprint}`);
    }
    findingFingerprints.add(finding.fingerprint);
  }
  const triageFingerprints = new Set<string>();
  for (const triage of submission.triage ?? []) {
    const validation = validateFindingTriageV2(triage);
    if (!validation.valid) throw commandError("triage_invalid", validation.errors.join("; "));
    if (triage.disposition === "open") {
      throw commandError("triage_invalid", "Only dismissed or accepted-risk triage may be submitted");
    }
    if (triageFingerprints.has(triage.findingFingerprint)) {
      throw commandError("triage_invalid", `Duplicate triage fingerprint: ${triage.findingFingerprint}`);
    }
    triageFingerprints.add(triage.findingFingerprint);
    if (!findingFingerprints.has(triage.findingFingerprint)) {
      throw commandError("triage_invalid", "Triage fingerprint does not exist in review findings");
    }
  }
  if (!submission.artifacts || typeof submission.artifacts !== "object" || Array.isArray(submission.artifacts)) {
    throw commandError("artifacts_invalid", "Submission artifacts must be an object");
  }
  if (Object.keys(submission.artifacts).length === 0) {
    throw commandError("artifacts_invalid", "Submission must contain at least one attempt artifact");
  }
  const binding = submission.evidence.binding;
  const group = state.groups[groupId]!;
  if (
    binding.runId !== state.runId ||
    binding.groupId !== groupId ||
    binding.attempt !== state.currentAttempt ||
    binding.planningRevision !== state.planningRevision ||
    binding.taskGroupFingerprint !== group.taskGroupFingerprint ||
    binding.baselineGitRevision !== state.git.baselineRevision
  ) {
    throw commandError("evidence_binding_mismatch", "Evidence does not bind to the current run/group/attempt");
  }
  return submission;
}

function submissionHashes(submission: NormalizedLoopSubmissionBundleV2): {
  reviewHash: ArtifactHashV2;
  artifactHash: ArtifactHashV2;
  artifactManifest: Record<string, ArtifactHashV2>;
  artifactFiles: Record<string, string | Uint8Array | object>;
  fullBundleHash: ArtifactHashV2;
} {
  if (!submission || submission.schemaVersion !== 2) {
    throw commandError("bundle_invalid", "Submission bundle schemaVersion must equal 2");
  }
  assertEvidenceBundleV2(submission.evidence);
  if (!submission.review || !Array.isArray(submission.review.findings)) {
    throw commandError("review_invalid", "Submission review.findings must be an array");
  }
  for (const finding of submission.review.findings) {
    const validation = validateReviewFindingV2(finding);
    if (!validation.valid) throw commandError("review_invalid", validation.errors.join("; "));
  }
  if (!submission.artifacts || typeof submission.artifacts !== "object" || Array.isArray(submission.artifacts)) {
    throw commandError("artifacts_invalid", "Submission artifacts must be an object");
  }
  const reviewHash = hashCanonicalArtifactV2({
    findingsHash: hashReviewFindingsV2(submission.review.findings),
    triage: submission.triage ?? [],
  });
  const { files: artifactFiles, manifest: artifactManifest } = artifactManifestV2(
    submission.artifacts,
  );
  const artifactHash = hashCanonicalArtifactV2(artifactManifest);
  return {
    reviewHash,
    artifactHash,
    artifactManifest,
    artifactFiles,
    fullBundleHash: hashCanonicalArtifactV2({
      schemaVersion: 2,
      binding: submission.evidence.binding,
      evidenceBundleHash: submission.evidence.bundleHash,
      evidenceHash: submission.evidence.evidenceHash,
      reviewHash,
      artifactHash,
    }),
  };
}

async function inspectPlanningDefault(
  projectRoot: string,
  changeName: string,
  store?: string,
): Promise<LoopPlanningSnapshotV2> {
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
  return {
    ready: report.status === "ready",
    planningRevision: await computeRunPlanningRevisionV2({
      schemaName: resolved.schemaName,
      changeRoot: resolved.changeRoot,
      artifactPaths: resolved.artifactPaths,
      taskArtifactId: report.taskArtifactId,
    }),
    groups: report.taskGroups.map((group) => ({
      id: String(group.number),
      fingerprint: asHash(fingerprintTaskGroupV2(group)),
    })),
    blockers: report.checks
      .filter((check) => check.status !== "pass")
      .map((check) => `${check.code}: ${check.message}`),
  };
}

function planningFreshnessFailure(
  state: LoopStateV2,
  planning: LoopPlanningSnapshotV2,
): BlockedReasonV2 | null {
  if (!planning.ready) {
    return {
      code: "planning_invalidated",
      message: planning.blockers.join("; ") || "Planning is no longer ready",
      details: { cause: "not_ready" },
    };
  }
  if (planning.planningRevision !== state.planningRevision) {
    return {
      code: "planning_invalidated",
      message: "Planning changed after loop init",
      details: { cause: "planning_revision_changed" },
    };
  }
  for (const [groupId, group] of Object.entries(state.groups)) {
    const current = planning.groups.find((candidate) => candidate.id === groupId);
    if (!current || current.fingerprint !== group.taskGroupFingerprint) {
      return {
        code: "planning_invalidated",
        message: `Task Group '${groupId}' changed after loop init`,
        details: { cause: "task_group_changed", groupId },
      };
    }
  }
  return null;
}

function requireRunState(
  inspection: LoopStoreInspectionV2,
  request: LoopCasRequestV2,
): LoopStateV2 {
  const state = inspection.state;
  if (!state) throw commandError("run_not_found", `Run '${request.runId}' was not found`);
  if (state.runId !== request.runId) throw commandError("run_mismatch", "runId is not current");
  return state;
}

function requireRunSession(state: LoopStateV2, request: LoopCasRequestV2): void {
  if (state.sessionId !== request.sessionId) {
    throw commandError("session_conflict", "sessionId does not match");
  }
}

/**
 * A lost resume response is the one mutation whose exact retry legitimately
 * carries the superseded session id. Keep that exception narrow: the resume
 * must be the latest durable event, bind to the original session/CAS token,
 * and have the same normalized arguments as the committed event.
 */
function isExactCurrentResumeReplay(
  inspection: LoopStoreInspectionV2,
  state: LoopStateV2,
  request: Extract<LoopRequestV2, { operation: "resume" }>,
): boolean {
  const record = inspection.events.find((candidate) =>
    candidate.event.type === "run_resumed" &&
    candidate.event.runId === request.runId &&
    candidate.event.expectedStateRevision === request.stateRevision &&
    candidate.event.expectedNonce === request.nonce
  );
  if (record?.event.type !== "run_resumed" || !isDeepStrictEqual(record.postState, state)) {
    return false;
  }
  const source = inspection.events.find((candidate) =>
    candidate.postState.runId === request.runId &&
    candidate.postState.stateRevision === request.stateRevision &&
    candidate.postState.nonce === request.nonce &&
    candidate.event.seq === record.event.seq - 1
  )?.postState;
  if (!source || source.sessionId !== request.sessionId) return false;

  const targetPhase = request.targetPhase ?? inferResumeTarget(source);
  const maxAttemptsPerGroup = request.maxAttemptsPerGroup ?? source.limits.maxAttemptsPerGroup;
  return record.event.sessionId === (request.newSessionId ?? request.sessionId) &&
    record.event.targetPhase === targetPhase &&
    record.event.maxAttemptsPerGroup === maxAttemptsPerGroup;
}

async function peekForMutation(
  store: LoopStorePortV2,
  changeName: string,
  runId?: string,
): Promise<LoopStoreInspectionV2> {
  const repairCommand = `corgispec loop inspect ${changeName}` +
    (runId ? ` --run-id ${runId}` : "");
  try {
    const inspection = await store.peek(changeName, runId ? { runId } : {});
    if (inspection.recoveryRequired) {
      throw commandError(
        "LOOP_RECOVERY_REQUIRED",
        `Canonical state requires repair; run '${repairCommand}' before retrying`,
      );
    }
    return inspection;
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "LOOP_RECOVERY_REQUIRED" &&
      !(error instanceof Error && error.message.includes("corgispec loop inspect"))
    ) {
      throw commandError(
        "LOOP_RECOVERY_REQUIRED",
        `${error instanceof Error ? error.message : "Canonical state requires repair"}; ` +
          `run '${repairCommand}' before retrying`,
      );
    }
    throw error;
  }
}

async function resolveLoopCanonicalProvenanceV2(
  store: LoopStorePortV2,
  projectRoot: string,
  changeName: string,
  inspection: LoopStoreInspectionV2,
  dependencies: LoopV2Dependencies,
  ancestors: string[],
  remainingDepth: number,
): Promise<{
  trustedLegacyGroupIds?: string[];
  successorSource?: CanonicalSuccessorSourceV2;
}> {
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
  const localGroups = new Set(inspection.events
    .filter((record) => record.event.type === "bundle_submitted")
    .map((record) => record.event.type === "bundle_submitted" ? record.event.groupId : ""));
  const legacyGroups = Object.values(state.groups)
    .filter((group) =>
      group.bundle.bundleId?.startsWith("legacy-v1-") === true &&
      (!state.supersedesRunId || localGroups.has(group.id))
    )
    .sort((left, right) => left.ordinal - right.ordinal);
  let trustedLegacyGroupIds: string[] = [];
  if (legacyGroups.length > 0) {
    const verifyLegacy = dependencies.verifyLegacyMigration ?? (async (input) =>
      await verifyLegacyMigrationArchiveV2({
        projectRoot: input.projectRoot,
        changeName: input.changeName,
        runId: input.runId,
      }));
    const verified = await verifyLegacy({
      projectRoot,
      changeName,
      runId: state.runId,
      groupIds: legacyGroups.map((group) => group.id),
    });
    trustedLegacyGroupIds = verified.trustedLegacyGroupIds.map((ordinal) => {
      const group = Object.values(state.groups).find(
        (candidate) => candidate.ordinal === Number(ordinal),
      );
      if (!group) {
        throw commandError(
          "legacy_migration_verification_mismatch",
          `Legacy archive references absent Task Group ordinal ${ordinal}`,
        );
      }
      return group.id;
    });
    if (
      trustedLegacyGroupIds.some((id, index) => {
        const group = state.groups[id]!;
        return group.ordinal !== index + 1 || group.status !== "completed" ||
          !group.bundle.bundleId?.startsWith("legacy-v1-");
      }) ||
      JSON.stringify(trustedLegacyGroupIds) !==
        JSON.stringify(legacyGroups.map((group) => group.id))
    ) {
      throw commandError(
        "legacy_migration_verification_mismatch",
        "Verified legacy groups do not exactly match the completed migration prefix",
      );
    }
  }
  const needsSource = Object.values(state.groups).some((group) =>
    group.status === "completed" &&
    !localGroups.has(group.id)
  );
  let successorSource: CanonicalSuccessorSourceV2 | undefined;
  if (needsSource && state.supersedesRunId) {
    const sourceInspection = await store.peek(changeName, { runId: state.supersedesRunId });
    if (sourceInspection.state) {
      const nested = await resolveLoopCanonicalProvenanceV2(
        store,
        projectRoot,
        changeName,
        { ...sourceInspection, recoveryRequired: false },
        dependencies,
        [...ancestors, state.runId],
        remainingDepth - 1,
      );
      const paths = store.paths(changeName, state.supersedesRunId);
      successorSource = {
        inspection: { ...sourceInspection, recoveryRequired: false },
        attemptsRoot: paths.attempts!,
        reviewTriagePath: paths.reviewTriage,
        ...nested,
      };
    }
  }
  return {
    ...(trustedLegacyGroupIds.length > 0 ? { trustedLegacyGroupIds } : {}),
    ...(successorSource ? { successorSource } : {}),
  };
}

function tokenMatches(state: LoopStateV2, request: LoopCasRequestV2): boolean {
  return state.stateRevision === request.stateRevision && state.nonce === request.nonce;
}

function requireCurrentGroup(state: LoopStateV2) {
  const groupId = state.currentGroupId;
  if (!groupId || !state.groups[groupId]) throw commandError("group_missing", "Run has no current Task Group");
  return state.groups[groupId]!;
}

async function previousGroupRevision(
  state: LoopStateV2,
  store: LoopStorePortV2,
): Promise<string> {
  const current = requireCurrentGroup(state);
  const previous = Object.values(state.groups)
    .filter((group) => group.ordinal < current.ordinal && group.commit.status === "acknowledged")
    .sort((left, right) => right.ordinal - left.ordinal);
  if (!state.supersedesRunId) {
    return previous[0]?.commit.revision ?? state.git.baselineRevision;
  }
  const superseded = await store.peek(state.changeName, { runId: state.supersedesRunId });
  if (!superseded.state) {
    throw commandError(
      "superseded_run_missing",
      `Superseded run '${state.supersedesRunId}' is unavailable for commit-baseline validation`,
    );
  }
  const firstNewCommit = previous.find((group) => {
    const old = superseded.state!.groups[group.id];
    return !old ||
      old.taskGroupFingerprint !== group.taskGroupFingerprint ||
      old.commit.status !== group.commit.status ||
      old.commit.revision !== group.commit.revision ||
      old.commit.tree !== group.commit.tree ||
      old.commit.workspaceFingerprint !== group.commit.workspaceFingerprint;
  });
  return firstNewCommit?.commit.revision ?? state.git.baselineRevision;
}

function lastAcknowledgedRevision(state: LoopStateV2): string | null {
  return Object.values(state.groups)
    .filter((group) => group.commit.status === "acknowledged")
    .sort((left, right) => right.ordinal - left.ordinal)[0]?.commit.revision ?? null;
}

function casFromState(state: LoopStateV2) {
  return {
    changeName: state.changeName,
    runId: state.runId,
    sessionId: state.sessionId,
    expectedStateRevision: state.stateRevision,
    expectedNonce: state.nonce,
  };
}

function successOutput(
  operation: LoopRequestV2["operation"],
  changeName: string,
  state: LoopStateV2,
  extra: Partial<LoopCommandOutputV2> = {},
): LoopCommandOutputV2 {
  return {
    schemaVersion: 2,
    operation,
    status: "ok",
    changeName,
    state,
    token: { stateRevision: state.stateRevision, nonce: state.nonce },
    action: actionFor(state),
    ...extra,
  };
}

function actionFor(state: LoopStateV2): LoopActionV2 {
  switch (state.phase) {
    case "awaiting_group_result":
      return { type: "dispatch_group", groupId: state.currentGroupId!, attempt: state.currentAttempt };
    case "fixing":
      return {
        type: "fix_group",
        groupId: state.currentGroupId!,
        attempt: state.currentAttempt,
        reason: state.blockedReason,
      };
    case "awaiting_evaluation":
      return { type: "awaiting_evaluation", groupId: state.currentGroupId!, attempt: state.currentAttempt };
    case "awaiting_group_commit":
      return { type: "commit_group", groupId: state.currentGroupId!, attempt: state.currentAttempt };
    case "awaiting_finalize":
      return { type: "finalize" };
    default:
      return { type: "terminal", phase: state.phase, reason: state.blockedReason };
  }
}

function isTerminalState(state: LoopStateV2): boolean {
  return [
    "done", "verification_failed", "review_failed", "circuit_breaker",
    "corrupted", "worktree_missing", "invalidated",
  ].includes(state.phase);
}

function legacyExists(projectRoot: string, changeName: string): boolean {
  const legacy = inspectLegacyLoop(projectRoot, changeName);
  return legacy.runs.length > 0 || legacy.corruptPaths.length > 0 || legacy.unsupportedPaths.length > 0;
}

function artifactManifestV2(
  artifacts: Record<string, string | Uint8Array | object>,
): {
  files: Record<string, string | Uint8Array | object>;
  manifest: Record<string, ArtifactHashV2>;
} {
  const files: Record<string, string | Uint8Array | object> = {};
  const manifest: Record<string, ArtifactHashV2> = {};
  for (const [name, value] of Object.entries(artifacts)) {
    const portable = portableArtifactRelativePath(name);
    const key = `artifacts/${portable}`;
    if (Object.hasOwn(files, key)) {
      throw commandError(
        "artifacts_invalid",
        `Attempt artifact keys collide after portable normalization: '${name}' -> '${key}'`,
      );
    }
    files[key] = value;
    manifest[key] = hashArtifactBytesV2(attemptArtifactBytes(value));
  }
  return { files, manifest };
}

function portableArtifactRelativePath(input: string): string {
  if (!input || input.includes("\0") || /^[A-Za-z]:[\\/]/u.test(input)) {
    throw commandError("artifacts_invalid", `Attempt artifact path is not portable: '${input}'`);
  }
  const slash = input.replace(/\\/gu, "/");
  if (slash.startsWith("/") || slash.split("/").includes("..")) {
    throw commandError("artifacts_invalid", `Attempt artifact path escapes its root: '${input}'`);
  }
  const normalized = slash.split("/").filter((segment) => segment !== "" && segment !== ".").join("/");
  if (!normalized) {
    throw commandError("artifacts_invalid", `Attempt artifact path is empty after normalization: '${input}'`);
  }
  return normalized;
}

function attemptArtifactBytes(value: string | Uint8Array | object): Uint8Array {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function distinctNonce(current: string, create: () => string): string {
  const candidate = create();
  return candidate === current ? `${candidate}-${randomUUID()}` : candidate;
}

function asHash(value: string): ArtifactHashV2 {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw commandError("hash_invalid", `Expected sha256 hash, got '${value}'`);
  }
  return value as ArtifactHashV2;
}

function requireNonEmpty(value: string | undefined, label: string): string {
  if (!value?.trim()) throw commandError("input_invalid", `${label} must be non-empty`);
  return value.trim();
}

function commandError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function errorShape(error: unknown): { code: string; message: string } {
  return {
    code:
      error && typeof error === "object" && "code" in error && typeof error.code === "string"
        ? error.code
        : error instanceof Error
          ? error.name
          : "loop_contract_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function createLoopV2Command(dependencies: LoopV2Dependencies = {}): Command {
  const loop = new Command("loop").description("Manage canonical Corgi run-contract v2 state");

  loop.command("init")
    .argument("<change>")
    .option("--session <id>")
    .option("--owner <id>")
    .option("--owner-kind <kind>", "human, agent, or automation", "agent")
    .option("--mode <mode>", "self-driven or hook-driven", "hook-driven")
    .option("--run-id <id>")
    .option("--store <id>")
    .option("--require-push")
    .option("--path <dir>", "Working directory", ".")
    .option("--json")
    .action(async (change, opts) => emitLoopResult(await executeLoopV2({
      operation: "init",
      changeName: change,
      projectRoot: opts.path,
      sessionId: opts.session,
      ownerId: opts.owner,
      ownerKind: opts.ownerKind,
      mode: opts.mode,
      runId: opts.runId,
      store: opts.store,
      requirePush: opts.requirePush,
    }, dependencies), opts.json));

  loop.command("inspect")
    .argument("<change>")
    .option("--run-id <id>")
    .option("--path <dir>", "Working directory", ".")
    .option("--json")
    .action(async (change, opts) => emitLoopResult(await executeLoopV2({
      operation: "inspect", changeName: change, projectRoot: opts.path, runId: opts.runId,
    }, dependencies), opts.json));

  addCasOptions(loop.command("submit").argument("<change>").option("--bundle <file>"))
    .option("--store <id>")
    .action(async (change, opts) => {
      try {
        const stdin = opts.bundle ? {} : await readOptionalStdinJson();
        const bundle = opts.bundle
          ? JSON.parse(await readFile(resolve(opts.path, opts.bundle), "utf8"))
          : (stdin.bundle ?? stdin);
        emitLoopResult(await executeLoopV2({
          operation: "submit", changeName: change, projectRoot: opts.path,
          ...casOptions(opts, stdin), bundle, store: opts.store,
        }, dependencies), opts.json);
      } catch (error) {
        emitLoopResult(loopInputFailure("submit", change, error), opts.json);
      }
    });

  addCasOptions(loop.command("ack-commit").argument("<change>"))
    .option("--push-status <status>")
    .option("--remote-revision <revision>")
    .action(async (change, opts) => {
      try {
        const stdin = needsCasStdin(opts) ? await readOptionalStdinJson() : {};
        emitLoopResult(await executeLoopV2({
          operation: "ack-commit", changeName: change, projectRoot: opts.path,
          ...casOptions(opts, stdin), pushStatus: opts.pushStatus,
          remoteRevision: opts.remoteRevision,
        }, dependencies), opts.json);
      } catch (error) {
        emitLoopResult(loopInputFailure("ack-commit", change, error), opts.json);
      }
    });

  addCasOptions(loop.command("finalize").argument("<change>"))
    .option("--store <id>")
    .action(async (change, opts) => {
      try {
        const stdin = needsCasStdin(opts) ? await readOptionalStdinJson() : {};
        emitLoopResult(await executeLoopV2({
          operation: "finalize", changeName: change, projectRoot: opts.path,
          ...casOptions(opts, stdin), store: opts.store,
        }, dependencies), opts.json);
      } catch (error) {
        emitLoopResult(loopInputFailure("finalize", change, error), opts.json);
      }
    });

  addCasOptions(loop.command("invalidate").argument("<change>").option("--reason <text>"))
    .action(async (change, opts) => {
      try {
        const stdin = needsCasStdin(opts) ? await readOptionalStdinJson() : {};
        emitLoopResult(await executeLoopV2({
          operation: "invalidate", changeName: change, projectRoot: opts.path,
          ...casOptions(opts, stdin), reason: opts.reason,
        }, dependencies), opts.json);
      } catch (error) {
        emitLoopResult(loopInputFailure("invalidate", change, error), opts.json);
      }
    });

  addCasOptions(loop.command("resume").argument("<change>"))
    .option("--new-session <id>")
    .option("--target-phase <phase>")
    .option("--max-attempts <count>")
    .action(async (change, opts) => {
      try {
        const stdin = needsCasStdin(opts) ? await readOptionalStdinJson() : {};
        emitLoopResult(await executeLoopV2({
          operation: "resume", changeName: change, projectRoot: opts.path,
          ...casOptions(opts, stdin), newSessionId: opts.newSession ?? stdin.newSessionId,
          targetPhase: optionalActivePhase(opts.targetPhase ?? stdin.targetPhase),
          maxAttemptsPerGroup: optionalInteger(opts.maxAttempts ?? stdin.maxAttemptsPerGroup),
        }, dependencies), opts.json);
      } catch (error) {
        emitLoopResult(loopInputFailure("resume", change, error), opts.json);
      }
    });

  return loop;
}

function addCasOptions(command: Command): Command {
  return command
    .option("--run-id <id>")
    .option("--session <id>")
    .option("--state-revision <number>")
    .option("--nonce <token>")
    .option("--path <dir>", "Working directory", ".")
    .option("--json");
}

function casOptions(opts: Record<string, unknown>, stdin: Record<string, any>): LoopCasRequestV2 {
  return {
    runId: requireNonEmpty(String(opts.runId ?? stdin.runId ?? ""), "runId"),
    sessionId: requireNonEmpty(String(opts.session ?? stdin.sessionId ?? ""), "sessionId"),
    stateRevision: requiredInteger(opts.stateRevision ?? stdin.stateRevision, "stateRevision"),
    nonce: requireNonEmpty(String(opts.nonce ?? stdin.nonce ?? ""), "nonce"),
  };
}

function needsCasStdin(opts: Record<string, unknown>): boolean {
  return !opts.runId || !opts.session || opts.stateRevision === undefined || !opts.nonce;
}

function requiredInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw commandError("input_invalid", `${label} must be a non-negative integer`);
  return parsed;
}

function optionalActivePhase(value: unknown): ActiveLoopPhaseV2 | undefined {
  if (value === undefined) return undefined;
  if (!isActiveLoopPhaseV2(value)) {
    throw commandError("input_invalid", `targetPhase must be an active loop phase, got '${String(value)}'`);
  }
  return value;
}

function optionalInteger(value: unknown): number | undefined {
  return value === undefined ? undefined : requiredInteger(value, "maxAttemptsPerGroup");
}

async function readOptionalStdinJson(): Promise<Record<string, any>> {
  if (process.stdin.isTTY) return {};
  let input = "";
  for await (const chunk of process.stdin) input += String(chunk);
  if (!input.trim()) return {};
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw commandError("input_invalid", "stdin must be a JSON object");
  }
  return parsed;
}

function emitLoopResult(result: LoopExecutionResultV2, json: boolean): void {
  if (json) process.stdout.write(`${JSON.stringify(result.output)}\n`);
  else if (result.output.status === "error") process.stderr.write(`${result.output.error?.message}\n`);
  else process.stdout.write(`${result.output.message ?? JSON.stringify(result.output.action ?? result.output.status)}\n`);
  process.exitCode = result.exitCode;
}

function loopInputFailure(
  operation: LoopRequestV2["operation"],
  changeName: string,
  error: unknown,
): LoopExecutionResultV2 {
  return {
    exitCode: 2,
    output: {
      schemaVersion: 2,
      operation,
      status: "error",
      changeName,
      error: { code: "input_invalid", message: error instanceof Error ? error.message : String(error) },
    },
  };
}
