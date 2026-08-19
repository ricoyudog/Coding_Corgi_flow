import { isDeepStrictEqual } from "node:util";

import type { EvidenceRequirement, TrackerBinding } from "./change-contract.js";

export const RUN_CONTRACT_SCHEMA_VERSION = 3 as const;

export const ACTIVE_PHASES_V3 = [
  "planning_ready",
  "applying",
  "awaiting_verify",
  "awaiting_human_review",
  "awaiting_human_qa",
  "ready_for_archive",
  "archiving",
] as const;

export const TERMINAL_PHASES_V3 = [
  "repair_required",
  "archived",
  "invalidated",
  "corrupted",
] as const;

export type ActiveRunPhaseV3 = (typeof ACTIVE_PHASES_V3)[number];
export type TerminalRunPhaseV3 = (typeof TERMINAL_PHASES_V3)[number];
export type RunPhaseV3 = ActiveRunPhaseV3 | TerminalRunPhaseV3;
export type ArtifactHashV3 = `sha256:${string}`;

export interface RunOwnerV3 {
  id: string;
  kind: "human" | "agent" | "automation";
}

export interface RunAcceptanceV3 {
  id: string;
  evidence: EvidenceRequirement;
  taskGroups: string[];
}

export interface RunContractBindingV3 {
  kind: "rfc-slice" | "maintenance";
  deliveryRef: string;
  rfcId: string | null;
  rfcDigest: ArtifactHashV3 | null;
  acceptedCommit: string | null;
  sliceId: string | null;
  sourcePath: string;
  sourceDigest: ArtifactHashV3;
  traceabilityPath: string;
  traceabilityDigest: ArtifactHashV3;
  acceptance: RunAcceptanceV3[];
  tracker: TrackerBinding;
}

export interface RunGroupV3 {
  id: string;
  ordinal: number;
  fingerprint: ArtifactHashV3;
  status: "pending" | "in_progress" | "completed" | "invalidated";
  commitRevision: string | null;
  commitTree: string | null;
  workspaceFingerprint: ArtifactHashV3 | null;
  evidenceHash: ArtifactHashV3 | null;
  trackerCheckpoint: string | null;
  completedAt: string | null;
  /** Completed evidence inherited unchanged from a predecessor repair run. */
  carriedFromRunId?: string | null;
}

export interface CriterionEvidenceV3 {
  id: string;
  automated: "pass" | "fail" | "not_applicable";
  human: "pass" | "fail" | "not_applicable";
  evidenceRefs: string[];
}

export interface VerifyEvidenceV3 {
  verdict: "pass" | "fail";
  finalRevision: string;
  planningRevision: ArtifactHashV3;
  sourceDigest: ArtifactHashV3;
  traceabilityDigest: ArtifactHashV3;
  reportHash: ArtifactHashV3;
  checks: Array<{ name: string; status: "pass" | "fail"; evidenceRefs: string[] }>;
  acceptance: CriterionEvidenceV3[];
  verifiedAt: string;
}

export type HumanReviewDecisionV3 =
  | "approve"
  | "reject-implementation"
  | "require-rfc-amendment";

export interface HumanReviewEvidenceV3 {
  decision: HumanReviewDecisionV3;
  reviewer: string;
  reason: string | null;
  finalRevision: string;
  planningRevision: ArtifactHashV3;
  verifyReportHash: ArtifactHashV3;
  reviewedAt: string;
}

export interface HumanQaEvidenceV3 {
  verdict: "pass" | "fail" | "skipped";
  reviewer: string;
  reason: string | null;
  noRuntimeImpact: boolean;
  finalRevision: string;
  planningRevision: ArtifactHashV3;
  reportHash: ArtifactHashV3;
  acceptance: CriterionEvidenceV3[];
  evidenceRefs: string[];
  reviewedAt: string;
}

export interface RepairRequirementV3 {
  kind: "implementation" | "rfc_amendment";
  reason: string;
  failedPhase: "verify" | "human_review" | "human_qa";
  requestedAt: string;
}

export interface ArchiveProgressV3 {
  intentId: string;
  evidenceManifestHash: ArtifactHashV3 | null;
  archivedRoot: string | null;
  deliveryPage: string | null;
  deliveryRevision: number | null;
  closeoutCommit: string | null;
  localCompleted: boolean;
  trackerCompleted: boolean;
  startedAt: string;
}

export interface RunStateV3 {
  schemaVersion: typeof RUN_CONTRACT_SCHEMA_VERSION;
  changeName: string;
  runId: string;
  supersedesRunId: string | null;
  owner: RunOwnerV3;
  sessionId: string;
  stateRevision: number;
  nonce: string;
  lastEventSeq: number;
  phase: RunPhaseV3;
  planningRevision: ArtifactHashV3;
  baselineRevision: string;
  finalRevision: string | null;
  currentGroupId: string | null;
  contract: RunContractBindingV3;
  groups: Record<string, RunGroupV3>;
  verify: VerifyEvidenceV3 | null;
  review: HumanReviewEvidenceV3 | null;
  qa: HumanQaEvidenceV3 | null;
  repair: RepairRequirementV3 | null;
  archive: ArchiveProgressV3 | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

interface EventBaseV3 {
  schemaVersion: typeof RUN_CONTRACT_SCHEMA_VERSION;
  runId: string;
  seq: number;
  expectedStateRevision: number;
  expectedNonce: string | null;
  nextNonce: string;
  occurredAt: string;
  actor: RunOwnerV3;
}

export interface RunInitializedEventV3 extends EventBaseV3 {
  type: "run_initialized";
  seq: 0;
  expectedStateRevision: -1;
  expectedNonce: null;
  initialState: RunStateV3;
}

export interface ApplyStartedEventV3 extends EventBaseV3 {
  type: "apply_started";
}

export interface GroupCompletedEventV3 extends EventBaseV3 {
  type: "group_completed";
  groupId: string;
  commitRevision: string;
  commitTree: string;
  workspaceFingerprint: ArtifactHashV3;
  evidenceHash: ArtifactHashV3;
  trackerCheckpoint: string | null;
}

export interface VerifySubmittedEventV3 extends EventBaseV3 {
  type: "verify_submitted";
  evidence: VerifyEvidenceV3;
}

export interface HumanReviewSubmittedEventV3 extends EventBaseV3 {
  type: "human_review_submitted";
  evidence: HumanReviewEvidenceV3;
}

export interface HumanQaSubmittedEventV3 extends EventBaseV3 {
  type: "human_qa_submitted";
  evidence: HumanQaEvidenceV3;
}

export interface ArchiveStartedEventV3 extends EventBaseV3 {
  type: "archive_started";
  intentId: string;
}

export interface ArchiveLocalCompletedEventV3 extends EventBaseV3 {
  type: "archive_local_completed";
  evidenceManifestHash: ArtifactHashV3;
  archivedRoot: string;
  deliveryPage: string;
  deliveryRevision: number | null;
  closeoutCommit: string;
}

export interface ArchiveTrackerCompletedEventV3 extends EventBaseV3 {
  type: "archive_tracker_completed";
}

export interface RunArchivedEventV3 extends EventBaseV3 {
  type: "run_archived";
}

export interface RunInvalidatedEventV3 extends EventBaseV3 {
  type: "run_invalidated";
  reason: string;
}

export type RunEventV3 =
  | RunInitializedEventV3
  | ApplyStartedEventV3
  | GroupCompletedEventV3
  | VerifySubmittedEventV3
  | HumanReviewSubmittedEventV3
  | HumanQaSubmittedEventV3
  | ArchiveStartedEventV3
  | ArchiveLocalCompletedEventV3
  | ArchiveTrackerCompletedEventV3
  | RunArchivedEventV3
  | RunInvalidatedEventV3;

export interface RunEventRecordV3 {
  schemaVersion: typeof RUN_CONTRACT_SCHEMA_VERSION;
  event: RunEventV3;
  postState: RunStateV3;
}

export interface InitialRunGroupV3 {
  id: string;
  fingerprint: ArtifactHashV3;
}

export interface CreateInitialRunStateV3Input {
  changeName: string;
  runId: string;
  supersedesRunId?: string | null;
  owner: RunOwnerV3;
  sessionId: string;
  nonce: string;
  planningRevision: ArtifactHashV3;
  baselineRevision: string;
  contract: RunContractBindingV3;
  groups: InitialRunGroupV3[];
  startedAt: string;
}

export class RunContractV3Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RunContractV3Error";
  }
}

const HASH = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requireCondition(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new RunContractV3Error(code, message);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isArtifactHashV3(value: unknown): value is ArtifactHashV3 {
  return typeof value === "string" && HASH.test(value);
}

export function isActiveRunPhaseV3(value: unknown): value is ActiveRunPhaseV3 {
  return typeof value === "string" && (ACTIVE_PHASES_V3 as readonly string[]).includes(value);
}

export function isTerminalRunPhaseV3(value: unknown): value is TerminalRunPhaseV3 {
  return typeof value === "string" && (TERMINAL_PHASES_V3 as readonly string[]).includes(value);
}

export function createInitialRunStateV3(input: CreateInitialRunStateV3Input): RunStateV3 {
  requireCondition(input.groups.length > 0, "RUN_GROUPS_EMPTY", "a run requires at least one Task Group");
  const ids = new Set(input.groups.map((group) => group.id));
  requireCondition(ids.size === input.groups.length, "RUN_GROUPS_DUPLICATE", "Task Group ids must be unique");
  const groups = Object.fromEntries(input.groups.map((group, index) => [
    group.id,
    {
      id: group.id,
      ordinal: index + 1,
      fingerprint: group.fingerprint,
      status: "pending" as const,
      commitRevision: null,
      commitTree: null,
      workspaceFingerprint: null,
      evidenceHash: null,
      trackerCheckpoint: null,
      completedAt: null,
      carriedFromRunId: null,
    },
  ]));
  const state: RunStateV3 = {
    schemaVersion: RUN_CONTRACT_SCHEMA_VERSION,
    changeName: input.changeName,
    runId: input.runId,
    supersedesRunId: input.supersedesRunId ?? null,
    owner: clone(input.owner),
    sessionId: input.sessionId,
    stateRevision: 0,
    nonce: input.nonce,
    lastEventSeq: 0,
    phase: "planning_ready",
    planningRevision: input.planningRevision,
    baselineRevision: input.baselineRevision,
    finalRevision: null,
    currentGroupId: input.groups[0]!.id,
    contract: clone(input.contract),
    groups,
    verify: null,
    review: null,
    qa: null,
    repair: null,
    archive: null,
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    completedAt: null,
  };
  assertRunStateV3(state);
  return state;
}

export function createRunInitializedEventV3(state: RunStateV3): RunInitializedEventV3 {
  assertRunStateV3(state);
  requireCondition(
    state.phase === "planning_ready" && state.stateRevision === 0 && state.lastEventSeq === 0,
    "RUN_INITIAL_STATE_INVALID",
    "initial state must be revision zero and planning_ready",
  );
  return {
    schemaVersion: RUN_CONTRACT_SCHEMA_VERSION,
    type: "run_initialized",
    runId: state.runId,
    seq: 0,
    expectedStateRevision: -1,
    expectedNonce: null,
    nextNonce: state.nonce,
    occurredAt: state.startedAt,
    actor: clone(state.owner),
    initialState: clone(state),
  };
}

function assertEventIdentity(state: RunStateV3, event: Exclude<RunEventV3, RunInitializedEventV3>): void {
  requireCondition(event.schemaVersion === 3, "RUN_EVENT_SCHEMA", "event schemaVersion must equal 3");
  requireCondition(event.runId === state.runId, "RUN_EVENT_MISMATCH", "event runId does not match state");
  requireCondition(event.expectedStateRevision === state.stateRevision, "RUN_CAS_CONFLICT", "state revision is stale");
  requireCondition(event.expectedNonce === state.nonce, "RUN_CAS_CONFLICT", "state nonce is stale");
  requireCondition(event.seq === state.lastEventSeq + 1, "RUN_EVENT_SEQUENCE", "event sequence must increment once");
  requireCondition(event.nextNonce !== state.nonce && nonEmpty(event.nextNonce), "RUN_NONCE_REUSED", "next nonce must be distinct");
  requireCondition(Date.parse(event.occurredAt) >= Date.parse(state.updatedAt), "RUN_TIME_REGRESSION", "event time precedes state");
}

function orderedGroups(state: RunStateV3): RunGroupV3[] {
  return Object.values(state.groups).sort((left, right) => left.ordinal - right.ordinal);
}

function hasExactCriterionIds(state: RunStateV3, evidence: CriterionEvidenceV3[]): boolean {
  const expected = state.contract.acceptance.map((item) => item.id).sort();
  const actual = evidence.map((item) => item.id).sort();
  return new Set(actual).size === actual.length && isDeepStrictEqual(actual, expected);
}

function automatedPasses(state: RunStateV3, evidence: CriterionEvidenceV3[]): boolean {
  if (!hasExactCriterionIds(state, evidence)) return false;
  return evidence.every((entry) => {
    const requirement = state.contract.acceptance.find((item) => item.id === entry.id)!.evidence;
    if (entry.automated === "pass" && entry.evidenceRefs.length === 0) return false;
    if (requirement === "automated" || requirement === "both") return entry.automated === "pass";
    return entry.automated === "not_applicable" || entry.automated === "pass";
  });
}

function humanPasses(state: RunStateV3, evidence: CriterionEvidenceV3[]): boolean {
  if (!hasExactCriterionIds(state, evidence)) return false;
  return evidence.every((entry) => {
    const requirement = state.contract.acceptance.find((item) => item.id === entry.id)!.evidence;
    if (entry.human === "pass" && entry.evidenceRefs.length === 0) return false;
    if (requirement === "human" || requirement === "both") return entry.human === "pass";
    return entry.human === "not_applicable" || entry.human === "pass";
  });
}

function requireEvidenceBinding(state: RunStateV3, input: {
  finalRevision: string;
  planningRevision: ArtifactHashV3;
}): void {
  requireCondition(nonEmpty(input.finalRevision), "RUN_EVIDENCE_REVISION", "evidence finalRevision is required");
  requireCondition(input.planningRevision === state.planningRevision, "RUN_PLANNING_CHANGED", "evidence planningRevision is stale");
  if (state.finalRevision !== null) {
    requireCondition(input.finalRevision === state.finalRevision, "RUN_FINAL_REVISION_CHANGED", "final revision changed after verification");
  }
}

function setRepair(
  state: RunStateV3,
  kind: RepairRequirementV3["kind"],
  failedPhase: RepairRequirementV3["failedPhase"],
  reason: string,
): void {
  state.phase = "repair_required";
  state.repair = { kind, failedPhase, reason, requestedAt: state.updatedAt };
  state.completedAt = state.updatedAt;
}

export function reduceRunEventV3(state: RunStateV3 | null, event: RunEventV3): RunEventRecordV3 {
  if (state === null) {
    requireCondition(event.type === "run_initialized", "RUN_INITIALIZATION_REQUIRED", "first event must initialize the run");
    assertRunStateV3(event.initialState);
    requireCondition(event.schemaVersion === 3 && event.seq === 0 && event.expectedStateRevision === -1, "RUN_INITIAL_EVENT_INVALID", "initial event is invalid");
    requireCondition(event.runId === event.initialState.runId && event.nextNonce === event.initialState.nonce, "RUN_INITIAL_EVENT_INVALID", "initial event does not bind initial state");
    return { schemaVersion: 3, event: clone(event), postState: clone(event.initialState) };
  }
  assertRunStateV3(state);
  requireCondition(event.type !== "run_initialized", "RUN_ALREADY_INITIALIZED", "run is already initialized");
  assertEventIdentity(state, event);
  const next = clone(state);
  next.stateRevision += 1;
  next.lastEventSeq += 1;
  next.nonce = event.nextNonce;
  next.updatedAt = event.occurredAt;

  switch (event.type) {
    case "apply_started": {
      requireCondition(next.phase === "planning_ready", "RUN_PHASE_INVALID", "apply may start only from planning_ready");
      const group = next.groups[next.currentGroupId!];
      requireCondition(group?.status === "pending", "RUN_GROUP_INVALID", "first Task Group is not pending");
      group.status = "in_progress";
      next.phase = "applying";
      break;
    }
    case "group_completed": {
      requireCondition(next.phase === "applying", "RUN_PHASE_INVALID", "Task Group completion requires applying phase");
      requireCondition(event.groupId === next.currentGroupId, "RUN_GROUP_INVALID", "only the current Task Group may complete");
      const group = next.groups[event.groupId];
      requireCondition(group?.status === "in_progress", "RUN_GROUP_INVALID", "Task Group is not in progress");
      requireCondition(nonEmpty(event.commitRevision) && nonEmpty(event.commitTree), "RUN_GROUP_COMMIT_INVALID", "Task Group commit binding is incomplete");
      requireCondition(isArtifactHashV3(event.workspaceFingerprint), "RUN_GROUP_COMMIT_INVALID", "Task Group workspace fingerprint is invalid");
      requireCondition(isArtifactHashV3(event.evidenceHash), "RUN_GROUP_EVIDENCE_INVALID", "Task Group evidence hash is invalid");
      const trackerRequired = next.contract.tracker.provider !== "none";
      requireCondition(
        trackerRequired ? nonEmpty(event.trackerCheckpoint) : event.trackerCheckpoint === null,
        "RUN_TRACKER_CHECKPOINT_INVALID",
        trackerRequired ? "tracked Task Group requires a checkpoint marker" : "trackerless Task Group cannot claim a checkpoint",
      );
      group.status = "completed";
      group.commitRevision = event.commitRevision;
      group.commitTree = event.commitTree;
      group.workspaceFingerprint = event.workspaceFingerprint;
      group.evidenceHash = event.evidenceHash;
      group.trackerCheckpoint = event.trackerCheckpoint;
      group.completedAt = event.occurredAt;
      group.carriedFromRunId = null;
      const following = orderedGroups(next).find((candidate) => candidate.ordinal === group.ordinal + 1);
      if (following) {
        following.status = "in_progress";
        next.currentGroupId = following.id;
      } else {
        next.currentGroupId = null;
        next.phase = "awaiting_verify";
      }
      break;
    }
    case "verify_submitted": {
      requireCondition(next.phase === "awaiting_verify", "RUN_PHASE_INVALID", "verify evidence is not currently accepted");
      requireEvidenceBinding(next, event.evidence);
      requireCondition(event.evidence.sourceDigest === next.contract.sourceDigest, "RUN_SOURCE_CHANGED", "source digest changed after apply");
      requireCondition(event.evidence.traceabilityDigest === next.contract.traceabilityDigest, "RUN_TRACEABILITY_CHANGED", "traceability digest changed after apply");
      requireCondition(isArtifactHashV3(event.evidence.reportHash), "RUN_VERIFY_REPORT_INVALID", "verify report hash is invalid");
      const pass = automatedPasses(next, event.evidence.acceptance)
        && event.evidence.checks.length > 0
        && event.evidence.checks.every((check) => check.status === "pass" && check.evidenceRefs.length > 0);
      requireCondition(event.evidence.verdict === (pass ? "pass" : "fail"), "RUN_VERIFY_VERDICT_INVALID", "verify verdict does not match canonical evidence");
      next.verify = clone(event.evidence);
      next.finalRevision = event.evidence.finalRevision;
      if (pass) next.phase = "awaiting_human_review";
      else setRepair(next, "implementation", "verify", "canonical verification failed");
      break;
    }
    case "human_review_submitted": {
      requireCondition(next.phase === "awaiting_human_review", "RUN_PHASE_INVALID", "human review is not currently accepted");
      requireEvidenceBinding(next, event.evidence);
      requireCondition(next.verify?.verdict === "pass", "RUN_VERIFY_REQUIRED", "passing verification is required before review");
      requireCondition(event.evidence.verifyReportHash === next.verify.reportHash, "RUN_VERIFY_CHANGED", "review does not bind canonical verification");
      requireCondition(nonEmpty(event.evidence.reviewer), "RUN_HUMAN_REQUIRED", "reviewer identity is required");
      if (event.evidence.decision !== "approve") {
        requireCondition(nonEmpty(event.evidence.reason), "RUN_REVIEW_REASON_REQUIRED", "rejection requires a reason");
      }
      next.review = clone(event.evidence);
      if (event.evidence.decision === "approve") next.phase = "awaiting_human_qa";
      else if (event.evidence.decision === "reject-implementation") {
        setRepair(next, "implementation", "human_review", event.evidence.reason!);
      } else {
        setRepair(next, "rfc_amendment", "human_review", event.evidence.reason!);
      }
      break;
    }
    case "human_qa_submitted": {
      requireCondition(next.phase === "awaiting_human_qa", "RUN_PHASE_INVALID", "Human QA is not currently accepted");
      requireEvidenceBinding(next, event.evidence);
      requireCondition(next.review?.decision === "approve", "RUN_REVIEW_REQUIRED", "approved human review is required before QA");
      requireCondition(nonEmpty(event.evidence.reviewer), "RUN_HUMAN_REQUIRED", "QA reviewer identity is required");
      requireCondition(isArtifactHashV3(event.evidence.reportHash), "RUN_QA_REPORT_INVALID", "QA report hash is invalid");
      requireCondition(
        Array.isArray(event.evidence.evidenceRefs) && event.evidence.evidenceRefs.every(nonEmpty),
        "RUN_QA_REPORT_INVALID",
        "QA evidence references are invalid",
      );
      let pass = false;
      if (event.evidence.verdict === "skipped") {
        requireCondition(event.evidence.noRuntimeImpact && nonEmpty(event.evidence.reason), "RUN_QA_SKIP_INVALID", "QA skip requires no-runtime-impact confirmation and a reason");
        requireCondition(event.evidence.acceptance.length === 0, "RUN_QA_SKIP_INVALID", "skipped QA must not claim criterion evidence");
        pass = true;
      } else {
        pass = event.evidence.evidenceRefs.length > 0
          && humanPasses(next, event.evidence.acceptance);
        requireCondition(event.evidence.verdict === (pass ? "pass" : "fail"), "RUN_QA_VERDICT_INVALID", "QA verdict does not match criterion evidence");
      }
      next.qa = clone(event.evidence);
      if (pass) next.phase = "ready_for_archive";
      else setRepair(next, "implementation", "human_qa", event.evidence.reason ?? "Human QA failed");
      break;
    }
    case "archive_started":
      requireCondition(next.phase === "ready_for_archive", "RUN_PHASE_INVALID", "archive requires ready_for_archive");
      requireCondition(nonEmpty(event.intentId), "RUN_ARCHIVE_INTENT_INVALID", "archive intent id is required");
      next.archive = {
        intentId: event.intentId,
        evidenceManifestHash: null,
        archivedRoot: null,
        deliveryPage: null,
        deliveryRevision: null,
        closeoutCommit: null,
        localCompleted: false,
        trackerCompleted: next.contract.tracker.provider === "none",
        startedAt: event.occurredAt,
      };
      next.phase = "archiving";
      break;
    case "archive_local_completed":
      requireCondition(next.phase === "archiving" && next.archive !== null, "RUN_PHASE_INVALID", "archive has not started");
      requireCondition(isArtifactHashV3(event.evidenceManifestHash), "RUN_ARCHIVE_EVIDENCE_INVALID", "archive evidence manifest hash is invalid");
      requireCondition(
        nonEmpty(event.archivedRoot) && nonEmpty(event.deliveryPage) && nonEmpty(event.closeoutCommit),
        "RUN_ARCHIVE_LOCAL_INVALID",
        "archive local closeout binding is incomplete",
      );
      requireCondition(
        event.deliveryRevision === null || (Number.isSafeInteger(event.deliveryRevision) && event.deliveryRevision >= 0),
        "RUN_ARCHIVE_LOCAL_INVALID",
        "archive delivery revision is invalid",
      );
      next.archive.localCompleted = true;
      next.archive.evidenceManifestHash = event.evidenceManifestHash;
      next.archive.archivedRoot = event.archivedRoot;
      next.archive.deliveryPage = event.deliveryPage;
      next.archive.deliveryRevision = event.deliveryRevision;
      next.archive.closeoutCommit = event.closeoutCommit;
      break;
    case "archive_tracker_completed":
      requireCondition(next.phase === "archiving" && next.archive?.localCompleted === true, "RUN_ARCHIVE_LOCAL_REQUIRED", "local archive must complete before tracker closeout");
      requireCondition(next.contract.tracker.provider !== "none", "RUN_TRACKER_NOT_CONFIGURED", "tracker closeout is not configured");
      next.archive.trackerCompleted = true;
      break;
    case "run_archived":
      requireCondition(next.phase === "archiving" && next.archive?.localCompleted === true && next.archive.trackerCompleted, "RUN_ARCHIVE_INCOMPLETE", "archive closeout is incomplete");
      next.phase = "archived";
      next.completedAt = event.occurredAt;
      break;
    case "run_invalidated":
      requireCondition(next.phase !== "archived", "RUN_PHASE_INVALID", "an archived run cannot be invalidated");
      for (const group of Object.values(next.groups)) {
        if (group.status !== "completed") group.status = "invalidated";
      }
      next.currentGroupId = null;
      next.phase = "invalidated";
      next.repair = null;
      next.completedAt = event.occurredAt;
      break;
  }

  assertRunStateV3(next);
  return { schemaVersion: RUN_CONTRACT_SCHEMA_VERSION, event: clone(event), postState: next };
}

export function assertRunStateV3(value: unknown): asserts value is RunStateV3 {
  requireCondition(Boolean(value) && typeof value === "object" && !Array.isArray(value), "RUN_STATE_INVALID", "state must be an object");
  const state = value as RunStateV3;
  requireCondition(state.schemaVersion === 3, "RUN_SCHEMA_UNSUPPORTED", "state schemaVersion must equal 3");
  requireCondition(nonEmpty(state.changeName) && SAFE_ID.test(state.changeName), "RUN_CHANGE_INVALID", "changeName is unsafe");
  requireCondition(nonEmpty(state.runId) && SAFE_ID.test(state.runId), "RUN_ID_INVALID", "runId is unsafe");
  requireCondition(state.supersedesRunId === null || (SAFE_ID.test(state.supersedesRunId) && state.supersedesRunId !== state.runId), "RUN_SUPERSEDES_INVALID", "supersedesRunId is invalid");
  requireCondition(nonEmpty(state.owner?.id) && ["human", "agent", "automation"].includes(state.owner.kind), "RUN_OWNER_INVALID", "owner is invalid");
  requireCondition(nonEmpty(state.sessionId), "RUN_SESSION_INVALID", "sessionId is required");
  requireCondition(Number.isSafeInteger(state.stateRevision) && state.stateRevision >= 0 && state.stateRevision === state.lastEventSeq, "RUN_REVISION_INVALID", "state revision is invalid");
  requireCondition(nonEmpty(state.nonce), "RUN_NONCE_INVALID", "nonce is required");
  requireCondition(isActiveRunPhaseV3(state.phase) || isTerminalRunPhaseV3(state.phase), "RUN_PHASE_INVALID", "phase is invalid");
  requireCondition(isArtifactHashV3(state.planningRevision), "RUN_PLANNING_INVALID", "planningRevision is invalid");
  requireCondition(isArtifactHashV3(state.contract?.sourceDigest) && isArtifactHashV3(state.contract?.traceabilityDigest), "RUN_CONTRACT_INVALID", "contract digests are invalid");
  requireCondition(Array.isArray(state.contract?.acceptance) && state.contract.acceptance.length > 0, "RUN_CONTRACT_INVALID", "contract acceptance is empty");
  const acceptanceIds = state.contract.acceptance.map((item) => item.id);
  requireCondition(new Set(acceptanceIds).size === acceptanceIds.length, "RUN_CONTRACT_INVALID", "contract acceptance ids are duplicated");
  const groups = orderedGroups(state);
  requireCondition(groups.length > 0 && groups.every((group, index) => group.ordinal === index + 1 && group.id in state.groups && isArtifactHashV3(group.fingerprint)), "RUN_GROUPS_INVALID", "Task Groups are invalid");
  requireCondition(groups.every((group) => group.status !== "completed" || (
    nonEmpty(group.commitRevision)
    && nonEmpty(group.commitTree)
    && isArtifactHashV3(group.workspaceFingerprint)
    && isArtifactHashV3(group.evidenceHash)
    && (state.contract.tracker.provider === "none"
      ? group.trackerCheckpoint === null
      : nonEmpty(group.trackerCheckpoint))
    && Number.isFinite(Date.parse(group.completedAt ?? ""))
  )), "RUN_GROUPS_INVALID", "completed Task Group lacks canonical commit evidence");
  requireCondition(groups.every((group) =>
    group.carriedFromRunId === undefined
    || group.carriedFromRunId === null
    || (SAFE_ID.test(group.carriedFromRunId) && group.carriedFromRunId !== state.runId)
  ), "RUN_GROUPS_INVALID", "carried Task Group has an invalid predecessor binding");
  const inProgress = groups.filter((group) => group.status === "in_progress");
  if (state.phase === "planning_ready") {
    const pending = groups.filter((group) => group.status === "pending");
    const carried = groups.filter((group) => group.status === "completed");
    const fresh = carried.length === 0
      && pending.length === groups.length
      && state.currentGroupId === groups[0]!.id;
    const repair = state.supersedesRunId !== null
      && pending.length === 1
      && state.currentGroupId === pending[0]!.id
      && carried.length === groups.length - 1
      && carried.every((group) => nonEmpty(group.carriedFromRunId))
      && groups.slice(0, carried.length).every((group) => group.status === "completed");
    requireCondition(fresh || repair, "RUN_GROUPS_INVALID", "planning_ready must retain pending work or one appended repair Group");
  }
  if (state.phase === "applying") {
    requireCondition(inProgress.length === 1 && state.currentGroupId === inProgress[0]!.id, "RUN_GROUPS_INVALID", "applying requires exactly one current Task Group");
  }
  if (!["planning_ready", "applying"].includes(state.phase)) {
    requireCondition(state.currentGroupId === null, "RUN_GROUPS_INVALID", "post-apply phases cannot have a current Task Group");
  }
  if (["awaiting_verify", "awaiting_human_review", "awaiting_human_qa", "ready_for_archive", "archiving", "archived"].includes(state.phase)) {
    requireCondition(groups.every((group) => group.status === "completed"), "RUN_GROUPS_INCOMPLETE", "post-apply phase requires completed Task Groups");
  }
  if (["awaiting_human_review", "awaiting_human_qa", "ready_for_archive", "archiving", "archived"].includes(state.phase)) {
    requireCondition(state.verify?.verdict === "pass" && state.finalRevision === state.verify.finalRevision, "RUN_VERIFY_REQUIRED", "phase requires passing verification");
  }
  if (["awaiting_human_qa", "ready_for_archive", "archiving", "archived"].includes(state.phase)) {
    requireCondition(state.review?.decision === "approve", "RUN_REVIEW_REQUIRED", "phase requires accepted human review");
  }
  if (["ready_for_archive", "archiving", "archived"].includes(state.phase)) {
    requireCondition(state.qa?.verdict === "pass" || state.qa?.verdict === "skipped", "RUN_QA_REQUIRED", "phase requires passing or validly skipped Human QA");
  }
  if (state.archive?.localCompleted) {
    requireCondition(
      isArtifactHashV3(state.archive.evidenceManifestHash)
      && nonEmpty(state.archive.archivedRoot)
      && nonEmpty(state.archive.deliveryPage)
      && nonEmpty(state.archive.closeoutCommit)
      && (state.archive.deliveryRevision === null
        || (Number.isSafeInteger(state.archive.deliveryRevision) && state.archive.deliveryRevision >= 0)),
      "RUN_ARCHIVE_LOCAL_INVALID",
      "completed local archive lacks canonical closeout evidence",
    );
  }
  requireCondition(Number.isFinite(Date.parse(state.startedAt)) && Number.isFinite(Date.parse(state.updatedAt)), "RUN_TIME_INVALID", "run timestamps are invalid");
  requireCondition(state.completedAt === null || Number.isFinite(Date.parse(state.completedAt)), "RUN_TIME_INVALID", "completedAt is invalid");
}

export function replayRunEventsV3(events: readonly RunEventV3[]): RunStateV3 {
  requireCondition(events.length > 0, "RUN_EVENTS_EMPTY", "cannot replay an empty event stream");
  let state: RunStateV3 | null = null;
  for (const event of events) state = reduceRunEventV3(state, event).postState;
  return state!;
}

export function eventBaseV3(
  state: RunStateV3,
  type: Exclude<RunEventV3["type"], "run_initialized">,
  input: { nextNonce: string; occurredAt: string; actor?: RunOwnerV3 },
): EventBaseV3 & { type: typeof type } {
  return {
    schemaVersion: RUN_CONTRACT_SCHEMA_VERSION,
    type,
    runId: state.runId,
    seq: state.lastEventSeq + 1,
    expectedStateRevision: state.stateRevision,
    expectedNonce: state.nonce,
    nextNonce: input.nextNonce,
    occurredAt: input.occurredAt,
    actor: clone(input.actor ?? state.owner),
  };
}
