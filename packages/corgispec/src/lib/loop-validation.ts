import type {
  LoopState,
  VerifyArtifact,
  ReviewArtifact,
  EvidenceEntry,
  FindingDetail,
  Verdict,
  Severity,
  LoopPhase,
  AutoApprovalPolicy,
} from "./loop-types.js";

// ─── Validation Result ──────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  "PASS",
  "PASS_WITH_WARNINGS",
  "FAIL",
]);

const VALID_SEVERITIES: ReadonlySet<string> = new Set([
  "critical",
  "important",
  "suggestion",
  "nit",
  "fyi",
]);

const VALID_PHASES: ReadonlySet<string> = new Set([
  "init",
  "awaiting_group_result",
  "awaiting_finalize",
  "done",
  "verify_failed",
  "stopped_review_findings",
  "error_validation",
  "session_conflict",
  "circuit_breaker",
  "error_corruption",
  "worktree_missing",
]);

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(reasons: string[]): ValidationResult {
  return { valid: false, errors: reasons };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── LoopState Validator ────────────────────────────────────────────────

export function validateLoopState(obj: unknown): ValidationResult {
  if (!isObject(obj)) {
    return fail(["loop state must be an object (not null, array, or primitive)"]);
  }

  const errors: string[] = [];

  // active: boolean
  if (typeof obj["active"] !== "boolean") {
    errors.push("loop state: 'active' must be a boolean");
  }

  // changeName: string
  if (typeof obj["changeName"] !== "string" || obj["changeName"].length === 0) {
    errors.push("loop state: 'changeName' must be a non-empty string");
  }

  // sessionId: string
  if (typeof obj["sessionId"] !== "string" || obj["sessionId"].length === 0) {
    errors.push("loop state: 'sessionId' must be a non-empty string");
  }

  // nonce: string
  if (typeof obj["nonce"] !== "string" || obj["nonce"].length === 0) {
    errors.push("loop state: 'nonce' must be a non-empty string");
  }

  // currentGroup: number
  if (typeof obj["currentGroup"] !== "number" || !Number.isInteger(obj["currentGroup"]) || obj["currentGroup"] < 1) {
    errors.push("loop state: 'currentGroup' must be a positive integer");
  }

  // totalGroups: number
  if (typeof obj["totalGroups"] !== "number" || !Number.isInteger(obj["totalGroups"]) || obj["totalGroups"] < 1) {
    errors.push("loop state: 'totalGroups' must be a positive integer");
  }

  // phase: LoopPhase
  if (typeof obj["phase"] !== "string" || !VALID_PHASES.has(obj["phase"])) {
    errors.push(
      `loop state: 'phase' must be a valid LoopPhase, got: ${JSON.stringify(obj["phase"])}`
    );
  }

  // worktreePath: string
  if (typeof obj["worktreePath"] !== "string" || obj["worktreePath"].length === 0) {
    errors.push("loop state: 'worktreePath' must be a non-empty string");
  }

  // platform: string
  if (typeof obj["platform"] !== "string" || obj["platform"].length === 0) {
    errors.push("loop state: 'platform' must be a non-empty string");
  }

  // autoApprovalPolicy: AutoApprovalPolicy
  const policy = obj["autoApprovalPolicy"];
  if (!isObject(policy)) {
    errors.push("loop state: 'autoApprovalPolicy' must be an object");
  } else {
    if (typeof policy["allowCommitPush"] !== "boolean") {
      errors.push("loop state: autoApprovalPolicy.allowCommitPush must be a boolean");
    }
    if (typeof policy["allowPassWithWarnings"] !== "boolean") {
      errors.push("loop state: autoApprovalPolicy.allowPassWithWarnings must be a boolean");
    }
  }

  // startedAt: string
  if (typeof obj["startedAt"] !== "string" || obj["startedAt"].length === 0) {
    errors.push("loop state: 'startedAt' must be a non-empty string");
  }

  // updatedAt: string
  if (typeof obj["updatedAt"] !== "string" || obj["updatedAt"].length === 0) {
    errors.push("loop state: 'updatedAt' must be a non-empty string");
  }

  // completedGroups: number[]
  if (!Array.isArray(obj["completedGroups"])) {
    errors.push("loop state: 'completedGroups' must be an array");
  } else {
    const arr = obj["completedGroups"] as unknown[];
    for (let i = 0; i < arr.length; i++) {
      if (typeof arr[i] !== "number") {
        errors.push(`loop state: completedGroups[${i}] must be a number`);
      }
    }
  }

  // groupStatuses: Record<string, string>
  if (!isObjectOrNull(obj["groupStatuses"])) {
    errors.push("loop state: 'groupStatuses' must be an object");
  } else if (obj["groupStatuses"] !== null) {
    const gs = obj["groupStatuses"] as Record<string, unknown>;
    for (const key of Object.keys(gs)) {
      if (typeof gs[key] !== "string") {
        errors.push(`loop state: groupStatuses["${key}"] must be a string`);
      }
    }
  }

  // pushStatus: Record<string, string>
  if (!isObjectOrNull(obj["pushStatus"])) {
    errors.push("loop state: 'pushStatus' must be an object");
  } else if (obj["pushStatus"] !== null) {
    const ps = obj["pushStatus"] as Record<string, unknown>;
    for (const key of Object.keys(ps)) {
      if (typeof ps[key] !== "string") {
        errors.push(`loop state: pushStatus["${key}"] must be a string`);
      }
    }
  }

  // blockCount: number
  if (typeof obj["blockCount"] !== "number" || !Number.isInteger(obj["blockCount"]) || obj["blockCount"] < 0) {
    errors.push("loop state: 'blockCount' must be a non-negative integer");
  }

  // maxBlocks: number
  if (typeof obj["maxBlocks"] !== "number" || !Number.isInteger(obj["maxBlocks"]) || obj["maxBlocks"] < 1) {
    errors.push("loop state: 'maxBlocks' must be a positive integer");
  }

  // maxGroups: number
  if (typeof obj["maxGroups"] !== "number" || !Number.isInteger(obj["maxGroups"]) || obj["maxGroups"] < 1) {
    errors.push("loop state: 'maxGroups' must be a positive integer");
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ─── VerifyArtifact Validator ───────────────────────────────────────────

export function validateVerifyArtifact(obj: unknown): ValidationResult {
  if (!isObject(obj)) {
    return fail(["verify artifact must be an object (not null, array, or primitive)"]);
  }

  const errors: string[] = [];

  // schemaVersion: number
  if (typeof obj["schemaVersion"] !== "number" || !Number.isInteger(obj["schemaVersion"]) || obj["schemaVersion"] < 1) {
    errors.push("verify artifact: 'schemaVersion' must be a positive integer");
  }

  // changeName: string
  if (typeof obj["changeName"] !== "string" || obj["changeName"].length === 0) {
    errors.push("verify artifact: 'changeName' must be a non-empty string");
  }

  // group: number
  if (typeof obj["group"] !== "number" || !Number.isInteger(obj["group"]) || obj["group"] < 1) {
    errors.push("verify artifact: 'group' must be a positive integer");
  }

  // nonce: string
  if (typeof obj["nonce"] !== "string" || obj["nonce"].length === 0) {
    errors.push("verify artifact: 'nonce' must be a non-empty string");
  }

  // verdict: Verdict (string, valid enum)
  if (typeof obj["verdict"] !== "string") {
    errors.push(
      `verify artifact: 'verdict' must be a string, got ${typeof obj["verdict"]}`
    );
  } else if (!VALID_VERDICTS.has(obj["verdict"])) {
    errors.push(
      `verify artifact: 'verdict' must be one of PASS, PASS_WITH_WARNINGS, FAIL, got: "${obj["verdict"]}"`
    );
  }

  // summary: optional string
  if ("summary" in obj && obj["summary"] !== undefined && obj["summary"] !== null) {
    if (typeof obj["summary"] !== "string") {
      errors.push("verify artifact: 'summary' must be a string if provided");
    }
  }

  // evidence: EvidenceEntry[]
  if (!Array.isArray(obj["evidence"])) {
    errors.push("verify artifact: 'evidence' must be an array");
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ─── ReviewArtifact Validator ───────────────────────────────────────────

export function validateReviewArtifact(obj: unknown): ValidationResult {
  if (!isObject(obj)) {
    return fail(["review artifact must be an object (not null, array, or primitive)"]);
  }

  const errors: string[] = [];

  // schemaVersion: number
  if (typeof obj["schemaVersion"] !== "number" || !Number.isInteger(obj["schemaVersion"]) || obj["schemaVersion"] < 1) {
    errors.push("review artifact: 'schemaVersion' must be a positive integer");
  }

  // changeName: string
  if (typeof obj["changeName"] !== "string" || obj["changeName"].length === 0) {
    errors.push("review artifact: 'changeName' must be a non-empty string");
  }

  // group: number
  if (typeof obj["group"] !== "number" || !Number.isInteger(obj["group"]) || obj["group"] < 1) {
    errors.push("review artifact: 'group' must be a positive integer");
  }

  // nonce: string
  if (typeof obj["nonce"] !== "string" || obj["nonce"].length === 0) {
    errors.push("review artifact: 'nonce' must be a non-empty string");
  }

  // finding_details: FindingDetail[]
  if (!Array.isArray(obj["finding_details"])) {
    errors.push("review artifact: 'finding_details' must be an array");
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ─── Identity Validator ─────────────────────────────────────────────────

/**
 * Check that changeName, group, and nonce match across all three artifacts.
 * Group comparison uses tostring to handle string-vs-number mismatch safely.
 */
export function validateIdentity(
  state: LoopState,
  verify: VerifyArtifact,
  review: ReviewArtifact
): ValidationResult {
  const errors: string[] = [];

  // changeName match
  if (state.changeName !== verify.changeName) {
    errors.push(
      `identity mismatch: state.changeName "${state.changeName}" != verify.changeName "${verify.changeName}"`
    );
  }
  if (state.changeName !== review.changeName) {
    errors.push(
      `identity mismatch: state.changeName "${state.changeName}" != review.changeName "${review.changeName}"`
    );
  }

  // group match (use tostring comparison for safety)
  if (String(state.currentGroup) !== String(verify.group)) {
    errors.push(
      `identity mismatch: state.currentGroup "${state.currentGroup}" != verify.group "${verify.group}"`
    );
  }
  if (String(state.currentGroup) !== String(review.group)) {
    errors.push(
      `identity mismatch: state.currentGroup "${state.currentGroup}" != review.group "${review.group}"`
    );
  }

  // nonce match
  if (state.nonce !== verify.nonce) {
    errors.push(
      `identity mismatch: state.nonce "${state.nonce}" != verify.nonce "${verify.nonce}"`
    );
  }
  if (state.nonce !== review.nonce) {
    errors.push(
      `identity mismatch: state.nonce "${state.nonce}" != review.nonce "${review.nonce}"`
    );
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ─── Severity Enum Validator ────────────────────────────────────────────

export function validateSeverityEnum(finding_details: FindingDetail[]): ValidationResult {
  const errors: string[] = [];

  for (let i = 0; i < finding_details.length; i++) {
    const finding = finding_details[i];
    if (!finding) {
      errors.push(`finding_details[${i}]: missing or null entry`);
      continue;
    }

    const severity = finding.severity;
    if (severity === null || severity === undefined) {
      errors.push(
        `finding_details[${i}]: severity must not be null or undefined`
      );
    } else if (typeof severity !== "string") {
      errors.push(
        `finding_details[${i}]: severity must be a string, got ${typeof severity}`
      );
    } else if (!VALID_SEVERITIES.has(severity)) {
      errors.push(
        `finding_details[${i}]: invalid severity "${severity}" (must be one of: critical, important, suggestion, nit, fyi)`
      );
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ─── Verdict String Validator ───────────────────────────────────────────

export function validateVerdictString(verdict: unknown): ValidationResult {
  if (verdict === null || verdict === undefined) {
    return fail(["verdict must not be null or undefined"]);
  }
  if (Array.isArray(verdict)) {
    return fail(["verdict must be a string, got array"]);
  }
  if (typeof verdict === "number") {
    return fail(["verdict must be a string, got number"]);
  }
  if (typeof verdict !== "string") {
    return fail([`verdict must be a string, got ${typeof verdict}`]);
  }
  if (!VALID_VERDICTS.has(verdict)) {
    return fail([
      `verdict must be one of PASS, PASS_WITH_WARNINGS, FAIL, got: "${verdict}"`,
    ]);
  }

  return ok();
}

// ─── FindingDetails Type Validator ──────────────────────────────────────

export function validateFindingDetailsType(value: unknown): ValidationResult {
  if (value === null || value === undefined) {
    return fail(["finding_details must not be null or undefined"]);
  }
  if (!Array.isArray(value)) {
    return fail([
      `finding_details must be an array, got ${typeof value}`,
    ]);
  }

  return ok();
}

// ─── Evidence Provenance Validator ──────────────────────────────────────

/**
 * If verdict is PASS, at least one evidence entry must have provenance "cli-emitted".
 */
export function validateEvidenceProvenance(
  evidence: EvidenceEntry[],
  verdict: Verdict
): ValidationResult {
  if (verdict !== "PASS") {
    return ok();
  }

  if (evidence.length === 0) {
    return fail([
      "evidence provenance: verdict is PASS but evidence array is empty — at least one cli-emitted entry required",
    ]);
  }

  const hasCliEmitted = evidence.some(
    (entry) => entry.provenance === "cli-emitted"
  );

  if (!hasCliEmitted) {
    return fail([
      "evidence provenance: verdict is PASS but no evidence entry has provenance 'cli-emitted'",
    ]);
  }

  return ok();
}

// ─── Exit Code Consistency Validator ────────────────────────────────────

/**
 * For cli-emitted evidence:
 *  - exitCode 0 must match status "pass"
 *  - exitCode non-zero must match status "fail"
 */
export function validateExitCodeConsistency(
  evidence: EvidenceEntry[]
): ValidationResult {
  const errors: string[] = [];

  for (let i = 0; i < evidence.length; i++) {
    const entry = evidence[i];
    if (!entry) continue;

    // Only check cli-emitted entries that have exitCode
    if (entry.provenance !== "cli-emitted") continue;
    if (entry.exitCode === undefined || entry.exitCode === null) continue;

    const exitCode = entry.exitCode;
    const status = entry.status;

    if (exitCode === 0 && status !== "pass") {
      errors.push(
        `evidence[${i}]: exitCode 0 must match status "pass", got status "${status}"`
      );
    }
    if (exitCode !== 0 && status === "pass") {
      errors.push(
        `evidence[${i}]: non-zero exitCode ${exitCode} must not have status "pass"`
      );
    }
  }

  return errors.length === 0 ? ok() : fail(errors);
}

// ─── Internal Helper ────────────────────────────────────────────────────

function isObjectOrNull(value: unknown): value is Record<string, unknown> | null {
  if (value === null) return true;
  return typeof value === "object" && !Array.isArray(value);
}
