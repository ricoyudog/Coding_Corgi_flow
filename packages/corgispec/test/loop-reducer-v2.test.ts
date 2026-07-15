import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type {
  ActiveLoopPhaseV2,
  ArtifactHashV2,
  BlockedReasonV2,
  LoopEventTypeV2,
  LoopEventV2,
  LoopPhaseV2,
  LoopStateV2,
} from "../src/lib/run-contract-v2.js";
import {
  ACTIVE_PHASES_V2,
  LOOP_EVENT_TYPES_V2,
  TERMINAL_PHASES_V2,
  validateLoopStateV2,
} from "../src/lib/run-contract-v2.js";
import {
  TRANSITION_MATRIX_V2,
  LoopReducerErrorV2,
  createInitialLoopStateV2,
  createRunInitializedEventV2,
  isEventAllowedInPhaseV2,
  isIdempotentEventReplayV2,
  reduceLoopEventV2,
  replayLoopEventsV2,
} from "../src/lib/loop-reducer-v2.js";

const hash = (char: string): ArtifactHashV2 => `sha256:${char.repeat(64)}` as ArtifactHashV2;
const PLAN = hash("1");
const WORKSPACE = hash("2");
const ARTIFACT = hash("3");
const BUNDLE = hash("4");
const EVIDENCE = hash("5");
const REVIEW = hash("6");
const START = "2026-02-01T00:00:00.000Z";
const FAIL_REASON: BlockedReasonV2 = {
  code: "verification_failed",
  message: "tests failed",
  details: { failed: 1 },
};
const REVIEW_REASON: BlockedReasonV2 = {
  code: "review_findings",
  message: "review found a blocker",
  details: {},
};

function initial(options: {
  mode?: "self-driven" | "hook-driven";
  attempts?: number;
  events?: number;
  groups?: number;
  requirePush?: boolean;
} = {}): LoopStateV2 {
  const count = options.groups ?? 2;
  return createInitialLoopStateV2({
    changeName: "change-a",
    runId: "run-a",
    supersedesRunId: null,
    owner: { id: "owner-a", kind: "agent" },
    sessionId: "session-a",
    mode: options.mode ?? "self-driven",
    nonce: "nonce-0",
    planningRevision: PLAN,
    baselineGitRevision: "baseline",
    workspaceFingerprint: WORKSPACE,
    policy: {
      requireCleanReview: true,
      requireCliPass: true,
      requireCleanWorktreeForCommit: true,
      requirePush: options.requirePush ?? false,
    },
    limits: {
      maxGroups: Math.max(count, 1),
      maxAttemptsPerGroup: options.attempts ?? 3,
      maxEvents: options.events ?? 100,
    },
    groups: Array.from({ length: count }, (_, index) => ({
      id: `group-${index + 1}`,
      taskGroupFingerprint: hash(String((index + 7) % 10)),
    })),
    startedAt: START,
  });
}

function time(seq: number): string {
  return new Date(Date.parse(START) + seq * 1_000).toISOString();
}

function meta(state: LoopStateV2, type: LoopEventTypeV2): Record<string, unknown> {
  const seq = state.lastEventSeq + 1;
  return {
    schemaVersion: 2,
    type,
    runId: state.runId,
    seq,
    expectedStateRevision: state.stateRevision,
    expectedNonce: state.nonce,
    nextNonce: `nonce-${seq}`,
    occurredAt: time(seq),
    actor: { id: "owner-a", kind: "agent" },
  };
}

function submit(state: LoopStateV2): Extract<LoopEventV2, { type: "bundle_submitted" }> {
  return {
    ...meta(state, "bundle_submitted"),
    type: "bundle_submitted",
    groupId: state.currentGroupId!,
    attempt: state.currentAttempt,
    bundleId: `${state.currentGroupId}-attempt-${state.currentAttempt}`,
    bundleHash: BUNDLE,
    artifactHash: ARTIFACT,
    observedGitRevision: `observed-${state.currentGroupId}`,
    workspaceFingerprint: WORKSPACE,
  } as Extract<LoopEventV2, { type: "bundle_submitted" }>;
}

function evaluate(
  state: LoopStateV2,
  result: "pass" | "verification_failed" | "review_failed" = "pass",
): Extract<LoopEventV2, { type: "evaluation_completed" }> {
  return {
    ...meta(state, "evaluation_completed"),
    type: "evaluation_completed",
    groupId: state.currentGroupId!,
    attempt: state.currentAttempt,
    result,
    evidenceHash: EVIDENCE,
    reviewHash: REVIEW,
    reviewClean: result === "pass",
    reason: result === "pass" ? null : result === "review_failed" ? REVIEW_REASON : FAIL_REASON,
  } as Extract<LoopEventV2, { type: "evaluation_completed" }>;
}

function acknowledge(state: LoopStateV2): Extract<LoopEventV2, { type: "group_commit_acknowledged" }> {
  const pushed = state.policy.requirePush;
  return {
    ...meta(state, "group_commit_acknowledged"),
    type: "group_commit_acknowledged",
    groupId: state.currentGroupId!,
    attempt: state.currentAttempt,
    commitRevision: `commit-${state.currentGroupId}`,
    commitTree: `tree-${state.currentGroupId}`,
    workspaceFingerprint: WORKSPACE,
    pushStatus: pushed ? "pushed" : "not_required",
    remoteRevision: pushed ? `remote-${state.currentGroupId}` : null,
  } as Extract<LoopEventV2, { type: "group_commit_acknowledged" }>;
}

function finalized(state: LoopStateV2): Extract<LoopEventV2, { type: "run_finalized" }> {
  return {
    ...meta(state, "run_finalized"),
    type: "run_finalized",
    finalGitRevision: "final-revision",
    workspaceFingerprint: WORKSPACE,
  } as Extract<LoopEventV2, { type: "run_finalized" }>;
}

function apply(state: LoopStateV2, event: LoopEventV2): LoopStateV2 {
  return reduceLoopEventV2(state, event).postState;
}

function interrupt(
  state: LoopStateV2,
  terminalPhase: "circuit_breaker" | "worktree_missing",
): LoopStateV2 {
  return apply(state, {
    ...meta(state, "run_blocked"),
    type: "run_blocked",
    terminalPhase,
    reason: terminalPhase === "circuit_breaker"
      ? { code: "circuit_breaker", message: "event limit", details: {} }
      : { code: "worktree_missing", message: "worktree disappeared", details: {} },
  } as Extract<LoopEventV2, { type: "run_blocked" }>);
}

function resumeInterrupted(
  state: LoopStateV2,
  targetPhase: ActiveLoopPhaseV2,
): LoopStateV2 {
  return apply(state, {
    ...meta(state, "run_resumed"),
    type: "run_resumed",
    sessionId: "restored-session",
    targetPhase,
    maxAttemptsPerGroup: state.limits.maxAttemptsPerGroup,
  } as Extract<LoopEventV2, { type: "run_resumed" }>);
}

function passAndCommit(state: LoopStateV2, events?: LoopEventV2[]): LoopStateV2 {
  let nextEvent: LoopEventV2 = submit(state);
  events?.push(nextEvent);
  state = apply(state, nextEvent);
  nextEvent = evaluate(state);
  events?.push(nextEvent);
  state = apply(state, nextEvent);
  nextEvent = acknowledge(state);
  events?.push(nextEvent);
  return apply(state, nextEvent);
}

describe("LoopStateV2 reducer", () => {
  it("initializes through a durable event without sharing mutable state", () => {
    const source = initial();
    const event = createRunInitializedEventV2(source);
    const record = reduceLoopEventV2(null, event);
    expect(record.postState).toEqual(source);
    expect(record.postState).not.toBe(source);
    record.postState.owner.id = "changed";
    expect(source.owner.id).toBe("owner-a");

    expect(() => reduceLoopEventV2(null, submit(source))).toThrow(expect.objectContaining({ code: "initialization_conflict" }));
    expect(() => reduceLoopEventV2(source, event)).toThrow(expect.objectContaining({ code: "initialization_conflict" }));
    const badActor = structuredClone(event);
    badActor.actor.id = "someone-else";
    expect(() => reduceLoopEventV2(null, badActor)).toThrow(expect.objectContaining({ code: "initialization_conflict" }));
  });

  it("runs every group through submit, clean evaluation, commit, and finalize", () => {
    const original = initial({ requirePush: true });
    let state = original;
    const stream: LoopEventV2[] = [createRunInitializedEventV2(state)];

    const firstSubmit = submit(state);
    state = apply(state, firstSubmit);
    stream.push(firstSubmit);
    expect(state.phase).toBe("awaiting_evaluation");
    expect(state.groups["group-1"]!.bundle.status).toBe("submitted");
    expect(original.phase).toBe("awaiting_group_result");

    const firstEvaluation = evaluate(state);
    state = apply(state, firstEvaluation);
    stream.push(firstEvaluation);
    expect(state.phase).toBe("awaiting_group_commit");
    expect(state.groups["group-1"]!.bundle).toMatchObject({
      status: "approved",
      evidenceHash: EVIDENCE,
      reviewHash: REVIEW,
    });

    const firstCommit = acknowledge(state);
    state = apply(state, firstCommit);
    stream.push(firstCommit);
    expect(state).toMatchObject({ phase: "awaiting_group_result", currentGroupId: "group-2", currentAttempt: 1 });
    expect(state.groups["group-1"]!).toMatchObject({
      status: "completed",
      push: { status: "pushed", remoteRevision: "remote-group-1" },
      commit: { status: "acknowledged", revision: "commit-group-1" },
    });

    state = passAndCommit(state, stream);
    expect(state).toMatchObject({ phase: "awaiting_finalize", currentGroupId: null, currentAttempt: 0 });
    const finalEvent = finalized(state);
    stream.push(finalEvent);
    state = apply(state, finalEvent);
    expect(state).toMatchObject({
      phase: "done",
      completedAt: state.updatedAt,
      git: { finalRevision: "final-revision" },
    });
    expect(validateLoopStateV2(state).valid).toBe(true);
    expect(replayLoopEventsV2(stream)).toEqual(state);
  });

  it("increments attempt and enters fixing only for self-driven runs with retry budget", () => {
    let state = initial({ attempts: 2 });
    state = apply(state, submit(state));
    state = apply(state, evaluate(state, "verification_failed"));
    expect(state).toMatchObject({ phase: "fixing", currentAttempt: 2, blockedReason: FAIL_REASON });
    expect(state.groups["group-1"]!).toMatchObject({ attempt: 2, status: "in_progress", bundle: { status: "none" } });

    state = apply(state, submit(state));
    state = apply(state, evaluate(state, "review_failed"));
    expect(state).toMatchObject({ phase: "review_failed", completedAt: state.updatedAt, blockedReason: REVIEW_REASON });
    expect(state.groups["group-1"]!.status).toBe("failed");

    let hooks = initial({ mode: "hook-driven", attempts: 5 });
    hooks = apply(hooks, submit(hooks));
    hooks = apply(hooks, evaluate(hooks, "verification_failed"));
    expect(hooks).toMatchObject({ phase: "verification_failed", currentAttempt: 1 });
  });

  it("requires a submitted bundle and a genuinely clean review", () => {
    const awaiting = structuredClone(initial());
    awaiting.phase = "awaiting_evaluation";
    expect(() => apply(awaiting, evaluate(awaiting))).toThrow(expect.objectContaining({ code: "invalid_state" }));

    const submitted = apply(initial(), submit(initial()));
    const dirtyPass = evaluate(submitted);
    dirtyPass.reviewClean = false;
    expect(() => apply(submitted, dirtyPass)).toThrow(expect.objectContaining({ code: "invalid_event" }));

    const missingReason = evaluate(submitted, "review_failed");
    missingReason.reason = null;
    expect(() => apply(submitted, missingReason)).toThrow(expect.objectContaining({ code: "invalid_event" }));
  });

  it("rejects stale CAS, sequence, run, event-limit, group, and attempt tokens without mutation", () => {
    const source = initial();
    const valid = submit(source);
    const cases: Array<[string, (event: any) => void, string]> = [
      ["run", (x) => { x.runId = "other"; }, "run_mismatch"],
      ["revision", (x) => { x.expectedStateRevision = 1; }, "stale_revision"],
      ["nonce", (x) => { x.expectedNonce = "stale"; }, "stale_nonce"],
      ["sequence", (x) => { x.seq = 2; }, "sequence_mismatch"],
      ["timestamp", (x) => { x.occurredAt = "2025-01-01T00:00:00.000Z"; }, "timestamp_regression"],
      ["group", (x) => { x.groupId = "group-2"; }, "group_mismatch"],
      ["attempt", (x) => { x.attempt = 2; }, "attempt_mismatch"],
    ];
    for (const [label, change, code] of cases) {
      const event = structuredClone(valid);
      change(event);
      expect(() => apply(source, event), label).toThrow(expect.objectContaining({ code }));
      expect(source).toEqual(initial());
    }

    let limited = initial({ events: 1 });
    limited = apply(limited, submit(limited));
    expect(() => apply(limited, evaluate(limited))).toThrow(expect.objectContaining({ code: "event_limit" }));

    const invalidState = structuredClone(source);
    invalidState.schemaVersion = 1 as 2;
    expect(() => apply(invalidState, valid)).toThrow(expect.objectContaining({ code: "invalid_state" }));
    const invalidEvent = structuredClone(valid);
    invalidEvent.bundleHash = "bad" as ArtifactHashV2;
    expect(() => apply(source, invalidEvent)).toThrow(expect.objectContaining({ code: "invalid_event" }));
  });

  it("enforces commit fingerprint and push policy and advances only after ack", () => {
    let state = initial({ requirePush: true });
    state = apply(state, submit(state));
    state = apply(state, evaluate(state));
    const wrongFingerprint = acknowledge(state);
    wrongFingerprint.workspaceFingerprint = hash("9");
    expect(() => apply(state, wrongFingerprint)).toThrow(expect.objectContaining({ code: "bundle_mismatch" }));
    const wrongPush = acknowledge(state);
    wrongPush.pushStatus = "not_required";
    wrongPush.remoteRevision = null;
    expect(() => apply(state, wrongPush)).toThrow(expect.objectContaining({ code: "policy_violation" }));
  });

  it("invalidates, blocks, and explicitly resumes terminal states", () => {
    for (const terminalPhase of ["circuit_breaker", "corrupted", "worktree_missing"] as const) {
      const source = initial();
      const event = {
        ...meta(source, "run_blocked"),
        type: "run_blocked",
        terminalPhase,
        reason: { ...FAIL_REASON, code: terminalPhase === "corrupted" ? "corrupted_state" : terminalPhase },
      } as Extract<LoopEventV2, { type: "run_blocked" }>;
      const blocked = apply(source, event);
      expect(blocked).toMatchObject({ phase: terminalPhase, completedAt: blocked.updatedAt });
    }

    let failed = initial({ mode: "hook-driven" });
    failed = apply(failed, submit(failed));
    failed = apply(failed, evaluate(failed, "verification_failed"));
    const resume = {
      ...meta(failed, "run_resumed"),
      type: "run_resumed",
      sessionId: "new-session",
      targetPhase: "fixing",
      maxAttemptsPerGroup: 4,
    } as Extract<LoopEventV2, { type: "run_resumed" }>;
    const resumed = apply(failed, resume);
    expect(resumed).toMatchObject({
      phase: "fixing",
      sessionId: "new-session",
      currentAttempt: 2,
      completedAt: null,
      blockedReason: FAIL_REASON,
    });

    let pushFailure = initial({ mode: "hook-driven", requirePush: true });
    pushFailure = apply(pushFailure, submit(pushFailure));
    pushFailure = apply(pushFailure, evaluate(pushFailure, "verification_failed"));
    const redispatch = {
      ...meta(pushFailure, "run_resumed"),
      type: "run_resumed",
      sessionId: "push-session",
      targetPhase: "fixing",
      maxAttemptsPerGroup: 4,
    } as Extract<LoopEventV2, { type: "run_resumed" }>;
    expect(apply(pushFailure, redispatch)).toMatchObject({
      phase: "fixing",
      currentAttempt: 2,
      groups: { "group-1": { push: { status: "pending" } } },
    });

    const lowerLimit = { ...resume, maxAttemptsPerGroup: 2 };
    expect(() => apply(failed, lowerLimit)).toThrow(expect.objectContaining({ code: "policy_violation" }));
    const exhausted = structuredClone(failed);
    exhausted.groups["group-1"]!.attempt = 3;
    exhausted.currentAttempt = 3;
    expect(() => apply(exhausted, { ...resume, maxAttemptsPerGroup: 3 })).toThrow(expect.objectContaining({ code: "policy_violation" }));

    const invalidate = {
      ...meta(resumed, "run_invalidated"),
      type: "run_invalidated",
      reason: { code: "planning_invalidated", message: "plan changed", details: {} },
    } as Extract<LoopEventV2, { type: "run_invalidated" }>;
    expect(apply(resumed, invalidate)).toMatchObject({ phase: "invalidated", completedAt: time(invalidate.seq) });
  });

  it("restores every interrupted active phase without discarding its durable attempt", () => {
    const groupResult = initial();
    const awaitingEvaluation = apply(initial(), submit(initial()));
    const awaitingCommit = apply(awaitingEvaluation, evaluate(awaitingEvaluation));
    let fixing = initial({ attempts: 3 });
    fixing = apply(fixing, submit(fixing));
    fixing = apply(fixing, evaluate(fixing, "verification_failed"));

    const scenarios: Array<{
      source: LoopStateV2;
      target: ActiveLoopPhaseV2;
      terminal: "circuit_breaker" | "worktree_missing";
    }> = [
      { source: groupResult, target: "awaiting_group_result", terminal: "worktree_missing" },
      { source: awaitingEvaluation, target: "awaiting_evaluation", terminal: "circuit_breaker" },
      { source: awaitingCommit, target: "awaiting_group_commit", terminal: "worktree_missing" },
      { source: fixing, target: "fixing", terminal: "circuit_breaker" },
    ];

    for (const { source, target, terminal } of scenarios) {
      const originalGroup = structuredClone(source.groups[source.currentGroupId!]!);
      const originalAttempt = source.currentAttempt;
      const blocked = interrupt(source, terminal);
      const restored = resumeInterrupted(blocked, target);
      expect(restored.phase, target).toBe(target);
      expect(restored.currentAttempt, target).toBe(originalAttempt);
      expect(restored.groups[restored.currentGroupId!]!, target).toEqual(originalGroup);
      expect(restored.sessionId, target).toBe("restored-session");
      expect(restored.completedAt, target).toBeNull();
      expect(restored.blockedReason, target).toEqual(target === "fixing" ? blocked.blockedReason : null);
      expect(validateLoopStateV2(restored).valid, target).toBe(true);
    }
  });

  it("fails closed when a resume target contradicts the durable bundle phase", () => {
    const groupResult = interrupt(initial(), "worktree_missing");
    expect(() => resumeInterrupted(groupResult, "awaiting_evaluation"))
      .toThrow(expect.objectContaining({ code: "resume_target_mismatch" }));
    expect(() => resumeInterrupted(groupResult, "awaiting_group_commit"))
      .toThrow(expect.objectContaining({ code: "resume_target_mismatch" }));

    const submitted = apply(initial(), submit(initial()));
    const evaluation = interrupt(submitted, "circuit_breaker");
    expect(() => resumeInterrupted(evaluation, "awaiting_group_result"))
      .toThrow(expect.objectContaining({ code: "resume_target_mismatch" }));

    const approved = apply(submitted, evaluate(submitted));
    const commit = interrupt(approved, "worktree_missing");
    expect(() => resumeInterrupted(commit, "awaiting_evaluation"))
      .toThrow(expect.objectContaining({ code: "resume_target_mismatch" }));

    let failed = initial({ mode: "hook-driven" });
    failed = apply(failed, submit(failed));
    failed = apply(failed, evaluate(failed, "review_failed"));
    expect(() => resumeInterrupted(failed, "awaiting_group_result"))
      .toThrow(expect.objectContaining({ code: "resume_target_mismatch" }));
    expect(() => resumeInterrupted(failed, "awaiting_group_commit"))
      .toThrow(expect.objectContaining({ code: "resume_target_mismatch" }));
  });

  it("resumes an interrupted finalization and can invalidate an already done run", () => {
    let state = initial({ groups: 1 });
    state = passAndCommit(state);
    const blockedEvent = {
      ...meta(state, "run_blocked"),
      type: "run_blocked",
      terminalPhase: "worktree_missing",
      reason: { code: "worktree_missing", message: "gone", details: {} },
    } as Extract<LoopEventV2, { type: "run_blocked" }>;
    const blocked = apply(state, blockedEvent);
    const resume = {
      ...meta(blocked, "run_resumed"),
      type: "run_resumed",
      sessionId: "restored",
      targetPhase: "awaiting_finalize",
      maxAttemptsPerGroup: blocked.limits.maxAttemptsPerGroup,
    } as Extract<LoopEventV2, { type: "run_resumed" }>;
    state = apply(blocked, resume);
    expect(state).toMatchObject({ phase: "awaiting_finalize", completedAt: null });
    state = apply(state, finalized(state));
    const invalidate = {
      ...meta(state, "run_invalidated"),
      type: "run_invalidated",
      reason: { code: "planning_invalidated", message: "new plan", details: {} },
    } as Extract<LoopEventV2, { type: "run_invalidated" }>;
    const invalidated = apply(state, invalidate);
    expect(invalidated).toMatchObject({ phase: "invalidated", git: { finalRevision: "final-revision" } });

    let early = initial();
    early = apply(early, {
      ...meta(early, "run_blocked"),
      type: "run_blocked",
      terminalPhase: "worktree_missing",
      reason: { code: "worktree_missing", message: "gone", details: {} },
    } as Extract<LoopEventV2, { type: "run_blocked" }>);
    expect(() => apply(early, { ...resume, ...meta(early, "run_resumed") })).toThrow(expect.objectContaining({ code: "group_mismatch" }));
  });

  it("has an explicit phase × event transition scenario for every pair", () => {
    const expected: Record<LoopPhaseV2, readonly LoopEventTypeV2[]> = {
      awaiting_group_result: ["bundle_submitted", "run_invalidated", "run_blocked"],
      awaiting_evaluation: ["evaluation_completed", "run_invalidated", "run_blocked"],
      fixing: ["bundle_submitted", "run_invalidated", "run_blocked"],
      awaiting_group_commit: ["group_commit_acknowledged", "run_invalidated", "run_blocked"],
      awaiting_finalize: ["run_finalized", "run_invalidated", "run_blocked"],
      done: ["run_invalidated"],
      verification_failed: ["run_resumed", "run_invalidated"],
      review_failed: ["run_resumed", "run_invalidated"],
      circuit_breaker: ["run_resumed", "run_invalidated"],
      corrupted: [],
      worktree_missing: ["run_resumed", "run_invalidated"],
      invalidated: [],
    };
    let scenarios = 0;
    for (const phase of [...ACTIVE_PHASES_V2, ...TERMINAL_PHASES_V2]) {
      expect(TRANSITION_MATRIX_V2[phase]).toEqual(expected[phase]);
      for (const eventType of LOOP_EVENT_TYPES_V2) {
        scenarios++;
        expect(isEventAllowedInPhaseV2(phase, eventType), `${phase} × ${eventType}`)
          .toBe(expected[phase].includes(eventType));
      }
    }
    expect(scenarios).toBe((ACTIVE_PHASES_V2.length + TERMINAL_PHASES_V2.length) * LOOP_EVENT_TYPES_V2.length);

    const source = initial();
    expect(() => apply(source, finalized(source))).toThrow(expect.objectContaining({ code: "invalid_transition" }));
  });

  it("recognizes only exact idempotent retries of the latest committed token", () => {
    const source = initial();
    const event = submit(source);
    const record = reduceLoopEventV2(source, event);
    expect(isIdempotentEventReplayV2(record, structuredClone(event))).toBe(true);
    expect(isIdempotentEventReplayV2(record, { ...event, bundleId: "different-payload" })).toBe(false);
    const corruptRecord = structuredClone(record);
    corruptRecord.postState.nonce = "corrupt";
    expect(isIdempotentEventReplayV2(corruptRecord, event)).toBe(false);
    expect(isIdempotentEventReplayV2(record, createRunInitializedEventV2(source))).toBe(false);
    expect(() => replayLoopEventsV2([])).toThrow(LoopReducerErrorV2);
  });

  it("validates initialization limits, ids, and malformed inputs", () => {
    const base = {
      changeName: "x",
      runId: "r",
      owner: { id: "o", kind: "agent" as const },
      sessionId: "s",
      mode: "self-driven" as const,
      nonce: "n",
      planningRevision: PLAN,
      baselineGitRevision: "b",
      workspaceFingerprint: WORKSPACE,
      policy: { requireCleanReview: true, requireCliPass: true, requireCleanWorktreeForCommit: true, requirePush: false },
      limits: { maxGroups: 1, maxAttemptsPerGroup: 1, maxEvents: 10 },
      startedAt: START,
    };
    expect(() => createInitialLoopStateV2({ ...base, groups: [] })).toThrow(expect.objectContaining({ code: "invalid_state" }));
    expect(() => createInitialLoopStateV2({
      ...base,
      groups: [{ id: "a", taskGroupFingerprint: PLAN }, { id: "b", taskGroupFingerprint: PLAN }],
    })).toThrow(expect.objectContaining({ code: "invalid_state" }));
    expect(() => createInitialLoopStateV2({
      ...base,
      limits: { ...base.limits, maxGroups: 2 },
      groups: [{ id: "a", taskGroupFingerprint: PLAN }, { id: "a", taskGroupFingerprint: PLAN }],
    })).toThrow(expect.objectContaining({ code: "invalid_state" }));
    expect(() => createInitialLoopStateV2({
      ...base,
      groups: [{ id: "", taskGroupFingerprint: PLAN }],
    })).toThrow(expect.objectContaining({ code: "invalid_state" }));

    const nonInitial = initial();
    nonInitial.stateRevision = 1;
    nonInitial.lastEventSeq = 1;
    expect(() => createRunInitializedEventV2(nonInitial)).toThrow(expect.objectContaining({ code: "invalid_state" }));
  });
});

describe("property-based event sequences", () => {
  it("preserves attempt and bundle invariants across arbitrary interrupt/resume sources", () => {
    fc.assert(fc.property(
      fc.constantFrom(
        "awaiting_group_result" as const,
        "awaiting_evaluation" as const,
        "fixing" as const,
        "awaiting_group_commit" as const,
      ),
      fc.constantFrom("circuit_breaker" as const, "worktree_missing" as const),
      (target, terminal) => {
        let source = initial({ attempts: 3 });
        if (target === "awaiting_evaluation" || target === "awaiting_group_commit" || target === "fixing") {
          source = apply(source, submit(source));
        }
        if (target === "awaiting_group_commit") source = apply(source, evaluate(source));
        if (target === "fixing") source = apply(source, evaluate(source, "verification_failed"));
        const group = structuredClone(source.groups[source.currentGroupId!]!);
        const attempt = source.currentAttempt;

        const restored = resumeInterrupted(interrupt(source, terminal), target);

        expect(restored.currentAttempt).toBe(attempt);
        expect(restored.groups[restored.currentGroupId!]!).toEqual(group);
        expect(restored.phase).toBe(target);
        expect(validateLoopStateV2(restored).valid).toBe(true);
      },
    ), { numRuns: 100 });
  });

  it("keeps CAS tokens monotonic and replays arbitrary retry/pass sequences", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 4 }),
      fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 8 }),
      (groupCount, retries) => {
        let state = initial({ groups: groupCount, attempts: 4 });
        const stream: LoopEventV2[] = [createRunInitializedEventV2(state)];
        const nonces = new Set([state.nonce]);
        let priorRevision = state.stateRevision;
        for (let index = 0; index < groupCount; index++) {
          const failures = retries[index % retries.length]!;
          for (let failure = 0; failure < failures; failure++) {
            const submitEvent = submit(state);
            stream.push(submitEvent);
            state = apply(state, submitEvent);
            const failureEvent = evaluate(state, failure % 2 === 0 ? "verification_failed" : "review_failed");
            stream.push(failureEvent);
            state = apply(state, failureEvent);
            expect(state.phase).toBe("fixing");
          }
          state = passAndCommit(state, stream);
          expect(validateLoopStateV2(state).valid).toBe(true);
          expect(state.stateRevision).toBeGreaterThan(priorRevision);
          expect(state.stateRevision).toBe(state.lastEventSeq);
          expect(nonces.has(state.nonce)).toBe(false);
          nonces.add(state.nonce);
          priorRevision = state.stateRevision;
        }
        const finalEvent = finalized(state);
        stream.push(finalEvent);
        state = apply(state, finalEvent);
        expect(replayLoopEventsV2(stream)).toEqual(state);
        expect(state.stateRevision).toBe(stream.length - 1);
      },
    ), { numRuns: 100 });
  });

  it("rejects arbitrary stale revisions before changing the source", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10_000 }), (delta) => {
      const state = initial();
      const snapshot = structuredClone(state);
      const event = submit(state);
      event.expectedStateRevision += delta;
      expect(() => apply(state, event)).toThrow(expect.objectContaining({ code: "stale_revision" }));
      expect(state).toEqual(snapshot);
    }), { numRuns: 100 });
  });

  it("rejects arbitrary timestamp regressions before changing the source", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1_000_000 }), (milliseconds) => {
      const state = initial();
      const snapshot = structuredClone(state);
      const event = submit(state);
      event.occurredAt = new Date(Date.parse(state.updatedAt) - milliseconds).toISOString();
      expect(() => apply(state, event)).toThrow(expect.objectContaining({ code: "timestamp_regression" }));
      expect(state).toEqual(snapshot);
    }), { numRuns: 100 });
  });
});
