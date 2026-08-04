import { describe, expect, it } from "vitest";
import {
  LoopSuccessorV2Error,
  createSuccessorRunV2,
  type CreateSuccessorRunV2Input,
} from "../src/lib/loop-successor-v2.js";
import {
  assertLoopStateV2,
  type ArtifactHashV2,
  type LoopGroupStateV2,
  type LoopStateV2,
} from "../src/lib/run-contract-v2.js";

const hash = (character: string): ArtifactHashV2 => `sha256:${character.repeat(64)}`;
const H1 = hash("1");
const H2 = hash("2");
const H3 = hash("3");
const H4 = hash("4");
const H5 = hash("5");
const OLD = "2026-04-01T00:00:00.000Z";
const NEW = "2026-04-02T00:00:00.000Z";

function approved(
  id: string,
  ordinal: number,
  fingerprint: ArtifactHashV2,
  requirePush = false,
): LoopGroupStateV2 {
  return {
    id,
    ordinal,
    status: "completed",
    taskGroupFingerprint: fingerprint,
    attempt: 1,
    bundle: {
      status: "approved",
      bundleId: `bundle-${id}`,
      bundleHash: H1,
      artifactHash: H2,
      evidenceHash: H3,
      reviewHash: H4,
      observedGitRevision: `observed-${id}`,
      workspaceFingerprint: H5,
    },
    push: requirePush
      ? { status: "pushed", remoteRevision: `remote-${id}` }
      : { status: "not_required", remoteRevision: null },
    commit: {
      status: "acknowledged",
      revision: `commit-${id}`,
      tree: `tree-${id}`,
      workspaceFingerprint: H5,
    },
    tracker: { status: "not_required", marker: null },
    completedAt: OLD,
  };
}

function incomplete(
  id: string,
  ordinal: number,
  fingerprint: ArtifactHashV2,
  requirePush = false,
): LoopGroupStateV2 {
  return {
    id,
    ordinal,
    status: "invalidated",
    taskGroupFingerprint: fingerprint,
    attempt: 1,
    bundle: {
      status: "none",
      bundleId: null,
      bundleHash: null,
      artifactHash: null,
      evidenceHash: null,
      reviewHash: null,
      observedGitRevision: null,
      workspaceFingerprint: null,
    },
    push: requirePush
      ? { status: "pending", remoteRevision: null }
      : { status: "not_required", remoteRevision: null },
    commit: { status: "pending", revision: null, tree: null, workspaceFingerprint: null },
    tracker: { status: "not_required", marker: null },
    completedAt: null,
  };
}

function previous(requirePush = false): LoopStateV2 {
  return {
    schemaVersion: 2,
    changeName: "change-a",
    runId: "run-old",
    supersedesRunId: null,
    owner: { id: "old-owner", kind: "agent" },
    sessionId: "old-session",
    mode: "self-driven",
    stateRevision: 4,
    nonce: "old-nonce",
    lastEventSeq: 4,
    phase: "invalidated",
    currentGroupId: "TG-3",
    currentAttempt: 1,
    policy: {
      requireCleanReview: true,
      requireCliPass: true,
      requireCleanWorktreeForCommit: true,
      requirePush,
    },
    limits: { maxGroups: 3, maxAttemptsPerGroup: 3, maxEvents: 100 },
    blockedReason: {
      code: "planning_invalidated",
      message: "Planning changed",
      details: {},
    },
    planningRevision: H1,
    git: { baselineRevision: "old-base", finalRevision: null, workspaceFingerprint: H2 },
    tracking: { binding: null },
    groups: {
      "TG-1": approved("TG-1", 1, H1, requirePush),
      "TG-2": approved("TG-2", 2, H2, requirePush),
      "TG-3": incomplete("TG-3", 3, H3, requirePush),
    },
    startedAt: "2026-03-01T00:00:00.000Z",
    updatedAt: OLD,
    completedAt: OLD,
  };
}

function input(
  old: LoopStateV2,
  groups: CreateSuccessorRunV2Input["groups"],
): CreateSuccessorRunV2Input {
  return {
    previousState: old,
    runId: "run-new",
    sessionId: "new-session",
    owner: { id: "new-owner", kind: "human" },
    nonce: "new-nonce",
    startedAt: NEW,
    planningRevision: H5,
    baselineGitRevision: "new-base",
    workspaceFingerprint: H4,
    groups,
  };
}

function doneState(): LoopStateV2 {
  const state = previous();
  state.phase = "done";
  state.currentGroupId = null;
  state.currentAttempt = 0;
  state.blockedReason = null;
  state.git.finalRevision = "old-final";
  state.groups["TG-3"] = approved("TG-3", 3, H3);
  return state;
}

describe("createSuccessorRunV2", () => {
  it("reuses only unchanged approved+committed groups and dispatches the first gap", () => {
    const old = previous();
    const oldSnapshot = structuredClone(old);
    const result = createSuccessorRunV2(input(old, [
      { id: "TG-1", taskGroupFingerprint: H1 },
      { id: "TG-2", taskGroupFingerprint: H4 },
      { id: "TG-4", taskGroupFingerprint: H5 },
    ]));

    expect(result.reusableEvidenceGroups).toEqual(["TG-1"]);
    expect(result.state).toMatchObject({
      runId: "run-new",
      supersedesRunId: "run-old",
      owner: { id: "new-owner", kind: "human" },
      sessionId: "new-session",
      mode: "self-driven",
      stateRevision: 0,
      lastEventSeq: 0,
      nonce: "new-nonce",
      phase: "awaiting_group_result",
      currentGroupId: "TG-2",
      currentAttempt: 1,
      planningRevision: H5,
      git: { baselineRevision: "new-base", finalRevision: null, workspaceFingerprint: H4 },
    });
    expect(result.state.groups["TG-1"]).toEqual({
      ...old.groups["TG-1"],
      ordinal: 1,
    });
    expect(result.state.groups["TG-2"]).toMatchObject({
      ordinal: 2,
      status: "in_progress",
      attempt: 1,
      bundle: { status: "none" },
      commit: { status: "pending" },
    });
    expect(result.state.groups["TG-4"]).toMatchObject({
      ordinal: 3,
      status: "pending",
      attempt: 0,
    });
    expect(result.state.groups["TG-3"]).toBeUndefined();
    expect(old).toEqual(oldSnapshot);
    expect(() => assertLoopStateV2(result.state)).not.toThrow();
  });

  it("reruns the full suffix after the first changed group", () => {
    const result = createSuccessorRunV2(input(previous(), [
      { id: "TG-1", taskGroupFingerprint: H4 },
      // TG-2 is unchanged but cannot safely reuse across the changed TG-1 prefix.
      { id: "TG-2", taskGroupFingerprint: H2 },
    ]));
    expect(result.reusableEvidenceGroups).toEqual([]);
    expect(result.state).toMatchObject({
      phase: "awaiting_group_result",
      currentGroupId: "TG-1",
      currentAttempt: 1,
      groups: {
        "TG-1": { status: "in_progress", attempt: 1 },
        "TG-2": { status: "pending", attempt: 0 },
      },
    });

    const missingPrefix = createSuccessorRunV2(input(previous(), [
      { id: "TG-2", taskGroupFingerprint: H2 },
    ]));
    expect(missingPrefix.reusableEvidenceGroups).toEqual([]);
    expect(missingPrefix.state.groups["TG-2"]).toMatchObject({
      ordinal: 1,
      status: "in_progress",
    });
  });

  it("enters awaiting_finalize when every current group is reusable", () => {
    const old = doneState();
    const result = createSuccessorRunV2(input(old, [
      { id: "TG-1", taskGroupFingerprint: H1 },
      { id: "TG-2", taskGroupFingerprint: H2 },
      { id: "TG-3", taskGroupFingerprint: H3 },
    ]));
    expect(result.reusableEvidenceGroups).toEqual(["TG-1", "TG-2", "TG-3"]);
    expect(result.state).toMatchObject({
      phase: "awaiting_finalize",
      currentGroupId: null,
      currentAttempt: 0,
      completedAt: null,
      git: { finalRevision: null },
    });
    expect(Object.values(result.state.groups).every((group) => group.status === "completed"))
      .toBe(true);
  });

  it("expands maxGroups and safely inherits attempt/event policy limits", () => {
    const old = previous();
    old.limits.maxGroups = 3;
    old.limits.maxAttemptsPerGroup = 7;
    old.limits.maxEvents = 999;
    const result = createSuccessorRunV2(input(old, [
      { id: "TG-1", taskGroupFingerprint: H1 },
      { id: "TG-2", taskGroupFingerprint: H2 },
      { id: "TG-3", taskGroupFingerprint: H3 },
      { id: "TG-4", taskGroupFingerprint: H4 },
      { id: "TG-5", taskGroupFingerprint: H5 },
    ]));
    expect(result.state.limits).toEqual({
      maxGroups: 5,
      maxAttemptsPerGroup: 7,
      maxEvents: 999,
    });
    expect(result.state.policy).toEqual(old.policy);
    expect(result.state.currentGroupId).toBe("TG-3");
  });

  it("preserves pushed approvals and initializes fresh groups as push-pending", () => {
    const old = previous(true);
    const result = createSuccessorRunV2(input(old, [
      { id: "TG-1", taskGroupFingerprint: H1 },
      { id: "TG-2", taskGroupFingerprint: H4 },
    ]));
    expect(result.state.groups["TG-1"]!.push).toEqual({
      status: "pushed",
      remoteRevision: "remote-TG-1",
    });
    expect(result.state.groups["TG-2"]!.push).toEqual({
      status: "pending",
      remoteRevision: null,
    });
  });

  it("does not reuse an approved bundle without a completed acknowledged group", () => {
    const old = previous();
    old.groups["TG-3"] = {
      ...approved("TG-3", 3, H3),
      status: "invalidated",
      commit: { status: "pending", revision: null, tree: null, workspaceFingerprint: null },
      completedAt: null,
    };
    expect(() => assertLoopStateV2(old)).not.toThrow();
    const result = createSuccessorRunV2(input(old, [
      { id: "TG-3", taskGroupFingerprint: H3 },
    ]));
    expect(result.reusableEvidenceGroups).toEqual([]);
    expect(result.state.groups["TG-3"]).toMatchObject({
      status: "in_progress",
      bundle: { status: "none" },
      commit: { status: "pending" },
    });
  });

  it("rejects invalid, active, and malformed successor inputs", () => {
    const invalid = previous() as LoopStateV2 & { schemaVersion: number };
    invalid.schemaVersion = 9;
    expect(() => createSuccessorRunV2(input(invalid, [
      { id: "TG-1", taskGroupFingerprint: H1 },
    ]))).toThrowError(expect.objectContaining({ code: "invalid_previous_state" }));

    const active = previous();
    active.phase = "awaiting_group_result";
    active.completedAt = null;
    active.blockedReason = null;
    active.groups["TG-3"]!.status = "in_progress";
    expect(() => createSuccessorRunV2(input(active, [
      { id: "TG-1", taskGroupFingerprint: H1 },
    ]))).toThrowError(expect.objectContaining({ code: "previous_run_not_terminal" }));

    const old = previous();
    expect(() => createSuccessorRunV2(input(old, [])))
      .toThrowError(expect.objectContaining({ code: "invalid_successor_groups" }));
    expect(() => createSuccessorRunV2(input(old, [
      { id: "TG-1", taskGroupFingerprint: H1 },
      { id: "TG-1", taskGroupFingerprint: H2 },
    ]))).toThrowError(expect.objectContaining({ code: "invalid_successor_groups" }));
    expect(() => createSuccessorRunV2({
      ...input(old, [{ id: "TG-1", taskGroupFingerprint: H1 }]),
      runId: old.runId,
    })).toThrowError(expect.objectContaining({ code: "invalid_successor_state" }));
  });
});
