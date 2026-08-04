/**
 * Canonical, platform-independent contract for Corgi run state version 2.
 *
 * This module deliberately contains no filesystem or git operations.  It is the
 * shared boundary used by the reducer, persistent store, and CLI.
 */

import { validateConvergenceIntentV2 } from "./convergence-intent-v2.js";

export const ACTIVE_PHASES_V2 = [
  "awaiting_group_result",
  "awaiting_evaluation",
  "fixing",
  "awaiting_group_commit",
  "awaiting_tracker_sync",
  "awaiting_finalize",
] as const;

export const TERMINAL_PHASES_V2 = [
  "done",
  "verification_failed",
  "review_failed",
  "circuit_breaker",
  "corrupted",
  "worktree_missing",
  "invalidated",
] as const;

export type ActiveLoopPhaseV2 = (typeof ACTIVE_PHASES_V2)[number];
export type TerminalLoopPhaseV2 = (typeof TERMINAL_PHASES_V2)[number];
export type LoopPhaseV2 = ActiveLoopPhaseV2 | TerminalLoopPhaseV2;

export const LOOP_EVENT_TYPES_V2 = [
  "run_initialized",
  "bundle_submitted",
  "evaluation_completed",
  "group_commit_acknowledged",
  "group_tracker_checkpointed",
  "run_finalized",
  "run_invalidated",
  "run_blocked",
  "run_resumed",
] as const;

export type LoopEventTypeV2 = (typeof LOOP_EVENT_TYPES_V2)[number];
export type LoopRunModeV2 = "self-driven" | "hook-driven";
export type LoopOwnerKindV2 = "human" | "agent" | "automation";
export type ArtifactHashV2 = `sha256:${string}`;

export interface LoopOwnerV2 {
  id: string;
  kind: LoopOwnerKindV2;
}

export interface LoopPolicyV2 {
  /** PASS requires a review without an open finding. */
  requireCleanReview: boolean;
  /** PASS requires at least one successful CLI evidence entry. */
  requireCliPass: boolean;
  /** Commit acknowledgement must attest a clean worktree. */
  requireCleanWorktreeForCommit: boolean;
  /** A completed group must also have a pushed revision. */
  requirePush: boolean;
}

export interface LoopLimitsV2 {
  maxGroups: number;
  maxAttemptsPerGroup: number;
  maxEvents: number;
}

export type BlockedReasonCodeV2 =
  | "verification_failed"
  | "review_findings"
  | "retry_exhausted"
  | "circuit_breaker"
  | "corrupted_state"
  | "worktree_missing"
  | "planning_invalidated"
  | "manual";

export interface BlockedReasonV2 {
  code: BlockedReasonCodeV2;
  message: string;
  details: Record<string, unknown>;
}

export interface GitBindingV2 {
  baselineRevision: string;
  finalRevision: string | null;
  workspaceFingerprint: ArtifactHashV2;
}

export type LoopTrackerProviderV2 = "github" | "gitlab";

/** Immutable Issue target captured when a fresh RC8 loop starts. */
export interface LoopTrackerBindingV2 {
  provider: LoopTrackerProviderV2;
  issueUrl: string;
  repository: string;
  issueNumber: number;
}

export interface LoopTrackingStateV2 {
  binding: LoopTrackerBindingV2 | null;
}

export type LoopGroupStatusV2 =
  | "pending"
  | "in_progress"
  | "awaiting_commit"
  | "completed"
  | "failed"
  | "invalidated";

export interface GroupBundleStateV2 {
  status: "none" | "submitted" | "approved" | "rejected";
  bundleId: string | null;
  bundleHash: ArtifactHashV2 | null;
  artifactHash: ArtifactHashV2 | null;
  evidenceHash: ArtifactHashV2 | null;
  reviewHash: ArtifactHashV2 | null;
  observedGitRevision: string | null;
  workspaceFingerprint: ArtifactHashV2 | null;
}

export interface GroupPushStateV2 {
  status: "not_required" | "pending" | "pushed";
  remoteRevision: string | null;
}

export interface GroupCommitStateV2 {
  status: "pending" | "acknowledged";
  revision: string | null;
  tree: string | null;
  workspaceFingerprint: ArtifactHashV2 | null;
}

export interface GroupTrackerCheckpointStateV2 {
  status: "not_required" | "pending" | "checkpointed";
  marker: string | null;
}

export interface LoopGroupStateV2 {
  id: string;
  ordinal: number;
  status: LoopGroupStatusV2;
  taskGroupFingerprint: ArtifactHashV2;
  /** Zero for an undispatched group, otherwise the most recent attempt. */
  attempt: number;
  bundle: GroupBundleStateV2;
  push: GroupPushStateV2;
  commit: GroupCommitStateV2;
  tracker: GroupTrackerCheckpointStateV2;
  completedAt: string | null;
}

export interface LoopStateV2 {
  schemaVersion: 2;
  changeName: string;
  runId: string;
  supersedesRunId: string | null;
  owner: LoopOwnerV2;
  sessionId: string;
  mode: LoopRunModeV2;
  stateRevision: number;
  nonce: string;
  lastEventSeq: number;
  phase: LoopPhaseV2;
  currentGroupId: string | null;
  /** Zero exactly when currentGroupId is null. */
  currentAttempt: number;
  policy: LoopPolicyV2;
  limits: LoopLimitsV2;
  blockedReason: BlockedReasonV2 | null;
  planningRevision: ArtifactHashV2;
  git: GitBindingV2;
  tracking: LoopTrackingStateV2;
  groups: Record<string, LoopGroupStateV2>;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface LoopEventActorV2 {
  id: string;
  kind: LoopOwnerKindV2;
}

interface LoopEventBaseV2 {
  schemaVersion: 2;
  type: LoopEventTypeV2;
  runId: string;
  /** Zero for run_initialized; otherwise previous lastEventSeq + 1. */
  seq: number;
  /** -1 for run_initialized; otherwise the revision being compared. */
  expectedStateRevision: number;
  /** null for run_initialized; otherwise the nonce being compared. */
  expectedNonce: string | null;
  nextNonce: string;
  occurredAt: string;
  actor: LoopEventActorV2;
}

export interface RunInitializedEventV2 extends LoopEventBaseV2 {
  type: "run_initialized";
  seq: 0;
  expectedStateRevision: -1;
  expectedNonce: null;
  initialState: LoopStateV2;
}

export interface BundleSubmittedEventV2 extends LoopEventBaseV2 {
  type: "bundle_submitted";
  groupId: string;
  attempt: number;
  bundleId: string;
  bundleHash: ArtifactHashV2;
  artifactHash: ArtifactHashV2;
  observedGitRevision: string;
  workspaceFingerprint: ArtifactHashV2;
}

export type EvaluationResultV2 =
  | "pass"
  | "verification_failed"
  | "review_failed";

export interface EvaluationCompletedEventV2 extends LoopEventBaseV2 {
  type: "evaluation_completed";
  groupId: string;
  attempt: number;
  result: EvaluationResultV2;
  evidenceHash: ArtifactHashV2;
  reviewHash: ArtifactHashV2;
  reviewClean: boolean;
  reason: BlockedReasonV2 | null;
}

export interface GroupCommitAcknowledgedEventV2 extends LoopEventBaseV2 {
  type: "group_commit_acknowledged";
  groupId: string;
  attempt: number;
  commitRevision: string;
  commitTree: string;
  workspaceFingerprint: ArtifactHashV2;
  pushStatus: "not_required" | "pushed";
  remoteRevision: string | null;
}

export interface GroupTrackerCheckpointedEventV2 extends LoopEventBaseV2 {
  type: "group_tracker_checkpointed";
  groupId: string;
  attempt: number;
  marker: string;
}

export interface RunFinalizedEventV2 extends LoopEventBaseV2 {
  type: "run_finalized";
  finalGitRevision: string;
  workspaceFingerprint: ArtifactHashV2;
}

export interface RunInvalidatedEventV2 extends LoopEventBaseV2 {
  type: "run_invalidated";
  reason: BlockedReasonV2;
}

export interface RunBlockedEventV2 extends LoopEventBaseV2 {
  type: "run_blocked";
  terminalPhase: "circuit_breaker" | "corrupted" | "worktree_missing";
  reason: BlockedReasonV2;
}

export interface RunResumedEventV2 extends LoopEventBaseV2 {
  type: "run_resumed";
  sessionId: string;
  targetPhase: ActiveLoopPhaseV2;
  /** May raise (never lower) the attempt ceiling after an explicit resume. */
  maxAttemptsPerGroup: number;
}

export type LoopEventV2 =
  | RunInitializedEventV2
  | BundleSubmittedEventV2
  | EvaluationCompletedEventV2
  | GroupCommitAcknowledgedEventV2
  | GroupTrackerCheckpointedEventV2
  | RunFinalizedEventV2
  | RunInvalidatedEventV2
  | RunBlockedEventV2
  | RunResumedEventV2;

/** Durable JSONL entry. postState makes event-first crash recovery deterministic. */
export interface LoopEventRecordV2 {
  schemaVersion: 2;
  event: LoopEventV2;
  postState: LoopStateV2;
}

export interface RunContractValidationResultV2 {
  valid: boolean;
  errors: string[];
}

export class RunContractValidationErrorV2 extends Error {
  readonly errors: string[];

  constructor(label: string, errors: string[]) {
    super(`${label}: ${errors.join("; ")}`);
    this.name = "RunContractValidationErrorV2";
    this.errors = errors;
  }
}

const ACTIVE_PHASE_SET = new Set<string>(ACTIVE_PHASES_V2);
const TERMINAL_PHASE_SET = new Set<string>(TERMINAL_PHASES_V2);
const EVENT_TYPE_SET = new Set<string>(LOOP_EVENT_TYPES_V2);
const OWNER_KIND_SET = new Set<string>(["human", "agent", "automation"]);
const MODE_SET = new Set<string>(["self-driven", "hook-driven"]);
const GROUP_STATUS_SET = new Set<string>([
  "pending",
  "in_progress",
  "awaiting_commit",
  "completed",
  "failed",
  "invalidated",
]);
const BLOCK_REASON_SET = new Set<string>([
  "verification_failed",
  "review_findings",
  "retry_exhausted",
  "circuit_breaker",
  "corrupted_state",
  "worktree_missing",
  "planning_invalidated",
  "manual",
]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PORTABLE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isPortableRunSegmentV2(value: unknown): value is string {
  return typeof value === "string" &&
    PORTABLE_SEGMENT_PATTERN.test(value) &&
    value !== "." &&
    value !== ".." &&
    !value.endsWith(".") &&
    !value.endsWith(" ") &&
    !WINDOWS_RESERVED_SEGMENT.test(value);
}

function integer(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function hash(value: unknown): value is ArtifactHashV2 {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function nullable<T>(value: unknown, predicate: (candidate: unknown) => candidate is T): value is T | null {
  return value === null || predicate(value);
}

function validation(errors: string[]): RunContractValidationResultV2 {
  return { valid: errors.length === 0, errors };
}

function checkOwner(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!nonEmpty(value["id"])) errors.push(`${path}.id must be a non-empty string`);
  if (typeof value["kind"] !== "string" || !OWNER_KIND_SET.has(value["kind"])) {
    errors.push(`${path}.kind is invalid`);
  }
}

function checkReason(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof value["code"] !== "string" || !BLOCK_REASON_SET.has(value["code"])) {
    errors.push(`${path}.code is invalid`);
  }
  if (!nonEmpty(value["message"])) errors.push(`${path}.message must be non-empty`);
  const details = value["details"];
  if (!isRecord(details)) {
    errors.push(`${path}.details must be an object`);
    return;
  }
  if (details["operation"] === "converge") {
    if (value["code"] !== "planning_invalidated") {
      errors.push(`${path} convergence intent requires planning_invalidated code`);
    }
    const keys = Object.keys(details).sort();
    if (keys.join(",") !== "convergenceIntent,operation") {
      errors.push(`${path}.details convergence contract has unknown or missing fields`);
    }
    const intent = validateConvergenceIntentV2(details["convergenceIntent"]);
    errors.push(...intent.errors.map((error) => `${path}.details.${error}`));
  } else if (Object.prototype.hasOwnProperty.call(details, "convergenceIntent")) {
    errors.push(`${path}.details.convergenceIntent requires operation converge`);
  }
}

function checkTrackerBinding(value: unknown, path: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (value["provider"] !== "github" && value["provider"] !== "gitlab") {
    errors.push(`${path}.provider is invalid`);
  }
  if (!nonEmpty(value["issueUrl"])) {
    errors.push(`${path}.issueUrl must be non-empty`);
  } else {
    try {
      new URL(value["issueUrl"]);
    } catch {
      errors.push(`${path}.issueUrl must be a URL`);
    }
  }
  if (!nonEmpty(value["repository"])) errors.push(`${path}.repository must be non-empty`);
  if (!integer(value["issueNumber"], 1)) errors.push(`${path}.issueNumber must be a positive integer`);
}

function checkTracking(value: unknown, errors: string[]): value is LoopTrackingStateV2 {
  if (!isRecord(value)) {
    errors.push("tracking must be an object");
    return false;
  }
  if (value["binding"] !== null) checkTrackerBinding(value["binding"], "tracking.binding", errors);
  else if (!("binding" in value)) errors.push("tracking.binding must be an object or null");
  return true;
}

function checkGroup(value: unknown, key: string, errors: string[]): value is LoopGroupStateV2 {
  const path = `groups.${key}`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  const errorCount = errors.length;
  if (value["id"] !== key || !isPortableRunSegmentV2(value["id"]) || !isPortableRunSegmentV2(key)) {
    errors.push(`${path}.id must equal its portable safe map key`);
  }
  if (!integer(value["ordinal"], 1)) errors.push(`${path}.ordinal must be a positive integer`);
  if (typeof value["status"] !== "string" || !GROUP_STATUS_SET.has(value["status"])) {
    errors.push(`${path}.status is invalid`);
  }
  if (!hash(value["taskGroupFingerprint"])) errors.push(`${path}.taskGroupFingerprint must be sha256`);
  if (!integer(value["attempt"], 0)) errors.push(`${path}.attempt must be a non-negative integer`);
  if (!nullable(value["completedAt"], isoDate)) errors.push(`${path}.completedAt must be ISO time or null`);

  const bundle = value["bundle"];
  if (!isRecord(bundle)) {
    errors.push(`${path}.bundle must be an object`);
  } else {
    if (!["none", "submitted", "approved", "rejected"].includes(String(bundle["status"]))) {
      errors.push(`${path}.bundle.status is invalid`);
    }
    for (const field of ["bundleHash", "artifactHash", "evidenceHash", "reviewHash", "workspaceFingerprint"] as const) {
      if (!nullable(bundle[field], hash)) errors.push(`${path}.bundle.${field} must be sha256 or null`);
    }
    for (const field of ["bundleId", "observedGitRevision"] as const) {
      if (!nullable(bundle[field], nonEmpty)) errors.push(`${path}.bundle.${field} must be non-empty or null`);
    }
    const status = bundle["status"];
    const hasSubmission = nonEmpty(bundle["bundleId"]) && hash(bundle["bundleHash"])
      && hash(bundle["artifactHash"]) && nonEmpty(bundle["observedGitRevision"])
      && hash(bundle["workspaceFingerprint"]);
    if (status === "none" && Object.entries(bundle).some(([name, field]) => name !== "status" && field !== null)) {
      errors.push(`${path}.bundle none must not retain bindings`);
    }
    if (status !== "none" && !hasSubmission) errors.push(`${path}.bundle ${String(status)} requires submission bindings`);
    if (status === "approved" && (!hash(bundle["evidenceHash"]) || !hash(bundle["reviewHash"]))) {
      errors.push(`${path}.bundle approved requires evidence and review hashes`);
    }
  }

  const push = value["push"];
  if (!isRecord(push)) {
    errors.push(`${path}.push must be an object`);
  } else {
    if (!["not_required", "pending", "pushed"].includes(String(push["status"]))) {
      errors.push(`${path}.push.status is invalid`);
    }
    if (!nullable(push["remoteRevision"], nonEmpty)) errors.push(`${path}.push.remoteRevision must be non-empty or null`);
    if (push["status"] === "pushed" && !nonEmpty(push["remoteRevision"])) {
      errors.push(`${path}.push pushed requires remoteRevision`);
    }
    if (push["status"] !== "pushed" && push["remoteRevision"] !== null) {
      errors.push(`${path}.push remoteRevision is only valid when pushed`);
    }
  }

  const commit = value["commit"];
  if (!isRecord(commit)) {
    errors.push(`${path}.commit must be an object`);
  } else {
    if (!["pending", "acknowledged"].includes(String(commit["status"]))) {
      errors.push(`${path}.commit.status is invalid`);
    }
    for (const field of ["revision", "tree"] as const) {
      if (!nullable(commit[field], nonEmpty)) errors.push(`${path}.commit.${field} must be non-empty or null`);
    }
    if (!nullable(commit["workspaceFingerprint"], hash)) {
      errors.push(`${path}.commit.workspaceFingerprint must be sha256 or null`);
    }
    const acknowledged = commit["status"] === "acknowledged";
    const hasCommit = nonEmpty(commit["revision"]) && nonEmpty(commit["tree"])
      && hash(commit["workspaceFingerprint"]);
    if (acknowledged !== hasCommit) errors.push(`${path}.commit bindings must match acknowledged status`);
  }

  const tracker = value["tracker"];
  if (!isRecord(tracker)) {
    errors.push(`${path}.tracker must be an object`);
  } else {
    if (![
      "not_required",
      "pending",
      "checkpointed",
    ].includes(String(tracker["status"]))) {
      errors.push(`${path}.tracker.status is invalid`);
    }
    if (!nullable(tracker["marker"], nonEmpty)) {
      errors.push(`${path}.tracker.marker must be non-empty or null`);
    }
    if (tracker["status"] === "checkpointed" && !nonEmpty(tracker["marker"])) {
      errors.push(`${path}.tracker checkpointed requires marker`);
    }
    if (tracker["status"] !== "checkpointed" && tracker["marker"] !== null) {
      errors.push(`${path}.tracker marker is only valid when checkpointed`);
    }
  }

  const status = value["status"];
  const attempt = value["attempt"];
  const bundleStatus = isRecord(bundle) ? bundle["status"] : undefined;
  const commitStatus = isRecord(commit) ? commit["status"] : undefined;
  const pushStatus = isRecord(push) ? push["status"] : undefined;
  if (status === "pending" && attempt !== 0) errors.push(`${path} pending must have attempt zero`);
  if (status !== "pending" && integer(attempt, 0) && attempt === 0) errors.push(`${path} dispatched status requires a positive attempt`);
  if (status !== "completed" && value["completedAt"] !== null) errors.push(`${path}.completedAt is only valid when completed`);
  if (status !== "completed" && commitStatus === "acknowledged") errors.push(`${path} acknowledged commit requires completed status`);
  if (status !== "completed" && pushStatus === "pushed") errors.push(`${path} pushed revision requires completed status`);
  if (status === "pending" && bundleStatus !== "none") errors.push(`${path} pending must not have a bundle`);
  if (status === "awaiting_commit" && bundleStatus !== "approved") errors.push(`${path} awaiting_commit requires approved bundle`);
  if (status === "failed" && bundleStatus !== "rejected") errors.push(`${path} failed requires rejected bundle`);
  if (bundleStatus === "submitted" && isRecord(bundle)
    && (bundle["evidenceHash"] !== null || bundle["reviewHash"] !== null)) {
    errors.push(`${path}.bundle submitted must not contain evaluation hashes`);
  }
  if (bundleStatus === "rejected" && isRecord(bundle)
    && (!hash(bundle["evidenceHash"]) || !hash(bundle["reviewHash"]))) {
    errors.push(`${path}.bundle rejected requires evidence and review hashes`);
  }
  return errors.length === errorCount;
}

export function isActiveLoopPhaseV2(value: unknown): value is ActiveLoopPhaseV2 {
  return typeof value === "string" && ACTIVE_PHASE_SET.has(value);
}

export function isTerminalLoopPhaseV2(value: unknown): value is TerminalLoopPhaseV2 {
  return typeof value === "string" && TERMINAL_PHASE_SET.has(value);
}

export function validateLoopStateV2(value: unknown): RunContractValidationResultV2 {
  if (!isRecord(value)) return validation(["state must be an object"]);
  const errors: string[] = [];
  if (value["schemaVersion"] !== 2) errors.push("schemaVersion must equal 2");
  for (const field of ["changeName", "runId", "sessionId", "nonce"] as const) {
    if (!nonEmpty(value[field])) errors.push(`${field} must be a non-empty string`);
  }
  if (!nullable(value["supersedesRunId"], nonEmpty)) errors.push("supersedesRunId must be non-empty or null");
  if (value["supersedesRunId"] === value["runId"]) errors.push("supersedesRunId must differ from runId");
  checkOwner(value["owner"], "owner", errors);
  if (typeof value["mode"] !== "string" || !MODE_SET.has(value["mode"])) errors.push("mode is invalid");
  if (!integer(value["stateRevision"], 0)) errors.push("stateRevision must be a non-negative integer");
  if (!integer(value["lastEventSeq"], 0)) errors.push("lastEventSeq must be a non-negative integer");
  if (value["stateRevision"] !== value["lastEventSeq"]) errors.push("stateRevision must equal lastEventSeq");
  const phase = value["phase"];
  if (!isActiveLoopPhaseV2(phase) && !isTerminalLoopPhaseV2(phase)) errors.push("phase is invalid");
  if (!nullable(value["currentGroupId"], nonEmpty)) errors.push("currentGroupId must be non-empty or null");
  if (!integer(value["currentAttempt"], 0)) errors.push("currentAttempt must be a non-negative integer");

  const policy = value["policy"];
  if (!isRecord(policy)) {
    errors.push("policy must be an object");
  } else {
    for (const field of ["requireCleanReview", "requireCliPass", "requireCleanWorktreeForCommit", "requirePush"] as const) {
      if (typeof policy[field] !== "boolean") errors.push(`policy.${field} must be boolean`);
    }
    if (policy["requireCleanReview"] !== true) errors.push("policy.requireCleanReview must be true in v2");
    if (policy["requireCliPass"] !== true) errors.push("policy.requireCliPass must be true in v2");
  }

  const limits = value["limits"];
  if (!isRecord(limits)) {
    errors.push("limits must be an object");
  } else {
    for (const field of ["maxGroups", "maxAttemptsPerGroup", "maxEvents"] as const) {
      if (!integer(limits[field], 1)) errors.push(`limits.${field} must be a positive integer`);
    }
  }
  if (value["blockedReason"] !== null) checkReason(value["blockedReason"], "blockedReason", errors);
  if (!hash(value["planningRevision"])) errors.push("planningRevision must be sha256");

  const git = value["git"];
  if (!isRecord(git)) {
    errors.push("git must be an object");
  } else {
    if (!nonEmpty(git["baselineRevision"])) errors.push("git.baselineRevision must be non-empty");
    if (!nullable(git["finalRevision"], nonEmpty)) errors.push("git.finalRevision must be non-empty or null");
    if (!hash(git["workspaceFingerprint"])) errors.push("git.workspaceFingerprint must be sha256");
  }

  const trackingValid = checkTracking(value["tracking"], errors);
  const trackerBinding = trackingValid && isRecord(value["tracking"])
    ? value["tracking"]["binding"]
    : undefined;

  const groupsValue = value["groups"];
  const groups: LoopGroupStateV2[] = [];
  if (!isRecord(groupsValue) || Object.keys(groupsValue).length === 0) {
    errors.push("groups must be a non-empty object");
  } else {
    for (const [key, group] of Object.entries(groupsValue)) {
      if (checkGroup(group, key, errors)) groups.push(group as unknown as LoopGroupStateV2);
    }
  }

  if (!isoDate(value["startedAt"])) errors.push("startedAt must be ISO time");
  if (!isoDate(value["updatedAt"])) errors.push("updatedAt must be ISO time");
  if (!nullable(value["completedAt"], isoDate)) errors.push("completedAt must be ISO time or null");
  if (isoDate(value["startedAt"]) && isoDate(value["updatedAt"]) && Date.parse(value["updatedAt"]) < Date.parse(value["startedAt"])) {
    errors.push("updatedAt must not precede startedAt");
  }

  const maxGroups = isRecord(limits) && integer(limits["maxGroups"], 1) ? limits["maxGroups"] : 0;
  const maxAttempts = isRecord(limits) && integer(limits["maxAttemptsPerGroup"], 1)
    ? limits["maxAttemptsPerGroup"] : 0;
  if (maxGroups > 0 && groups.length > maxGroups) errors.push("group count exceeds limits.maxGroups");
  const maxEvents = isRecord(limits) && integer(limits["maxEvents"], 1) ? limits["maxEvents"] : 0;
  if (maxEvents > 0 && typeof value["lastEventSeq"] === "number" && value["lastEventSeq"] > maxEvents) {
    errors.push("lastEventSeq exceeds limits.maxEvents");
  }
  const ordinals = groups.map((group) => group.ordinal).sort((a, b) => a - b);
  if (ordinals.some((ordinal, index) => ordinal !== index + 1)) errors.push("group ordinals must be unique and contiguous");
  if (maxAttempts > 0 && groups.some((group) => group.attempt > maxAttempts)) {
    errors.push("group attempt exceeds limits.maxAttemptsPerGroup");
  }

  const currentId = typeof value["currentGroupId"] === "string" ? value["currentGroupId"] : null;
  const current = currentId && isRecord(groupsValue) ? groupsValue[currentId] as unknown : undefined;
  if (currentId !== null && !isRecord(current)) errors.push("currentGroupId must reference a group");
  if (currentId === null && value["currentAttempt"] !== 0) errors.push("currentAttempt must be zero without a current group");
  if (isRecord(current) && value["currentAttempt"] !== current["attempt"]) {
    errors.push("currentAttempt must equal the current group attempt");
  }

  const active = isActiveLoopPhaseV2(phase);
  const terminal = isTerminalLoopPhaseV2(phase);
  if (active && value["completedAt"] !== null) errors.push("active state must not have completedAt");
  if (terminal && !isoDate(value["completedAt"])) errors.push("terminal state requires completedAt");
  if (terminal && isoDate(value["completedAt"]) && isoDate(value["updatedAt"]) && value["completedAt"] !== value["updatedAt"]) {
    errors.push("terminal completedAt must equal updatedAt");
  }

  if (phase === "awaiting_finalize" || phase === "done") {
    if (currentId !== null || value["currentAttempt"] !== 0) errors.push(`${String(phase)} must not have a current group`);
    if (groups.some((group) => group.status !== "completed")) errors.push(`${String(phase)} requires every group completed`);
  } else if (active && currentId === null) {
    errors.push(`${String(phase)} requires a current group`);
  }
  if (isRecord(current)) {
    const expectedStatus: Partial<Record<LoopPhaseV2, LoopGroupStatusV2>> = {
      awaiting_group_result: "in_progress",
      awaiting_evaluation: "in_progress",
      fixing: "in_progress",
      awaiting_group_commit: "awaiting_commit",
      awaiting_tracker_sync: "completed",
      verification_failed: "failed",
      review_failed: "failed",
    };
    const expected = typeof phase === "string" ? expectedStatus[phase as LoopPhaseV2] : undefined;
    if (expected && current["status"] !== expected) errors.push(`current group must be ${expected} in ${String(phase)}`);
    const expectedBundle: Partial<Record<LoopPhaseV2, GroupBundleStateV2["status"]>> = {
      awaiting_group_result: "none",
      fixing: "none",
      awaiting_evaluation: "submitted",
      awaiting_group_commit: "approved",
      awaiting_tracker_sync: "approved",
      verification_failed: "rejected",
      review_failed: "rejected",
    };
    const bundleStatus = isRecord(current["bundle"]) ? current["bundle"]["status"] : undefined;
    const requiredBundle = typeof phase === "string" ? expectedBundle[phase as LoopPhaseV2] : undefined;
    if (requiredBundle && bundleStatus !== requiredBundle) {
      errors.push(`current group bundle must be ${requiredBundle} in ${String(phase)}`);
    }
  }
  if (groups.some((group) => group.status === "pending" && group.attempt !== 0)) {
    errors.push("pending groups must have attempt zero");
  }
  for (const group of groups.filter((candidate) => candidate.status === "completed")) {
    if (group.bundle.status !== "approved" || group.commit.status !== "acknowledged" || !isoDate(group.completedAt)) {
      errors.push(`completed group ${group.id} requires approved bundle, acknowledged commit, and completedAt`);
    }
    const pushExpected = isRecord(policy) && policy["requirePush"] === true ? "pushed" : "not_required";
    if (group.push.status !== pushExpected) errors.push(`completed group ${group.id} has inconsistent push status`);
    const checkpoint = group.tracker;
    const interruptedTrackerCheckpoint = isTerminalLoopPhaseV2(phase) &&
      group.id === currentId &&
      checkpoint.status === "pending";
    const awaitingCurrentCheckpoint =
      (phase === "awaiting_tracker_sync" && group.id === currentId) || interruptedTrackerCheckpoint;
    if (trackerBinding === null && checkpoint.status !== "not_required") {
      errors.push(`completed group ${group.id} must not require tracker synchronization`);
    }
    if (trackerBinding !== null && checkpoint.status !== (awaitingCurrentCheckpoint ? "pending" : "checkpointed")) {
      errors.push(`completed group ${group.id} has inconsistent tracker checkpoint status`);
    }
  }
  if (isRecord(policy) && typeof policy["requirePush"] === "boolean") {
    for (const group of groups) {
      const expectedPush = group.status === "completed"
        ? (policy["requirePush"] ? "pushed" : "not_required")
        : (policy["requirePush"] ? "pending" : "not_required");
      if (isRecord(group.push) && group.push.status !== expectedPush) {
        errors.push(`group ${group.id} push status conflicts with policy`);
      }
    }
  }
  if (phase === "done") {
    if (!isRecord(git) || !nonEmpty(git["finalRevision"])) errors.push("done requires git.finalRevision");
    if (value["blockedReason"] !== null) errors.push("done must not have blockedReason");
  } else if (isRecord(git) && git["finalRevision"] !== null && phase !== "invalidated") {
    errors.push("only done or a later-invalidated run may have git.finalRevision");
  }
  if (["verification_failed", "review_failed", "circuit_breaker", "corrupted", "worktree_missing", "invalidated"].includes(String(phase))
    && value["blockedReason"] === null) {
    errors.push(`${String(phase)} requires blockedReason`);
  }
  if (active && phase !== "fixing" && value["blockedReason"] !== null) {
    errors.push(`${String(phase)} must not have blockedReason`);
  }
  if (phase === "fixing" && value["blockedReason"] === null) errors.push("fixing requires blockedReason");
  return validation(errors);
}

export function assertLoopStateV2(value: unknown): asserts value is LoopStateV2 {
  const result = validateLoopStateV2(value);
  if (!result.valid) throw new RunContractValidationErrorV2("invalid LoopStateV2", result.errors);
}

function validateEventBase(value: Record<string, unknown>, errors: string[]): void {
  if (value["schemaVersion"] !== 2) errors.push("event.schemaVersion must equal 2");
  if (typeof value["type"] !== "string" || !EVENT_TYPE_SET.has(value["type"])) errors.push("event.type is invalid");
  if (!nonEmpty(value["runId"])) errors.push("event.runId must be non-empty");
  if (!integer(value["seq"], 0)) errors.push("event.seq must be a non-negative integer");
  if (!integer(value["expectedStateRevision"], -1)) errors.push("event.expectedStateRevision must be >= -1");
  if (!nullable(value["expectedNonce"], nonEmpty)) errors.push("event.expectedNonce must be non-empty or null");
  if (!nonEmpty(value["nextNonce"])) errors.push("event.nextNonce must be non-empty");
  if (value["expectedNonce"] === value["nextNonce"]) errors.push("event.nextNonce must change the nonce");
  if (!isoDate(value["occurredAt"])) errors.push("event.occurredAt must be ISO time");
  checkOwner(value["actor"], "event.actor", errors);
}

export function validateLoopEventV2(value: unknown): RunContractValidationResultV2 {
  if (!isRecord(value)) return validation(["event must be an object"]);
  const errors: string[] = [];
  validateEventBase(value, errors);
  const type = value["type"];
  if (type === "run_initialized") {
    if (value["seq"] !== 0 || value["expectedStateRevision"] !== -1 || value["expectedNonce"] !== null) {
      errors.push("run_initialized must use seq 0, revision -1, and null nonce");
    }
    const stateResult = validateLoopStateV2(value["initialState"]);
    errors.push(...stateResult.errors.map((error) => `initialState.${error}`));
    if (isRecord(value["initialState"])) {
      const initial = value["initialState"];
      if (initial["runId"] !== value["runId"]) errors.push("run_initialized runId must match initialState");
      if (initial["stateRevision"] !== 0 || initial["lastEventSeq"] !== 0) errors.push("run_initialized state must start at revision zero");
      if (initial["nonce"] !== value["nextNonce"]) errors.push("run_initialized nextNonce must match initialState");
      if (initial["updatedAt"] !== value["occurredAt"]) errors.push("run_initialized occurredAt must match initialState");
    }
  } else {
    if (!integer(value["expectedStateRevision"], 0)) errors.push("non-init event expectedStateRevision must be non-negative");
    if (!nonEmpty(value["expectedNonce"])) errors.push("non-init event expectedNonce must be non-empty");
  }

  if (type === "bundle_submitted") {
    for (const field of ["groupId", "bundleId", "observedGitRevision"] as const) {
      if (!nonEmpty(value[field])) errors.push(`${field} must be non-empty`);
    }
    if (!isPortableRunSegmentV2(value["groupId"])) errors.push("groupId must be a portable safe segment");
    if (!integer(value["attempt"], 1)) errors.push("attempt must be positive");
    for (const field of ["bundleHash", "artifactHash", "workspaceFingerprint"] as const) {
      if (!hash(value[field])) errors.push(`${field} must be sha256`);
    }
  } else if (type === "evaluation_completed") {
    if (!nonEmpty(value["groupId"])) errors.push("groupId must be non-empty");
    if (!isPortableRunSegmentV2(value["groupId"])) errors.push("groupId must be a portable safe segment");
    if (!integer(value["attempt"], 1)) errors.push("attempt must be positive");
    if (!["pass", "verification_failed", "review_failed"].includes(String(value["result"]))) errors.push("result is invalid");
    if (!hash(value["evidenceHash"]) || !hash(value["reviewHash"])) errors.push("evaluation hashes must be sha256");
    if (typeof value["reviewClean"] !== "boolean") errors.push("reviewClean must be boolean");
    if (value["result"] === "pass" && value["reviewClean"] !== true) errors.push("pass requires a clean review");
    if (value["result"] === "pass" && value["reason"] !== null) errors.push("pass must not carry a reason");
    if (value["result"] !== "pass") checkReason(value["reason"], "reason", errors);
    if (value["result"] === "verification_failed"
      && (!isRecord(value["reason"]) || value["reason"]["code"] !== "verification_failed")) {
      errors.push("verification_failed requires reason.code verification_failed");
    }
    if (value["result"] === "review_failed"
      && (!isRecord(value["reason"]) || value["reason"]["code"] !== "review_findings")) {
      errors.push("review_failed requires reason.code review_findings");
    }
  } else if (type === "group_commit_acknowledged") {
    for (const field of ["groupId", "commitRevision", "commitTree"] as const) {
      if (!nonEmpty(value[field])) errors.push(`${field} must be non-empty`);
    }
    if (!isPortableRunSegmentV2(value["groupId"])) errors.push("groupId must be a portable safe segment");
    if (!integer(value["attempt"], 1)) errors.push("attempt must be positive");
    if (!hash(value["workspaceFingerprint"])) errors.push("workspaceFingerprint must be sha256");
    if (!["not_required", "pushed"].includes(String(value["pushStatus"]))) errors.push("pushStatus is invalid");
    if (value["pushStatus"] === "pushed" && !nonEmpty(value["remoteRevision"])) errors.push("pushed requires remoteRevision");
    if (value["pushStatus"] === "not_required" && value["remoteRevision"] !== null) errors.push("not_required requires null remoteRevision");
  } else if (type === "group_tracker_checkpointed") {
    if (!nonEmpty(value["groupId"])) errors.push("groupId must be non-empty");
    if (!isPortableRunSegmentV2(value["groupId"])) errors.push("groupId must be a portable safe segment");
    if (!integer(value["attempt"], 1)) errors.push("attempt must be positive");
    if (!nonEmpty(value["marker"])) errors.push("marker must be non-empty");
  } else if (type === "run_finalized") {
    if (!nonEmpty(value["finalGitRevision"])) errors.push("finalGitRevision must be non-empty");
    if (!hash(value["workspaceFingerprint"])) errors.push("workspaceFingerprint must be sha256");
  } else if (type === "run_invalidated") {
    checkReason(value["reason"], "reason", errors);
  } else if (type === "run_blocked") {
    if (!["circuit_breaker", "corrupted", "worktree_missing"].includes(String(value["terminalPhase"]))) {
      errors.push("terminalPhase is invalid for run_blocked");
    }
    checkReason(value["reason"], "reason", errors);
  } else if (type === "run_resumed") {
    if (!nonEmpty(value["sessionId"])) errors.push("sessionId must be non-empty");
    if (!isActiveLoopPhaseV2(value["targetPhase"])) errors.push("targetPhase is invalid");
    if (!integer(value["maxAttemptsPerGroup"], 1)) errors.push("maxAttemptsPerGroup must be positive");
  }
  return validation(errors);
}

export function assertLoopEventV2(value: unknown): asserts value is LoopEventV2 {
  const result = validateLoopEventV2(value);
  if (!result.valid) throw new RunContractValidationErrorV2("invalid LoopEventV2", result.errors);
}

export function validateLoopEventRecordV2(value: unknown): RunContractValidationResultV2 {
  if (!isRecord(value)) return validation(["event record must be an object"]);
  const errors: string[] = [];
  if (value["schemaVersion"] !== 2) errors.push("record.schemaVersion must equal 2");
  const eventResult = validateLoopEventV2(value["event"]);
  const stateResult = validateLoopStateV2(value["postState"]);
  errors.push(...eventResult.errors.map((error) => `event.${error}`));
  errors.push(...stateResult.errors.map((error) => `postState.${error}`));
  if (isRecord(value["event"]) && isRecord(value["postState"])) {
    const event = value["event"];
    const state = value["postState"];
    if (event["runId"] !== state["runId"]) errors.push("record runId mismatch");
    if (event["seq"] !== state["lastEventSeq"]) errors.push("record seq must equal postState.lastEventSeq");
    if (event["nextNonce"] !== state["nonce"]) errors.push("record nextNonce must equal postState.nonce");
    if (event["occurredAt"] !== state["updatedAt"]) errors.push("record occurredAt must equal postState.updatedAt");
    const expectedPostRevision = typeof event["expectedStateRevision"] === "number"
      ? event["expectedStateRevision"] + 1 : Number.NaN;
    if (state["stateRevision"] !== expectedPostRevision) errors.push("record postState revision must increment exactly once");
    if (event["type"] === "run_initialized" && isRecord(event["initialState"])) {
      if (event["initialState"]["runId"] !== state["runId"] || event["initialState"]["nonce"] !== state["nonce"]) {
        errors.push("run_initialized initialState must identify the postState");
      }
    }
  }
  return validation(errors);
}

export function assertLoopEventRecordV2(value: unknown): asserts value is LoopEventRecordV2 {
  const result = validateLoopEventRecordV2(value);
  if (!result.valid) throw new RunContractValidationErrorV2("invalid LoopEventRecordV2", result.errors);
}
