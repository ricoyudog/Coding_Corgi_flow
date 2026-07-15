import { createHash } from "node:crypto";

import type {
  ConvergenceResultV2,
  TaskGroupDraftV2,
} from "./converge-v2.js";

export type ConvergenceIntentHashV2 = `sha256:${string}`;

/**
 * Durable description of one confirmed convergence mutation.
 *
 * The intent is written before invalidating the source run.  Every value that
 * would otherwise be generated during recovery is captured here, so replay
 * never needs to guess or allocate a second successor identity.
 */
export interface ConvergenceIntentV2 {
  schemaVersion: 2;
  kind: "convergence_intent";
  changeName: string;
  sourceRunId: string;
  sourceSessionId: string;
  sourceStateRevision: number;
  sourceNonce: string;
  confirmationToken: ConvergenceIntentHashV2;
  prePlanningRevision: ConvergenceIntentHashV2;
  expectedPostPlanningRevision: ConvergenceIntentHashV2;
  preGitRevision: string;
  preWorkspaceFingerprint: ConvergenceIntentHashV2;
  originalGroupFingerprintsHash: ConvergenceIntentHashV2;
  preTaskBytesHash: ConvergenceIntentHashV2;
  postTaskBytesHash: ConvergenceIntentHashV2;
  draftHash: ConvergenceIntentHashV2;
  taskArtifactId: string;
  taskArtifactPathHash: ConvergenceIntentHashV2;
  successorRunId: string;
  successorNonce: string;
  successorStartedAt: string;
  reusableEvidenceGroups: string[];
  evaluation: ConvergenceResultV2;
}

export interface ConvergenceSuccessorIdentityV2 {
  runId: string;
  nonce: string;
  startedAt: string;
}

export interface CreateConvergenceIntentV2Input {
  changeName: string;
  sourceRunId: string;
  sourceSessionId: string;
  sourceStateRevision: number;
  sourceNonce: string;
  expectedPostPlanningRevision: string;
  preTaskBytes: string | Uint8Array;
  postTaskBytes: string | Uint8Array;
  taskArtifactId: string;
  taskArtifactPath: string;
  successor: ConvergenceSuccessorIdentityV2;
  reusableEvidenceGroups: readonly string[];
  evaluation: ConvergenceResultV2;
}

export interface ConvergenceIntentValidationResultV2 {
  valid: boolean;
  errors: string[];
}

export class ConvergenceIntentValidationErrorV2 extends Error {
  readonly errors: string[];

  constructor(label: string, errors: string[], options?: ErrorOptions) {
    super(`${label}: ${errors.join("; ")}`, options);
    this.name = "ConvergenceIntentValidationErrorV2";
    this.errors = errors;
  }
}

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const ASSESSMENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const CANONICAL_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

const INTENT_KEYS = [
  "schemaVersion",
  "kind",
  "changeName",
  "sourceRunId",
  "sourceSessionId",
  "sourceStateRevision",
  "sourceNonce",
  "confirmationToken",
  "prePlanningRevision",
  "expectedPostPlanningRevision",
  "preGitRevision",
  "preWorkspaceFingerprint",
  "originalGroupFingerprintsHash",
  "preTaskBytesHash",
  "postTaskBytesHash",
  "draftHash",
  "taskArtifactId",
  "taskArtifactPathHash",
  "successorRunId",
  "successorNonce",
  "successorStartedAt",
  "reusableEvidenceGroups",
  "evaluation",
] as const;

const EVALUATION_KEYS = [
  "schemaVersion",
  "changeName",
  "status",
  "planningRevision",
  "gitRevision",
  "workspaceFingerprint",
  "evidence",
  "gaps",
  "taskGroupDraft",
  "confirmationToken",
  "originalGroupFingerprints",
] as const;

const EVIDENCE_KEYS = [
  "id",
  "planningRevision",
  "observedGitRevision",
  "workspaceFingerprint",
  "status",
  "summary",
] as const;
const GAP_REQUIRED_KEYS = ["id", "summary"] as const;
const GAP_OPTIONAL_KEYS = ["details", "suggestedTasks"] as const;
const DRAFT_KEYS = ["number", "title", "tasks", "markdown"] as const;
const DRAFT_TASK_KEYS = ["id", "description", "gapId"] as const;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHash(value: unknown): value is ConvergenceIntentHashV2 {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isSafeSegment(value: unknown): value is string {
  return typeof value === "string" &&
    SAFE_SEGMENT_PATTERN.test(value) &&
    value !== "." &&
    value !== ".." &&
    !value.endsWith(".") &&
    !value.endsWith(" ") &&
    !WINDOWS_RESERVED_SEGMENT.test(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value);
}

function isControlSafeText(value: unknown): value is string {
  return typeof value === "string" && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}

function isAssessmentText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && isControlSafeText(value);
}

function isAssessmentOneLine(value: unknown): value is string {
  return isAssessmentText(value) && !/[\r\n]/u.test(value);
}

function isOneLineText(value: unknown): value is string {
  return isNonEmptyText(value) && !/[\r\n]/u.test(value);
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string" || !CANONICAL_ISO_PATTERN.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  errors: string[],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${path}.${key} is unknown`);
  }
}

/** Stable JSON using UTF-16 code-unit key ordering, never locale ordering. */
export function stableConvergenceJsonV2(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Convergence JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableConvergenceJsonV2).join(",")}]`;
  if (isRecord(value)) {
    const keys = Object.keys(value).sort(compareCodeUnits);
    return `{${keys.map((key) => {
      if (value[key] === undefined) {
        throw new TypeError(`Convergence JSON field '${key}' must not be undefined`);
      }
      return `${JSON.stringify(key)}:${stableConvergenceJsonV2(value[key])}`;
    }).join(",")}}`;
  }
  throw new TypeError(`Value is not persistent convergence JSON: ${String(value)}`);
}

function hashBytes(domain: string, value: string | Uint8Array): ConvergenceIntentHashV2 {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update(value);
  return `sha256:${hash.digest("hex")}`;
}

/** Hash arbitrary persistent JSON with fixed key ordering and domain separation. */
export function hashConvergenceJsonV2(
  domain: string,
  value: unknown,
): ConvergenceIntentHashV2 {
  if (!isOneLineText(domain)) throw new TypeError("Hash domain must be non-empty and one line");
  return hashBytes(`${domain}\0`, stableConvergenceJsonV2(value));
}

/** Hash exact task artifact bytes, preserving encoding bytes and line endings. */
export function hashConvergenceTaskBytesV2(
  value: string | Uint8Array,
): ConvergenceIntentHashV2 {
  return hashBytes("corgispec-convergence-task-bytes-v2\0", value);
}

export function hashConvergenceTaskArtifactPathV2(path: string): ConvergenceIntentHashV2 {
  if (!isNonEmptyText(path)) throw new TypeError("Task artifact path must be non-empty");
  return hashBytes("corgispec-convergence-task-path-v2\0", path);
}

export function hashConvergenceTaskGroupDraftV2(
  draft: TaskGroupDraftV2,
): ConvergenceIntentHashV2 {
  return hashConvergenceJsonV2("corgispec-convergence-draft-v2", draft);
}

export function hashConvergenceOriginalGroupFingerprintsV2(
  fingerprints: Record<string, string>,
): ConvergenceIntentHashV2 {
  return hashConvergenceJsonV2(
    "corgispec-convergence-original-group-fingerprints-v2",
    fingerprints,
  );
}

/** Recompute the token emitted by evaluateConvergenceV2 without importing it. */
export function computeConvergenceConfirmationTokenV2(
  evaluation: Pick<
    ConvergenceResultV2,
    | "changeName"
    | "planningRevision"
    | "gitRevision"
    | "workspaceFingerprint"
    | "originalGroupFingerprints"
    | "taskGroupDraft"
    | "evidence"
  >,
): ConvergenceIntentHashV2 {
  if (!evaluation.taskGroupDraft) {
    throw new TypeError("A convergence confirmation token requires a Task Group draft");
  }
  return hashBytes(
    "corgispec-convergence-confirmation-v2\0",
    stableConvergenceJsonV2({
      changeName: evaluation.changeName,
      planningRevision: evaluation.planningRevision,
      gitRevision: evaluation.gitRevision,
      workspaceFingerprint: evaluation.workspaceFingerprint,
      originalGroupFingerprints: evaluation.originalGroupFingerprints,
      taskGroupDraft: evaluation.taskGroupDraft,
      evidence: evaluation.evidence,
    }),
  );
}

export function hashConvergenceIntentV2(intent: ConvergenceIntentV2): ConvergenceIntentHashV2 {
  assertConvergenceIntentV2(intent);
  return hashConvergenceJsonV2("corgispec-convergence-intent-v2", intent);
}

/**
 * Optional deterministic identity generator.  A caller may instead persist
 * identities generated by its injected run/nonce/clock providers.
 */
export function deriveConvergenceSuccessorIdentityV2(input: {
  changeName: string;
  sourceRunId: string;
  sourceStateRevision: number;
  sourceNonce: string;
  confirmationToken: ConvergenceIntentHashV2;
  startedAt: string;
}): ConvergenceSuccessorIdentityV2 {
  if (!isSafeSegment(input.changeName) || !isSafeSegment(input.sourceRunId) ||
    !Number.isInteger(input.sourceStateRevision) || input.sourceStateRevision < 0 ||
    !isNonEmptyText(input.sourceNonce) || !isHash(input.confirmationToken) ||
    !isCanonicalIso(input.startedAt)) {
    throw new ConvergenceIntentValidationErrorV2(
      "invalid deterministic successor seed",
      ["successor seed bindings are invalid"],
    );
  }
  const digest = hashConvergenceJsonV2("corgispec-convergence-successor-v2", input).slice(7);
  return {
    runId: `run-converge-${digest.slice(0, 32)}`,
    nonce: `nonce-converge-${digest.slice(32)}`,
    startedAt: input.startedAt,
  };
}

function checkEvidence(
  value: unknown,
  index: number,
  evaluation: Record<string, unknown>,
  errors: string[],
): void {
  const path = `intent.evaluation.evidence[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  exactKeys(value, EVIDENCE_KEYS, [], path, errors);
  if (!isOneLineText(value["id"])) errors.push(`${path}.id must be non-empty and one line`);
  if (!isHash(value["planningRevision"])) errors.push(`${path}.planningRevision must be sha256`);
  if (!isNonEmptyText(value["observedGitRevision"])) errors.push(`${path}.observedGitRevision must be non-empty`);
  if (!isHash(value["workspaceFingerprint"])) errors.push(`${path}.workspaceFingerprint must be sha256`);
  if (value["status"] !== "pass" && value["status"] !== "fail") errors.push(`${path}.status is invalid`);
  if (!isAssessmentText(value["summary"])) errors.push(`${path}.summary must be non-empty`);
  if (value["planningRevision"] !== evaluation["planningRevision"] ||
    value["observedGitRevision"] !== evaluation["gitRevision"] ||
    value["workspaceFingerprint"] !== evaluation["workspaceFingerprint"]) {
    errors.push(`${path} bindings must match the evaluation`);
  }
}

function checkGap(value: unknown, index: number, errors: string[]): string | undefined {
  const path = `intent.evaluation.gaps[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  exactKeys(value, GAP_REQUIRED_KEYS, GAP_OPTIONAL_KEYS, path, errors);
  if (typeof value["id"] !== "string" || !ASSESSMENT_ID_PATTERN.test(value["id"])) {
    errors.push(`${path}.id must be a portable assessment segment`);
  }
  if (!isAssessmentOneLine(value["summary"])) errors.push(`${path}.summary must be non-empty and one line`);
  if (Object.prototype.hasOwnProperty.call(value, "details") && !isControlSafeText(value["details"])) {
    errors.push(`${path}.details must be control-safe text when present`);
  }
  if (Object.prototype.hasOwnProperty.call(value, "suggestedTasks")) {
    if (!Array.isArray(value["suggestedTasks"]) || value["suggestedTasks"].length === 0 ||
      value["suggestedTasks"].some((task) => !isOneLineText(task))) {
      errors.push(`${path}.suggestedTasks must contain non-empty one-line tasks`);
    }
  }
  return typeof value["id"] === "string" ? value["id"] : undefined;
}

function checkDraft(
  value: unknown,
  gapIds: ReadonlySet<string>,
  errors: string[],
): value is TaskGroupDraftV2 {
  const path = "intent.evaluation.taskGroupDraft";
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  exactKeys(value, DRAFT_KEYS, [], path, errors);
  if (!Number.isInteger(value["number"]) || Number(value["number"]) < 1) {
    errors.push(`${path}.number must be a positive integer`);
  }
  if (!isOneLineText(value["title"])) errors.push(`${path}.title must be non-empty and one line`);
  if (!isAssessmentText(value["markdown"])) errors.push(`${path}.markdown must be non-empty`);
  if (!Array.isArray(value["tasks"]) || value["tasks"].length === 0) {
    errors.push(`${path}.tasks must be a non-empty array`);
    return true;
  }
  const ids: string[] = [];
  for (const [index, candidate] of value["tasks"].entries()) {
    const taskPath = `${path}.tasks[${index}]`;
    if (!isRecord(candidate)) {
      errors.push(`${taskPath} must be an object`);
      continue;
    }
    exactKeys(candidate, DRAFT_TASK_KEYS, [], taskPath, errors);
    if (!isSafeSegment(candidate["id"])) errors.push(`${taskPath}.id must be a portable safe segment`);
    if (!isOneLineText(candidate["description"])) errors.push(`${taskPath}.description must be non-empty and one line`);
    if (typeof candidate["gapId"] !== "string" || !ASSESSMENT_ID_PATTERN.test(candidate["gapId"]) ||
      !gapIds.has(candidate["gapId"])) {
      errors.push(`${taskPath}.gapId must reference a declared gap`);
    }
    if (typeof candidate["id"] === "string") ids.push(candidate["id"]);
  }
  if (new Set(ids).size !== ids.length) errors.push(`${path}.tasks ids must be unique`);
  return true;
}

function checkEvaluation(
  value: unknown,
  intent: Record<string, unknown>,
  errors: string[],
): void {
  const path = "intent.evaluation";
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  // Persist only the original dry-run result.  applied/reason/successor are not
  // valid recovery inputs, even though they are optional on ConvergenceResultV2.
  exactKeys(value, EVALUATION_KEYS, [], path, errors);
  if (value["schemaVersion"] !== 2) errors.push(`${path}.schemaVersion must equal 2`);
  if (value["status"] !== "needs_work") errors.push(`${path}.status must equal needs_work`);
  if (!isSafeSegment(value["changeName"])) errors.push(`${path}.changeName must be a portable safe segment`);
  if (!isHash(value["planningRevision"])) errors.push(`${path}.planningRevision must be sha256`);
  if (!isNonEmptyText(value["gitRevision"])) errors.push(`${path}.gitRevision must be non-empty`);
  if (!isHash(value["workspaceFingerprint"])) errors.push(`${path}.workspaceFingerprint must be sha256`);
  if (!isHash(value["confirmationToken"])) errors.push(`${path}.confirmationToken must be sha256`);

  if (!Array.isArray(value["evidence"]) || value["evidence"].length === 0) {
    errors.push(`${path}.evidence must be a non-empty array`);
  } else {
    value["evidence"].forEach((entry, index) => checkEvidence(entry, index, value, errors));
    const ids = value["evidence"].flatMap((entry) =>
      isRecord(entry) && typeof entry["id"] === "string" ? [entry["id"]] : []
    );
    if (new Set(ids).size !== ids.length) errors.push(`${path}.evidence ids must be unique`);
  }

  const gapIds: string[] = [];
  if (!Array.isArray(value["gaps"]) || value["gaps"].length === 0) {
    errors.push(`${path}.gaps must be a non-empty array for needs_work`);
  } else {
    value["gaps"].forEach((entry, index) => {
      const id = checkGap(entry, index, errors);
      if (id !== undefined) gapIds.push(id);
    });
    if (new Set(gapIds).size !== gapIds.length) errors.push(`${path}.gap ids must be unique`);
  }
  const draftValid = checkDraft(value["taskGroupDraft"], new Set(gapIds), errors);

  if (!isRecord(value["originalGroupFingerprints"])) {
    errors.push(`${path}.originalGroupFingerprints must be an object`);
  } else {
    for (const [groupId, fingerprint] of Object.entries(value["originalGroupFingerprints"])) {
      if (!/^[1-9]\d*$/u.test(groupId)) {
        errors.push(`${path}.originalGroupFingerprints key '${groupId}' must be a positive group number`);
      }
      if (!isHash(fingerprint)) errors.push(`${path}.originalGroupFingerprints.${groupId} must be sha256`);
    }
  }

  if (value["changeName"] !== intent["changeName"]) errors.push(`${path}.changeName does not match intent`);
  if (value["confirmationToken"] !== intent["confirmationToken"]) errors.push(`${path}.confirmationToken does not match intent`);
  if (value["planningRevision"] !== intent["prePlanningRevision"]) errors.push(`${path}.planningRevision does not match intent`);
  if (value["gitRevision"] !== intent["preGitRevision"]) errors.push(`${path}.gitRevision does not match intent`);
  if (value["workspaceFingerprint"] !== intent["preWorkspaceFingerprint"]) {
    errors.push(`${path}.workspaceFingerprint does not match intent`);
  }
  if (isRecord(value["originalGroupFingerprints"])) {
    try {
      if (hashConvergenceOriginalGroupFingerprintsV2(value["originalGroupFingerprints"] as Record<string, string>) !==
        intent["originalGroupFingerprintsHash"]) {
        errors.push(`${path}.originalGroupFingerprints hash does not match intent`);
      }
    } catch (error) {
      errors.push(`${path}.originalGroupFingerprints cannot be hashed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (draftValid) {
    try {
      if (hashConvergenceTaskGroupDraftV2(value["taskGroupDraft"] as TaskGroupDraftV2) !== intent["draftHash"]) {
        errors.push(`${path}.taskGroupDraft hash does not match intent`);
      }
    } catch (error) {
      errors.push(`${path}.taskGroupDraft cannot be hashed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (draftValid && Array.isArray(value["evidence"]) && isRecord(value["originalGroupFingerprints"])) {
    try {
      const computed = computeConvergenceConfirmationTokenV2(
        value as unknown as Pick<
          ConvergenceResultV2,
          | "changeName"
          | "planningRevision"
          | "gitRevision"
          | "workspaceFingerprint"
          | "originalGroupFingerprints"
          | "taskGroupDraft"
          | "evidence"
        >,
      );
      if (computed !== value["confirmationToken"]) {
        errors.push(`${path}.confirmationToken does not authenticate the original evaluation`);
      }
    } catch (error) {
      errors.push(`${path}.confirmationToken cannot be recomputed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export function validateConvergenceIntentV2(
  value: unknown,
): ConvergenceIntentValidationResultV2 {
  if (!isRecord(value)) return { valid: false, errors: ["intent must be an object"] };
  const errors: string[] = [];
  exactKeys(value, INTENT_KEYS, [], "intent", errors);
  if (value["schemaVersion"] !== 2) errors.push("intent.schemaVersion must equal 2");
  if (value["kind"] !== "convergence_intent") errors.push("intent.kind must equal convergence_intent");
  for (const field of ["changeName", "sourceRunId", "successorRunId"] as const) {
    if (!isSafeSegment(value[field])) errors.push(`intent.${field} must be a portable safe segment`);
  }
  for (const field of ["sourceSessionId", "sourceNonce", "taskArtifactId", "successorNonce"] as const) {
    if (!isNonEmptyText(value[field])) errors.push(`intent.${field} must be non-empty control-safe text`);
  }
  if (!Number.isInteger(value["sourceStateRevision"]) || Number(value["sourceStateRevision"]) < 0) {
    errors.push("intent.sourceStateRevision must be a non-negative integer");
  }
  if (!isNonEmptyText(value["preGitRevision"])) errors.push("intent.preGitRevision must be non-empty");
  for (const field of [
    "confirmationToken",
    "prePlanningRevision",
    "expectedPostPlanningRevision",
    "preWorkspaceFingerprint",
    "originalGroupFingerprintsHash",
    "preTaskBytesHash",
    "postTaskBytesHash",
    "draftHash",
    "taskArtifactPathHash",
  ] as const) {
    if (!isHash(value[field])) errors.push(`intent.${field} must be sha256`);
  }
  if (!isCanonicalIso(value["successorStartedAt"])) {
    errors.push("intent.successorStartedAt must be a canonical ISO timestamp");
  }
  if (value["sourceRunId"] === value["successorRunId"]) {
    errors.push("intent.successorRunId must differ from sourceRunId");
  }

  if (!Array.isArray(value["reusableEvidenceGroups"])) {
    errors.push("intent.reusableEvidenceGroups must be an array");
  } else {
    const groups = value["reusableEvidenceGroups"];
    if (groups.some((group) => !isSafeSegment(group))) {
      errors.push("intent.reusableEvidenceGroups must contain portable safe segments");
    }
    if (new Set(groups).size !== groups.length) {
      errors.push("intent.reusableEvidenceGroups must not contain duplicates");
    }
    if (isRecord(value["evaluation"]) && isRecord(value["evaluation"]["originalGroupFingerprints"])) {
      const originals = value["evaluation"]["originalGroupFingerprints"] as Record<string, unknown>;
      if (groups.some((group) => typeof group !== "string" || !Object.prototype.hasOwnProperty.call(originals, group))) {
        errors.push("intent.reusableEvidenceGroups must reference original Task Groups");
      }
      const ordered = Object.keys(originals)
        .filter((group) => /^[1-9]\d*$/u.test(group))
        .sort((left, right) => Number(left) - Number(right));
      if (groups.some((group, index) => group !== ordered[index])) {
        errors.push("intent.reusableEvidenceGroups must be an ordered prefix");
      }
    }
  }

  checkEvaluation(value["evaluation"], value, errors);
  return { valid: errors.length === 0, errors };
}

export function assertConvergenceIntentV2(
  value: unknown,
): asserts value is ConvergenceIntentV2 {
  const result = validateConvergenceIntentV2(value);
  if (!result.valid) {
    throw new ConvergenceIntentValidationErrorV2("invalid ConvergenceIntentV2", result.errors);
  }
}

/** Construct and validate an immutable-by-copy persistent intent. */
export function createConvergenceIntentV2(
  input: CreateConvergenceIntentV2Input,
): ConvergenceIntentV2 {
  // A valid command result is JSON data, but callers may retain optional keys
  // with the JavaScript value undefined.  Normalize those keys to their
  // persistent JSON representation before applying the strict shape check.
  const evaluation = JSON.parse(JSON.stringify(input.evaluation)) as ConvergenceResultV2;
  if (evaluation.status !== "needs_work" || !evaluation.confirmationToken || !evaluation.taskGroupDraft) {
    throw new ConvergenceIntentValidationErrorV2(
      "cannot create ConvergenceIntentV2",
      ["evaluation must be a confirmed needs_work result with a Task Group draft"],
    );
  }
  const intent: ConvergenceIntentV2 = {
    schemaVersion: 2,
    kind: "convergence_intent",
    changeName: input.changeName,
    sourceRunId: input.sourceRunId,
    sourceSessionId: input.sourceSessionId,
    sourceStateRevision: input.sourceStateRevision,
    sourceNonce: input.sourceNonce,
    confirmationToken: evaluation.confirmationToken,
    prePlanningRevision: evaluation.planningRevision as ConvergenceIntentHashV2,
    expectedPostPlanningRevision:
      input.expectedPostPlanningRevision as ConvergenceIntentHashV2,
    preGitRevision: evaluation.gitRevision,
    preWorkspaceFingerprint: evaluation.workspaceFingerprint as ConvergenceIntentHashV2,
    originalGroupFingerprintsHash: hashConvergenceOriginalGroupFingerprintsV2(
      evaluation.originalGroupFingerprints,
    ),
    preTaskBytesHash: hashConvergenceTaskBytesV2(input.preTaskBytes),
    postTaskBytesHash: hashConvergenceTaskBytesV2(input.postTaskBytes),
    draftHash: hashConvergenceTaskGroupDraftV2(evaluation.taskGroupDraft),
    taskArtifactId: input.taskArtifactId,
    taskArtifactPathHash: hashConvergenceTaskArtifactPathV2(input.taskArtifactPath),
    successorRunId: input.successor.runId,
    successorNonce: input.successor.nonce,
    successorStartedAt: input.successor.startedAt,
    reusableEvidenceGroups: [...input.reusableEvidenceGroups],
    evaluation,
  };
  assertConvergenceIntentV2(intent);
  return intent;
}

/** Canonical single-line serialization suitable for a JSON/JSONL payload. */
export function serializeConvergenceIntentV2(intent: ConvergenceIntentV2): string {
  assertConvergenceIntentV2(intent);
  return stableConvergenceJsonV2(intent);
}

/** Parse JSON and reject unknown, missing, partial, or inconsistent fields. */
export function parseConvergenceIntentV2(serialized: string): ConvergenceIntentV2 {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new ConvergenceIntentValidationErrorV2(
      "invalid ConvergenceIntentV2 JSON",
      [error instanceof Error ? error.message : String(error)],
      { cause: error },
    );
  }
  assertConvergenceIntentV2(value);
  return value;
}

export function convergenceIntentsExactlyEqualV2(
  left: ConvergenceIntentV2,
  right: ConvergenceIntentV2,
): boolean {
  assertConvergenceIntentV2(left);
  assertConvergenceIntentV2(right);
  return stableConvergenceJsonV2(left) === stableConvergenceJsonV2(right);
}

/** Validate both operands and fail if any otherwise-valid binding was replaced. */
export function assertExactConvergenceIntentV2(
  actual: unknown,
  expected: ConvergenceIntentV2,
): asserts actual is ConvergenceIntentV2 {
  assertConvergenceIntentV2(expected);
  assertConvergenceIntentV2(actual);
  if (stableConvergenceJsonV2(actual) !== stableConvergenceJsonV2(expected)) {
    throw new ConvergenceIntentValidationErrorV2(
      "ConvergenceIntentV2 does not exactly match the expected intent",
      ["one or more durable convergence bindings changed"],
    );
  }
}

export function parseExactConvergenceIntentV2(
  serialized: string,
  expected: ConvergenceIntentV2,
): ConvergenceIntentV2 {
  const actual = parseConvergenceIntentV2(serialized);
  assertExactConvergenceIntentV2(actual, expected);
  return actual;
}
