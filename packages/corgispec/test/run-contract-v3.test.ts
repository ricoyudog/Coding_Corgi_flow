import { describe, expect, it } from "vitest";

import {
  createInitialRunStateV3,
  createRunInitializedEventV3,
  eventBaseV3,
  reduceRunEventV3,
  type ArtifactHashV3,
  type CriterionEvidenceV3,
  type RunEventV3,
  type RunStateV3,
} from "../src/lib/run-contract-v3.js";

const hashes = [..."abcdef012"].map((letter) => `sha256:${letter.repeat(64)}` as ArtifactHashV3);

function initial(tracked = false): RunStateV3 {
  return createInitialRunStateV3({
    changeName: "change-a",
    runId: "run-a",
    owner: { id: "agent-a", kind: "agent" },
    sessionId: "session-a",
    nonce: "nonce-0",
    planningRevision: hashes[0]!,
    baselineRevision: "base",
    contract: {
      kind: "rfc-slice",
      deliveryRef: "RFC-0001-example/S-01-example",
      rfcId: "RFC-0001-example",
      rfcDigest: hashes[1]!,
      acceptedCommit: "accepted",
      sliceId: "S-01-example",
      sourcePath: "openspec/changes/change-a/corgi/source.yaml",
      sourceDigest: hashes[2]!,
      traceabilityPath: "openspec/changes/change-a/corgi/traceability.yaml",
      traceabilityDigest: hashes[3]!,
      acceptance: [
        { id: "AC-001", evidence: "automated", taskGroups: ["1"] },
        { id: "AC-002", evidence: "both", taskGroups: ["2"] },
      ],
      tracker: tracked
        ? {
            provider: "github",
            idempotencyKey: "feature-key",
            issue: { id: "42", url: "https://example.test/issues/42" },
          }
        : { provider: "none", idempotencyKey: "local-key" },
    },
    groups: [
      { id: "1", fingerprint: hashes[4]! },
      { id: "2", fingerprint: hashes[5]! },
    ],
    startedAt: "2026-08-14T00:00:00.000Z",
  });
}

function applyEvent(
  state: RunStateV3,
  type: Exclude<RunEventV3["type"], "run_initialized">,
  extra: Record<string, unknown> = {},
): RunStateV3 {
  const revision = state.stateRevision + 1;
  const event = {
    ...eventBaseV3(state, type, {
      nextNonce: `nonce-${revision}`,
      occurredAt: `2026-08-14T00:00:${String(revision).padStart(2, "0")}.000Z`,
    }),
    type,
    ...extra,
  } as RunEventV3;
  return reduceRunEventV3(state, event).postState;
}

function throughApply(tracked = false): RunStateV3 {
  let state = initial(tracked);
  expect(reduceRunEventV3(null, createRunInitializedEventV3(state)).postState).toEqual(state);
  state = applyEvent(state, "apply_started");
  state = applyEvent(state, "group_completed", {
    groupId: "1",
    commitRevision: "commit-1",
    commitTree: "tree-1",
    workspaceFingerprint: hashes[6]!,
    evidenceHash: hashes[7]!,
    trackerCheckpoint: tracked ? "checkpoint-1" : null,
  });
  state = applyEvent(state, "group_completed", {
    groupId: "2",
    commitRevision: "commit-2",
    commitTree: "tree-2",
    workspaceFingerprint: hashes[6]!,
    evidenceHash: hashes[7]!,
    trackerCheckpoint: tracked ? "checkpoint-2" : null,
  });
  return state;
}

function verifyAcceptance(): CriterionEvidenceV3[] {
  return [
    { id: "AC-001", automated: "pass", human: "not_applicable", evidenceRefs: ["test:unit"] },
    { id: "AC-002", automated: "pass", human: "not_applicable", evidenceRefs: ["test:e2e"] },
  ];
}

describe("Run Contract v3", () => {
  it("moves Apply only to awaiting_verify and gates the complete quality chain", () => {
    let state = throughApply();
    expect(state.phase).toBe("awaiting_verify");
    expect(Object.values(state.groups).map((group) => group.status)).toEqual(["completed", "completed"]);

    state = applyEvent(state, "verify_submitted", {
      evidence: {
        verdict: "pass",
        finalRevision: "commit-2",
        planningRevision: state.planningRevision,
        sourceDigest: state.contract.sourceDigest,
        traceabilityDigest: state.contract.traceabilityDigest,
        reportHash: hashes[8]!,
        checks: [{ name: "test", status: "pass", evidenceRefs: ["test.log"] }],
        acceptance: verifyAcceptance(),
        verifiedAt: "2026-08-14T00:00:04.000Z",
      },
    });
    expect(state.phase).toBe("awaiting_human_review");

    state = applyEvent(state, "human_review_submitted", {
      evidence: {
        decision: "approve",
        reviewer: "human-a",
        reason: null,
        finalRevision: "commit-2",
        planningRevision: state.planningRevision,
        verifyReportHash: state.verify!.reportHash,
        reviewedAt: "2026-08-14T00:00:05.000Z",
      },
    });
    expect(state.phase).toBe("awaiting_human_qa");

    state = applyEvent(state, "human_qa_submitted", {
      evidence: {
        verdict: "pass",
        reviewer: "human-a",
        reason: null,
        noRuntimeImpact: false,
        finalRevision: "commit-2",
        planningRevision: state.planningRevision,
        reportHash: hashes[7]!,
        acceptance: [
          { id: "AC-001", automated: "not_applicable", human: "not_applicable", evidenceRefs: [] },
          { id: "AC-002", automated: "not_applicable", human: "pass", evidenceRefs: ["qa:walkthrough"] },
        ],
        evidenceRefs: ["qa:walkthrough"],
        reviewedAt: "2026-08-14T00:00:06.000Z",
      },
    });
    expect(state.phase).toBe("ready_for_archive");

    state = applyEvent(state, "archive_started", { intentId: "archive-a" });
    expect(state.phase).toBe("archiving");
    state = applyEvent(state, "archive_local_completed", {
      evidenceManifestHash: hashes[6]!,
      archivedRoot: "/repo/openspec/changes/archive/2026-08-14-change-a",
      deliveryPage: "/repo/wiki/deliveries/RFC-0001-example-S-01-example.md",
      deliveryRevision: 2,
      closeoutCommit: "archive-closeout",
    });
    state = applyEvent(state, "run_archived");
    expect(state.phase).toBe("archived");
  });

  it("fails closed on partial AC coverage and requires an implementation successor", () => {
    let state = throughApply();
    state = applyEvent(state, "verify_submitted", {
      evidence: {
        verdict: "fail",
        finalRevision: "commit-2",
        planningRevision: state.planningRevision,
        sourceDigest: state.contract.sourceDigest,
        traceabilityDigest: state.contract.traceabilityDigest,
        reportHash: hashes[8]!,
        checks: [{ name: "test", status: "pass", evidenceRefs: ["test.log"] }],
        acceptance: [verifyAcceptance()[0]],
        verifiedAt: "2026-08-14T00:00:04.000Z",
      },
    });
    expect(state).toMatchObject({
      phase: "repair_required",
      repair: { kind: "implementation", failedPhase: "verify" },
    });
  });

  it("routes the two negative human decisions to distinct repair contracts", () => {
    const reviewed = (decision: "reject-implementation" | "require-rfc-amendment") => {
      let state = throughApply();
      state = applyEvent(state, "verify_submitted", {
        evidence: {
          verdict: "pass",
          finalRevision: "commit-2",
          planningRevision: state.planningRevision,
          sourceDigest: state.contract.sourceDigest,
          traceabilityDigest: state.contract.traceabilityDigest,
          reportHash: hashes[8]!,
          checks: [{ name: "test", status: "pass", evidenceRefs: ["test.log"] }],
          acceptance: verifyAcceptance(),
          verifiedAt: "2026-08-14T00:00:04.000Z",
        },
      });
      return applyEvent(state, "human_review_submitted", {
        evidence: {
          decision,
          reviewer: "human-a",
          reason: "needs repair",
          finalRevision: "commit-2",
          planningRevision: state.planningRevision,
          verifyReportHash: state.verify!.reportHash,
          reviewedAt: "2026-08-14T00:00:05.000Z",
        },
      });
    };
    expect(reviewed("reject-implementation").repair?.kind).toBe("implementation");
    expect(reviewed("require-rfc-amendment").repair?.kind).toBe("rfc_amendment");
  });

  it("requires tracker checkpoints and tracker archive closeout for tracked runs", () => {
    expect(() => {
      let state = initial(true);
      state = applyEvent(state, "apply_started");
      applyEvent(state, "group_completed", {
        groupId: "1",
        commitRevision: "commit-1",
        commitTree: "tree-1",
        workspaceFingerprint: hashes[6]!,
        evidenceHash: hashes[7]!,
        trackerCheckpoint: null,
      });
    }).toThrowError(expect.objectContaining({ code: "RUN_TRACKER_CHECKPOINT_INVALID" }));
  });

  it("clears the current Group when an active Apply run is invalidated", () => {
    let state = initial();
    state = applyEvent(state, "apply_started");
    expect(state).toMatchObject({ phase: "applying", currentGroupId: "1" });

    state = applyEvent(state, "run_invalidated", { reason: "superseded by a recovery run" });
    expect(state).toMatchObject({ phase: "invalidated", currentGroupId: null });
    expect(Object.values(state.groups).map((group) => group.status)).toEqual(["invalidated", "invalidated"]);
  });
});
