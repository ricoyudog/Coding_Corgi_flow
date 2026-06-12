// ─── Imports ─────────────────────────────────────────────────────────────

import type {
  LoopState,
  VerifyArtifact,
  ReviewArtifact,
  LoopHookDecision,
} from "./loop-types.js";

import {
  validateLoopState,
  validateVerifyArtifact,
  validateReviewArtifact,
  validateIdentity,
  validateSeverityEnum,
  validateEvidenceProvenance,
  validateExitCodeConsistency,
} from "./loop-validation.js";

// ─── LoopHookInput ────────────────────────────────────────────────────────

/** Runtime input passed by the hook when invoking the state machine. */
interface LoopHookInput {
  hook_event_name: string;
  stop_hook_active: boolean;
  session_id: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function timestamp(): string {
  return new Date().toISOString();
}

function terminal(
  state: LoopState,
  phase: LoopState["phase"],
): LoopHookDecision {
  state.phase = phase;
  state.active = false;
  state.updatedAt = timestamp();
  return { decision: "proceed" };
}

function block(
  state: LoopState,
  reason: string,
): LoopHookDecision {
  state.blockCount++;
  state.updatedAt = timestamp();
  return { decision: "block", reason };
}

// ─── Core State Machine ──────────────────────────────────────────────────

/**
 * Process the loop state machine: evaluate the current state, verify artifact,
 * review artifact, and runtime hook input to produce a decision.
 *
 * Mutates `state` **in place**. Returns a LoopHookDecision.
 *
 * State machine flow (ordered):
 *   0. Null/undefined guard
 *   1. Inert guard            — active !== true → proceed (graceful inactive)
 *   2. Stop-hook-active guard — prevents re-entry when hook already active
 *   3. Circuit breaker        — blockCount >= maxBlocks → circuit_breaker
 *   4. Corruption guards      — currentGroup out of range → error_corruption
 *   5. State structural validation — catch-all for malformed state objects
 *   6. Session guard          — session ID mismatch → session_conflict
 *   7. Finalize → Done        — awaiting_finalize → done
 *   8. First-run detection    — missing verify/review → block
 *   9. Identity validation    — structural + cross-reference checks
 *  10. Verdict gate           — FAIL / PASS_WITH_WARNINGS+deny → verify_failed
 *  11. Severity derivation    — evidence checks, critical/important → stopped_review_findings
 *  12. Advance or Finalize    — mark complete, move to next group or finalize
 *
 * @param state  - Current loop state (mutated in place)
 * @param verify - Verification artifact for the current group
 * @param review - Review artifact for the current group
 * @param input  - Runtime input from the stop hook
 * @returns Decision (proceed/block) with optional reason
 */
export function processLoopState(
  state: LoopState,
  verify: VerifyArtifact,
  review: ReviewArtifact,
  input: LoopHookInput,
): LoopHookDecision {
  // ── 0. Null/undefined state guard ────────────────────────────────────
  if (state === null || state === undefined) {
    // Cannot mutate null/undefined. Caller must validate before invoking.
    return { decision: "proceed" };
  }

  // ── 1. Inert guard ──────────────────────────────────────────────────
  if (state.active !== true) {
    return { decision: "proceed" };
  }

  // ── 2. Stop-hook-active guard (prevents re-entry) ────────────────────
  if (input.stop_hook_active === true) {
    return { decision: "proceed" };
  }

  // ── 3. Circuit breaker ──────────────────────────────────────────────
  if (state.blockCount >= state.maxBlocks) {
    return terminal(state, "circuit_breaker");
  }

  // ── 4. Corruption guards ────────────────────────────────────────────
  if (state.currentGroup < 1 || state.currentGroup > state.totalGroups) {
    return terminal(state, "error_corruption");
  }

  // ── 5. State structural validation (catch-all for malformed states) ──
  const stateResult = validateLoopState(state);
  if (!stateResult.valid) {
    return terminal(state, "error_validation");
  }

  // ── 6. Session guard ────────────────────────────────────────────────
  if (input.session_id && input.session_id !== state.sessionId) {
    return terminal(state, "session_conflict");
  }

  // ── 7. Finalize → Done ──────────────────────────────────────────────
  if (state.phase === "awaiting_finalize") {
    return terminal(state, "done");
  }

  // ── 8. First-run detection ──────────────────────────────────────────
  if (!verify || !review) {
    return block(state, `Run Group ${state.currentGroup}/${state.totalGroups} bundle`);
  }

  // ── 9. Identity / artifact validation ───────────────────────────────

  const verifyResult = validateVerifyArtifact(verify);
  if (!verifyResult.valid) {
    return terminal(state, "error_validation");
  }

  const reviewResult = validateReviewArtifact(review);
  if (!reviewResult.valid) {
    return terminal(state, "error_validation");
  }

  const identityResult = validateIdentity(state, verify, review);
  if (!identityResult.valid) {
    return terminal(state, "error_validation");
  }

  // verdict is guaranteed to be a valid Verdict string at this point
  const verdict = verify.verdict;

  // ── 10. Verdict gate ────────────────────────────────────────────────
  if (verdict === "FAIL") {
    return terminal(state, "verify_failed");
  }

  if (verdict === "PASS_WITH_WARNINGS" && !state.autoApprovalPolicy.allowPassWithWarnings) {
    return terminal(state, "verify_failed");
  }

  // ── 11. Severity validation, evidence validation, severity gate ─────

  const severityResult = validateSeverityEnum(review.finding_details);
  if (!severityResult.valid) {
    return terminal(state, "error_validation");
  }

  const exitCodeResult = validateExitCodeConsistency(verify.evidence);
  if (!exitCodeResult.valid) {
    return terminal(state, "error_validation");
  }

  const provenanceResult = validateEvidenceProvenance(verify.evidence, verdict);
  if (!provenanceResult.valid) {
    return terminal(state, "error_validation");
  }

  // Severity derivation: count blocking findings from finding_details array
  const critical = review.finding_details.filter(f => f.severity === "critical").length;
  const important = review.finding_details.filter(f => f.severity === "important").length;

  if (critical > 0 || important > 0) {
    return terminal(state, "stopped_review_findings");
  }

  // ── 12. Advance or Finalize ─────────────────────────────────────────

  // Re-entry guard: if currentGroup is already completed, just block
  if (state.completedGroups.includes(state.currentGroup)) {
    return block(state, `Re-entering Group ${state.currentGroup} — already completed`);
  }

  // Mark current group as completed
  state.groupStatuses[String(state.currentGroup)] = "completed";
  state.completedGroups.push(state.currentGroup);
  state.retryCount = 0;

  const nextGroup = state.currentGroup + 1;

  if (nextGroup > state.totalGroups) {
    // All groups complete — advance to finalize
    state.phase = "awaiting_finalize";
    return block(
      state,
      `All groups complete. Auto-approve Group ${state.currentGroup}/${state.totalGroups}, then finalize`,
    );
  }

  // Advance to next group
  state.currentGroup = nextGroup;
  state.phase = "awaiting_group_result";
  return block(
    state,
    `Auto-approve Group ${nextGroup - 1}, then run Group ${nextGroup}/${state.totalGroups} bundle`,
  );
}
