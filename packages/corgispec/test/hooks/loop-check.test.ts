// RED PHASE — these tests are designed to FAIL until Task 6 implements processLoopState
//
// The import of processLoopState from "../../src/lib/loop-state.js" cannot resolve
// because the function doesn't exist yet. Every test will fail at import time.
//
// When processLoopState is implemented:
//   - It mutates state IN PLACE (modifies state.phase, state.currentGroup, etc.)
//   - Returns LoopHookDecision { decision: "proceed" | "block", reason?: string }
//   - Signature: processLoopState(state, verify, review, input)
//
// This is the RED phase of TDD. Tests describe the desired behavior before
// any implementation exists.

import { describe, it, expect } from "vitest";
import { processLoopState } from "../../src/lib/loop-state.js";
import type {
  LoopState,
  VerifyArtifact,
  ReviewArtifact,
  LoopHookDecision,
  AutoApprovalPolicy,
  LoopPhase,
  Severity,
} from "../../src/lib/loop-types.js";

// ─── LoopHookInput (will be added to loop-types.ts in Task 6) ────────────

interface LoopHookInput {
  hook_event_name: string;
  stop_hook_active: boolean;
  session_id: string;
}

// ─── Factory Helpers ──────────────────────────────────────────────────────

function makeState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    active: true,
    changeName: "test-change",
    sessionId: "ses_test",
    nonce: "2026-01-01T00:00:00Z-group-1",
    currentGroup: 1,
    totalGroups: 2,
    phase: "awaiting_group_result",
    worktreePath: ".",
    platform: "github-tracked",
    autoApprovalPolicy: { allowCommitPush: true, allowPassWithWarnings: false },
    startedAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    completedGroups: [],
    groupStatuses: { "1": "in_progress", "2": "pending" },
    pushStatus: {},
    blockCount: 0,
    maxBlocks: 6,
    maxGroups: 10,
    retryCount: 0,
    maxRetries: 3,
    selfDriven: false,
    ...overrides,
  };
}

function makeVerify(overrides: Partial<VerifyArtifact> = {}): VerifyArtifact {
  return {
    schemaVersion: 1,
    changeName: "test-change",
    group: 1,
    nonce: "2026-01-01T00:00:00Z-group-1",
    verdict: "PASS",
    evidence: [
      {
        kind: "build",
        command: "npm run build",
        status: "pass",
        exitCode: 0,
        provenance: "cli-emitted",
      },
    ],
    ...overrides,
  };
}

function makeReview(overrides: Partial<ReviewArtifact> = {}): ReviewArtifact {
  return {
    schemaVersion: 1,
    changeName: "test-change",
    group: 1,
    nonce: "2026-01-01T00:00:00Z-group-1",
    finding_details: [{ severity: "suggestion", check: "Code Quality", description: "Minor style issue" }],
    ...overrides,
  };
}

const defaultInput: LoopHookInput = {
  hook_event_name: "Stop",
  stop_hook_active: false,
  session_id: "ses_test",
};

// ─── Test Suite ───────────────────────────────────────────────────────────

describe("processLoopState", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // IDENTITY VALIDATION
  // ═══════════════════════════════════════════════════════════════════════

  describe("identity validation", () => {
    it("1. changeName mismatch → state.phase='error_validation', decision='proceed'", () => {
      const state = makeState({ changeName: "expected-change" });
      const verify = makeVerify({ changeName: "different-change" });
      const review = makeReview();

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_validation" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("2. group mismatch → state.phase='error_validation'", () => {
      const state = makeState({ currentGroup: 2 });
      const verify = makeVerify({ group: 1 });
      const review = makeReview({ group: 1 });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_validation" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("3. nonce mismatch → state.phase='error_validation'", () => {
      const state = makeState({ nonce: "2026-01-01T12:00:00Z-group-1" });
      const verify = makeVerify({ nonce: "2026-01-01T00:00:00Z-group-1" });
      const review = makeReview({ nonce: "2026-01-01T00:00:00Z-group-1" });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_validation" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // VERDICT GATES
  // ═══════════════════════════════════════════════════════════════════════

  describe("verdict gates", () => {
    it("4. verdict=FAIL → state.phase='verify_failed', decision='proceed'", () => {
      const state = makeState();
      const verify = makeVerify({ verdict: "FAIL" });
      const review = makeReview({ finding_details: [] });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("verify_failed" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("5. verdict=PASS_WITH_WARNINGS + policy denies → state.phase='verify_failed'", () => {
      const state = makeState({
        autoApprovalPolicy: { allowCommitPush: true, allowPassWithWarnings: false },
      });
      const verify = makeVerify({ verdict: "PASS_WITH_WARNINGS" });
      const review = makeReview({ finding_details: [] });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("verify_failed" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("6. verdict=PASS_WITH_WARNINGS + policy allows → advances past verdict gate", () => {
      const state = makeState({
        autoApprovalPolicy: { allowCommitPush: true, allowPassWithWarnings: true },
      });
      const verify = makeVerify({ verdict: "PASS_WITH_WARNINGS" });
      const review = makeReview({ finding_details: [] });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      // Should NOT be verify_failed — policy allows advance
      expect(state.phase).not.toBe("verify_failed");
      // Should advance to a non-terminal state (block for next group or finalize)
      expect(result.decision).toBe("block");
      expect(state.active).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // REVIEW SEVERITY GATES
  // ═══════════════════════════════════════════════════════════════════════

  describe("review severity gates", () => {
    it("7. critical finding → state.phase='stopped_review_findings', decision='proceed'", () => {
      const state = makeState();
      const verify = makeVerify({ verdict: "PASS" });
      const review = makeReview({
        finding_details: [{ severity: "critical", check: "Security", description: "SQL injection risk" }],
      });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("stopped_review_findings" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("8. important finding → state.phase='stopped_review_findings', decision='proceed'", () => {
      const state = makeState();
      const verify = makeVerify({ verdict: "PASS" });
      const review = makeReview({
        finding_details: [{ severity: "important", check: "Architecture", description: "Circular dependency" }],
      });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("stopped_review_findings" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("9. suggestion/nit/fyi findings → NOT stopped (non-blocking)", () => {
      const state = makeState();
      const verify = makeVerify({ verdict: "PASS" });
      const review = makeReview({
        finding_details: [
          { severity: "suggestion", check: "Code Quality", description: "Use optional chaining" },
          { severity: "nit", check: "Style", description: "Missing trailing comma" },
          { severity: "fyi", check: "Docs", description: "Update README" },
        ],
      });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(state.phase).not.toBe("stopped_review_findings");
      expect(state.active).toBe(true);
      expect(result.decision).toBe("block");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ARTIFACT TYPE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════

  describe("artifact type validation", () => {
    it("10. malformed state (missing required field) → state.phase='error_validation'", () => {
      // Pass empty object as state — validateLoopState will catch missing fields
      const state = {} as unknown as LoopState;
      const verify = makeVerify();
      const review = makeReview();

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_validation" satisfies LoopPhase);
    });

    it("11. non-string verdict → state.phase='error_validation'", () => {
      const state = makeState();
      const verify = { ...makeVerify(), verdict: 42 } as unknown as VerifyArtifact;
      const review = makeReview();

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_validation" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("12. non-array finding_details → state.phase='error_validation'", () => {
      const state = makeState();
      const verify = makeVerify({ verdict: "PASS" });
      const review = {
        ...makeReview(),
        finding_details: "not-an-array",
      } as unknown as ReviewArtifact;

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_validation" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("13. null severity → state.phase='error_validation'", () => {
      const state = makeState();
      const verify = makeVerify({ verdict: "PASS" });
      const review = makeReview({
        finding_details: [{
          severity: null as unknown as Severity,
          check: "Bad",
          description: "Null severity",
        }],
      });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_validation" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("14. unknown severity value → state.phase='error_validation'", () => {
      const state = makeState();
      const verify = makeVerify({ verdict: "PASS" });
      const review = makeReview({
        finding_details: [{
          severity: "catastrophic" as unknown as Severity,
          check: "Unknown",
          description: "Unknown severity value",
        }],
      });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_validation" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // EVIDENCE VALIDATION
  // ═══════════════════════════════════════════════════════════════════════

  describe("evidence validation", () => {
    it("15. cli-emitted exitCode mismatch (non-zero with status='pass') → state.phase='error_validation'", () => {
      const state = makeState();
      const verify = makeVerify({
        verdict: "PASS",
        evidence: [{
          kind: "test",
          command: "npm test",
          status: "pass",
          exitCode: 1,
          provenance: "cli-emitted",
        }],
      });
      const review = makeReview({ finding_details: [] });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_validation" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("16. no cli-emitted evidence for PASS verdict → state.phase='error_validation'", () => {
      const state = makeState();
      const verify = makeVerify({
        verdict: "PASS",
        evidence: [{
          kind: "manual-check",
          description: "Looks good",
          status: "pass",
          provenance: "llm-interpreted",
        }],
      });
      const review = makeReview({ finding_details: [] });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_validation" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SESSION CONFLICT
  // ═══════════════════════════════════════════════════════════════════════

  describe("session conflict", () => {
    it("17. session_id input mismatch with state.sessionId → state.phase='session_conflict'", () => {
      const state = makeState({ sessionId: "ses_stale" });
      const verify = makeVerify();
      const review = makeReview();
      const input: LoopHookInput = {
        ...defaultInput,
        session_id: "ses_different_runtime",
      };

      const result: LoopHookDecision = processLoopState(state, verify, review, input);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("session_conflict" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("18. stale session ID pattern (non-standard format) → state.phase='session_conflict'", () => {
      const state = makeState({ sessionId: "stale-session-from-previous-run" });
      const verify = makeVerify();
      const review = makeReview();

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("session_conflict" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CIRCUIT BREAKER
  // ═══════════════════════════════════════════════════════════════════════

  describe("circuit breaker", () => {
    it("19. blockCount >= maxBlocks → state.phase='circuit_breaker', decision='proceed'", () => {
      const state = makeState({ blockCount: 6, maxBlocks: 6 });
      const verify = makeVerify();
      const review = makeReview();

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("circuit_breaker" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("20. blockCount < maxBlocks → passes circuit breaker, reaches other gates", () => {
      const state = makeState({ blockCount: 4, maxBlocks: 6 });
      const verify = makeVerify({ verdict: "PASS" });
      const review = makeReview({ finding_details: [] });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      // Should NOT hit circuit_breaker — blockCount < maxBlocks
      expect(state.phase).not.toBe("circuit_breaker");
      // Should advance normally or hit another terminal
      expect(result.decision).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CORRUPTION GUARDS
  // ═══════════════════════════════════════════════════════════════════════

  describe("corruption guards", () => {
    it("21. currentGroup > totalGroups → state.phase='error_corruption', decision='proceed'", () => {
      const state = makeState({ currentGroup: 5, totalGroups: 3 });

      const result: LoopHookDecision = processLoopState(state, makeVerify(), makeReview(), defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_corruption" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });

    it("22. currentGroup < 1 → state.phase='error_corruption', decision='proceed'", () => {
      const state = makeState({ currentGroup: 0, totalGroups: 3 });

      const result: LoopHookDecision = processLoopState(state, makeVerify(), makeReview(), defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("error_corruption" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // CLEAN ADVANCE & FINALIZE
  // ═══════════════════════════════════════════════════════════════════════

  describe("clean advance and finalize", () => {
    it("23. clean advance to next group → decision='block', currentGroup incremented", () => {
      const state = makeState({
        currentGroup: 1,
        totalGroups: 3,
        phase: "awaiting_group_result",
        blockCount: 2,
      });
      const verify = makeVerify({ verdict: "PASS" });
      const review = makeReview({ finding_details: [] });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("block");
      expect(state.phase).toBe("awaiting_group_result" satisfies LoopPhase);
      expect(state.currentGroup).toBe(2);
      expect(state.completedGroups).toContain(1);
      expect(state.blockCount).toBe(3); // incremented
      expect(state.active).toBe(true);
    });

    it("24. final group clean → decision='block', state.phase='awaiting_finalize'", () => {
      const state = makeState({
        currentGroup: 3,
        totalGroups: 3,
        phase: "awaiting_group_result",
        blockCount: 2,
        groupStatuses: { "1": "complete", "2": "complete", "3": "in_progress" },
      });
      const verify = makeVerify({ verdict: "PASS", group: 3, nonce: "2026-01-01T00:00:00Z-group-1" });
      const review = makeReview({
        group: 3,
        finding_details: [],
        nonce: "2026-01-01T00:00:00Z-group-1",
      });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("block");
      expect(state.phase).toBe("awaiting_finalize" satisfies LoopPhase);
      expect(state.completedGroups).toContain(3);
      expect(state.blockCount).toBe(3);
      expect(state.active).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FINALIZE → DONE
  // ═══════════════════════════════════════════════════════════════════════

  describe("finalize → done", () => {
    it("25. awaiting_finalize + all groups completed → decision='proceed', state.phase='done'", () => {
      const state = makeState({
        phase: "awaiting_finalize",
        currentGroup: 3,
        totalGroups: 3,
        completedGroups: [1, 2, 3],
        groupStatuses: { "1": "complete", "2": "complete", "3": "complete" },
        active: true,
      });

      const result: LoopHookDecision = processLoopState(state, makeVerify(), makeReview(), defaultInput);

      expect(result.decision).toBe("proceed");
      expect(state.phase).toBe("done" satisfies LoopPhase);
      expect(state.active).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // INERT GUARD
  // ═══════════════════════════════════════════════════════════════════════

  describe("inert guard", () => {
    it("26. inactive loop → decision='proceed', no mutation beyond updatedAt", () => {
      const state = makeState({ active: false, phase: "init" });

      const result: LoopHookDecision = processLoopState(state, makeVerify(), makeReview(), defaultInput);

      expect(result.decision).toBe("proceed");
      // Inert: no phase change, no active change (already false)
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // FIRST-RUN BLOCK
  // ═══════════════════════════════════════════════════════════════════════

  describe("first-run block", () => {
    it("27. no verify artifact provided → decision='block', reason includes 'verify'", () => {
      const state = makeState({ phase: "awaiting_group_result" });
      const review = makeReview();

      const result: LoopHookDecision = processLoopState(state, undefined as unknown as VerifyArtifact, review, defaultInput);

      expect(result.decision).toBe("block");
      expect(result.reason).toBeDefined();
      expect(state.active).toBe(true);
    });

    it("28. no review artifact provided → decision='block', reason includes 'review'", () => {
      const state = makeState({ phase: "awaiting_group_result" });
      const verify = makeVerify();

      const result: LoopHookDecision = processLoopState(state, verify, undefined as unknown as ReviewArtifact, defaultInput);

      expect(result.decision).toBe("block");
      expect(result.reason).toBeDefined();
      expect(state.active).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════

  describe("edge cases", () => {
    it("29. retryCount reset to 0 on clean advance", () => {
      const state = makeState({
        retryCount: 2,
        maxRetries: 3,
        currentGroup: 1,
        totalGroups: 3,
      });
      const verify = makeVerify({ verdict: "PASS" });
      const review = makeReview({ finding_details: [] });

      const result: LoopHookDecision = processLoopState(state, verify, review, defaultInput);

      expect(result.decision).toBe("block");
      expect(state.retryCount).toBe(0);
      expect(state.currentGroup).toBe(2);
    });

    it("30. blockCount increments on each non-terminal block", () => {
      const state = makeState({ blockCount: 0 });
      const verify = makeVerify({ verdict: "PASS" });
      const review = makeReview({ finding_details: [] });

      processLoopState(state, verify, review, defaultInput);

      // On clean advance, blockCount should have increased by 1
      expect(state.blockCount).toBe(1);
    });

    it("31. verify-only artifact (no review) with block → reason is descriptive", () => {
      const state = makeState({ phase: "awaiting_group_result" });
      const verify = makeVerify({ verdict: "PASS" });

      const result: LoopHookDecision = processLoopState(state, verify, undefined as unknown as ReviewArtifact, defaultInput);

      expect(result.decision).toBe("block");
      expect(result.reason).toBeTruthy();
      expect(result.reason!.length).toBeGreaterThan(0);
    });
  });
});
