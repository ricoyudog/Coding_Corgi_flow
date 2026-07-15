import { describe, expect, it } from "vitest";

import {
  ACTIVE_PHASES_V2,
  TERMINAL_PHASES_V2,
  RunContractValidationErrorV2,
  assertLoopEventRecordV2,
  assertLoopEventV2,
  assertLoopStateV2,
  isActiveLoopPhaseV2,
  isTerminalLoopPhaseV2,
  validateLoopEventRecordV2,
  validateLoopEventV2,
  validateLoopStateV2,
} from "../src/lib/run-contract-v2.js";
import type {
  BlockedReasonV2,
  LoopEventV2,
  LoopStateV2,
} from "../src/lib/run-contract-v2.js";
import {
  createInitialLoopStateV2,
  createRunInitializedEventV2,
  reduceLoopEventV2,
} from "../src/lib/loop-reducer-v2.js";

const H1 = `sha256:${"1".repeat(64)}` as const;
const H2 = `sha256:${"2".repeat(64)}` as const;
const H3 = `sha256:${"3".repeat(64)}` as const;
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";
const REASON: BlockedReasonV2 = { code: "manual", message: "stopped", details: {} };

function state(): LoopStateV2 {
  return createInitialLoopStateV2({
    changeName: "change-a",
    runId: "run-a",
    owner: { id: "owner-a", kind: "agent" },
    sessionId: "session-a",
    mode: "self-driven",
    nonce: "nonce-0",
    planningRevision: H1,
    baselineGitRevision: "base-rev",
    workspaceFingerprint: H2,
    policy: {
      requireCleanReview: true,
      requireCliPass: true,
      requireCleanWorktreeForCommit: true,
      requirePush: false,
    },
    limits: { maxGroups: 3, maxAttemptsPerGroup: 3, maxEvents: 100 },
    groups: [
      { id: "group-1", taskGroupFingerprint: H2 },
      { id: "group-2", taskGroupFingerprint: H3 },
    ],
    startedAt: T0,
  });
}

function completedState(): LoopStateV2 {
  const value = state();
  for (const group of Object.values(value.groups)) {
    group.status = "completed";
    group.attempt = 1;
    group.bundle = {
      status: "approved",
      bundleId: `bundle-${group.id}`,
      bundleHash: H1,
      artifactHash: H2,
      evidenceHash: H2,
      reviewHash: H3,
      observedGitRevision: "observed",
      workspaceFingerprint: H2,
    };
    group.push = { status: "not_required", remoteRevision: null };
    group.commit = { status: "acknowledged", revision: "commit", tree: "tree", workspaceFingerprint: H2 };
    group.completedAt = T1;
  }
  value.phase = "awaiting_finalize";
  value.currentGroupId = null;
  value.currentAttempt = 0;
  value.updatedAt = T1;
  return value;
}

function bindBundle(value: LoopStateV2, status: "submitted" | "approved" | "rejected"): void {
  value.groups["group-1"]!.bundle = {
    status,
    bundleId: "bundle-1",
    bundleHash: H1,
    artifactHash: H2,
    evidenceHash: status === "submitted" ? null : H2,
    reviewHash: status === "submitted" ? null : H3,
    observedGitRevision: "observed",
    workspaceFingerprint: H2,
  };
}

function mutate(change: (draft: any) => void): LoopStateV2 {
  const draft = structuredClone(state());
  change(draft);
  return draft;
}

function common(type: LoopEventV2["type"]): Record<string, unknown> {
  return {
    schemaVersion: 2,
    type,
    runId: "run-a",
    seq: 1,
    expectedStateRevision: 0,
    expectedNonce: "nonce-0",
    nextNonce: "nonce-1",
    occurredAt: T1,
    actor: { id: "owner-a", kind: "agent" },
  };
}

function events(): LoopEventV2[] {
  const initial = state();
  return [
    createRunInitializedEventV2(initial),
    {
      ...common("bundle_submitted"),
      type: "bundle_submitted",
      groupId: "group-1",
      attempt: 1,
      bundleId: "bundle-1",
      bundleHash: H1,
      artifactHash: H2,
      observedGitRevision: "observed",
      workspaceFingerprint: H2,
    } as LoopEventV2,
    {
      ...common("evaluation_completed"),
      type: "evaluation_completed",
      groupId: "group-1",
      attempt: 1,
      result: "pass",
      evidenceHash: H2,
      reviewHash: H3,
      reviewClean: true,
      reason: null,
    } as LoopEventV2,
    {
      ...common("group_commit_acknowledged"),
      type: "group_commit_acknowledged",
      groupId: "group-1",
      attempt: 1,
      commitRevision: "commit",
      commitTree: "tree",
      workspaceFingerprint: H2,
      pushStatus: "not_required",
      remoteRevision: null,
    } as LoopEventV2,
    { ...common("run_finalized"), type: "run_finalized", finalGitRevision: "final", workspaceFingerprint: H3 } as LoopEventV2,
    { ...common("run_invalidated"), type: "run_invalidated", reason: REASON } as LoopEventV2,
    { ...common("run_blocked"), type: "run_blocked", terminalPhase: "circuit_breaker", reason: REASON } as LoopEventV2,
    {
      ...common("run_resumed"),
      type: "run_resumed",
      sessionId: "new-session",
      targetPhase: "fixing",
      maxAttemptsPerGroup: 4,
    } as LoopEventV2,
  ];
}

describe("LoopStateV2 contract", () => {
  it("accepts every exact active and terminal phase shape", () => {
    for (const phase of ACTIVE_PHASES_V2) {
      const candidate = state();
      candidate.phase = phase;
      if (phase === "awaiting_evaluation") bindBundle(candidate, "submitted");
      if (phase === "fixing") candidate.blockedReason = REASON;
      if (phase === "awaiting_group_commit") {
        candidate.groups["group-1"]!.status = "awaiting_commit";
        bindBundle(candidate, "approved");
      }
      if (phase === "awaiting_finalize") {
        Object.assign(candidate, completedState());
      }
      expect(validateLoopStateV2(candidate), phase).toEqual({ valid: true, errors: [] });
      expect(isActiveLoopPhaseV2(phase)).toBe(true);
      expect(isTerminalLoopPhaseV2(phase)).toBe(false);
    }

    for (const phase of TERMINAL_PHASES_V2) {
      const candidate = phase === "done" ? completedState() : state();
      candidate.phase = phase;
      candidate.updatedAt = T1;
      candidate.completedAt = T1;
      if (phase === "done") candidate.git.finalRevision = "final";
      else candidate.blockedReason = REASON;
      if (phase === "verification_failed" || phase === "review_failed") {
        candidate.groups["group-1"]!.status = "failed";
        bindBundle(candidate, "rejected");
      }
      if (phase === "invalidated") candidate.groups["group-1"]!.status = "invalidated";
      expect(validateLoopStateV2(candidate), phase).toEqual({ valid: true, errors: [] });
      expect(isTerminalLoopPhaseV2(phase)).toBe(true);
      expect(isActiveLoopPhaseV2(phase)).toBe(false);
    }
    expect(isActiveLoopPhaseV2(3)).toBe(false);
    expect(isTerminalLoopPhaseV2("future")).toBe(false);
  });

  it("rejects every malformed top-level field", () => {
    const cases: Array<[string, unknown]> = [
      ["object", null],
      ["schema", mutate((x) => { x.schemaVersion = 3; })],
      ["change", mutate((x) => { x.changeName = " "; })],
      ["run", mutate((x) => { x.runId = ""; })],
      ["session", mutate((x) => { x.sessionId = 4; })],
      ["nonce", mutate((x) => { x.nonce = ""; })],
      ["supersedes blank", mutate((x) => { x.supersedesRunId = ""; })],
      ["supersedes self", mutate((x) => { x.supersedesRunId = x.runId; })],
      ["owner object", mutate((x) => { x.owner = null; })],
      ["owner id", mutate((x) => { x.owner.id = ""; })],
      ["owner kind", mutate((x) => { x.owner.kind = "robot"; })],
      ["mode", mutate((x) => { x.mode = "manual"; })],
      ["revision", mutate((x) => { x.stateRevision = -1; })],
      ["seq", mutate((x) => { x.lastEventSeq = -1; })],
      ["revision mismatch", mutate((x) => { x.stateRevision = 1; })],
      ["phase", mutate((x) => { x.phase = "init"; })],
      ["group id", mutate((x) => { x.currentGroupId = ""; })],
      ["attempt", mutate((x) => { x.currentAttempt = -1; })],
      ["policy object", mutate((x) => { x.policy = null; })],
      ["policy bool", mutate((x) => { x.policy.requirePush = "yes"; })],
      ["clean review", mutate((x) => { x.policy.requireCleanReview = false; })],
      ["cli pass", mutate((x) => { x.policy.requireCliPass = false; })],
      ["limits object", mutate((x) => { x.limits = []; })],
      ["limits positive", mutate((x) => { x.limits.maxEvents = 0; })],
      ["reason object", mutate((x) => { x.blockedReason = "why"; })],
      ["reason code", mutate((x) => { x.blockedReason = { code: "x", message: "x", details: {} }; })],
      ["reason message", mutate((x) => { x.blockedReason = { code: "manual", message: "", details: {} }; })],
      ["reason details", mutate((x) => { x.blockedReason = { code: "manual", message: "x", details: [] }; })],
      ["plan hash", mutate((x) => { x.planningRevision = "md5:x"; })],
      ["git object", mutate((x) => { x.git = null; })],
      ["git base", mutate((x) => { x.git.baselineRevision = ""; })],
      ["git final", mutate((x) => { x.git.finalRevision = ""; })],
      ["git fingerprint", mutate((x) => { x.git.workspaceFingerprint = "x"; })],
      ["start time", mutate((x) => { x.startedAt = "today"; })],
      ["update time", mutate((x) => { x.updatedAt = "today"; })],
      ["completed time", mutate((x) => { x.completedAt = "today"; })],
      ["time ordering", mutate((x) => { x.startedAt = T1; x.updatedAt = T0; })],
    ];
    for (const [label, candidate] of cases) {
      expect(validateLoopStateV2(candidate).valid, label).toBe(false);
    }
  });

  it("rejects malformed group bundle, push, and commit fields", () => {
    const cases: Array<[string, LoopStateV2]> = [
      ["group object", mutate((x) => { x.groups["group-1"] = null; })],
      ["group id", mutate((x) => { x.groups["group-1"].id = "other"; })],
      ["ordinal", mutate((x) => { x.groups["group-1"].ordinal = 0; })],
      ["status", mutate((x) => { x.groups["group-1"].status = "running"; })],
      ["fingerprint", mutate((x) => { x.groups["group-1"].taskGroupFingerprint = "x"; })],
      ["attempt", mutate((x) => { x.groups["group-1"].attempt = -1; })],
      ["completedAt", mutate((x) => { x.groups["group-1"].completedAt = "soon"; })],
      ["bundle object", mutate((x) => { x.groups["group-1"].bundle = null; })],
      ["bundle status", mutate((x) => { x.groups["group-1"].bundle.status = "ready"; })],
      ["bundle hash", mutate((x) => { x.groups["group-1"].bundle.bundleHash = "x"; })],
      ["bundle id", mutate((x) => { x.groups["group-1"].bundle.bundleId = ""; })],
      ["none retains", mutate((x) => { x.groups["group-1"].bundle.bundleId = "retained"; })],
      ["submitted incomplete", mutate((x) => { x.groups["group-1"].bundle.status = "submitted"; })],
      ["approved incomplete", mutate((x) => {
        const b = x.groups["group-1"].bundle;
        Object.assign(b, { status: "approved", bundleId: "b", bundleHash: H1, artifactHash: H2, observedGitRevision: "r", workspaceFingerprint: H2 });
      })],
      ["push object", mutate((x) => { x.groups["group-1"].push = null; })],
      ["push status", mutate((x) => { x.groups["group-1"].push.status = "sent"; })],
      ["push remote type", mutate((x) => { x.groups["group-1"].push.remoteRevision = 1; })],
      ["pushed missing", mutate((x) => { x.groups["group-1"].push.status = "pushed"; })],
      ["pending retained", mutate((x) => { x.groups["group-1"].push.remoteRevision = "r"; })],
      ["commit object", mutate((x) => { x.groups["group-1"].commit = null; })],
      ["commit status", mutate((x) => { x.groups["group-1"].commit.status = "done"; })],
      ["commit revision", mutate((x) => { x.groups["group-1"].commit.revision = 1; })],
      ["commit fingerprint", mutate((x) => { x.groups["group-1"].commit.workspaceFingerprint = "x"; })],
      ["ack missing", mutate((x) => { x.groups["group-1"].commit.status = "acknowledged"; })],
      ["pending retains", mutate((x) => {
        Object.assign(x.groups["group-1"].commit, { revision: "r", tree: "t", workspaceFingerprint: H2 });
      })],
    ];
    for (const [label, candidate] of cases) expect(validateLoopStateV2(candidate).valid, label).toBe(false);
  });

  it("rejects group identifiers that are unsafe as portable path segments", () => {
    for (const unsafeId of ["../escape", "/absolute", "C:\\escape", "CON", "group.", "group name"]) {
      const candidate = state();
      const group = candidate.groups["group-1"]!;
      delete candidate.groups["group-1"];
      group.id = unsafeId;
      candidate.groups[unsafeId] = group;
      candidate.currentGroupId = unsafeId;

      expect(validateLoopStateV2(candidate).valid, unsafeId).toBe(false);
    }
  });

  it("enforces cross-field group, phase, attempt, completion, and git invariants", () => {
    const cases: Array<[string, LoopStateV2]> = [
      ["empty groups", mutate((x) => { x.groups = {}; })],
      ["max groups", mutate((x) => { x.limits.maxGroups = 1; })],
      ["ordinals", mutate((x) => { x.groups["group-2"].ordinal = 1; })],
      ["attempt ceiling", mutate((x) => { x.groups["group-1"].attempt = 4; x.currentAttempt = 4; })],
      ["unknown current", mutate((x) => { x.currentGroupId = "missing"; })],
      ["null attempt", mutate((x) => { x.currentGroupId = null; })],
      ["attempt mismatch", mutate((x) => { x.currentAttempt = 2; })],
      ["active complete time", mutate((x) => { x.completedAt = T1; })],
      ["active no group", mutate((x) => { x.currentGroupId = null; x.currentAttempt = 0; })],
      ["wrong phase status", mutate((x) => { x.phase = "awaiting_group_commit"; })],
      ["pending attempted", mutate((x) => { x.groups["group-2"].attempt = 1; })],
      ["finalize current", mutate((x) => { x.phase = "awaiting_finalize"; })],
      ["terminal no timestamp", mutate((x) => { x.phase = "circuit_breaker"; x.blockedReason = REASON; })],
      ["terminal time mismatch", mutate((x) => { x.phase = "circuit_breaker"; x.blockedReason = REASON; x.completedAt = T0; x.updatedAt = T1; })],
      ["terminal no reason", mutate((x) => { x.phase = "circuit_breaker"; x.completedAt = x.updatedAt; })],
      ["non-done final", mutate((x) => { x.git.finalRevision = "final"; })],
      ["done no final", (() => { const x = completedState(); x.phase = "done"; x.completedAt = x.updatedAt; return x; })()],
      ["done reason", (() => { const x = completedState(); x.phase = "done"; x.completedAt = x.updatedAt; x.git.finalRevision = "final"; x.blockedReason = REASON; return x; })()],
      ["completed incomplete", (() => { const x = completedState(); x.groups["group-1"]!.bundle.status = "rejected"; return x; })()],
      ["completed push", (() => { const x = completedState(); x.policy.requirePush = true; return x; })()],
    ];
    for (const [label, candidate] of cases) expect(validateLoopStateV2(candidate).valid, label).toBe(false);
    expect(() => assertLoopStateV2(cases[0]![1])).toThrow(RunContractValidationErrorV2);
  });
});

describe("LoopEventV2 and durable record contracts", () => {
  it("accepts every event variant and all resume targets", () => {
    for (const event of events()) {
      expect(validateLoopEventV2(event), event.type).toEqual({ valid: true, errors: [] });
      expect(() => assertLoopEventV2(event)).not.toThrow();
    }
    for (const targetPhase of [
      "awaiting_group_result",
      "awaiting_evaluation",
      "fixing",
      "awaiting_group_commit",
      "awaiting_finalize",
    ] as const) {
      const resume = { ...events().at(-1)!, targetPhase };
      expect(validateLoopEventV2(resume), targetPhase).toEqual({ valid: true, errors: [] });
    }
  });

  it("rejects malformed common and event-specific fields", () => {
    const valid = events();
    const bad = (index: number, change: (draft: any) => void): unknown => {
      const draft = structuredClone(valid[index]);
      change(draft);
      return draft;
    };
    const cases: Array<[string, unknown]> = [
      ["object", []],
      ["schema", bad(1, (x) => { x.schemaVersion = 1; })],
      ["type", bad(1, (x) => { x.type = "unknown"; })],
      ["run", bad(1, (x) => { x.runId = ""; })],
      ["seq", bad(1, (x) => { x.seq = -1; })],
      ["revision", bad(1, (x) => { x.expectedStateRevision = -2; })],
      ["nonce", bad(1, (x) => { x.expectedNonce = ""; })],
      ["same nonce", bad(1, (x) => { x.nextNonce = x.expectedNonce; })],
      ["time", bad(1, (x) => { x.occurredAt = "now"; })],
      ["actor", bad(1, (x) => { x.actor = null; })],
      ["actor id", bad(1, (x) => { x.actor.id = ""; })],
      ["actor kind", bad(1, (x) => { x.actor.kind = "robot"; })],
      ["init metadata", bad(0, (x) => { x.seq = 1; })],
      ["init state", bad(0, (x) => { x.initialState.schemaVersion = 3; })],
      ["non-init revision", bad(1, (x) => { x.expectedStateRevision = -1; x.expectedNonce = null; })],
      ["bundle strings", bad(1, (x) => { x.groupId = ""; })],
      ["bundle attempt", bad(1, (x) => { x.attempt = 0; })],
      ["bundle hashes", bad(1, (x) => { x.bundleHash = "x"; })],
      ["evaluation group", bad(2, (x) => { x.groupId = ""; })],
      ["evaluation attempt", bad(2, (x) => { x.attempt = 0; })],
      ["evaluation result", bad(2, (x) => { x.result = "warning"; })],
      ["evaluation hashes", bad(2, (x) => { x.evidenceHash = "x"; })],
      ["review bool", bad(2, (x) => { x.reviewClean = "yes"; })],
      ["dirty pass", bad(2, (x) => { x.reviewClean = false; })],
      ["pass reason", bad(2, (x) => { x.reason = REASON; })],
      ["fail reason", bad(2, (x) => { x.result = "review_failed"; })],
      ["verification reason code", bad(2, (x) => {
        x.result = "verification_failed";
        x.reason = { code: "review_findings", message: "wrong", details: {} };
      })],
      ["review reason code", bad(2, (x) => {
        x.result = "review_failed";
        x.reason = { code: "verification_failed", message: "wrong", details: {} };
      })],
      ["commit strings", bad(3, (x) => { x.commitTree = ""; })],
      ["commit attempt", bad(3, (x) => { x.attempt = 0; })],
      ["commit hash", bad(3, (x) => { x.workspaceFingerprint = "x"; })],
      ["commit push", bad(3, (x) => { x.pushStatus = "pending"; })],
      ["push remote", bad(3, (x) => { x.pushStatus = "pushed"; })],
      ["not-required remote", bad(3, (x) => { x.remoteRevision = "r"; })],
      ["final revision", bad(4, (x) => { x.finalGitRevision = ""; })],
      ["final hash", bad(4, (x) => { x.workspaceFingerprint = "x"; })],
      ["invalidate reason", bad(5, (x) => { x.reason = null; })],
      ["block phase", bad(6, (x) => { x.terminalPhase = "done"; })],
      ["block reason", bad(6, (x) => { x.reason = null; })],
      ["resume session", bad(7, (x) => { x.sessionId = ""; })],
      ["resume target", bad(7, (x) => { x.targetPhase = "done"; })],
      ["resume limit", bad(7, (x) => { x.maxAttemptsPerGroup = 0; })],
    ];
    for (const [label, candidate] of cases) expect(validateLoopEventV2(candidate).valid, label).toBe(false);
    expect(() => assertLoopEventV2(cases[1]![1])).toThrow(RunContractValidationErrorV2);
  });

  it("rejects unsafe group identifiers in every group-scoped event", () => {
    const valid = events();
    for (const eventIndex of [1, 2, 3]) {
      for (const unsafeId of ["../escape", "/absolute", "C:\\escape", "NUL.txt", "group.", "group name"]) {
        const candidate = structuredClone(valid[eventIndex]) as Record<string, unknown>;
        candidate["groupId"] = unsafeId;
        expect(validateLoopEventV2(candidate).valid, `${eventIndex}:${unsafeId}`).toBe(false);
      }
    }
  });

  it("binds event records to their exact post-state", () => {
    const initial = state();
    const event = createRunInitializedEventV2(initial);
    const record = reduceLoopEventV2(null, event);
    expect(validateLoopEventRecordV2(record)).toEqual({ valid: true, errors: [] });
    expect(() => assertLoopEventRecordV2(record)).not.toThrow();

    const mutations: Array<[string, (draft: any) => void]> = [
      ["record schema", (x) => { x.schemaVersion = 1; }],
      ["event", (x) => { x.event = null; }],
      ["state", (x) => { x.postState = null; }],
      ["run", (x) => { x.postState.runId = "other"; }],
      ["seq", (x) => { x.postState.lastEventSeq = 1; x.postState.stateRevision = 1; }],
      ["nonce", (x) => { x.postState.nonce = "other"; }],
      ["time", (x) => { x.postState.updatedAt = T1; }],
      ["revision", (x) => { x.event.expectedStateRevision = 0; }],
      ["initial identity", (x) => { x.event.initialState.runId = "other"; }],
    ];
    for (const [label, change] of mutations) {
      const draft = structuredClone(record);
      change(draft);
      expect(validateLoopEventRecordV2(draft).valid, label).toBe(false);
    }
    expect(validateLoopEventRecordV2(1).valid).toBe(false);
    expect(() => assertLoopEventRecordV2({})).toThrow(RunContractValidationErrorV2);
  });
});
