import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { LoopStoreV3, loopRunPathsV3 } from "../src/lib/loop-store-v3.js";
import {
  createInitialRunStateV3,
  createRunInitializedEventV3,
  eventBaseV3,
  type ArtifactHashV3,
  type RunEventV3,
  type RunStateV3,
} from "../src/lib/run-contract-v3.js";

const H = `sha256:${"a".repeat(64)}` as ArtifactHashV3;
const H2 = `sha256:${"b".repeat(64)}` as ArtifactHashV3;

function state(runId = "run-a"): RunStateV3 {
  return createInitialRunStateV3({
    changeName: "change-a",
    runId,
    owner: { id: "agent", kind: "agent" },
    sessionId: "session-a",
    nonce: "nonce-0",
    planningRevision: H,
    baselineRevision: "base",
    contract: {
      kind: "maintenance",
      deliveryRef: "maintenance/change-a",
      rfcId: null,
      rfcDigest: null,
      acceptedCommit: null,
      sliceId: null,
      sourcePath: "openspec/changes/change-a/corgi/source.yaml",
      sourceDigest: H,
      traceabilityPath: "openspec/changes/change-a/corgi/traceability.yaml",
      traceabilityDigest: H2,
      acceptance: [{ id: "AC-001", evidence: "automated", taskGroups: ["1"] }],
      tracker: { provider: "none", idempotencyKey: "local" },
    },
    groups: [{ id: "1", fingerprint: H2 }],
    startedAt: "2026-08-14T00:00:00.000Z",
  });
}

function event(current: RunStateV3, type: Exclude<RunEventV3["type"], "run_initialized">, extra: object = {}): RunEventV3 {
  const revision = current.stateRevision + 1;
  return {
    ...eventBaseV3(current, type, {
      nextNonce: `nonce-${revision}`,
      occurredAt: `2026-08-14T00:00:${String(revision).padStart(2, "0")}.000Z`,
    }),
    type,
    ...extra,
  } as RunEventV3;
}

function transition(store: LoopStoreV3, current: RunStateV3, next: RunEventV3): RunStateV3 {
  return store.transition({
    changeName: current.changeName,
    runId: current.runId,
    sessionId: current.sessionId,
    expectedStateRevision: current.stateRevision,
    expectedNonce: current.nonce,
  }, next);
}

describe("LoopStoreV3", () => {
  it("persists CAS events and repairs a stale snapshot from the canonical log", () => {
    const root = mkdtempSync(resolve(tmpdir(), "corgispec-loop-v3-"));
    const store = new LoopStoreV3(root);
    const initial = state();
    store.initialize(initial, createRunInitializedEventV3(initial));
    const applyingEvent = event(initial, "apply_started");
    const applying = transition(store, initial, applyingEvent);
    expect(applying.phase).toBe("applying");

    const paths = store.paths("change-a", "run-a");
    writeFileSync(paths.state!, `${JSON.stringify(initial, null, 2)}\n`);
    const inspection = store.inspect("change-a", "run-a");
    expect(inspection).toMatchObject({ recovered: true, state: { phase: "applying", stateRevision: 1 } });
    expect(JSON.parse(readFileSync(paths.state!, "utf8"))).toMatchObject({ phase: "applying" });

    expect(() => transition(store, initial, applyingEvent)).not.toThrow();
    expect(() => transition(store, initial, event(initial, "run_invalidated", { reason: "different" })))
      .toThrowError(expect.objectContaining({ code: "LOOP_EVENT_CONFLICT" }));
  });

  it("refuses to initialize v3 while any v2 run remains active", () => {
    const root = mkdtempSync(resolve(tmpdir(), "corgispec-loop-v2-active-"));
    const legacy = resolve(root, ".corgi/loop/change-a/runs/run-v2");
    mkdirSync(legacy, { recursive: true });
    writeFileSync(resolve(legacy, "state.json"), JSON.stringify({
      schemaVersion: 2,
      changeName: "change-a",
      runId: "run-v2",
      phase: "awaiting_group_result",
    }));
    const next = state("run-v3");
    expect(() => new LoopStoreV3(root).initialize(next, createRunInitializedEventV3(next)))
      .toThrowError(expect.objectContaining({ code: "ACTIVE_V2_RUN_UNSUPPORTED" }));
  });

  it("recovers a lock left by a dead writer without weakening live-lock exclusion", () => {
    const root = mkdtempSync(resolve(tmpdir(), "corgispec-loop-v3-lock-"));
    const lockRoot = resolve(root, ".corgi/loop/change-a");
    mkdirSync(lockRoot, { recursive: true });
    writeFileSync(resolve(lockRoot, ".lock-v3"), JSON.stringify({ pid: 99_999_999 }));
    const store = new LoopStoreV3(root);
    const initial = state();
    expect(store.initialize(initial, createRunInitializedEventV3(initial)).phase).toBe("planning_ready");
  });

  it("materializes canonical archive evidence idempotently and rejects divergent retries", () => {
    const root = mkdtempSync(resolve(tmpdir(), "corgispec-loop-v3-evidence-"));
    const store = new LoopStoreV3(root);
    let current = state();
    store.initialize(current, createRunInitializedEventV3(current));
    current = transition(store, current, event(current, "apply_started"));
    current = transition(store, current, event(current, "group_completed", {
      groupId: "1",
      commitRevision: "commit-1",
      commitTree: "tree-1",
      workspaceFingerprint: H,
      evidenceHash: H2,
      trackerCheckpoint: null,
    }));
    current = transition(store, current, event(current, "verify_submitted", {
      evidence: {
        verdict: "pass",
        finalRevision: "commit-1",
        planningRevision: current.planningRevision,
        sourceDigest: current.contract.sourceDigest,
        traceabilityDigest: current.contract.traceabilityDigest,
        reportHash: H,
        checks: [{ name: "test", status: "pass", evidenceRefs: ["test.log"] }],
        acceptance: [{ id: "AC-001", automated: "pass", human: "not_applicable", evidenceRefs: ["test.log"] }],
        verifiedAt: "2026-08-14T00:00:03.000Z",
      },
    }));
    current = transition(store, current, event(current, "human_review_submitted", {
      evidence: {
        decision: "approve",
        reviewer: "human",
        reason: null,
        finalRevision: "commit-1",
        planningRevision: current.planningRevision,
        verifyReportHash: H,
        reviewedAt: "2026-08-14T00:00:04.000Z",
      },
    }));
    current = transition(store, current, event(current, "human_qa_submitted", {
      evidence: {
        verdict: "pass",
        reviewer: "human",
        reason: null,
        noRuntimeImpact: false,
        finalRevision: "commit-1",
        planningRevision: current.planningRevision,
        reportHash: H2,
        acceptance: [{ id: "AC-001", automated: "not_applicable", human: "not_applicable", evidenceRefs: [] }],
        evidenceRefs: ["qa.log"],
        reviewedAt: "2026-08-14T00:00:05.000Z",
      },
    }));
    current = transition(store, current, event(current, "archive_started", { intentId: "archive-a" }));
    const token = {
      changeName: current.changeName,
      runId: current.runId,
      sessionId: current.sessionId,
      expectedStateRevision: current.stateRevision,
      expectedNonce: current.nonce,
    };
    expect(() => store.materializeEvidence(token, [{ path: "../unsafe.json", content: "unsafe" }]))
      .toThrowError(expect.objectContaining({ code: "LOOP_PATH_UNSAFE" }));
    expect(() => store.materializeEvidence(token, [
      { path: "duplicate.json", content: "first" },
      { path: "duplicate.json", content: "second" },
    ])).toThrowError(expect.objectContaining({ code: "LOOP_EVIDENCE_DUPLICATE" }));
    expect(() => store.materializeEvidence({ ...token, expectedStateRevision: token.expectedStateRevision + 1 }, []))
      .toThrowError(expect.objectContaining({ code: "LOOP_CAS_CONFLICT" }));
    const files = [
      { path: "verify.json", content: current.verify! },
      { path: "summary.txt", content: "verified\n" },
      { path: "raw.bin", content: Buffer.from([0, 1, 2]) },
    ];
    const first = store.materializeEvidence(token, files);
    const repeated = store.materializeEvidence(token, files);
    expect(first.idempotent).toBe(false);
    expect(repeated).toMatchObject({ idempotent: true, manifestHash: first.manifestHash });
    writeFileSync(resolve(store.paths("change-a", "run-a").evidence!, "verify.json"), "{}\n");
    expect(() => store.materializeEvidence(token, files))
      .toThrowError(expect.objectContaining({ code: "LOOP_EVIDENCE_CONFLICT" }));
  });

  it("makes Task Group evidence immutable and only accepts the active Group", () => {
    const root = mkdtempSync(resolve(tmpdir(), "corgispec-loop-v3-group-evidence-"));
    try {
      const store = new LoopStoreV3(root);
      let current = state();
      store.initialize(current, createRunInitializedEventV3(current));
      current = transition(store, current, event(current, "apply_started"));
      const token = {
        changeName: current.changeName,
        runId: current.runId,
        sessionId: current.sessionId,
        expectedStateRevision: current.stateRevision,
        expectedNonce: current.nonce,
      };

      expect(() => store.writeGroupEvidence(token, "2", { check: "wrong group" }))
        .toThrowError(expect.objectContaining({ code: "LOOP_GROUP_NOT_CURRENT" }));
      expect(() => store.writeGroupEvidence(token, "../escape", { check: "unsafe" }))
        .toThrowError(expect.objectContaining({ code: "LOOP_PATH_UNSAFE" }));

      const first = store.writeGroupEvidence(token, "1", { check: "pass" });
      expect(first.idempotent).toBe(false);
      expect(store.writeGroupEvidence(token, "1", { check: "pass" })).toMatchObject({
        idempotent: true,
        evidenceHash: first.evidenceHash,
      });
      expect(store.readGroupEvidence("change-a", "run-a", "1")).toMatchObject({
        evidence: { check: "pass" },
        evidenceHash: first.evidenceHash,
      });
      expect(() => store.writeGroupEvidence(token, "1", { check: "different" }))
        .toThrowError(expect.objectContaining({ code: "LOOP_GROUP_EVIDENCE_CONFLICT" }));
      expect(() => store.readGroupEvidence("change-a", "run-a", "2"))
        .toThrowError(expect.objectContaining({ code: "LOOP_GROUP_EVIDENCE_MISSING" }));
      expect(() => store.writeGroupEvidence({ ...token, expectedNonce: "stale" }, "1", { check: "pass" }))
        .toThrowError(expect.objectContaining({ code: "LOOP_CAS_CONFLICT" }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("captures immutable local evidence references and detects unsafe or changed blobs", () => {
    const root = mkdtempSync(resolve(tmpdir(), "corgispec-loop-v3-references-"));
    try {
      const store = new LoopStoreV3(root);
      let current = state();
      store.initialize(current, createRunInitializedEventV3(current));
      current = transition(store, current, event(current, "apply_started"));
      const token = {
        changeName: current.changeName,
        runId: current.runId,
        sessionId: current.sessionId,
        expectedStateRevision: current.stateRevision,
        expectedNonce: current.nonce,
      };
      const inputs = [
        { sourcePath: ".\\logs\\verify.txt", content: Buffer.from("verified\n") },
        { sourcePath: "reports/result.json", content: Buffer.from('{"ok":true}\n') },
      ];
      const captured = store.captureEvidenceReferences(token, "verify", inputs);
      expect(captured.map((entry) => entry.sourcePath)).toEqual(["logs/verify.txt", "reports/result.json"]);
      expect(captured.every((entry) => entry.reference.includes(`#${entry.digest}`))).toBe(true);
      expect(store.captureEvidenceReferences(token, "verify", inputs)).toEqual(captured);
      expect(store.readEvidenceReferences("change-a", "run-a", "verify").map((entry) => entry.content.toString("utf8")))
        .toEqual(["verified\n", '{"ok":true}\n']);

      const referencesRoot = resolve(store.paths("change-a", "run-a").runRoot!, "references");
      const scopePath = resolve(referencesRoot, "scopes/verify.json");
      const originalScope = readFileSync(scopePath, "utf8");
      writeFileSync(scopePath, "[]\n");
      expect(() => store.readEvidenceReferences("change-a", "run-a", "verify"))
        .toThrowError(expect.objectContaining({ code: "LOOP_EVIDENCE_REFERENCE_INVALID" }));
      writeFileSync(scopePath, `${JSON.stringify({
        schemaVersion: 3,
        scope: "verify",
        references: [null],
      })}\n`);
      expect(() => store.readEvidenceReferences("change-a", "run-a", "verify"))
        .toThrowError(expect.objectContaining({ code: "LOOP_EVIDENCE_REFERENCE_INVALID" }));
      writeFileSync(scopePath, `${JSON.stringify({
        schemaVersion: 3,
        scope: "verify",
        references: [{ ...captured[0], blobPath: "../outside" }],
      })}\n`);
      expect(() => store.readEvidenceReferences("change-a", "run-a", "verify"))
        .toThrowError(expect.objectContaining({ code: "LOOP_PATH_UNSAFE" }));
      writeFileSync(scopePath, originalScope);

      expect(() => store.captureEvidenceReferences(token, "bad/scope", inputs))
        .toThrowError(expect.objectContaining({ code: "LOOP_PATH_UNSAFE" }));
      expect(() => store.captureEvidenceReferences(token, "other", [{
        sourcePath: "../outside.log",
        content: Buffer.from("no"),
      }])).toThrowError(expect.objectContaining({ code: "LOOP_EVIDENCE_REFERENCE_INVALID" }));
      expect(() => store.captureEvidenceReferences(token, "other", [
        { sourcePath: "duplicate.log", content: Buffer.from("one") },
        { sourcePath: "duplicate.log", content: Buffer.from("two") },
      ])).toThrowError(expect.objectContaining({ code: "LOOP_EVIDENCE_REFERENCE_INVALID" }));
      expect(() => store.readEvidenceReferences("change-a", "run-a", "missing"))
        .toThrowError(expect.objectContaining({ code: "LOOP_EVIDENCE_REFERENCE_MISSING" }));

      const blob = resolve(referencesRoot, captured[0]!.blobPath);
      rmSync(blob);
      expect(() => store.readEvidenceReferences("change-a", "run-a", "verify"))
        .toThrowError(expect.objectContaining({ code: "LOOP_EVIDENCE_REFERENCE_MISSING" }));
      writeFileSync(blob, "tampered\n");
      expect(() => store.readEvidenceReferences("change-a", "run-a", "verify"))
        .toThrowError(expect.objectContaining({ code: "LOOP_EVIDENCE_REFERENCE_CONFLICT" }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects unsafe path segments and corrupt Run Contract storage before replay", () => {
    const root = mkdtempSync(resolve(tmpdir(), "corgispec-loop-v3-corruption-"));
    try {
      for (const unsafe of ["..", ".", "name.", "CON", "path/name"]) {
        expect(() => loopRunPathsV3(root, unsafe))
          .toThrowError(expect.objectContaining({ code: "LOOP_PATH_UNSAFE" }));
      }
      expect(() => loopRunPathsV3(root, "change-a", ".."))
        .toThrowError(expect.objectContaining({ code: "LOOP_PATH_UNSAFE" }));

      const store = new LoopStoreV3(root);
      const initial = state();
      const initialized = createRunInitializedEventV3(initial);
      store.initialize(initial, initialized);
      expect(store.initialize(initial, initialized)).toEqual(initial);

      const changed = state();
      changed.owner = { id: "different-agent", kind: "agent" };
      expect(() => store.initialize(changed, createRunInitializedEventV3(changed)))
        .toThrowError(expect.objectContaining({ code: "LOOP_RUN_CONFLICT" }));
      const second = state("run-b");
      expect(() => store.initialize(second, createRunInitializedEventV3(second)))
        .toThrowError(expect.objectContaining({ code: "LOOP_ACTIVE_RUN_EXISTS" }));
      expect(() => store.transition({
        changeName: "change-a",
        runId: "missing",
        sessionId: "session-a",
        expectedStateRevision: 0,
        expectedNonce: "nonce-0",
      }, event(initial, "apply_started"))).toThrowError(expect.objectContaining({ code: "LOOP_POINTER_INVALID" }));
      expect(() => store.transition({
        changeName: "change-a",
        runId: "run-a",
        sessionId: "wrong-session",
        expectedStateRevision: 0,
        expectedNonce: "nonce-0",
      }, event(initial, "apply_started"))).toThrowError(expect.objectContaining({ code: "LOOP_SESSION_CONFLICT" }));

      const paths = store.paths("change-a", "run-a");
      writeFileSync(paths.events!, "\n");
      expect(() => store.inspect("change-a", "run-a"))
        .toThrowError(expect.objectContaining({ code: "LOOP_CORRUPTION" }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
