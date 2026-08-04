import { isDeepStrictEqual } from "node:util";

import type {
  ArtifactHashV2,
  BlockedReasonV2,
  LoopEventActorV2,
  LoopEventRecordV2,
  LoopEventTypeV2,
  LoopEventV2,
  LoopGroupStateV2,
  LoopLimitsV2,
  LoopOwnerV2,
  LoopPhaseV2,
  LoopPolicyV2,
  LoopRunModeV2,
  LoopStateV2,
  LoopTrackingStateV2,
  RunInitializedEventV2,
} from "./run-contract-v2.js";
import {
  ACTIVE_PHASES_V2,
  LOOP_EVENT_TYPES_V2,
  TERMINAL_PHASES_V2,
  assertLoopEventRecordV2,
  assertLoopEventV2,
  assertLoopStateV2,
  validateLoopEventRecordV2,
} from "./run-contract-v2.js";

export const TRANSITION_MATRIX_V2: Readonly<Record<LoopPhaseV2, readonly LoopEventTypeV2[]>> = {
  awaiting_group_result: ["bundle_submitted", "run_invalidated", "run_blocked"],
  awaiting_evaluation: ["evaluation_completed", "run_invalidated", "run_blocked"],
  fixing: ["bundle_submitted", "run_invalidated", "run_blocked"],
  awaiting_group_commit: ["group_commit_acknowledged", "run_invalidated", "run_blocked"],
  awaiting_tracker_sync: ["group_tracker_checkpointed", "run_invalidated", "run_blocked"],
  awaiting_finalize: ["run_finalized", "run_invalidated", "run_blocked"],
  done: ["run_invalidated"],
  verification_failed: ["run_resumed", "run_invalidated"],
  review_failed: ["run_resumed", "run_invalidated"],
  circuit_breaker: ["run_resumed", "run_invalidated"],
  corrupted: [],
  worktree_missing: ["run_resumed", "run_invalidated"],
  invalidated: [],
};

export type LoopReducerErrorCodeV2 =
  | "invalid_state"
  | "invalid_event"
  | "initialization_conflict"
  | "run_mismatch"
  | "stale_revision"
  | "stale_nonce"
  | "sequence_mismatch"
  | "timestamp_regression"
  | "event_limit"
  | "invalid_transition"
  | "group_mismatch"
  | "attempt_mismatch"
  | "bundle_mismatch"
  | "policy_violation"
  | "resume_target_mismatch";

export class LoopReducerErrorV2 extends Error {
  constructor(
    readonly code: LoopReducerErrorCodeV2,
    message: string,
  ) {
    super(message);
    this.name = "LoopReducerErrorV2";
  }
}

export interface InitialLoopGroupV2 {
  id: string;
  taskGroupFingerprint: ArtifactHashV2;
}

export interface CreateInitialLoopStateV2Input {
  changeName: string;
  runId: string;
  supersedesRunId?: string | null;
  owner: LoopOwnerV2;
  sessionId: string;
  mode: LoopRunModeV2;
  nonce: string;
  planningRevision: ArtifactHashV2;
  baselineGitRevision: string;
  workspaceFingerprint: ArtifactHashV2;
  policy: LoopPolicyV2;
  limits: LoopLimitsV2;
  tracking?: LoopTrackingStateV2;
  groups: readonly InitialLoopGroupV2[];
  startedAt: string;
}

function blankGroup(
  input: InitialLoopGroupV2,
  ordinal: number,
  current: boolean,
  requirePush: boolean,
): LoopGroupStateV2 {
  return {
    id: input.id,
    ordinal,
    status: current ? "in_progress" : "pending",
    taskGroupFingerprint: input.taskGroupFingerprint,
    attempt: current ? 1 : 0,
    bundle: {
      status: "none",
      bundleId: null,
      bundleHash: null,
      artifactHash: null,
      evidenceHash: null,
      reviewHash: null,
      observedGitRevision: null,
      workspaceFingerprint: null,
    },
    push: { status: requirePush ? "pending" : "not_required", remoteRevision: null },
    commit: { status: "pending", revision: null, tree: null, workspaceFingerprint: null },
    tracker: { status: "not_required", marker: null },
    completedAt: null,
  };
}

function resetBundle(group: LoopGroupStateV2): void {
  group.bundle = {
    status: "none",
    bundleId: null,
    bundleHash: null,
    artifactHash: null,
    evidenceHash: null,
    reviewHash: null,
    observedGitRevision: null,
    workspaceFingerprint: null,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Create the dispatched-first-group state used as run_initialized.postState. */
export function createInitialLoopStateV2(input: CreateInitialLoopStateV2Input): LoopStateV2 {
  if (input.groups.length === 0) {
    throw new LoopReducerErrorV2("invalid_state", "a run requires at least one task group");
  }
  if (input.groups.length > input.limits.maxGroups) {
    throw new LoopReducerErrorV2("invalid_state", "task group count exceeds maxGroups");
  }
  if (new Set(input.groups.map((group) => group.id)).size !== input.groups.length) {
    throw new LoopReducerErrorV2("invalid_state", "task group ids must be unique");
  }
  const groups = Object.fromEntries(input.groups.map((group, index) => [
    group.id,
    blankGroup(group, index + 1, index === 0, input.policy.requirePush),
  ]));
  const state: LoopStateV2 = {
    schemaVersion: 2,
    changeName: input.changeName,
    runId: input.runId,
    supersedesRunId: input.supersedesRunId ?? null,
    owner: clone(input.owner),
    sessionId: input.sessionId,
    mode: input.mode,
    stateRevision: 0,
    nonce: input.nonce,
    lastEventSeq: 0,
    phase: "awaiting_group_result",
    currentGroupId: input.groups[0]!.id,
    currentAttempt: 1,
    policy: clone(input.policy),
    limits: clone(input.limits),
    blockedReason: null,
    planningRevision: input.planningRevision,
    git: {
      baselineRevision: input.baselineGitRevision,
      finalRevision: null,
      workspaceFingerprint: input.workspaceFingerprint,
    },
    tracking: input.tracking ? clone(input.tracking) : { binding: null },
    groups,
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    completedAt: null,
  };
  try {
    assertLoopStateV2(state);
  } catch (error) {
    throw new LoopReducerErrorV2("invalid_state", error instanceof Error ? error.message : String(error));
  }
  return state;
}

/** Build the first durable event for a newly created state. */
export function createRunInitializedEventV2(
  state: LoopStateV2,
  actor: LoopEventActorV2 = state.owner,
): RunInitializedEventV2 {
  assertLoopStateV2(state);
  if (state.stateRevision !== 0 || state.lastEventSeq !== 0 || state.phase !== "awaiting_group_result") {
    throw new LoopReducerErrorV2("invalid_state", "initial state must be revision zero and awaiting_group_result");
  }
  return {
    schemaVersion: 2,
    type: "run_initialized",
    runId: state.runId,
    seq: 0,
    expectedStateRevision: -1,
    expectedNonce: null,
    nextNonce: state.nonce,
    occurredAt: state.updatedAt,
    actor: clone(actor),
    initialState: clone(state),
  };
}

function reducerError(code: LoopReducerErrorCodeV2, message: string): never {
  throw new LoopReducerErrorV2(code, message);
}

function currentGroup(state: LoopStateV2): LoopGroupStateV2 {
  const id = state.currentGroupId;
  if (id === null || !state.groups[id]) reducerError("group_mismatch", "state has no current task group");
  return state.groups[id]!;
}

function checkEventIdentity(state: LoopStateV2, event: Exclude<LoopEventV2, RunInitializedEventV2>): void {
  if (event.runId !== state.runId) reducerError("run_mismatch", "event runId does not match state");
  if (event.expectedStateRevision !== state.stateRevision) {
    reducerError("stale_revision", `expected revision ${event.expectedStateRevision}, current is ${state.stateRevision}`);
  }
  if (event.expectedNonce !== state.nonce) reducerError("stale_nonce", "event nonce does not match state");
  if (event.seq !== state.lastEventSeq + 1) reducerError("sequence_mismatch", "event sequence must increment exactly once");
  if (Date.parse(event.occurredAt) < Date.parse(state.updatedAt)) {
    reducerError("timestamp_regression", "event timestamp must not precede the current snapshot");
  }
  if (event.seq > state.limits.maxEvents) reducerError("event_limit", "event exceeds limits.maxEvents");
  if (!TRANSITION_MATRIX_V2[state.phase].includes(event.type)) {
    reducerError("invalid_transition", `${event.type} is not allowed in ${state.phase}`);
  }
}

function checkGroupIdentity(
  state: LoopStateV2,
  event: { groupId: string; attempt: number },
): LoopGroupStateV2 {
  const group = currentGroup(state);
  if (event.groupId !== group.id) reducerError("group_mismatch", "event task group is not current");
  if (event.attempt !== state.currentAttempt || event.attempt !== group.attempt) {
    reducerError("attempt_mismatch", "event attempt is stale or does not match the task group");
  }
  return group;
}

function advanceMetadata(
  state: LoopStateV2,
  event: Exclude<LoopEventV2, RunInitializedEventV2>,
): void {
  state.stateRevision = event.expectedStateRevision + 1;
  state.lastEventSeq = event.seq;
  state.nonce = event.nextNonce;
  state.updatedAt = event.occurredAt;
}

function terminalize(state: LoopStateV2, phase: LoopStateV2["phase"], reason: BlockedReasonV2): void {
  state.phase = phase;
  state.blockedReason = clone(reason);
  state.completedAt = state.updatedAt;
}

function applyBundleSubmitted(
  state: LoopStateV2,
  event: Extract<LoopEventV2, { type: "bundle_submitted" }>,
): void {
  const group = checkGroupIdentity(state, event);
  group.status = "in_progress";
  group.bundle = {
    status: "submitted",
    bundleId: event.bundleId,
    bundleHash: event.bundleHash,
    artifactHash: event.artifactHash,
    evidenceHash: null,
    reviewHash: null,
    observedGitRevision: event.observedGitRevision,
    workspaceFingerprint: event.workspaceFingerprint,
  };
  state.phase = "awaiting_evaluation";
  state.blockedReason = null;
}

function applyEvaluation(
  state: LoopStateV2,
  event: Extract<LoopEventV2, { type: "evaluation_completed" }>,
): void {
  const group = checkGroupIdentity(state, event);
  if (group.bundle.status !== "submitted") reducerError("bundle_mismatch", "evaluation requires a submitted bundle");
  group.bundle.evidenceHash = event.evidenceHash;
  group.bundle.reviewHash = event.reviewHash;
  if (event.result === "pass") {
    if (!event.reviewClean) reducerError("policy_violation", "passing evaluation requires a clean review");
    group.bundle.status = "approved";
    group.status = "awaiting_commit";
    state.phase = "awaiting_group_commit";
    state.blockedReason = null;
    return;
  }

  group.bundle.status = "rejected";
  const reason = event.reason;
  if (reason === null) reducerError("invalid_event", "failed evaluation requires a reason");
  const retryAvailable = state.mode === "self-driven"
    && state.currentAttempt < state.limits.maxAttemptsPerGroup;
  if (retryAvailable) {
    const nextAttempt = state.currentAttempt + 1;
    state.currentAttempt = nextAttempt;
    group.attempt = nextAttempt;
    group.status = "in_progress";
    resetBundle(group);
    state.phase = "fixing";
    state.blockedReason = clone(reason);
    return;
  }
  group.status = "failed";
  terminalize(state, event.result, reason);
}

function nextPendingGroup(state: LoopStateV2, completedOrdinal: number): LoopGroupStateV2 | null {
  return Object.values(state.groups).find((candidate) => candidate.ordinal === completedOrdinal + 1) ?? null;
}

function applyCommitAcknowledged(
  state: LoopStateV2,
  event: Extract<LoopEventV2, { type: "group_commit_acknowledged" }>,
): void {
  const group = checkGroupIdentity(state, event);
  if (group.bundle.status !== "approved") reducerError("bundle_mismatch", "commit acknowledgement requires an approved bundle");
  if (group.bundle.workspaceFingerprint !== event.workspaceFingerprint) {
    reducerError("bundle_mismatch", "commit workspace fingerprint differs from the tested bundle");
  }
  const expectedPush = state.policy.requirePush ? "pushed" : "not_required";
  if (event.pushStatus !== expectedPush) reducerError("policy_violation", `push status must be ${expectedPush}`);
  group.commit = {
    status: "acknowledged",
    revision: event.commitRevision,
    tree: event.commitTree,
    workspaceFingerprint: event.workspaceFingerprint,
  };
  group.push = { status: event.pushStatus, remoteRevision: event.remoteRevision };
  group.status = "completed";
  group.completedAt = state.updatedAt;
  if (state.tracking.binding !== null) {
    group.tracker = { status: "pending", marker: null };
    state.phase = "awaiting_tracker_sync";
    state.blockedReason = null;
    return;
  }
  advanceAfterCompletedGroup(state, group);
}

function advanceAfterCompletedGroup(state: LoopStateV2, group: LoopGroupStateV2): void {
  const next = nextPendingGroup(state, group.ordinal);
  if (next === null) {
    state.currentGroupId = null;
    state.currentAttempt = 0;
    state.phase = "awaiting_finalize";
    return;
  }
  next.status = "in_progress";
  next.attempt = 1;
  state.currentGroupId = next.id;
  state.currentAttempt = 1;
  state.phase = "awaiting_group_result";
  state.blockedReason = null;
}

function applyTrackerCheckpointed(
  state: LoopStateV2,
  event: Extract<LoopEventV2, { type: "group_tracker_checkpointed" }>,
): void {
  const group = checkGroupIdentity(state, event);
  if (state.tracking.binding === null) {
    reducerError("policy_violation", "tracker checkpoint requires a configured tracker binding");
  }
  if (group.status !== "completed" || group.commit.status !== "acknowledged") {
    reducerError("bundle_mismatch", "tracker checkpoint requires an acknowledged Task Group commit");
  }
  if (group.tracker.status !== "pending") {
    reducerError("policy_violation", "tracker checkpoint is not pending");
  }
  group.tracker = { status: "checkpointed", marker: event.marker };
  advanceAfterCompletedGroup(state, group);
}

function applyResume(
  state: LoopStateV2,
  event: Extract<LoopEventV2, { type: "run_resumed" }>,
): void {
  if (event.maxAttemptsPerGroup < state.limits.maxAttemptsPerGroup) {
    reducerError("policy_violation", "resume may not lower maxAttemptsPerGroup");
  }
  const sourcePhase = state.phase;
  const priorReason = state.blockedReason;
  if (event.targetPhase === "awaiting_finalize") {
    if (state.currentGroupId !== null || Object.values(state.groups).some((group) => group.status !== "completed")) {
      reducerError("group_mismatch", "only a run with all groups completed may resume finalization");
    }
    state.limits.maxAttemptsPerGroup = event.maxAttemptsPerGroup;
    state.sessionId = event.sessionId;
    state.phase = "awaiting_finalize";
    state.blockedReason = null;
    state.completedAt = null;
    state.git.finalRevision = null;
    return;
  }
  const group = currentGroup(state);
  state.limits.maxAttemptsPerGroup = event.maxAttemptsPerGroup;
  state.sessionId = event.sessionId;

  if (sourcePhase === "verification_failed" || sourcePhase === "review_failed") {
    if (event.targetPhase !== "fixing") {
      reducerError("resume_target_mismatch", `${sourcePhase} may resume only into fixing`);
    }
    const nextAttempt = group.attempt + 1;
    if (event.maxAttemptsPerGroup < nextAttempt) {
      reducerError("policy_violation", "resume attempt exceeds maxAttemptsPerGroup");
    }
    state.currentAttempt = nextAttempt;
    group.attempt = nextAttempt;
    group.status = "in_progress";
    group.completedAt = null;
    group.commit = { status: "pending", revision: null, tree: null, workspaceFingerprint: null };
    group.push = { status: state.policy.requirePush ? "pending" : "not_required", remoteRevision: null };
    resetBundle(group);
  } else {
    const validTarget =
      ((event.targetPhase === "awaiting_group_result" || event.targetPhase === "fixing")
        && group.status === "in_progress" && group.bundle.status === "none") ||
      (event.targetPhase === "awaiting_evaluation"
        && group.status === "in_progress" && group.bundle.status === "submitted") ||
      (event.targetPhase === "awaiting_group_commit"
        && group.status === "awaiting_commit" && group.bundle.status === "approved") ||
      (event.targetPhase === "awaiting_tracker_sync"
        && group.status === "completed" && group.tracker.status === "pending");
    if (!validTarget) {
      reducerError(
        "resume_target_mismatch",
        `${sourcePhase} cannot restore ${event.targetPhase} from the durable group bundle`,
      );
    }
  }
  state.phase = event.targetPhase;
  state.blockedReason = event.targetPhase === "fixing" ? priorReason : null;
  state.completedAt = null;
  state.git.finalRevision = null;
}

/**
 * Apply one canonical event and return its durable event/post-state record.
 * The input state is never mutated.  Any stale token or invalid transition throws
 * before a post-state exists, allowing the store to remain byte-for-byte intact.
 */
export function reduceLoopEventV2(
  state: LoopStateV2 | null,
  event: LoopEventV2,
): LoopEventRecordV2 {
  try {
    assertLoopEventV2(event);
  } catch (error) {
    throw new LoopReducerErrorV2("invalid_event", error instanceof Error ? error.message : String(error));
  }
  if (state === null) {
    if (event.type !== "run_initialized") reducerError("initialization_conflict", "first event must initialize the run");
    const postState = clone(event.initialState);
    if (postState.runId !== event.runId || postState.nonce !== event.nextNonce
      || postState.updatedAt !== event.occurredAt || postState.stateRevision !== 0
      || postState.lastEventSeq !== 0 || postState.owner.id !== event.actor.id) {
      reducerError("initialization_conflict", "run_initialized metadata does not match initialState");
    }
    const record: LoopEventRecordV2 = { schemaVersion: 2, event: clone(event), postState };
    assertLoopEventRecordV2(record);
    return record;
  }
  try {
    assertLoopStateV2(state);
  } catch (error) {
    throw new LoopReducerErrorV2("invalid_state", error instanceof Error ? error.message : String(error));
  }
  if (event.type === "run_initialized") reducerError("initialization_conflict", "an existing run cannot be initialized again");
  checkEventIdentity(state, event);
  const postState = clone(state);
  advanceMetadata(postState, event);

  switch (event.type) {
    case "bundle_submitted":
      applyBundleSubmitted(postState, event);
      break;
    case "evaluation_completed":
      applyEvaluation(postState, event);
      break;
    case "group_commit_acknowledged":
      applyCommitAcknowledged(postState, event);
      break;
    case "group_tracker_checkpointed":
      applyTrackerCheckpointed(postState, event);
      break;
    case "run_finalized":
      postState.phase = "done";
      postState.git.finalRevision = event.finalGitRevision;
      postState.git.workspaceFingerprint = event.workspaceFingerprint;
      postState.blockedReason = null;
      postState.completedAt = postState.updatedAt;
      break;
    case "run_invalidated":
      postState.phase = "invalidated";
      postState.blockedReason = clone(event.reason);
      postState.completedAt = postState.updatedAt;
      if (postState.currentGroupId !== null) postState.groups[postState.currentGroupId]!.status = "invalidated";
      break;
    case "run_blocked":
      terminalize(postState, event.terminalPhase, event.reason);
      break;
    case "run_resumed":
      applyResume(postState, event);
      break;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
  const record: LoopEventRecordV2 = { schemaVersion: 2, event: clone(event), postState };
  try {
    assertLoopEventRecordV2(record);
  } catch (error) {
    throw new LoopReducerErrorV2("invalid_state", error instanceof Error ? error.message : String(error));
  }
  return record;
}

/** Replay records or bare events and verify every recorded post-state. */
export function replayLoopEventsV2(events: readonly LoopEventV2[]): LoopStateV2 {
  if (events.length === 0) reducerError("initialization_conflict", "cannot replay an empty event stream");
  let state: LoopStateV2 | null = null;
  for (const event of events) state = reduceLoopEventV2(state, event).postState;
  return state!;
}

/** True only for an exact repeat of the most recently committed event token. */
export function isIdempotentEventReplayV2(record: LoopEventRecordV2, event: LoopEventV2): boolean {
  return validateLoopEventRecordV2(record).valid && isDeepStrictEqual(record.event, event);
}

/** Exposed for transition-table tests and CLI help generation. */
export function isEventAllowedInPhaseV2(phase: LoopPhaseV2, type: LoopEventTypeV2): boolean {
  return TRANSITION_MATRIX_V2[phase].includes(type);
}

// Compile-time guards keep the matrix exhaustive when either union grows.
const _allPhases: readonly LoopPhaseV2[] = [...ACTIVE_PHASES_V2, ...TERMINAL_PHASES_V2];
const _allEvents: readonly LoopEventTypeV2[] = LOOP_EVENT_TYPES_V2;
void _allPhases;
void _allEvents;
