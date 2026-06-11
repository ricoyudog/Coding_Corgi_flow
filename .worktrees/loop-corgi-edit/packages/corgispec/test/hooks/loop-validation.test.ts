import { describe, it, expect } from "vitest";
import {
  validateLoopState,
  validateVerifyArtifact,
  validateReviewArtifact,
  validateIdentity,
  validateSeverityEnum,
  validateVerdictString,
  validateFindingDetailsType,
  validateEvidenceProvenance,
  validateExitCodeConsistency,
  validateRetryCount,
  validateMaxRetries,
  validateSelfDriven,
} from "../../src/lib/loop-validation.js";
import type {
  LoopState,
  VerifyArtifact,
  ReviewArtifact,
  EvidenceEntry,
  FindingDetail,
  Verdict,
  Severity,
} from "../../src/lib/loop-types.js";

// ─── Shared Fixtures ────────────────────────────────────────────────────

function validLoopState(): LoopState {
  return {
    active: true,
    changeName: "add-user-auth",
    sessionId: "ses_abc123",
    nonce: "2026-06-10T10:00:00Z-group-2",
    currentGroup: 2,
    totalGroups: 4,
    phase: "awaiting_group_result",
    worktreePath: "/tmp/worktrees/add-user-auth",
    platform: "github-tracked",
    autoApprovalPolicy: {
      allowCommitPush: true,
      allowPassWithWarnings: false,
    },
    startedAt: "2026-06-10T09:00:00Z",
    updatedAt: "2026-06-10T10:00:00Z",
    completedGroups: [1],
    groupStatuses: { "1": "done" },
    pushStatus: { "1": "pushed" },
    blockCount: 0,
    maxBlocks: 8,
    maxGroups: 4,
  };
}

function validVerifyArtifact(): VerifyArtifact {
  return {
    schemaVersion: 1,
    changeName: "add-user-auth",
    group: 2,
    nonce: "2026-06-10T10:00:00Z-group-2",
    verdict: "PASS",
    summary: "All checks passed",
    evidence: [
      {
        kind: "test",
        command: "npm test",
        status: "pass",
        exitCode: 0,
        provenance: "cli-emitted",
      },
      {
        kind: "build",
        command: "npm run build",
        status: "pass",
        exitCode: 0,
        provenance: "cli-emitted",
      },
      {
        kind: "manual-check",
        description: "Verified output format matches spec",
        status: "pass",
        provenance: "llm-interpreted",
      },
    ],
  };
}

function validReviewArtifact(): ReviewArtifact {
  return {
    schemaVersion: 1,
    changeName: "add-user-auth",
    group: 2,
    nonce: "2026-06-10T10:00:00Z-group-2",
    finding_details: [
      {
        severity: "important",
        check: "Spec Coverage",
        requirement: "REQ-3: Error handling",
        description: "No null input error path",
      },
      {
        severity: "suggestion",
        check: "Code Quality",
        file: "src/utils.ts",
        description: "Consider extracting repeated validation logic",
      },
    ],
  };
}

// ==================================================================
// validateLoopState
// ==================================================================

describe("validateLoopState", () => {
  it("accepts a valid complete LoopState", () => {
    const result = validateLoopState(validLoopState());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a LoopState with an empty completedGroups", () => {
    const state = { ...validLoopState(), completedGroups: [] };
    const result = validateLoopState(state);
    expect(result.valid).toBe(true);
  });

  it("rejects null input", () => {
    const result = validateLoopState(null);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("object");
  });

  it("rejects undefined input", () => {
    const result = validateLoopState(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("object");
  });

  it("rejects a string input", () => {
    const result = validateLoopState("not an object");
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("object");
  });

  it("rejects an array input", () => {
    const result = validateLoopState([]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("object");
  });

  it("rejects missing active field", () => {
    const state = { ...validLoopState(), active: undefined };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("active"))).toBe(true);
  });

  it("rejects active as string instead of boolean", () => {
    const state = { ...validLoopState(), active: "yes" };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("active"))).toBe(true);
  });

  it("rejects empty changeName", () => {
    const state = { ...validLoopState(), changeName: "" };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("changeName"))).toBe(true);
  });

  it("rejects missing changeName", () => {
    const state = { ...validLoopState(), changeName: undefined as unknown as string };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("changeName"))).toBe(true);
  });

  it("rejects empty sessionId", () => {
    const state = { ...validLoopState(), sessionId: "" };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sessionId"))).toBe(true);
  });

  it("rejects nonce as number instead of string", () => {
    const state = { ...validLoopState(), nonce: 12345 as unknown as string };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nonce"))).toBe(true);
  });

  it("rejects currentGroup as float", () => {
    const state = { ...validLoopState(), currentGroup: 2.5 };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("currentGroup"))).toBe(true);
  });

  it("rejects currentGroup less than 1", () => {
    const state = { ...validLoopState(), currentGroup: 0 };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("currentGroup"))).toBe(true);
  });

  it("rejects totalGroups as string", () => {
    const state = { ...validLoopState(), totalGroups: "four" as unknown as number };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("totalGroups"))).toBe(true);
  });

  it("rejects invalid phase", () => {
    const state = { ...validLoopState(), phase: "invalid_phase" as unknown as LoopState["phase"] };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("phase"))).toBe(true);
  });

  it("accepts all valid LoopPhase values", () => {
    const validPhases = [
      "init", "awaiting_group_result", "awaiting_finalize", "done",
      "verify_failed", "stopped_review_findings", "error_validation",
      "session_conflict", "circuit_breaker", "error_corruption", "worktree_missing",
    ];
    for (const phase of validPhases) {
      const state = { ...validLoopState(), phase: phase as LoopState["phase"] };
      const result = validateLoopState(state);
      expect(result.valid).toBe(true);
    }
  });

  it("rejects empty worktreePath", () => {
    const state = { ...validLoopState(), worktreePath: "" };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("worktreePath"))).toBe(true);
  });

  it("rejects missing autoApprovalPolicy", () => {
    const state = { ...validLoopState(), autoApprovalPolicy: undefined as unknown as LoopState["autoApprovalPolicy"] };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("autoApprovalPolicy"))).toBe(true);
  });

  it("rejects autoApprovalPolicy as string", () => {
    const state = { ...validLoopState(), autoApprovalPolicy: "bad" as unknown as LoopState["autoApprovalPolicy"] };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("autoApprovalPolicy"))).toBe(true);
  });

  it("rejects autoApprovalPolicy.allowCommitPush as number", () => {
    const state = { ...validLoopState() };
    state.autoApprovalPolicy = { allowCommitPush: 1 as unknown as boolean, allowPassWithWarnings: false };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("allowCommitPush"))).toBe(true);
  });

  it("rejects autoApprovalPolicy.allowPassWithWarnings as string", () => {
    const state = { ...validLoopState() };
    state.autoApprovalPolicy = { allowCommitPush: true, allowPassWithWarnings: "yes" as unknown as boolean };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("allowPassWithWarnings"))).toBe(true);
  });

  it("rejects empty startedAt", () => {
    const state = { ...validLoopState(), startedAt: "" };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("startedAt"))).toBe(true);
  });

  it("rejects empty updatedAt", () => {
    const state = { ...validLoopState(), updatedAt: "" };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("updatedAt"))).toBe(true);
  });

  it("rejects completedGroups as string instead of array", () => {
    const state = { ...validLoopState(), completedGroups: "not array" as unknown as number[] };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("completedGroups"))).toBe(true);
  });

  it("rejects completedGroups with non-number element", () => {
    const state = { ...validLoopState(), completedGroups: [1, "two" as unknown as number, 3] };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("completedGroups[1]"))).toBe(true);
  });

  it("rejects groupStatuses as a number", () => {
    const state = { ...validLoopState(), groupStatuses: 42 as unknown as Record<string, string> };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("groupStatuses"))).toBe(true);
  });

  it("rejects groupStatuses with non-string value", () => {
    const state = {
      ...validLoopState(),
      groupStatuses: { "1": 123 as unknown as string },
    };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("groupStatuses"))).toBe(true);
  });

  it("accepts null groupStatuses", () => {
    const state = { ...validLoopState(), groupStatuses: null as unknown as Record<string, string> };
    const result = validateLoopState(state);
    expect(result.valid).toBe(true);
  });

  it("rejects pushStatus as array", () => {
    const state = { ...validLoopState(), pushStatus: [] as unknown as Record<string, string> };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("pushStatus"))).toBe(true);
  });

  it("rejects blockCount as negative number", () => {
    const state = { ...validLoopState(), blockCount: -1 };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("blockCount"))).toBe(true);
  });

  it("rejects maxBlocks as 0", () => {
    const state = { ...validLoopState(), maxBlocks: 0 };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("maxBlocks"))).toBe(true);
  });

  it("rejects maxGroups as float", () => {
    const state = { ...validLoopState(), maxGroups: 4.5 };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("maxGroups"))).toBe(true);
  });

  it("reports multiple errors at once", () => {
    const state = {
      ...validLoopState(),
      active: "nope",
      changeName: "",
      currentGroup: 0,
    };
    const result = validateLoopState(state);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ==================================================================
// validateVerifyArtifact
// ==================================================================

describe("validateVerifyArtifact", () => {
  it("accepts a valid VerifyArtifact", () => {
    const result = validateVerifyArtifact(validVerifyArtifact());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts PASS_WITH_WARNINGS verdict", () => {
    const artifact = { ...validVerifyArtifact(), verdict: "PASS_WITH_WARNINGS" as Verdict };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(true);
  });

  it("accepts FAIL verdict", () => {
    const artifact = { ...validVerifyArtifact(), verdict: "FAIL" as Verdict };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(true);
  });

  it("accepts optional summary", () => {
    const artifact = { ...validVerifyArtifact(), summary: "All good" };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(true);
  });

  it("accepts missing summary", () => {
    const { summary, ...rest } = validVerifyArtifact();
    const result = validateVerifyArtifact(rest);
    expect(result.valid).toBe(true);
  });

  it("accepts summary as undefined", () => {
    const artifact = { ...validVerifyArtifact(), summary: undefined };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(true);
  });

  it("rejects null input", () => {
    const result = validateVerifyArtifact(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("object");
  });

  it("rejects undefined input", () => {
    const result = validateVerifyArtifact(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("object");
  });

  it("rejects array input", () => {
    const result = validateVerifyArtifact([1, 2, 3]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("object");
  });

  it("rejects missing schemaVersion", () => {
    const { schemaVersion, ...rest } = validVerifyArtifact();
    const result = validateVerifyArtifact(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects schemaVersion as 0", () => {
    const artifact = { ...validVerifyArtifact(), schemaVersion: 0 };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects schemaVersion as float", () => {
    const artifact = { ...validVerifyArtifact(), schemaVersion: 1.5 };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects empty changeName", () => {
    const artifact = { ...validVerifyArtifact(), changeName: "" };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("changeName"))).toBe(true);
  });

  it("rejects group as string", () => {
    const artifact = { ...validVerifyArtifact(), group: "two" as unknown as number };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("group"))).toBe(true);
  });

  it("rejects group as 0", () => {
    const artifact = { ...validVerifyArtifact(), group: 0 };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("group"))).toBe(true);
  });

  it("rejects empty nonce", () => {
    const artifact = { ...validVerifyArtifact(), nonce: "" };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nonce"))).toBe(true);
  });

  it("rejects verdict as number", () => {
    const artifact = { ...validVerifyArtifact(), verdict: 42 as unknown as string };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("verdict"))).toBe(true);
  });

  it("rejects verdict as array", () => {
    const artifact = { ...validVerifyArtifact(), verdict: ["PASS"] as unknown as string };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("verdict"))).toBe(true);
  });

  it("rejects invalid verdict value", () => {
    const artifact = { ...validVerifyArtifact(), verdict: "INVALID" as unknown as string };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("verdict"))).toBe(true);
  });

  it("rejects evidence as string", () => {
    const artifact = { ...validVerifyArtifact(), evidence: "nope" as unknown as EvidenceEntry[] };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("evidence"))).toBe(true);
  });

  it("rejects evidence as null", () => {
    const artifact = { ...validVerifyArtifact(), evidence: null as unknown as EvidenceEntry[] };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("evidence"))).toBe(true);
  });

  it("rejects summary as number", () => {
    const artifact = { ...validVerifyArtifact(), summary: 123 as unknown as string };
    const result = validateVerifyArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("summary"))).toBe(true);
  });
});

// ==================================================================
// validateReviewArtifact
// ==================================================================

describe("validateReviewArtifact", () => {
  it("accepts a valid ReviewArtifact", () => {
    const result = validateReviewArtifact(validReviewArtifact());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts a ReviewArtifact with empty finding_details", () => {
    const artifact = { ...validReviewArtifact(), finding_details: [] };
    const result = validateReviewArtifact(artifact);
    expect(result.valid).toBe(true);
  });

  it("rejects null input", () => {
    const result = validateReviewArtifact(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("object");
  });

  it("rejects undefined input", () => {
    const result = validateReviewArtifact(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("object");
  });

  it("rejects a number input", () => {
    const result = validateReviewArtifact(42);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("object");
  });

  it("rejects missing schemaVersion", () => {
    const { schemaVersion, ...rest } = validReviewArtifact();
    const result = validateReviewArtifact(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects schemaVersion as string", () => {
    const artifact = { ...validReviewArtifact(), schemaVersion: "v1" as unknown as number };
    const result = validateReviewArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects empty changeName", () => {
    const artifact = { ...validReviewArtifact(), changeName: "" };
    const result = validateReviewArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("changeName"))).toBe(true);
  });

  it("rejects group as negative", () => {
    const artifact = { ...validReviewArtifact(), group: -1 };
    const result = validateReviewArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("group"))).toBe(true);
  });

  it("rejects empty nonce", () => {
    const artifact = { ...validReviewArtifact(), nonce: "" };
    const result = validateReviewArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nonce"))).toBe(true);
  });

  it("rejects finding_details as string", () => {
    const artifact = { ...validReviewArtifact(), finding_details: "not array" as unknown as FindingDetail[] };
    const result = validateReviewArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("finding_details"))).toBe(true);
  });

  it("rejects finding_details as null", () => {
    const artifact = { ...validReviewArtifact(), finding_details: null as unknown as FindingDetail[] };
    const result = validateReviewArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("finding_details"))).toBe(true);
  });

  it("rejects finding_details as object", () => {
    const artifact = { ...validReviewArtifact(), finding_details: {} as unknown as FindingDetail[] };
    const result = validateReviewArtifact(artifact);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("finding_details"))).toBe(true);
  });
});

// ==================================================================
// validateIdentity
// ==================================================================

describe("validateIdentity", () => {
  it("passes when all three artifacts match", () => {
    const state = validLoopState();
    const verify = validVerifyArtifact();
    const review = validReviewArtifact();
    const result = validateIdentity(state, verify, review);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails when changeName differs between state and verify", () => {
    const state = validLoopState();
    const verify = { ...validVerifyArtifact(), changeName: "other-change" };
    const review = validReviewArtifact();
    const result = validateIdentity(state, verify, review);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("changeName"))).toBe(true);
  });

  it("fails when changeName differs between state and review", () => {
    const state = validLoopState();
    const verify = validVerifyArtifact();
    const review = { ...validReviewArtifact(), changeName: "other-change" };
    const result = validateIdentity(state, verify, review);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("changeName"))).toBe(true);
  });

  it("fails when group differs between state and verify", () => {
    const state = validLoopState();
    const verify = { ...validVerifyArtifact(), group: 3 };
    const review = validReviewArtifact();
    const result = validateIdentity(state, verify, review);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("group"))).toBe(true);
  });

  it("fails when group differs between state and review", () => {
    const state = validLoopState();
    const verify = validVerifyArtifact();
    const review = { ...validReviewArtifact(), group: 3 };
    const result = validateIdentity(state, verify, review);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("group"))).toBe(true);
  });

  it("handles group string-vs-number mismatch via tostring comparison", () => {
    const state = validLoopState();
    // group as string should still match via tostring
    const verify = { ...validVerifyArtifact(), group: "2" as unknown as number };
    const review = validReviewArtifact();
    const result = validateIdentity(state, verify, review);
    // String("2") === String("2") is true, so this should pass
    expect(result.valid).toBe(true);
  });

  it("fails when nonce differs between state and verify", () => {
    const state = validLoopState();
    const verify = { ...validVerifyArtifact(), nonce: "different-nonce" };
    const review = validReviewArtifact();
    const result = validateIdentity(state, verify, review);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nonce"))).toBe(true);
  });

  it("fails when nonce differs between state and review", () => {
    const state = validLoopState();
    const verify = validVerifyArtifact();
    const review = { ...validReviewArtifact(), nonce: "different-nonce" };
    const result = validateIdentity(state, verify, review);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nonce"))).toBe(true);
  });

  it("fails when all three identifiers differ", () => {
    const state = validLoopState();
    const verify = { ...validVerifyArtifact(), changeName: "X", group: 99, nonce: "A" };
    const review = { ...validReviewArtifact(), changeName: "Y", group: 100, nonce: "B" };
    const result = validateIdentity(state, verify, review);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(6);
  });
});

// ==================================================================
// validateSeverityEnum
// ==================================================================

describe("validateSeverityEnum", () => {
  it("passes with all valid severities", () => {
    const findings: FindingDetail[] = [
      { severity: "critical", check: "Security", description: "SQL injection risk" },
      { severity: "important", check: "Spec Coverage", description: "Missing edge case" },
      { severity: "suggestion", check: "Code Quality", description: "Refactor suggestion" },
      { severity: "nit", check: "Style", description: "Trailing whitespace" },
      { severity: "fyi", check: "Documentation", description: "Update README" },
      { severity: "important", check: "Performance", description: "N+1 query" },
    ];
    const result = validateSeverityEnum(findings);
    expect(result.valid).toBe(true);
  });

  it("passes with empty array", () => {
    const result = validateSeverityEnum([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails on unknown severity value", () => {
    const findings: FindingDetail[] = [
      { severity: "important", check: "Quality", description: "ok" },
      { severity: "invalid_severity" as unknown as FindingDetail["severity"], check: "Bad", description: "bad" },
    ];
    const result = validateSeverityEnum(findings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid_severity"))).toBe(true);
  });

  it("fails on severity null", () => {
    const findings: FindingDetail[] = [
      { severity: null as unknown as FindingDetail["severity"], check: "Bad", description: "bad" },
    ];
    const result = validateSeverityEnum(findings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("null"))).toBe(true);
  });

  it("fails on severity as number", () => {
    const findings: FindingDetail[] = [
      { severity: 5 as unknown as FindingDetail["severity"], check: "Bad", description: "bad" },
    ];
    const result = validateSeverityEnum(findings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("number"))).toBe(true);
  });

  it("fails on severity as boolean", () => {
    const findings: FindingDetail[] = [
      { severity: true as unknown as FindingDetail["severity"], check: "Bad", description: "bad" },
    ];
    const result = validateSeverityEnum(findings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("boolean"))).toBe(true);
  });

  it("fails on empty string severity", () => {
    const findings: FindingDetail[] = [
      { severity: "" as Severity, check: "Bad", description: "bad" },
    ];
    const result = validateSeverityEnum(findings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("severity"))).toBe(true);
  });

  it("skips null entries gracefully", () => {
    const findings: FindingDetail[] = [null as unknown as FindingDetail];
    const result = validateSeverityEnum(findings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing or null"))).toBe(true);
  });

  it("is case-sensitive: rejects CRITICAL (uppercase)", () => {
    const findings: FindingDetail[] = [
      { severity: "CRITICAL" as unknown as FindingDetail["severity"], check: "Bad", description: "bad" },
    ];
    const result = validateSeverityEnum(findings);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("CRITICAL"))).toBe(true);
  });

  it("reports multiple severity errors at once", () => {
    const findings: FindingDetail[] = [
      { severity: "bad1" as unknown as FindingDetail["severity"], check: "A", description: "a" },
      { severity: "bad2" as unknown as FindingDetail["severity"], check: "B", description: "b" },
      { severity: "important", check: "C", description: "c" },
    ];
    const result = validateSeverityEnum(findings);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
  });
});

// ==================================================================
// validateVerdictString
// ==================================================================

describe("validateVerdictString", () => {
  it("passes for PASS", () => {
    expect(validateVerdictString("PASS").valid).toBe(true);
  });

  it("passes for PASS_WITH_WARNINGS", () => {
    expect(validateVerdictString("PASS_WITH_WARNINGS").valid).toBe(true);
  });

  it("passes for FAIL", () => {
    expect(validateVerdictString("FAIL").valid).toBe(true);
  });

  it("rejects null", () => {
    const result = validateVerdictString(null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("null"))).toBe(true);
  });

  it("rejects undefined", () => {
    const result = validateVerdictString(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("undefined"))).toBe(true);
  });

  it("rejects a number", () => {
    const result = validateVerdictString(42);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("number"))).toBe(true);
  });

  it("rejects an array", () => {
    const result = validateVerdictString(["PASS"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("array"))).toBe(true);
  });

  it("rejects an object", () => {
    const result = validateVerdictString({ value: "PASS" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("object"))).toBe(true);
  });

  it("rejects a boolean", () => {
    const result = validateVerdictString(true);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("boolean"))).toBe(true);
  });

  it("rejects an invalid string value", () => {
    const result = validateVerdictString("APPROVED");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("APPROVED"))).toBe(true);
  });

  it("rejects empty string", () => {
    const result = validateVerdictString("");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("one of"))).toBe(true);
  });

  it("is case-sensitive: rejects pass (lowercase)", () => {
    const result = validateVerdictString("pass");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("pass"))).toBe(true);
  });
});

// ==================================================================
// validateFindingDetailsType
// ==================================================================

describe("validateFindingDetailsType", () => {
  it("passes for an array", () => {
    const result = validateFindingDetailsType([{ severity: "nit", check: "Style", description: "ok" }]);
    expect(result.valid).toBe(true);
  });

  it("passes for an empty array", () => {
    const result = validateFindingDetailsType([]);
    expect(result.valid).toBe(true);
  });

  it("rejects null", () => {
    const result = validateFindingDetailsType(null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("null"))).toBe(true);
  });

  it("rejects undefined", () => {
    const result = validateFindingDetailsType(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("undefined"))).toBe(true);
  });

  it("rejects a string", () => {
    const result = validateFindingDetailsType("not an array");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("array"))).toBe(true);
  });

  it("rejects a number", () => {
    const result = validateFindingDetailsType(42);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("number"))).toBe(true);
  });

  it("rejects an object", () => {
    const result = validateFindingDetailsType({});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("object"))).toBe(true);
  });

  it("rejects a boolean", () => {
    const result = validateFindingDetailsType(false);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("boolean"))).toBe(true);
  });
});

// ==================================================================
// validateEvidenceProvenance
// ==================================================================

describe("validateEvidenceProvenance", () => {
  it("passes when PASS verdict has cli-emitted evidence", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "test", command: "npm test", status: "pass", exitCode: 0, provenance: "cli-emitted" },
    ];
    const result = validateEvidenceProvenance(evidence, "PASS");
    expect(result.valid).toBe(true);
  });

  it("passes when PASS verdict has both cli-emitted and llm-interpreted", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "test", command: "npm test", status: "pass", exitCode: 0, provenance: "cli-emitted" },
      { kind: "manual-check", description: "Looks good", status: "pass", provenance: "llm-interpreted" },
    ];
    const result = validateEvidenceProvenance(evidence, "PASS");
    expect(result.valid).toBe(true);
  });

  it("passes regardless of provenance for non-PASS verdicts (FAIL)", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "manual-check", description: "Looks wrong", status: "fail", provenance: "llm-interpreted" },
    ];
    const result = validateEvidenceProvenance(evidence, "FAIL");
    expect(result.valid).toBe(true);
  });

  it("passes regardless of provenance for non-PASS verdicts (PASS_WITH_WARNINGS)", () => {
    const evidence: EvidenceEntry[] = [];
    const result = validateEvidenceProvenance(evidence, "PASS_WITH_WARNINGS");
    expect(result.valid).toBe(true);
  });

  it("fails when PASS verdict has no cli-emitted evidence (only llm-interpreted)", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "manual-check", description: "Looks good", status: "pass", provenance: "llm-interpreted" },
    ];
    const result = validateEvidenceProvenance(evidence, "PASS");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cli-emitted"))).toBe(true);
  });

  it("fails when PASS verdict has empty evidence array", () => {
    const result = validateEvidenceProvenance([], "PASS");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("empty"))).toBe(true);
  });
});

// ==================================================================
// validateExitCodeConsistency
// ==================================================================

describe("validateExitCodeConsistency", () => {
  it("passes when cli-emitted exitCode 0 matches status pass", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "test", command: "npm test", status: "pass", exitCode: 0, provenance: "cli-emitted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(true);
  });

  it("passes when cli-emitted exitCode 1 matches status fail", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "test", command: "npm test", status: "fail", exitCode: 1, provenance: "cli-emitted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(true);
  });

  it("passes with multiple consistent cli-emitted entries", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "test", command: "npm test", status: "pass", exitCode: 0, provenance: "cli-emitted" },
      { kind: "build", command: "npm run build", status: "pass", exitCode: 0, provenance: "cli-emitted" },
      { kind: "lint", command: "npm run lint", status: "pass", exitCode: 0, provenance: "cli-emitted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(true);
  });

  it("ignores llm-interpreted entries (no exitCode field)", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "manual-check", description: "Looks good", status: "pass", provenance: "llm-interpreted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(true);
  });

  it("ignores llm-interpreted entries even with exitCode present", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "manual-check", description: "Looks good", status: "fail", exitCode: 0, provenance: "llm-interpreted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(true);
  });

  it("ignores cli-emitted entries without exitCode", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "typecheck", command: "tsc --noEmit", status: "pass", provenance: "cli-emitted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(true);
  });

  it("fails when cli-emitted exitCode 0 has status fail", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "test", command: "npm test", status: "fail", exitCode: 0, provenance: "cli-emitted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("exitCode 0 must match"))).toBe(true);
  });

  it("fails when cli-emitted non-zero exitCode has status pass", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "test", command: "npm test", status: "pass", exitCode: 1, provenance: "cli-emitted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-zero exitCode"))).toBe(true);
  });

  it("fails when cli-emitted non-zero exitCode has status pass (exitCode 2)", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "build", command: "npm run build", status: "pass", exitCode: 2, provenance: "cli-emitted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-zero exitCode 2"))).toBe(true);
  });

  it("reports multiple exit code mismatches", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "test", command: "npm test", status: "fail", exitCode: 0, provenance: "cli-emitted" },
      { kind: "build", command: "npm run build", status: "pass", exitCode: 1, provenance: "cli-emitted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
  });

  it("passes with empty evidence array", () => {
    const result = validateExitCodeConsistency([]);
    expect(result.valid).toBe(true);
  });

  it("handles skipped cli-emitted entries with null exitCode", () => {
    const evidence: EvidenceEntry[] = [
      { kind: "test", command: "npm test", status: "skip", exitCode: null as unknown as number, provenance: "cli-emitted" },
    ];
    const result = validateExitCodeConsistency(evidence);
    expect(result.valid).toBe(true);
  });
});

// ─── validateRetryCount ─────────────────────────────────────────────────

describe("validateRetryCount", () => {
  it("passes with valid non-negative integer", () => {
    const result = validateRetryCount(0);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes with positive integer", () => {
    const result = validateRetryCount(3);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes with undefined (backward compat)", () => {
    const result = validateRetryCount(undefined);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails with null", () => {
    const result = validateRetryCount(null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must not be null"))).toBe(true);
  });

  it("fails with string", () => {
    const result = validateRetryCount("3");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-negative integer"))).toBe(true);
  });

  it("fails with negative number", () => {
    const result = validateRetryCount(-1);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-negative integer"))).toBe(true);
  });

  it("fails with float", () => {
    const result = validateRetryCount(1.5);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-negative integer"))).toBe(true);
  });

  it("fails with boolean", () => {
    const result = validateRetryCount(true);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-negative integer"))).toBe(true);
  });
});

// ─── validateMaxRetries ─────────────────────────────────────────────────

describe("validateMaxRetries", () => {
  it("passes with valid non-negative integer", () => {
    const result = validateMaxRetries(0);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes with positive integer", () => {
    const result = validateMaxRetries(5);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes with undefined (backward compat)", () => {
    const result = validateMaxRetries(undefined);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails with null", () => {
    const result = validateMaxRetries(null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must not be null"))).toBe(true);
  });

  it("fails with string", () => {
    const result = validateMaxRetries("5");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-negative integer"))).toBe(true);
  });

  it("fails with negative number", () => {
    const result = validateMaxRetries(-1);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-negative integer"))).toBe(true);
  });

  it("fails with float", () => {
    const result = validateMaxRetries(2.5);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-negative integer"))).toBe(true);
  });

  it("fails with boolean", () => {
    const result = validateMaxRetries(false);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("non-negative integer"))).toBe(true);
  });
});

// ─── validateSelfDriven ─────────────────────────────────────────────────

describe("validateSelfDriven", () => {
  it("passes with true", () => {
    const result = validateSelfDriven(true);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes with false", () => {
    const result = validateSelfDriven(false);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("passes with undefined (backward compat)", () => {
    const result = validateSelfDriven(undefined);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("fails with null", () => {
    const result = validateSelfDriven(null);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must not be null"))).toBe(true);
  });

  it("fails with string", () => {
    const result = validateSelfDriven("true");
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must be a boolean"))).toBe(true);
  });

  it("fails with number", () => {
    const result = validateSelfDriven(1);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must be a boolean"))).toBe(true);
  });

  it("fails with object", () => {
    const result = validateSelfDriven({});
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must be a boolean"))).toBe(true);
  });
});
