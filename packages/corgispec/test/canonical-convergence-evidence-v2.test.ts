import {
  mkdirSync,
  mkdtempSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertCanonicalFinalizationEvidenceV2,
  CanonicalConvergenceEvidenceErrorV2,
  deriveCanonicalConvergenceEvidenceV2,
  type CanonicalEvidenceReaderV2,
} from "../src/lib/canonical-convergence-evidence-v2.js";
import {
  createEvidenceBundleV2,
  createFindingTriageV2,
  createReviewFindingV2,
  hashArtifactBytesV2,
  hashCanonicalArtifactV2,
  hashReviewFindingsV2,
  type EvidenceEntryV2,
  type FindingTriageV2,
  type ReviewFindingV2,
} from "../src/lib/evidence-v2.js";
import {
  createInitialLoopStateV2,
  createRunInitializedEventV2,
  reduceLoopEventV2,
} from "../src/lib/loop-reducer-v2.js";
import type { LoopStoreInspectionV2, ReviewTriageEntryV2 } from "../src/lib/loop-store-v2.js";
import type {
  ArtifactHashV2,
  BlockedReasonV2,
  LoopEventRecordV2,
  LoopEventV2,
  LoopStateV2,
} from "../src/lib/run-contract-v2.js";

const roots: string[] = [];
const hash = (character: string): ArtifactHashV2 =>
  `sha256:${character.repeat(64)}` as ArtifactHashV2;
const PLAN = hash("1");
const WORKSPACE = hash("2");
const OTHER_WORKSPACE = hash("9");
const START = "2026-06-01T00:00:00.000Z";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Fixture {
  root: string;
  attemptsRoot: string;
  triagePath: string;
  state: LoopStateV2;
  events: LoopEventRecordV2[];
  triage: ReviewTriageEntryV2[];
  attemptPaths: Map<string, string>;
  currentGit: { revision: string; workspaceFingerprint: ArtifactHashV2 };
}

function fixture(options: { groups?: number; mode?: "self-driven" | "hook-driven" } = {}): Fixture {
  const root = mkdtempSync(resolve(tmpdir(), "canonical-convergence-evidence-"));
  roots.push(root);
  const attemptsRoot = resolve(root, "attempts");
  const triagePath = resolve(root, "review-triage.jsonl");
  mkdirSync(attemptsRoot, { recursive: true });
  writeFileSync(triagePath, "", "utf8");
  const count = options.groups ?? 1;
  const state = createInitialLoopStateV2({
    changeName: "change-a",
    runId: "run-a",
    owner: { id: "owner-a", kind: "agent" },
    sessionId: "session-a",
    mode: options.mode ?? "hook-driven",
    nonce: "nonce-0",
    planningRevision: PLAN,
    baselineGitRevision: "baseline",
    workspaceFingerprint: hash("0"),
    policy: {
      requireCleanReview: true,
      requireCliPass: true,
      requireCleanWorktreeForCommit: true,
      requirePush: false,
    },
    limits: { maxGroups: count, maxAttemptsPerGroup: 3, maxEvents: 100 },
    groups: Array.from({ length: count }, (_, index) => ({
      id: String(index + 1),
      taskGroupFingerprint: hash(String(index + 4)),
    })),
    startedAt: START,
  });
  const initialized = reduceLoopEventV2(null, createRunInitializedEventV2(state));
  return {
    root,
    attemptsRoot,
    triagePath,
    state: initialized.postState,
    events: [initialized],
    triage: [],
    attemptPaths: new Map(),
    currentGit: { revision: "baseline", workspaceFingerprint: hash("0") },
  };
}

function occurredAt(seq: number): string {
  return new Date(Date.parse(START) + seq * 1_000).toISOString();
}

function base(f: Fixture, type: LoopEventV2["type"]) {
  const seq = f.state.lastEventSeq + 1;
  return {
    schemaVersion: 2 as const,
    type,
    runId: f.state.runId,
    seq,
    expectedStateRevision: f.state.stateRevision,
    expectedNonce: f.state.nonce,
    nextNonce: `nonce-${seq}`,
    occurredAt: occurredAt(seq),
    actor: { id: "owner-a", kind: "agent" as const },
  };
}

function persistTriage(f: Fixture): void {
  writeFileSync(
    f.triagePath,
    f.triage.map((entry) => JSON.stringify(entry)).join("\n") + (f.triage.length ? "\n" : ""),
    "utf8",
  );
}

function inspection(f: Fixture): LoopStoreInspectionV2 {
  return {
    current: null,
    state: structuredClone(f.state),
    events: structuredClone(f.events),
    recovered: false,
    repairedTrailingEvent: false,
    recoveryRequired: false,
  };
}

function apply(f: Fixture, event: LoopEventV2): void {
  const record = reduceLoopEventV2(f.state, event);
  f.events.push(record);
  f.state = record.postState;
}

function triageStoreEntry(
  runId: string,
  groupId: string,
  attempt: number,
  bundleId: string,
  value: FindingTriageV2,
): ReviewTriageEntryV2 {
  return {
    schemaVersion: 2,
    runId,
    groupId,
    attempt,
    bundleId,
    findingFingerprint: value.findingFingerprint,
    action: value.disposition as "dismissed" | "accepted-risk",
    actor: { kind: "human", id: value.actor.id },
    reason: value.reason!,
    occurredAt: value.occurredAt,
  };
}

function addAttempt(f: Fixture, options: {
  verdict: "PASS" | "FAIL";
  findings?: ReviewFindingV2[];
  triage?: FindingTriageV2[];
  planningRevision?: ArtifactHashV2;
  bundleId?: string;
}): void {
  const groupId = f.state.currentGroupId!;
  const attempt = f.state.currentAttempt;
  const bundleId = options.bundleId ?? `bundle-${groupId}-${attempt}`;
  const binding = {
    runId: f.state.runId,
    groupId,
    attempt,
    bundleId,
    planningRevision: options.planningRevision ?? f.state.planningRevision,
    taskGroupFingerprint: f.state.groups[groupId]!.taskGroupFingerprint,
    baselineGitRevision: f.state.git.baselineRevision,
    observedGitRevision: f.currentGit.revision,
    workspaceFingerprint: WORKSPACE,
  };
  const entry: EvidenceEntryV2 = {
    id: `test-${groupId}-${attempt}`,
    kind: "test",
    provenance: "cli",
    status: options.verdict === "PASS" ? "pass" : "fail",
    binding,
    command: "npm test",
    cwd: f.root,
    exitCode: options.verdict === "PASS" ? 0 : 1,
  };
  const evidence = createEvidenceBundleV2({
    binding,
    verdict: options.verdict,
    evidence: [entry],
  });
  const findings = options.findings ?? [];
  const triage = options.triage ?? [];
  f.triage.push(...triage.map((value) => triageStoreEntry(
    f.state.runId,
    groupId,
    attempt,
    bundleId,
    value,
  )));
  persistTriage(f);
  const reviewHash = hashCanonicalArtifactV2({
    findingsHash: hashReviewFindingsV2(findings),
    triage,
  });
  const artifactPath = "artifacts/result.txt";
  const artifactBytes = Buffer.from(`artifact:${bundleId}\n`, "utf8");
  const artifactManifest = { [artifactPath]: hashArtifactBytesV2(artifactBytes) };
  const artifactHash = hashCanonicalArtifactV2(artifactManifest);
  const fullBundleHash = hashCanonicalArtifactV2({
    schemaVersion: 2,
    binding,
    evidenceBundleHash: evidence.bundleHash,
    evidenceHash: evidence.evidenceHash,
    reviewHash,
    artifactHash,
  });
  const bundleEvent = {
    ...base(f, "bundle_submitted"),
    type: "bundle_submitted" as const,
    groupId,
    attempt,
    bundleId,
    bundleHash: fullBundleHash,
    artifactHash,
    observedGitRevision: binding.observedGitRevision,
    workspaceFingerprint: binding.workspaceFingerprint,
  };
  apply(f, bundleEvent);
  const resolved = new Set(triage.map((value) => value.findingFingerprint));
  const openFindings = findings.filter((finding) => !resolved.has(finding.fingerprint));
  const result = options.verdict === "FAIL"
    ? "verification_failed"
    : openFindings.length > 0 ? "review_failed" : "pass";
  const reason: BlockedReasonV2 | null = result === "pass"
    ? null
    : result === "review_failed"
      ? { code: "review_findings", message: "Canonical review has open findings", details: {} }
      : { code: "verification_failed", message: "Canonical CLI verification failed", details: {} };
  const evaluationEvent = {
    ...base(f, "evaluation_completed"),
    type: "evaluation_completed" as const,
    groupId,
    attempt,
    result,
    evidenceHash: evidence.evidenceHash,
    reviewHash,
    reviewClean: openFindings.length === 0,
    reason,
  };
  apply(f, evaluationEvent);

  const directory = resolve(f.attemptsRoot, groupId, String(attempt));
  mkdirSync(directory, { recursive: true });
  mkdirSync(resolve(directory, "artifacts"), { recursive: true });
  writeFileSync(resolve(directory, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
  writeFileSync(resolve(directory, "review.json"), JSON.stringify({ findings, triage }, null, 2), "utf8");
  writeFileSync(resolve(directory, artifactPath), artifactBytes);
  writeFileSync(resolve(directory, "bundle.json"), JSON.stringify({
    schemaVersion: 2,
    runId: f.state.runId,
    groupId,
    attempt,
    bundleId,
    bundleHash: fullBundleHash,
    artifactHash,
    artifactManifest,
    evidenceHash: evidence.evidenceHash,
    reviewHash,
    observedGitRevision: binding.observedGitRevision,
    workspaceFingerprint: binding.workspaceFingerprint,
  }, null, 2), "utf8");
  f.attemptPaths.set(`${groupId}:${attempt}`, directory);
}

function commitCurrent(f: Fixture, revisionOverride?: string): string {
  const group = f.state.groups[f.state.currentGroupId!]!;
  const revision = revisionOverride ?? `commit-${group.ordinal}`;
  const event = {
    ...base(f, "group_commit_acknowledged"),
    type: "group_commit_acknowledged" as const,
    groupId: group.id,
    attempt: f.state.currentAttempt,
    commitRevision: revision,
    commitTree: `tree-${group.ordinal}`,
    workspaceFingerprint: group.bundle.workspaceFingerprint!,
    pushStatus: "not_required" as const,
    remoteRevision: null,
  };
  apply(f, event);
  f.currentGit = { revision, workspaceFingerprint: WORKSPACE };
  return revision;
}

function finalize(f: Fixture): void {
  const event = {
    ...base(f, "run_finalized"),
    type: "run_finalized" as const,
    finalGitRevision: f.currentGit.revision,
    workspaceFingerprint: f.currentGit.workspaceFingerprint,
  };
  apply(f, event);
}

function invalidate(f: Fixture): void {
  apply(f, {
    ...base(f, "run_invalidated"),
    type: "run_invalidated",
    reason: {
      code: "planning_invalidated",
      message: "Convergence found a successor planning revision",
      details: {},
    },
  });
}

function replaceWithTrustedLegacyFinalization(f: Fixture): void {
  const state = structuredClone(f.state);
  const group = state.groups["1"]!;
  state.phase = "awaiting_finalize";
  state.currentGroupId = null;
  state.currentAttempt = 0;
  group.status = "completed";
  group.attempt = 1;
  group.bundle = {
    status: "approved",
    bundleId: "legacy-v1-1",
    bundleHash: hash("a"),
    artifactHash: hash("b"),
    evidenceHash: hash("c"),
    reviewHash: hash("d"),
    observedGitRevision: "baseline",
    workspaceFingerprint: state.git.workspaceFingerprint,
  };
  group.commit = {
    status: "acknowledged",
    revision: "baseline",
    tree: "tree-baseline",
    workspaceFingerprint: state.git.workspaceFingerprint,
  };
  group.push = { status: "not_required", remoteRevision: null };
  group.completedAt = START;
  const initialized = reduceLoopEventV2(null, {
    schemaVersion: 2,
    type: "run_initialized",
    runId: state.runId,
    seq: 0,
    expectedStateRevision: -1,
    expectedNonce: null,
    nextNonce: state.nonce,
    occurredAt: state.updatedAt,
    actor: { id: state.owner.id, kind: state.owner.kind },
    initialState: state,
  });
  f.state = initialized.postState;
  f.events = [initialized];
  f.currentGit = {
    revision: "baseline",
    workspaceFingerprint: state.git.workspaceFingerprint,
  };
}

async function derive(f: Fixture) {
  return await deriveCanonicalConvergenceEvidenceV2({
    inspection: inspection(f),
    attemptsRoot: f.attemptsRoot,
    reviewTriagePath: f.triagePath,
    currentGit: f.currentGit,
  });
}

async function assertFinalization(
  f: Fixture,
  trustedLegacyGroupIds: readonly string[] = [],
  successorSource?: Fixture,
) {
  return await assertCanonicalFinalizationEvidenceV2({
    inspection: inspection(f),
    attemptsRoot: f.attemptsRoot,
    reviewTriagePath: f.triagePath,
    currentGit: f.currentGit,
    trustedLegacyGroupIds,
    ...(successorSource ? {
      successorSource: {
        inspection: inspection(successorSource),
        attemptsRoot: successorSource.attemptsRoot,
        reviewTriagePath: successorSource.triagePath,
      },
    } : {}),
  });
}

function partialSuccessorFixture(
  mutateReused?: (group: LoopStateV2["groups"][string]) => void,
): { source: Fixture; successor: Fixture } {
  const source = fixture({ groups: 2, mode: "hook-driven" });
  addAttempt(source, { verdict: "PASS" });
  commitCurrent(source, "source-group-1");
  addAttempt(source, { verdict: "FAIL" });
  invalidate(source);

  const successor = fixture({ groups: 2, mode: "hook-driven" });
  const initial = createInitialLoopStateV2({
    changeName: source.state.changeName,
    runId: "run-successor",
    supersedesRunId: source.state.runId,
    owner: { id: "owner-successor", kind: "agent" },
    sessionId: "session-successor",
    mode: "hook-driven",
    nonce: "successor-nonce-0",
    planningRevision: PLAN,
    baselineGitRevision: "successor-baseline",
    workspaceFingerprint: WORKSPACE,
    policy: source.state.policy,
    limits: source.state.limits,
    groups: Object.values(source.state.groups)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((group) => ({ id: group.id, taskGroupFingerprint: group.taskGroupFingerprint })),
    startedAt: START,
  });
  initial.groups["1"] = structuredClone(source.state.groups["1"]!);
  mutateReused?.(initial.groups["1"]!);
  initial.groups["2"]!.status = "in_progress";
  initial.groups["2"]!.attempt = 1;
  initial.currentGroupId = "2";
  initial.currentAttempt = 1;
  const initialized = reduceLoopEventV2(null, createRunInitializedEventV2(initial));
  successor.state = initialized.postState;
  successor.events = [initialized];
  successor.currentGit = {
    revision: "successor-baseline",
    workspaceFingerprint: WORKSPACE,
  };
  addAttempt(successor, { verdict: "PASS" });
  commitCurrent(successor, "successor-group-2");
  return { source, successor };
}

function diskReader(overrides: Partial<CanonicalEvidenceReaderV2> = {}): CanonicalEvidenceReaderV2 {
  return {
    async readFile(path) {
      return readFileSync(path);
    },
    async listDirectory(path) {
      return readdirSync(path, { withFileTypes: true }).map((entry) => ({
        name: entry.name,
        kind: entry.isSymbolicLink()
          ? "symlink" as const
          : entry.isFile()
            ? "file" as const
            : entry.isDirectory() ? "directory" as const : "other" as const,
      }));
    },
    async lstat(path) {
      const entry = lstatSync(path);
      return entry.isSymbolicLink()
        ? "symlink"
        : entry.isFile()
          ? "file"
          : entry.isDirectory() ? "directory" : "other";
    },
    async realpath(path) {
      return realpathSync(path);
    },
    ...overrides,
  };
}

describe("canonical convergence evidence v2", () => {
  it("never turns blockedReason or current Git into evidence when no canonical attempt exists", async () => {
    const f = fixture();
    const event = {
      ...base(f, "run_invalidated"),
      type: "run_invalidated" as const,
      reason: { code: "manual" as const, message: "Pretend tests passed", details: {} },
    };
    apply(f, event);
    f.currentGit = { revision: "unrelated-current-head", workspaceFingerprint: OTHER_WORKSPACE };

    await expect(derive(f)).resolves.toEqual({
      evidence: [], gaps: [], verifiedAttempts: [], reusableEvidenceGroupIds: [],
    });
  });

  it.each([
    ["verification_failed", "FAIL" as const, []],
    ["review_failed", "PASS" as const, [createReviewFindingV2({
      severity: "important",
      check: "requirements",
      description: "A required scenario is missing",
    })]],
  ])("derives original bound fail evidence and a gap for %s", async (result, verdict, findings) => {
    const f = fixture({ mode: "hook-driven" });
    addAttempt(f, { verdict, findings });
    f.currentGit = { revision: "newer-untrusted-head", workspaceFingerprint: OTHER_WORKSPACE };

    const assessment = await derive(f);

    expect(assessment.verifiedAttempts).toHaveLength(1);
    expect(assessment.verifiedAttempts[0]!.result).toBe(result);
    expect(assessment.evidence).toEqual([expect.objectContaining({
      status: "fail",
      planningRevision: PLAN,
      observedGitRevision: "baseline",
      workspaceFingerprint: WORKSPACE,
    })]);
    expect(assessment.gaps).toEqual([expect.objectContaining({
      id: "run-run-a-group-1-attempt-1",
    })]);
  });

  it("emits one current-final PASS only after every approved attempt, commit, triage, and final event validates", async () => {
    const f = fixture({ groups: 2, mode: "hook-driven" });
    const finding = createReviewFindingV2({
      severity: "suggestion",
      check: "maintainability",
      description: "A follow-up refactor is optional",
    });
    const triage = createFindingTriageV2({
      findingFingerprint: finding.fingerprint,
      disposition: "accepted-risk",
      actor: { id: "human-reviewer", kind: "human" },
      reason: "Accepted for this release",
      occurredAt: "2026-06-01T00:00:01.000Z",
    });
    addAttempt(f, { verdict: "PASS", findings: [finding], triage: [triage] });
    const firstCommit = commitCurrent(f);
    addAttempt(f, { verdict: "PASS" });
    const finalCommit = commitCurrent(f);
    finalize(f);

    const assessment = await derive(f);

    expect(firstCommit).toBe("commit-1");
    expect(finalCommit).toBe("commit-2");
    expect(f.state.phase).toBe("done");
    expect(assessment.verifiedAttempts).toHaveLength(2);
    expect(assessment.verifiedAttempts[0]!.triage).toEqual([triage]);
    expect(assessment.evidence).toEqual([{
      id: "run:run-a:final",
      planningRevision: PLAN,
      observedGitRevision: "commit-2",
      workspaceFingerprint: WORKSPACE,
      status: "pass",
      summary: "2 Task Group(s) have canonical approved attempts and commits",
    }]);
    expect(assessment.gaps).toEqual([]);
  });

  it("retains strict final PASS evidence when convergence invalidates an already finalized run", async () => {
    const f = fixture();
    addAttempt(f, { verdict: "PASS" });
    commitCurrent(f);
    finalize(f);
    invalidate(f);

    const assessment = await derive(f);

    expect(f.state).toMatchObject({
      phase: "invalidated",
      git: { finalRevision: "commit-1" },
      groups: { "1": { status: "completed" } },
    });
    expect(f.events.map((record) => record.event.type)).toEqual([
      "run_initialized",
      "bundle_submitted",
      "evaluation_completed",
      "group_commit_acknowledged",
      "run_finalized",
      "run_invalidated",
    ]);
    expect(assessment.evidence).toEqual([{
      id: "run:run-a:final",
      planningRevision: PLAN,
      observedGitRevision: "commit-1",
      workspaceFingerprint: WORKSPACE,
      status: "pass",
      summary: "1 Task Group(s) have canonical approved attempts and commits",
    }]);
    expect(assessment.gaps).toEqual([]);
  });

  it("fails closed when Git becomes stale after a finalized run is invalidated", async () => {
    const f = fixture();
    addAttempt(f, { verdict: "PASS" });
    commitCurrent(f);
    finalize(f);
    invalidate(f);
    f.currentGit = { revision: "moved-after-invalidation", workspaceFingerprint: OTHER_WORKSPACE };

    await expect(derive(f)).rejects.toMatchObject({
      code: "canonical_git_mismatch",
      details: {
        expectedRevision: "commit-1",
        actualRevision: "moved-after-invalidation",
      },
    });
  });

  it("strictly verifies every completed group before finalization without requiring run_finalized", async () => {
    const f = fixture({ groups: 2 });
    addAttempt(f, { verdict: "PASS" });
    commitCurrent(f);
    addAttempt(f, { verdict: "PASS" });
    commitCurrent(f);

    const summary = await assertFinalization(f);

    expect(f.state.phase).toBe("awaiting_finalize");
    expect(f.events.some((record) => record.event.type === "run_finalized")).toBe(false);
    expect(summary).toMatchObject({
      runId: "run-a",
      planningRevision: PLAN,
      completedGroupIds: ["1", "2"],
      canonicalGroupIds: ["1", "2"],
      trustedLegacyGroupIds: [],
      finalGitRevision: "commit-2",
      workspaceFingerprint: WORKSPACE,
    });
    expect(summary.verifiedAttempts).toHaveLength(2);
  });

  it("revalidates a completed prefix from a partially invalidated successor source", async () => {
    const { source, successor } = partialSuccessorFixture();

    await expect(assertFinalization(successor, [], source)).resolves.toMatchObject({
      runId: "run-successor",
      completedGroupIds: ["1", "2"],
      reusedSuccessorGroupIds: ["1"],
      canonicalGroupIds: ["2"],
    });
  });

  it("rejects changed successor fingerprints, commits, and source events without mutation", async () => {
    const changedAttempt = partialSuccessorFixture();
    const attemptEvents = structuredClone(changedAttempt.successor.events);
    writeFileSync(resolve(
      changedAttempt.source.attemptPaths.get("1:1")!,
      "artifacts/result.txt",
    ), "tampered source attempt\n", "utf8");
    await expect(assertFinalization(
      changedAttempt.successor,
      [],
      changedAttempt.source,
    )).rejects.toMatchObject({ code: "canonical_hash_mismatch" });
    expect(changedAttempt.successor.events).toEqual(attemptEvents);

    const changedFingerprint = partialSuccessorFixture((group) => {
      group.taskGroupFingerprint = hash("8");
    });
    const fingerprintEvents = structuredClone(changedFingerprint.successor.events);
    await expect(assertFinalization(
      changedFingerprint.successor,
      [],
      changedFingerprint.source,
    )).rejects.toMatchObject({ code: "canonical_finalization_invalid" });
    expect(changedFingerprint.successor.events).toEqual(fingerprintEvents);

    const changedCommit = partialSuccessorFixture((group) => {
      group.commit.revision = "forged-source-commit";
    });
    const commitEvents = structuredClone(changedCommit.successor.events);
    await expect(assertFinalization(
      changedCommit.successor,
      [],
      changedCommit.source,
    )).rejects.toMatchObject({ code: "canonical_finalization_invalid" });
    expect(changedCommit.successor.events).toEqual(commitEvents);

    const changedEvent = partialSuccessorFixture();
    const sourceSnapshot = structuredClone(changedEvent.source.events);
    const commitRecord = changedEvent.source.events.find(
      (record) => record.event.type === "group_commit_acknowledged",
    )!;
    if (commitRecord.event.type === "group_commit_acknowledged") {
      commitRecord.event.commitRevision = "tampered-event-commit";
    }
    await expect(assertFinalization(
      changedEvent.successor,
      [],
      changedEvent.source,
    )).rejects.toMatchObject({ code: "canonical_event_chain_invalid" });
    expect(changedEvent.successor.events.some((record) => record.event.type === "run_finalized"))
      .toBe(false);
    changedEvent.source.events = sourceSnapshot;
  });

  it("rejects stale Git, non-advancing commits, and missing attempt artifacts before finalization", async () => {
    const stale = fixture();
    addAttempt(stale, { verdict: "PASS" });
    commitCurrent(stale);
    stale.currentGit.revision = "moved-before-finalize";
    await expect(assertFinalization(stale)).rejects.toMatchObject({
      code: "canonical_git_mismatch",
      details: { expectedRevision: "commit-1", actualRevision: "moved-before-finalize" },
    });
    expect(stale.events.some((record) => record.event.type === "run_finalized")).toBe(false);

    const repeated = fixture({ groups: 2 });
    addAttempt(repeated, { verdict: "PASS" });
    commitCurrent(repeated, "same-commit");
    addAttempt(repeated, { verdict: "PASS" });
    commitCurrent(repeated, "same-commit");
    await expect(assertFinalization(repeated)).rejects.toMatchObject({
      code: "canonical_finalization_invalid",
    });

    const missing = fixture();
    addAttempt(missing, { verdict: "PASS" });
    commitCurrent(missing);
    unlinkSync(resolve(missing.attemptPaths.get("1:1")!, "evidence.json"));
    await expect(assertFinalization(missing)).rejects.toMatchObject({
      code: "canonical_attempt_missing",
    });
    expect(missing.events.some((record) => record.event.type === "run_finalized")).toBe(false);
  });

  it("allows only explicitly trusted legacy migration groups to omit canonical attempts", async () => {
    const legacy = fixture();
    replaceWithTrustedLegacyFinalization(legacy);

    await expect(assertFinalization(legacy, ["1"])).resolves.toMatchObject({
      completedGroupIds: ["1"],
      canonicalGroupIds: [],
      trustedLegacyGroupIds: ["1"],
      finalGitRevision: "baseline",
      verifiedAttempts: [],
    });
    await expect(assertFinalization(legacy)).rejects.toMatchObject({
      code: "canonical_finalization_invalid",
    });
    await expect(assertFinalization(legacy, ["1", "1"])).rejects.toMatchObject({
      code: "canonical_finalization_invalid",
    });

    const canonical = fixture();
    await expect(assertFinalization(canonical, ["missing"])).rejects.toMatchObject({
      code: "canonical_finalization_invalid",
    });
  });

  it("rejects finalization assessment outside awaiting_finalize", async () => {
    const f = fixture();
    await expect(assertFinalization(f)).rejects.toMatchObject({
      code: "canonical_finalization_invalid",
      details: { phase: "awaiting_group_result" },
    });
  });

  it("binds retry triage only to the exact later attempt, never retroactively by fingerprint", async () => {
    const f = fixture({ mode: "self-driven" });
    const finding = createReviewFindingV2({
      severity: "important",
      check: "requirements",
      description: "The same finding persists into the retry",
    });
    addAttempt(f, { verdict: "PASS", findings: [finding], bundleId: "attempt-one" });
    expect(f.state).toMatchObject({ phase: "fixing", currentAttempt: 2 });
    const triage = createFindingTriageV2({
      findingFingerprint: finding.fingerprint,
      disposition: "dismissed",
      actor: { id: "human", kind: "human" },
      reason: "Resolved by an external guarantee for attempt two",
      occurredAt: "2026-06-01T00:00:03.000Z",
    });
    addAttempt(f, {
      verdict: "PASS",
      findings: [finding],
      triage: [triage],
      bundleId: "attempt-two",
    });
    commitCurrent(f);
    finalize(f);

    const assessment = await derive(f);

    expect(assessment.verifiedAttempts.map((attempt) => ({
      bundleId: attempt.bundleId,
      result: attempt.result,
      triage: attempt.triage.length,
    }))).toEqual([
      { bundleId: "attempt-one", result: "review_failed", triage: 0 },
      { bundleId: "attempt-two", result: "pass", triage: 1 },
    ]);
    expect(assessment.evidence).toEqual([expect.objectContaining({ status: "pass" })]);
  });

  it("fails closed when current final Git does not match the durable finalize chain", async () => {
    const f = fixture();
    addAttempt(f, { verdict: "PASS" });
    commitCurrent(f);
    finalize(f);
    f.currentGit.revision = "moved-head";

    await expect(derive(f)).rejects.toMatchObject({
      code: "canonical_git_mismatch",
    });
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinked attemptsRoot, group, whole attempt, and review-triage ancestry without writes",
    async () => {
      for (const target of ["root", "group", "attempt", "triage"] as const) {
        const f = fixture();
        addAttempt(f, { verdict: "PASS" });
        commitCurrent(f);
        const eventSnapshot = structuredClone(f.events);
        if (target === "root") {
          const real = resolve(f.root, "real-attempts");
          renameSync(f.attemptsRoot, real);
          symlinkSync(real, f.attemptsRoot, "dir");
        } else if (target === "group") {
          const group = resolve(f.attemptsRoot, "1");
          const real = resolve(f.root, "real-group");
          renameSync(group, real);
          symlinkSync(real, group, "dir");
        } else if (target === "attempt") {
          const attempt = resolve(f.attemptsRoot, "1/1");
          const real = resolve(f.root, "real-attempt");
          renameSync(attempt, real);
          symlinkSync(real, attempt, "dir");
        } else {
          const real = resolve(f.root, "real-triage.jsonl");
          renameSync(f.triagePath, real);
          symlinkSync(real, f.triagePath, "file");
        }
        await expect(derive(f)).rejects.toMatchObject({
          code: target === "triage" ? "canonical_triage_invalid" : "canonical_attempt_corrupt",
        });
        await expect(assertFinalization(f)).rejects.toMatchObject({
          code: target === "triage" ? "canonical_triage_invalid" : "canonical_attempt_corrupt",
        });
        expect(f.events).toEqual(eventSnapshot);
        expect(f.events.some((record) => record.event.type === "run_finalized")).toBe(false);
      }
    },
  );

  it("fails closed for deleted and malformed required attempt artifacts", async () => {
    const deleted = fixture();
    addAttempt(deleted, { verdict: "FAIL" });
    unlinkSync(resolve(deleted.attemptPaths.get("1:1")!, "evidence.json"));
    await expect(derive(deleted)).rejects.toMatchObject({
      code: "canonical_attempt_missing",
    });

    const corrupt = fixture();
    addAttempt(corrupt, { verdict: "FAIL" });
    writeFileSync(resolve(corrupt.attemptPaths.get("1:1")!, "bundle.json"), "{bad-json", "utf8");
    await expect(derive(corrupt)).rejects.toMatchObject({
      code: "canonical_attempt_corrupt",
    });
  });

  it("detects evidence, review, marker, and triage tampering", async () => {
    const evidence = fixture();
    addAttempt(evidence, { verdict: "FAIL" });
    const evidencePath = resolve(evidence.attemptPaths.get("1:1")!, "evidence.json");
    const evidenceValue = JSON.parse(readFileSync(evidencePath, "utf8"));
    evidenceValue.evidence[0].command = "tampered command";
    writeFileSync(evidencePath, JSON.stringify(evidenceValue), "utf8");
    await expect(derive(evidence)).rejects.toMatchObject({ code: "canonical_evidence_invalid" });

    const review = fixture();
    const finding = createReviewFindingV2({ severity: "important", check: "security", description: "Finding" });
    addAttempt(review, { verdict: "PASS", findings: [finding] });
    const reviewPath = resolve(review.attemptPaths.get("1:1")!, "review.json");
    const reviewValue = JSON.parse(readFileSync(reviewPath, "utf8"));
    reviewValue.findings[0].description = "Tampered finding";
    writeFileSync(reviewPath, JSON.stringify(reviewValue), "utf8");
    await expect(derive(review)).rejects.toMatchObject({ code: "canonical_review_invalid" });

    const marker = fixture();
    addAttempt(marker, { verdict: "FAIL" });
    const markerPath = resolve(marker.attemptPaths.get("1:1")!, "bundle.json");
    const markerValue = JSON.parse(readFileSync(markerPath, "utf8"));
    markerValue.bundleHash = hash("8");
    writeFileSync(markerPath, JSON.stringify(markerValue), "utf8");
    await expect(derive(marker)).rejects.toMatchObject({ code: "canonical_hash_mismatch" });

    const triageFixture = fixture();
    const triagedFinding = createReviewFindingV2({ severity: "suggestion", check: "style", description: "Optional" });
    const accepted = createFindingTriageV2({
      findingFingerprint: triagedFinding.fingerprint,
      disposition: "dismissed",
      actor: { id: "human", kind: "human" },
      reason: "Not applicable",
      occurredAt: "2026-06-01T00:00:01.000Z",
    });
    addAttempt(triageFixture, { verdict: "PASS", findings: [triagedFinding], triage: [accepted] });
    triageFixture.triage[0]!.reason = "Tampered reason";
    persistTriage(triageFixture);
    await expect(derive(triageFixture)).rejects.toMatchObject({ code: "canonical_triage_invalid" });

    const artifact = fixture();
    addAttempt(artifact, { verdict: "FAIL" });
    writeFileSync(resolve(artifact.attemptPaths.get("1:1")!, "artifacts/result.txt"), "tampered\n", "utf8");
    await expect(derive(artifact)).rejects.toMatchObject({ code: "canonical_hash_mismatch" });

    const missingArtifact = fixture();
    addAttempt(missingArtifact, { verdict: "FAIL" });
    unlinkSync(resolve(missingArtifact.attemptPaths.get("1:1")!, "artifacts/result.txt"));
    await expect(derive(missingArtifact)).rejects.toMatchObject({ code: "canonical_hash_mismatch" });

    const extra = fixture();
    addAttempt(extra, { verdict: "FAIL" });
    writeFileSync(resolve(extra.attemptPaths.get("1:1")!, "unlisted.txt"), "unlisted\n", "utf8");
    await expect(derive(extra)).rejects.toMatchObject({ code: "canonical_hash_mismatch" });
  });

  it("rejects unsafe manifest aliases, extra directories, and symlink artifacts", async () => {
    const unsafe = fixture();
    addAttempt(unsafe, { verdict: "FAIL" });
    const markerPath = resolve(unsafe.attemptPaths.get("1:1")!, "bundle.json");
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    marker.artifactManifest["artifacts/nested/../result.txt"] = marker.artifactManifest["artifacts/result.txt"];
    writeFileSync(markerPath, JSON.stringify(marker), "utf8");
    await expect(derive(unsafe)).rejects.toMatchObject({ code: "canonical_attempt_corrupt" });

    const extraDirectory = fixture();
    addAttempt(extraDirectory, { verdict: "FAIL" });
    mkdirSync(resolve(extraDirectory.attemptPaths.get("1:1")!, "artifacts/empty"));
    await expect(derive(extraDirectory)).rejects.toMatchObject({ code: "canonical_hash_mismatch" });

    if (process.platform !== "win32") {
      const symlink = fixture();
      addAttempt(symlink, { verdict: "FAIL" });
      symlinkSync("result.txt", resolve(symlink.attemptPaths.get("1:1")!, "artifacts/alias.txt"));
      await expect(derive(symlink)).rejects.toMatchObject({ code: "canonical_attempt_corrupt" });
    }
  });

  it("rejects stale planning/task-group/baseline binding without rewriting it", async () => {
    const f = fixture();
    addAttempt(f, { verdict: "FAIL", planningRevision: hash("7") });

    await expect(derive(f)).rejects.toMatchObject({
      code: "canonical_binding_mismatch",
    });
  });

  it("rejects orphan triage and an event log that needs recovery", async () => {
    const f = fixture();
    addAttempt(f, { verdict: "FAIL" });
    f.triage.push({
      schemaVersion: 2,
      runId: f.state.runId,
      groupId: "1",
      attempt: 1,
      bundleId: "bundle-1-1",
      findingFingerprint: hash("8"),
      action: "dismissed",
      actor: { kind: "human", id: "human" },
      reason: "Orphan",
      occurredAt: "2026-06-01T00:00:01.000Z",
    });
    persistTriage(f);
    await expect(derive(f)).rejects.toMatchObject({ code: "canonical_triage_invalid" });

    const recovering = inspection(f);
    recovering.recoveryRequired = true;
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: recovering,
      attemptsRoot: f.attemptsRoot,
      reviewTriagePath: f.triagePath,
      currentGit: f.currentGit,
    })).rejects.toBeInstanceOf(CanonicalConvergenceEvidenceErrorV2);
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: recovering,
      attemptsRoot: f.attemptsRoot,
      reviewTriagePath: f.triagePath,
      currentGit: f.currentGit,
    })).rejects.toMatchObject({ code: "canonical_recovery_required" });
  });

  it("fails closed for every malformed canonical inspection boundary", async () => {
    const empty: LoopStoreInspectionV2 = {
      current: null,
      state: null,
      events: [],
      recovered: false,
      repairedTrailingEvent: false,
    };
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: empty,
      attemptsRoot: resolve(tmpdir(), "unused-attempts"),
      currentGit: { revision: "head", workspaceFingerprint: WORKSPACE },
    })).resolves.toEqual({
      evidence: [], gaps: [], verifiedAttempts: [], reusableEvidenceGroupIds: [],
    });

    const noTriage = fixture();
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: inspection(noTriage),
      attemptsRoot: noTriage.attemptsRoot,
      currentGit: noTriage.currentGit,
    })).resolves.toEqual({
      evidence: [], gaps: [], verifiedAttempts: [], reusableEvidenceGroupIds: [],
    });

    const f = fixture();
    const withEventsNoState = inspection(f);
    withEventsNoState.state = null;
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: withEventsNoState,
      attemptsRoot: f.attemptsRoot,
      currentGit: f.currentGit,
    })).rejects.toMatchObject({ code: "canonical_event_chain_invalid" });

    const invalidState = inspection(f);
    invalidState.state!.schemaVersion = 1 as 2;
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: invalidState,
      attemptsRoot: f.attemptsRoot,
      currentGit: f.currentGit,
    })).rejects.toMatchObject({ code: "canonical_state_invalid" });

    const noEvents = inspection(f);
    noEvents.events = [];
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: noEvents,
      attemptsRoot: f.attemptsRoot,
      currentGit: f.currentGit,
    })).rejects.toMatchObject({ code: "canonical_event_chain_invalid" });

    const invalidRecord = inspection(f);
    invalidRecord.events[0]!.schemaVersion = 1 as 2;
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: invalidRecord,
      attemptsRoot: f.attemptsRoot,
      currentGit: f.currentGit,
    })).rejects.toMatchObject({ code: "canonical_event_chain_invalid" });

    const replayMismatch = inspection(f);
    replayMismatch.events[0]!.postState.owner.id = "tampered-owner";
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: replayMismatch,
      attemptsRoot: f.attemptsRoot,
      currentGit: f.currentGit,
    })).rejects.toMatchObject({ code: "canonical_event_chain_invalid" });

    const latestMismatch = inspection(f);
    latestMismatch.state!.owner.id = "different-valid-owner";
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: latestMismatch,
      attemptsRoot: f.attemptsRoot,
      currentGit: f.currentGit,
    })).rejects.toMatchObject({ code: "canonical_event_chain_invalid" });
  });

  it("rejects malformed markers, reviews, and bound triage variants", async () => {
    const markerArray = fixture();
    addAttempt(markerArray, { verdict: "FAIL" });
    writeFileSync(resolve(markerArray.attemptPaths.get("1:1")!, "bundle.json"), "[]", "utf8");
    await expect(derive(markerArray)).rejects.toMatchObject({ code: "canonical_attempt_corrupt" });

    const markerSchema = fixture();
    addAttempt(markerSchema, { verdict: "FAIL" });
    const markerSchemaPath = resolve(markerSchema.attemptPaths.get("1:1")!, "bundle.json");
    const invalidMarker = JSON.parse(readFileSync(markerSchemaPath, "utf8"));
    invalidMarker.schemaVersion = 1;
    writeFileSync(markerSchemaPath, JSON.stringify(invalidMarker), "utf8");
    await expect(derive(markerSchema)).rejects.toMatchObject({ code: "canonical_attempt_corrupt" });

    const missingManifest = fixture();
    addAttempt(missingManifest, { verdict: "FAIL" });
    const missingManifestPath = resolve(missingManifest.attemptPaths.get("1:1")!, "bundle.json");
    const withoutManifest = JSON.parse(readFileSync(missingManifestPath, "utf8"));
    delete withoutManifest.artifactManifest;
    writeFileSync(missingManifestPath, JSON.stringify(withoutManifest), "utf8");
    await expect(derive(missingManifest)).rejects.toMatchObject({ code: "canonical_attempt_corrupt" });

    const emptyManifest = fixture();
    addAttempt(emptyManifest, { verdict: "FAIL" });
    const emptyManifestPath = resolve(emptyManifest.attemptPaths.get("1:1")!, "bundle.json");
    const emptyMarker = JSON.parse(readFileSync(emptyManifestPath, "utf8"));
    emptyMarker.artifactManifest = {};
    writeFileSync(emptyManifestPath, JSON.stringify(emptyMarker), "utf8");
    await expect(derive(emptyManifest)).rejects.toMatchObject({ code: "canonical_attempt_corrupt" });

    const caseAlias = fixture();
    addAttempt(caseAlias, { verdict: "FAIL" });
    const caseAliasPath = resolve(caseAlias.attemptPaths.get("1:1")!, "bundle.json");
    const caseMarker = JSON.parse(readFileSync(caseAliasPath, "utf8"));
    caseMarker.artifactManifest["artifacts/RESULT.txt"] = caseMarker.artifactManifest["artifacts/result.txt"];
    writeFileSync(caseAliasPath, JSON.stringify(caseMarker), "utf8");
    await expect(derive(caseAlias)).rejects.toMatchObject({ code: "canonical_attempt_corrupt" });

    const aggregate = fixture();
    addAttempt(aggregate, { verdict: "FAIL" });
    const aggregatePath = resolve(aggregate.attemptPaths.get("1:1")!, "bundle.json");
    const aggregateMarker = JSON.parse(readFileSync(aggregatePath, "utf8"));
    aggregateMarker.artifactHash = hash("8");
    writeFileSync(aggregatePath, JSON.stringify(aggregateMarker), "utf8");
    await expect(derive(aggregate)).rejects.toMatchObject({ code: "canonical_hash_mismatch" });

    const reviewShape = fixture();
    addAttempt(reviewShape, { verdict: "FAIL" });
    writeFileSync(resolve(reviewShape.attemptPaths.get("1:1")!, "review.json"), "{}", "utf8");
    await expect(derive(reviewShape)).rejects.toMatchObject({ code: "canonical_review_invalid" });

    const finding = createReviewFindingV2({ severity: "suggestion", check: "review", description: "Finding" });
    const accepted = createFindingTriageV2({
      findingFingerprint: finding.fingerprint,
      disposition: "dismissed",
      actor: { id: "human", kind: "human" },
      reason: "Reason",
      occurredAt: "2026-06-01T00:00:01.000Z",
    });
    const open = fixture();
    addAttempt(open, { verdict: "PASS", findings: [finding], triage: [accepted] });
    const openPath = resolve(open.attemptPaths.get("1:1")!, "review.json");
    const openReview = JSON.parse(readFileSync(openPath, "utf8"));
    openReview.triage[0] = { ...openReview.triage[0], disposition: "open", reason: null };
    writeFileSync(openPath, JSON.stringify(openReview), "utf8");
    await expect(derive(open)).rejects.toMatchObject({ code: "canonical_review_invalid" });

    const orphanInline = fixture();
    addAttempt(orphanInline, { verdict: "PASS", findings: [finding], triage: [accepted] });
    const orphanPath = resolve(orphanInline.attemptPaths.get("1:1")!, "review.json");
    const orphanReview = JSON.parse(readFileSync(orphanPath, "utf8"));
    orphanReview.triage[0].findingFingerprint = hash("8");
    writeFileSync(orphanPath, JSON.stringify(orphanReview), "utf8");
    await expect(derive(orphanInline)).rejects.toMatchObject({ code: "canonical_review_invalid" });
  });

  it("rejects malformed, invalid, and duplicate run-level triage JSONL", async () => {
    const malformed = fixture();
    addAttempt(malformed, { verdict: "FAIL" });
    writeFileSync(malformed.triagePath, "{bad\n", "utf8");
    await expect(derive(malformed)).rejects.toMatchObject({ code: "canonical_triage_invalid" });

    const invalid = fixture();
    addAttempt(invalid, { verdict: "FAIL" });
    writeFileSync(invalid.triagePath, JSON.stringify({ schemaVersion: 2, runId: "wrong" }) + "\n", "utf8");
    await expect(derive(invalid)).rejects.toMatchObject({ code: "canonical_triage_invalid" });

    const finding = createReviewFindingV2({ severity: "suggestion", check: "x", description: "x" });
    const triage = createFindingTriageV2({
      findingFingerprint: finding.fingerprint,
      disposition: "dismissed",
      actor: { id: "human", kind: "human" },
      reason: "x",
      occurredAt: "2026-06-01T00:00:01.000Z",
    });
    const invalidTime = fixture();
    addAttempt(invalidTime, { verdict: "PASS", findings: [finding], triage: [triage] });
    invalidTime.triage[0]!.occurredAt = "not-a-time";
    persistTriage(invalidTime);
    await expect(derive(invalidTime)).rejects.toMatchObject({ code: "canonical_triage_invalid" });

    const duplicate = fixture();
    addAttempt(duplicate, { verdict: "PASS", findings: [finding], triage: [triage] });
    duplicate.triage.push(structuredClone(duplicate.triage[0]!));
    persistTriage(duplicate);
    await expect(derive(duplicate)).rejects.toMatchObject({ code: "canonical_triage_invalid" });

    const conflicting = fixture();
    addAttempt(conflicting, { verdict: "PASS", findings: [finding], triage: [triage] });
    conflicting.triage.push({
      ...structuredClone(conflicting.triage[0]!),
      action: "accepted-risk",
      reason: "Conflicting disposition",
    });
    persistTriage(conflicting);
    await expect(derive(conflicting)).rejects.toMatchObject({ code: "canonical_triage_invalid" });
  });

  it("maps filesystem IO failures and unsafe reader entries to structured errors", async () => {
    const readFailure = fixture();
    addAttempt(readFailure, { verdict: "FAIL" });
    const readReader = diskReader({
      async readFile(path) {
        if (path.endsWith("evidence.json")) {
          throw Object.assign(new Error("EACCES"), { code: "EACCES" });
        }
        return readFileSync(path);
      },
    });
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: inspection(readFailure),
      attemptsRoot: readFailure.attemptsRoot,
      reviewTriagePath: readFailure.triagePath,
      currentGit: readFailure.currentGit,
      reader: readReader,
    })).rejects.toMatchObject({ code: "canonical_attempt_corrupt" });

    const listFailure = fixture();
    addAttempt(listFailure, { verdict: "FAIL" });
    const listReader = diskReader({
      async listDirectory() {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      },
    });
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: inspection(listFailure),
      attemptsRoot: listFailure.attemptsRoot,
      reviewTriagePath: listFailure.triagePath,
      currentGit: listFailure.currentGit,
      reader: listReader,
    })).rejects.toMatchObject({ code: "canonical_attempt_corrupt" });

    const unsafe = fixture();
    addAttempt(unsafe, { verdict: "FAIL" });
    const unsafeReader = diskReader({
      async listDirectory() {
        return [{ name: "../escape", kind: "file" }];
      },
    });
    await expect(deriveCanonicalConvergenceEvidenceV2({
      inspection: inspection(unsafe),
      attemptsRoot: unsafe.attemptsRoot,
      reviewTriagePath: unsafe.triagePath,
      currentGit: unsafe.currentGit,
      reader: unsafeReader,
    })).rejects.toMatchObject({ code: "canonical_attempt_corrupt" });
  });

  it("detects partial evaluation, semantic event mismatch, and a non-advancing done commit", async () => {
    const partial = fixture();
    addAttempt(partial, { verdict: "PASS" });
    partial.events.pop();
    partial.state = structuredClone(partial.events.at(-1)!.postState);
    await expect(derive(partial)).rejects.toMatchObject({ code: "canonical_event_mismatch" });

    const semantic = fixture({ mode: "hook-driven" });
    addAttempt(semantic, { verdict: "FAIL" });
    const submitted = semantic.events[1]!.postState;
    const original = semantic.events[2]!.event;
    if (original.type !== "evaluation_completed") throw new Error("fixture event mismatch");
    const changed = {
      ...original,
      result: "review_failed" as const,
      reason: { code: "review_findings" as const, message: "wrong semantic result", details: {} },
    };
    const changedRecord = reduceLoopEventV2(submitted, changed);
    semantic.events[2] = changedRecord;
    semantic.state = changedRecord.postState;
    await expect(derive(semantic)).rejects.toMatchObject({ code: "canonical_event_mismatch" });

    const chain = fixture();
    addAttempt(chain, { verdict: "PASS" });
    commitCurrent(chain, "baseline");
    finalize(chain);
    await expect(derive(chain)).rejects.toMatchObject({ code: "canonical_done_incomplete" });
  });

  it("uses completed canonical attempts but not uncommitted PASS as non-done evidence", async () => {
    const uncommitted = fixture();
    addAttempt(uncommitted, { verdict: "PASS" });
    await expect(derive(uncommitted)).resolves.toMatchObject({ evidence: [], gaps: [] });

    const partialRun = fixture({ groups: 2 });
    addAttempt(partialRun, { verdict: "PASS" });
    commitCurrent(partialRun);
    const assessment = await derive(partialRun);
    expect(assessment.evidence).toEqual([expect.objectContaining({
      status: "pass",
      observedGitRevision: "baseline",
      workspaceFingerprint: WORKSPACE,
    })]);
    expect(assessment.gaps).toEqual([]);
  });
});
