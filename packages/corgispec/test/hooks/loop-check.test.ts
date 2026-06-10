// RED PHASE — these tests are designed to FAIL until Task 6 implements evaluateLoopState
//
// The imports below reference modules that don't exist yet (loop-state.js).
// When `npx vitest run` executes, every test will fail because:
//   1. The import of evaluateLoopState from "../../src/lib/loop-state.js" cannot resolve
//   2. Even if the import somehow resolved, the function isn't implemented
//
// This is the RED phase of TDD. Tests describe the desired behavior before
// any implementation exists.

import { describe, it, expect } from "vitest";
import { evaluateLoopState } from "../../src/lib/loop-state.js";
import type {
  LoopState,
  VerifyArtifact,
  ReviewArtifact,
  LoopHookDecision,
  AutoApprovalPolicy,
  EvidenceEntry,
  FindingDetail,
} from "../../src/lib/loop-types.js";
import type { LoopPhase, Verdict, Severity } from "../../src/lib/loop-types.js";

// ─── Type for the evaluation result ─────────────────────────────────────
// (In Task 6, this will be the actual return type of evaluateLoopState)

interface LoopEvaluationResult extends LoopHookDecision {
  phase?: LoopPhase;
  terminal?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function defaultPolicy(overrides: Partial<AutoApprovalPolicy> = {}): AutoApprovalPolicy {
  return {
    allowCommitPush: true,
    allowPassWithWarnings: false,
    ...overrides,
  };
}

function defaultState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    active: true,
    changeName: "test-change",
    sessionId: "session-abc-123",
    nonce: "2026-06-10T00:00:00.000Z",
    currentGroup: 1,
    totalGroups: 3,
    phase: "awaiting_group_result",
    worktreePath: "/tmp/test-worktree",
    platform: "github-tracked",
    autoApprovalPolicy: defaultPolicy(),
    startedAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    completedGroups: [],
    groupStatuses: {},
    pushStatus: {},
    blockCount: 0,
    maxBlocks: 3,
    maxGroups: 5,
    ...overrides,
  };
}

function defaultVerifyArtifact(overrides: Partial<VerifyArtifact> = {}): VerifyArtifact {
  return {
    schemaVersion: 1,
    changeName: "test-change",
    group: 1,
    nonce: "2026-06-10T00:00:00.000Z",
    verdict: "PASS",
    evidence: [
      {
        kind: "test",
        command: "npm test",
        status: "pass",
        exitCode: 0,
        provenance: "cli-emitted",
      },
    ],
    ...overrides,
  };
}

function defaultReviewArtifact(overrides: Partial<ReviewArtifact> = {}): ReviewArtifact {
  return {
    schemaVersion: 1,
    changeName: "test-change",
    group: 1,
    nonce: "2026-06-10T00:00:00.000Z",
    finding_details: [],
    ...overrides,
  };
}

// ─── Test Suite ─────────────────────────────────────────────────────────

describe("evaluateLoopState", () => {
  // ── Category 1: Inert guard ──────────────────────────────────────────

  it("1. Inert guard: inactive loop → proceed (no-op)", () => {
    const state = defaultState({ active: false, phase: "init" });
    const result = evaluateLoopState(state) as LoopEvaluationResult;
    expect(result).toMatchObject({ decision: "proceed" });
  });

  // ── Category 2: First-run block ──────────────────────────────────────

  it("2. First-run block: active loop but no verify artifact → block with instruction", () => {
    const state = defaultState({
      active: true,
      phase: "awaiting_group_result",
    });
    const result = evaluateLoopState(state) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "block",
    });
    expect(result.reason).toBeDefined();
  });

  // ── Category 3–5: Identity validation ────────────────────────────────

  it("3. Identity validation: changeName mismatch → terminal error_validation", () => {
    const state = defaultState({ changeName: "expected-change" });
    const verify = defaultVerifyArtifact({ changeName: "different-change" });
    const review = defaultReviewArtifact();

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "error_validation",
      terminal: true,
    });
  });

  it("4. Identity validation: group mismatch → terminal error_validation", () => {
    const state = defaultState({ currentGroup: 2 });
    const verify = defaultVerifyArtifact({ group: 1 });
    const review = defaultReviewArtifact({ group: 1 });

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "error_validation",
      terminal: true,
    });
  });

  it("5. Identity validation: nonce mismatch → terminal error_validation", () => {
    const state = defaultState({ nonce: "2026-06-10T12:00:00.000Z" });
    const verify = defaultVerifyArtifact({ nonce: "2026-06-09T00:00:00.000Z" });
    const review = defaultReviewArtifact({ nonce: "2026-06-09T00:00:00.000Z" });

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "error_validation",
      terminal: true,
    });
  });

  // ── Category 6–8: Verdict gate ───────────────────────────────────────

  it("6. Verdict gate: FAIL → terminal verify_failed", () => {
    const state = defaultState();
    const verify = defaultVerifyArtifact({ verdict: "FAIL" });
    const review = defaultReviewArtifact();

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "verify_failed",
      terminal: true,
    });
  });

  it("7. Verdict gate: PASS_WITH_WARNINGS, policy denies → terminal verify_failed", () => {
    const state = defaultState({
      autoApprovalPolicy: defaultPolicy({ allowPassWithWarnings: false }),
    });
    const verify = defaultVerifyArtifact({ verdict: "PASS_WITH_WARNINGS" });
    const review = defaultReviewArtifact();

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "verify_failed",
      terminal: true,
    });
  });

  it("8. Verdict gate: PASS_WITH_WARNINGS, policy allows → advance to review check", () => {
    const state = defaultState({
      autoApprovalPolicy: defaultPolicy({ allowPassWithWarnings: true }),
    });
    const verify = defaultVerifyArtifact({ verdict: "PASS_WITH_WARNINGS" });
    const review = defaultReviewArtifact();

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    // Should advance past the verdict gate (not terminal verify_failed)
    expect(result).not.toMatchObject({ phase: "verify_failed" });
    expect(result).not.toMatchObject({ terminal: true });
  });

  // ── Category 9: Verdict type validation ──────────────────────────────

  it("9. Verdict type validation: verdict is not a string → terminal error_validation", () => {
    const state = defaultState();
    // Cast through unknown to inject a bad type at runtime
    const verify = {
      ...defaultVerifyArtifact(),
      verdict: 42,
    } as unknown as VerifyArtifact;
    const review = defaultReviewArtifact();

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "error_validation",
      terminal: true,
    });
  });

  // ── Category 10–12: Severity gate ────────────────────────────────────

  it("10. Severity gate: critical finding → terminal stopped_review_findings", () => {
    const state = defaultState();
    const verify = defaultVerifyArtifact({ verdict: "PASS" });
    const review = defaultReviewArtifact({
      finding_details: [
        { severity: "critical", check: "Security", description: "SQL injection risk" },
      ],
    });

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "stopped_review_findings",
      terminal: true,
    });
  });

  it("11. Severity gate: important finding → terminal stopped_review_findings", () => {
    const state = defaultState();
    const verify = defaultVerifyArtifact({ verdict: "PASS" });
    const review = defaultReviewArtifact({
      finding_details: [
        { severity: "important", check: "Architecture", description: "Circular dependency" },
      ],
    });

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "stopped_review_findings",
      terminal: true,
    });
  });

  it("12. Severity gate: suggestion/nit/fyi findings → advance (non-blocking)", () => {
    const state = defaultState();
    const verify = defaultVerifyArtifact({ verdict: "PASS" });
    const review = defaultReviewArtifact({
      finding_details: [
        { severity: "suggestion", check: "Code Quality", description: "Use optional chaining" },
        { severity: "nit", check: "Style", description: "Missing trailing comma" },
        { severity: "fyi", check: "Docs", description: "Update README" },
      ],
    });

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    // Non-blocking: should not hit stopped_review_findings
    expect(result).not.toMatchObject({ phase: "stopped_review_findings" });
    expect(result).not.toMatchObject({ terminal: true });
  });

  // ── Category 13: Severity enum validation ─────────────────────────────

  it("13. Severity enum validation: unknown severity → terminal error_validation", () => {
    const state = defaultState();
    const verify = defaultVerifyArtifact({ verdict: "PASS" });
    // Inject a severity value not in the enum
    const badSeverity = "catastrophic" as unknown as Severity;
    const review = defaultReviewArtifact({
      finding_details: [
        {
          severity: badSeverity,
          check: "Unknown",
          description: "This severity doesn't exist",
        },
      ],
    });

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "error_validation",
      terminal: true,
    });
  });

  // ── Category 14: finding_details type check ──────────────────────────

  it("14. finding_details is not an array → terminal error_validation", () => {
    const state = defaultState();
    const verify = defaultVerifyArtifact({ verdict: "PASS" });
    // Corrupt finding_details to be a non-array value
    const review = {
      ...defaultReviewArtifact(),
      finding_details: "not-an-array",
    } as unknown as ReviewArtifact;

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "error_validation",
      terminal: true,
    });
  });

  // ── Category 15: Circuit breaker ─────────────────────────────────────

  it("15. Circuit breaker: blockCount >= maxBlocks → terminal circuit_breaker", () => {
    const state = defaultState({
      blockCount: 3,
      maxBlocks: 3,
    });

    const result = evaluateLoopState(state) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "circuit_breaker",
      terminal: true,
    });
  });

  // ── Category 16: Session conflict ────────────────────────────────────

  it("16. Session conflict: sessionId mismatch → terminal session_conflict", () => {
    const state = defaultState({ sessionId: "session-expected" });
    const stateWithMismatch = defaultState({ sessionId: "session-different" });

    // The hook receives the actual session ID as a parameter or detects mismatch
    // For the test, we pass the state with a mismatched session
    const result = evaluateLoopState(stateWithMismatch) as LoopEvaluationResult;
    // session_conflict is triggered when the runtime session ID doesn't match
    // the one in state — we simulate this with a state that has a stale sessionId
    // that the hook detects as different from whatever it expects
    expect(result.decision).toBeDefined();
    // (Actual assertion depends on how the function receives the runtime session ID)
    // This test will be refined in Task 6 when the function signature is finalized
  });

  it("17. Session conflict: explicit stale session ID → terminal session_conflict", () => {
    const state = defaultState({
      sessionId: "stale-session-from-previous-run",
    });

    const result = evaluateLoopState(state) as LoopEvaluationResult;
    // The function should detect the stale session and terminate
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "session_conflict",
      terminal: true,
    });
  });

  // ── Category 17–18: Corruption guards ────────────────────────────────

  it("18. Corruption guard: currentGroup > totalGroups → terminal error_corruption", () => {
    const state = defaultState({
      currentGroup: 5,
      totalGroups: 3,
    });

    const result = evaluateLoopState(state) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "error_corruption",
      terminal: true,
    });
  });

  it("19. Corruption guard: currentGroup < 1 → terminal error_corruption", () => {
    const state = defaultState({
      currentGroup: 0,
      totalGroups: 3,
    });

    const result = evaluateLoopState(state) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "error_corruption",
      terminal: true,
    });
  });

  // ── Category 19: Clean advance ───────────────────────────────────────

  it("20. Clean advance: PASS verdict + clean review → block with instruction to continue", () => {
    const state = defaultState({
      currentGroup: 1,
      totalGroups: 3,
      phase: "awaiting_group_result",
    });
    const verify = defaultVerifyArtifact({ verdict: "PASS" });
    const review = defaultReviewArtifact({ finding_details: [] });

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "block",
    });
    expect(result.reason).toBeDefined();
    // Non-terminal block — loop continues, awaiting next group
    expect(result.terminal).toBeFalsy();
  });

  // ── Category 20: Finalize path ───────────────────────────────────────

  it("21. Finalize path: last group (currentGroup === totalGroups) clean → block with finalize instruction", () => {
    const state = defaultState({
      currentGroup: 3,
      totalGroups: 3,
      phase: "awaiting_group_result",
    });
    const verify = defaultVerifyArtifact({ verdict: "PASS", group: 3 });
    const review = defaultReviewArtifact({ group: 3, finding_details: [] });

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "block",
      phase: "awaiting_finalize",
    });
    expect(result.terminal).toBeFalsy();
  });

  // ── Category 21: Done state ──────────────────────────────────────────

  it("22. Done state: phase=awaiting_finalize, all finalized → proceed with phase=done", () => {
    const state = defaultState({
      phase: "awaiting_finalize",
      currentGroup: 3,
      totalGroups: 3,
      completedGroups: [1, 2, 3],
      groupStatuses: { "1": "complete", "2": "complete", "3": "complete" },
      active: true,
    });

    const result = evaluateLoopState(state) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "done",
      terminal: true,
    });
  });

  // ── Bonus: exitCode mismatch validation ─────────────────────────────

  it("23. Evidence exitCode mismatch: exitCode=1 but status='pass' with cli-emitted provenance → terminal error_validation", () => {
    const state = defaultState();
    const verify = defaultVerifyArtifact({
      verdict: "PASS",
      evidence: [
        {
          kind: "test",
          command: "npm test",
          status: "pass",
          exitCode: 1, // non-zero exit code contradicts "pass" status
          provenance: "cli-emitted",
        },
      ],
    });
    const review = defaultReviewArtifact();

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "error_validation",
      terminal: true,
    });
  });

  // ── Bonus: PASS with zero cli-emitted evidence ───────────────────────

  it("24. PASS verdict with zero cli-emitted evidence → terminal error_validation", () => {
    const state = defaultState();
    const verify = defaultVerifyArtifact({
      verdict: "PASS",
      evidence: [
        {
          kind: "manual-check",
          description: "Looks good to me",
          status: "pass",
          provenance: "llm-interpreted",
        },
      ],
    });
    const review = defaultReviewArtifact();

    const result = evaluateLoopState(state, verify, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "proceed",
      phase: "error_validation",
      terminal: true,
    });
  });

  // ── Edge: review-only artifact (no verify), should still work ───────

  it("25. No verify artifact (only review) → block (verify must come first)", () => {
    const state = defaultState({ phase: "awaiting_group_result" });
    const review = defaultReviewArtifact();

    const result = evaluateLoopState(state, undefined, review) as LoopEvaluationResult;
    expect(result).toMatchObject({
      decision: "block",
    });
    expect(result.reason).toBeDefined();
  });
});
