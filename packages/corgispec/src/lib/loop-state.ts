// ─── Imports ─────────────────────────────────────────────────────────────

import type {
  LoopState,
  VerifyArtifact,
  ReviewArtifact,
  LoopHookDecision,
  LoopPhase,
  FindingDetail,
} from "./loop-types.js";

import {
  validateVerifyArtifact,
  validateReviewArtifact,
  validateIdentity,
  validateVerdictString,
  validateFindingDetailsType,
  validateSeverityEnum,
  validateEvidenceProvenance,
  validateExitCodeConsistency,
} from "./loop-validation.js";

// ─── Return Type ─────────────────────────────────────────────────────────

/**
 * Result of evaluating the loop state machine.
 * Extends LoopHookDecision with phase tracking and terminal flag.
 * Includes the mutated state for the hook to write to disk.
 */
export interface LoopEvaluationResult extends LoopHookDecision {
  /** Current phase of the state machine after evaluation. */
  phase?: LoopPhase;
  /** Whether the loop has reached a terminal state (no further progress). */
  terminal?: boolean;
  /** The mutated state to write to disk. */
  state: LoopState;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Heuristic for detecting stale session IDs.
 * Loop-created session IDs always start with "session-".
 * Any sessionId not matching this pattern is likely from an older/foreign process.
 */
const VALID_SESSION_PATTERN = /^session-/;

function deepCloneState(state: LoopState): LoopState {
  return JSON.parse(JSON.stringify(state)) as LoopState;
}

function now(): string {
  return new Date().toISOString();
}

function buildTerminal(
  phase: LoopPhase,
  state: LoopState,
  reason?: string,
): LoopEvaluationResult {
  return {
    decision: "proceed",
    phase,
    terminal: true,
    reason,
    state: {
      ...state,
      active: false,
      phase,
      updatedAt: now(),
    },
  };
}

function buildBlock(
  state: LoopState,
  reason: string,
  phase?: LoopPhase,
): LoopEvaluationResult {
  const newBlockCount = state.blockCount + 1;
  return {
    decision: "block",
    phase,
    terminal: false,
    reason,
    state: {
      ...state,
      blockCount: newBlockCount,
      updatedAt: now(),
    },
  };
}

/**
 * Count findings with critical or important severity, derived from
 * the finding_details array (not trusted from LLM-written top-level fields).
 */
function countBlockingFindings(finding_details: FindingDetail[]): {
  critical: number;
  important: number;
} {
  let critical = 0;
  let important = 0;
  for (const f of finding_details) {
    if (f.severity === "critical") critical++;
    if (f.severity === "important") important++;
  }
  return { critical, important };
}

/**
 * Check whether all groups have been finalized.
 */
function allGroupsFinalized(state: LoopState): boolean {
  if (state.phase !== "awaiting_finalize") return false;
  const completed = new Set(state.completedGroups);
  for (let g = 1; g <= state.totalGroups; g++) {
    if (!completed.has(g)) return false;
  }
  return true;
}

// ─── Core State Machine ─────────────────────────────────────────────────

/**
 * Evaluate the current loop state against optional verify and review
 * artifacts from the most recently completed task group.
 *
 * This is a pure function — it receives data and returns a decision
 * plus a mutated state. No file I/O, no side effects.
 *
 * @param state - Current loop state (from disk)
 * @param verifyArtifact - Optional verification artifact for the current group
 * @param reviewArtifact - Optional review artifact for the current group
 * @returns Decision (proceed/block), optional phase/terminal, and mutated state
 */
export function evaluateLoopState(
  state: LoopState,
  verifyArtifact?: VerifyArtifact,
  reviewArtifact?: ReviewArtifact,
): LoopEvaluationResult {
  // ── 1. Inert guard ──────────────────────────────────────────────────
  if (!state.active) {
    return {
      decision: "proceed",
      state: deepCloneState(state),
    };
  }

  // ── 2. Session conflict ─────────────────────────────────────────────
  // Detect stale session IDs: if it doesn't start with "session-",
  // it was likely written by a different/older process.
  if (!VALID_SESSION_PATTERN.test(state.sessionId)) {
    return buildTerminal("session_conflict", state, "stale session ID detected");
  }

  // ── 3. Corruption guards ────────────────────────────────────────────
  if (state.currentGroup < 1) {
    return buildTerminal(
      "error_corruption",
      state,
      `currentGroup (${state.currentGroup}) is less than 1`,
    );
  }
  if (state.currentGroup > state.totalGroups) {
    return buildTerminal(
      "error_corruption",
      state,
      `currentGroup (${state.currentGroup}) exceeds totalGroups (${state.totalGroups})`,
    );
  }

  // ── 4. Circuit breaker ──────────────────────────────────────────────
  if (state.blockCount >= state.maxBlocks) {
    return buildTerminal(
      "circuit_breaker",
      state,
      `blockCount (${state.blockCount}) >= maxBlocks (${state.maxBlocks})`,
    );
  }

  // ── 5. Done state check ─────────────────────────────────────────────
  if (state.phase === "awaiting_finalize" && allGroupsFinalized(state)) {
    return buildTerminal("done", state, "all groups finalized");
  }

  // ── 6. First-run detection ──────────────────────────────────────────
  if (!verifyArtifact || !reviewArtifact) {
    const clone = deepCloneState(state);
    clone.blockCount++;
    clone.updatedAt = now();
    return {
      decision: "block",
      terminal: false,
      reason: "awaiting apply+verify+review — both artifacts required to evaluate",
      state: clone,
    };
  }

  // ── 7. Artifact validation ──────────────────────────────────────────

  // Verify artifact structural validation
  const verifyResult = validateVerifyArtifact(verifyArtifact);
  if (!verifyResult.valid) {
    return buildTerminal(
      "error_validation",
      state,
      `verify artifact validation failed: ${verifyResult.errors.join("; ")}`,
    );
  }

  // Review artifact structural validation
  const reviewResult = validateReviewArtifact(reviewArtifact);
  if (!reviewResult.valid) {
    return buildTerminal(
      "error_validation",
      state,
      `review artifact validation failed: ${reviewResult.errors.join("; ")}`,
    );
  }

  // Identity cross-validation
  const identityResult = validateIdentity(state, verifyArtifact, reviewArtifact);
  if (!identityResult.valid) {
    return buildTerminal(
      "error_validation",
      state,
      `identity validation failed: ${identityResult.errors.join("; ")}`,
    );
  }

  // ── 8. Verdict type check ───────────────────────────────────────────
  const verdictResult = validateVerdictString(verifyArtifact.verdict);
  if (!verdictResult.valid) {
    return buildTerminal(
      "error_validation",
      state,
      `verdict validation failed: ${verdictResult.errors.join("; ")}`,
    );
  }

  // ── 9. Verdict gate ─────────────────────────────────────────────────
  if (verifyArtifact.verdict === "FAIL") {
    return buildTerminal("verify_failed", state, "verification verdict: FAIL");
  }

  if (verifyArtifact.verdict === "PASS_WITH_WARNINGS") {
    if (!state.autoApprovalPolicy.allowPassWithWarnings) {
      return buildTerminal(
        "verify_failed",
        state,
        "verification verdict: PASS_WITH_WARNINGS and policy denies auto-approval",
      );
    }
    // Policy allows — continue to review checks
  }

  // At this point, verdict is PASS or PASS_WITH_WARNINGS (allowed)

  // ── 10. Finding details type check ──────────────────────────────────
  const findingTypeResult = validateFindingDetailsType(reviewArtifact.finding_details);
  if (!findingTypeResult.valid) {
    return buildTerminal(
      "error_validation",
      state,
      `finding_details type check failed: ${findingTypeResult.errors.join("; ")}`,
    );
  }

  // ── 11. Severity enum validation ────────────────────────────────────
  const severityEnumResult = validateSeverityEnum(reviewArtifact.finding_details);
  if (!severityEnumResult.valid) {
    return buildTerminal(
      "error_validation",
      state,
      `severity enum validation failed: ${severityEnumResult.errors.join("; ")}`,
    );
  }

  // ── 12. Evidence validation ─────────────────────────────────────────
  const exitCodeResult = validateExitCodeConsistency(verifyArtifact.evidence);
  if (!exitCodeResult.valid) {
    return buildTerminal(
      "error_validation",
      state,
      `exit code consistency check failed: ${exitCodeResult.errors.join("; ")}`,
    );
  }

  const provenanceResult = validateEvidenceProvenance(
    verifyArtifact.evidence,
    verifyArtifact.verdict,
  );
  if (!provenanceResult.valid) {
    return buildTerminal(
      "error_validation",
      state,
      `evidence provenance check failed: ${provenanceResult.errors.join("; ")}`,
    );
  }

  // ── 13. Severity gate ───────────────────────────────────────────────
  const { critical, important } = countBlockingFindings(reviewArtifact.finding_details);

  if (critical > 0) {
    return buildTerminal(
      "stopped_review_findings",
      state,
      `${critical} critical finding(s) block advancement`,
    );
  }

  if (important > 0) {
    return buildTerminal(
      "stopped_review_findings",
      state,
      `${important} important finding(s) block advancement`,
    );
  }

  // ── 14. Clean advance / finalize ────────────────────────────────────

  const isLastGroup = state.currentGroup === state.totalGroups;

  if (isLastGroup) {
    // Final group — advance to awaiting_finalize
    const clone = deepCloneState(state);
    clone.completedGroups = [...clone.completedGroups, state.currentGroup];
    clone.groupStatuses = {
      ...clone.groupStatuses,
      [String(state.currentGroup)]: "complete",
    };
    clone.blockCount++;
    clone.updatedAt = now();
    clone.phase = "awaiting_finalize";

    return {
      decision: "block",
      phase: "awaiting_finalize",
      terminal: false,
      reason: `group ${state.currentGroup} complete — finalize to finish the loop`,
      state: clone,
    };
  }

  // Non-final group — advance to next group
  const clone = deepCloneState(state);
  clone.completedGroups = [...clone.completedGroups, state.currentGroup];
  clone.groupStatuses = {
    ...clone.groupStatuses,
    [String(state.currentGroup)]: "complete",
  };
  clone.currentGroup = state.currentGroup + 1;
  clone.blockCount++;
  clone.updatedAt = now();
  clone.phase = "awaiting_group_result";

  return {
    decision: "block",
    terminal: false,
    reason: `group ${state.currentGroup} passed — advance to group ${clone.currentGroup} of ${state.totalGroups}`,
    state: clone,
  };
}
