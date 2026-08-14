import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  computeDeliveryBindingDigest,
  digestValue,
  loadChangeContract,
  writeChangeSource,
  writeChangeTraceability,
  type LoadedChangeContract,
  type RfcSliceSource,
} from "../src/lib/change-contract.js";
import { validateContractProvenance } from "../src/lib/contract-provenance.js";
import { GitWorkspaceV2 } from "../src/lib/git-workspace-v2.js";
import {
  assertArchiveCloseoutIntegrityV3,
  beginArchiveV3,
  assertGroupBridgeCheckpointV3,
  adoptAmendmentV3,
  canonicalEvidenceFilesV3,
  completeLocalArchiveV3,
  createRepairSuccessorV3,
  completeTaskGroupV3,
  completeTrackerArchiveV3,
  commitPlanningBaselineV3,
  finishArchiveV3,
  lifecycleTokenV3,
  materializeArchiveEvidenceV3,
  startApplyV3,
  submitHumanQaV3,
  submitHumanReviewV3,
  submitVerifyV3,
  writePlanningBridgeCheckpointV3,
  type LifecyclePlanV3,
  type LifecycleV3Dependencies,
} from "../src/lib/lifecycle-v3.js";
import { LoopStoreV3 } from "../src/lib/loop-store-v3.js";
import {
  acceptRfc,
  bindRfcSliceCas,
  createRfcDraft,
  ensureFoundationRfc,
  loadRfcDelivery,
  resolveAcceptedRfcSlice,
  resolveAcceptedRfcSliceForAmendmentAdoption,
} from "../src/lib/rfc.js";
import {
  createInitialRunStateV3,
  createRunInitializedEventV3,
  type ArtifactHashV3,
  type RunStateV3,
} from "../src/lib/run-contract-v3.js";
import { featureIssueMarker, repositoryIdentity } from "../src/lib/tracker.js";
import { writeProposeIntent } from "../src/lib/workflow-intent.js";

const H = `sha256:${"a".repeat(64)}` as ArtifactHashV3;
const H2 = `sha256:${"b".repeat(64)}` as ArtifactHashV3;
const H3 = `sha256:${"c".repeat(64)}` as ArtifactHashV3;
const INTENT_KEY = "d".repeat(64);

interface Harness {
  root: string;
  store: LoopStoreV3;
  dependencies: LifecycleV3Dependencies;
  plan: LifecyclePlanV3;
  setHead(value: string): void;
  setClean(value: boolean): void;
  setStatus(value: string): void;
  setChangedPaths(paths: string[]): void;
  setParents(revision: string, parents: string[]): void;
}

function harness(tracked = false): Harness {
  const root = mkdtempSync(resolve(tmpdir(), "corgispec-lifecycle-v3-"));
  writeFileSync(resolve(root, ".gitignore"), ".corgi/loop/\n.corgi/transactions/\n*.log\n");
  for (const evidence of [
    "test.log",
    "qa.log",
    "integration.log",
    "failure.log",
    "repair.log",
  ]) {
    writeFileSync(resolve(root, evidence), `${evidence} evidence\n`);
  }
  const changeRoot = resolve(root, "openspec/changes/change-a");
  mkdirSync(changeRoot, { recursive: true });
  const source = {
    schemaVersion: 1 as const,
    kind: "maintenance" as const,
    deliveryRef: "maintenance/change-a",
    maintenance: {
      category: "test-only" as const,
      description: "coverage",
      reason: "coverage",
      boundary: "tests",
      contractRefs: ["spec:test"],
    },
    acceptance: [{ id: "AC-001", evidence: "both" as const }],
    tracker: tracked
      ? {
          provider: "github" as const,
          idempotencyKey: INTENT_KEY,
          issue: { id: "42", url: "https://example.test/issues/42" },
        }
      : { provider: "none" as const, idempotencyKey: INTENT_KEY },
  };
  const contract: LoadedChangeContract = {
    sourcePath: resolve(changeRoot, "corgi/source.yaml"),
    traceabilityPath: resolve(changeRoot, "corgi/traceability.yaml"),
    source,
    traceability: {
      schemaVersion: 1,
      sourceDigest: H2,
      acceptance: [{
        id: "AC-001",
        evidence: "both",
        planningRefs: [{ path: "tasks.md" }],
        taskGroups: ["1"],
      }],
    },
    sourceDigest: H2,
    traceabilityDigest: H3,
  };
  const plan: LifecyclePlanV3 = {
    projectRoot: root,
    changeName: "change-a",
    changeRoot,
    planningArtifactPaths: [resolve(changeRoot, "tasks.md")],
    planningRevision: H,
    contract,
    binding: {
      kind: "maintenance",
      deliveryRef: source.deliveryRef,
      rfcId: null,
      rfcDigest: null,
      acceptedCommit: null,
      sliceId: null,
      sourcePath: "openspec/changes/change-a/corgi/source.yaml",
      sourceDigest: H2,
      traceabilityPath: "openspec/changes/change-a/corgi/traceability.yaml",
      traceabilityDigest: H3,
      acceptance: [{ id: "AC-001", evidence: "both", taskGroups: ["1"] }],
      tracker: structuredClone(source.tracker),
    },
    groups: [{ id: "1", fingerprint: H3 }],
    blockers: [],
  };
  const store = new LoopStoreV3(root);
  writeProposeIntent(root, {
    schemaVersion: 1,
    operation: "propose",
    key: INTENT_KEY,
    deliveryRef: source.deliveryRef,
    changeName: "change-a",
    headRevision: "base",
    stage: "complete",
    sourceDigest: H2,
    updatedAt: "2026-08-14T00:00:00.000Z",
  });
  let head = "base";
  let clean = true;
  let status = "";
  let changedPaths = ["test/change-a.test.ts"];
  const parents = new Map<string, string[]>([
    ["commit-1", ["base"]],
    ["repair-commit", ["commit-1"]],
    ["archive-closeout", ["commit-1"]],
  ]);
  const git = {
    snapshot: async () => ({
      headRevision: head,
      treeRevision: `tree-${head}`,
      workspaceFingerprint: H,
      clean,
      status,
    }),
    verifyCommittedWorkspace: async (fingerprint: string) => ({
      headRevision: head,
      treeRevision: `tree-${head}`,
      workspaceFingerprint: fingerprint,
      clean,
      status,
      commitTreeFingerprint: fingerprint,
    }),
    changedPaths: async () => changedPaths,
    commitParents: async (revision: string) => parents.get(revision) ?? [],
  } as unknown as GitWorkspaceV2;
  let sequence = 0;
  const dependencies: LifecycleV3Dependencies = {
    createStore: () => store,
    createGit: () => git,
    inspectPlan: async () => plan,
    runId: () => "run-a",
    nonce: () => `nonce-${++sequence}`,
    intentId: () => "archive-a",
    now: () => `2026-08-14T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    verifyArchiveCheckpoint: () => ({
      archivedRoot: resolve(root, "openspec/changes/archive/2026-08-14-change-a"),
    }),
    assertGroupBridgeCheckpoint: () => undefined,
    writePlanningBridgeCheckpoint: () => undefined,
  };
  return {
    root,
    store,
    dependencies,
    plan,
    setHead: (value) => { head = value; },
    setClean: (value) => { clean = value; },
    setStatus: (value) => { status = value; },
    setChangedPaths: (paths) => { changedPaths = paths; },
    setParents: (revision, values) => { parents.set(revision, values); },
  };
}

async function applied(h: Harness): Promise<RunStateV3> {
  let state = await startApplyV3({
    projectRoot: h.root,
    changeName: "change-a",
    sessionId: "session-a",
    owner: { id: "agent", kind: "agent" },
  }, h.dependencies);
  h.setHead("commit-1");
  state = await completeTaskGroupV3({
    projectRoot: h.root,
    changeName: "change-a",
    token: lifecycleTokenV3(state),
    groupId: "1",
    workspaceFingerprint: H,
    evidence: {
      schemaVersion: 3,
      groupId: "1",
      checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }],
      automatedReview: { verdict: "pass", findings: [] },
      artifacts: ["test.log"],
      summary: "Task Group complete",
    },
  }, h.dependencies);
  return state;
}

async function verified(h: Harness): Promise<RunStateV3> {
  const state = await applied(h);
  return await submitVerifyV3({
    projectRoot: h.root,
    changeName: "change-a",
    token: lifecycleTokenV3(state),
    report: {
      checks: [{ name: "test", status: "pass", evidenceRefs: ["test.log"] }],
      acceptance: [{
        id: "AC-001",
        automated: "pass",
        human: "not_applicable",
        evidenceRefs: ["test.log"],
      }],
    },
  }, h.dependencies);
}

async function reviewed(h: Harness): Promise<RunStateV3> {
  const state = await verified(h);
  return await submitHumanReviewV3({
    projectRoot: h.root,
    changeName: "change-a",
    token: lifecycleTokenV3(state),
    decision: "approve",
    reviewer: "human",
  }, h.dependencies);
}

async function readyForArchive(h: Harness): Promise<RunStateV3> {
  const state = await reviewed(h);
  return await submitHumanQaV3({
    projectRoot: h.root,
    changeName: "change-a",
    token: lifecycleTokenV3(state),
    report: {
      verdict: "pass",
      reviewer: "human",
      evidenceRefs: ["qa.log"],
      acceptance: [{ id: "AC-001", automated: "not_applicable", human: "pass", evidenceRefs: ["qa.log"] }],
    },
  }, h.dependencies);
}

async function archiving(h: Harness): Promise<RunStateV3> {
  const state = await readyForArchive(h);
  return await beginArchiveV3({
    projectRoot: h.root,
    changeName: "change-a",
    token: lifecycleTokenV3(state),
  }, h.dependencies);
}

describe("Run Contract v3 lifecycle services", () => {
  it("requires the Task Group commit bridge checkpoint to name the next Run state", async () => {
    const h = harness();
    const state = await startApplyV3({
      projectRoot: h.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies);
    mkdirSync(resolve(h.root, "memory"), { recursive: true });
    writeFileSync(resolve(h.root, "memory/session-bridge.md"), [
      "# Session Bridge",
      "- **RFC**: maintenance",
      "- **RFC Revision**: rfc-exempt",
      "- **Slice**: maintenance",
      "- **Issue**: none",
      "- **Change**: change-a",
      `- **Worktree**: ${h.root}`,
      "- **Phase at Checkpoint**: awaiting_verify",
      "- **Task Group at Checkpoint**: 1",
      `- **Observed Run Revision**: ${state.stateRevision + 1}`,
      "- **Last Verified HEAD**: base",
      "",
    ].join("\n"));
    expect(() => assertGroupBridgeCheckpointV3({
      projectRoot: h.root,
      state,
      groupId: "1",
      headRevision: "base",
      nextPhase: "awaiting_verify",
    })).not.toThrow();
    writeFileSync(resolve(h.root, "memory/session-bridge.md"), "# broken\n");
    expect(() => assertGroupBridgeCheckpointV3({
      projectRoot: h.root,
      state,
      groupId: "1",
      headRevision: "base",
      nextPhase: "awaiting_verify",
    })).toThrowError(expect.objectContaining({ code: "BRIDGE_CHECKPOINT_STALE" }));
  });

  it("rejects missing evidence files before acknowledging a Task Group", async () => {
    const h = harness();
    let state = await startApplyV3({
      projectRoot: h.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies);
    h.setHead("commit-1");
    await expect(completeTaskGroupV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      groupId: "1",
      workspaceFingerprint: H,
      evidence: {
        schemaVersion: 3,
        groupId: "1",
        checks: [{ name: "unit", status: "pass", evidenceRefs: ["missing.log"] }],
        automatedReview: { verdict: "pass", findings: [] },
        artifacts: ["missing.log"],
        summary: "invalid evidence must not advance the Run",
      },
    }, h.dependencies)).rejects.toMatchObject({ code: "EVIDENCE_REFERENCE_MISSING" });
    state = h.store.inspect("change-a", state.runId).state!;
    expect(state).toMatchObject({ phase: "applying", currentGroupId: "1" });
  });

  it("refuses Archive when captured evidence bytes are tampered", async () => {
    const h = harness();
    let state = await verified(h);
    state = await submitHumanReviewV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      decision: "approve",
      reviewer: "human",
    }, h.dependencies);
    state = await submitHumanQaV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: {
        verdict: "pass",
        reviewer: "human",
        evidenceRefs: ["qa.log"],
        acceptance: [{ id: "AC-001", automated: "not_applicable", human: "pass", evidenceRefs: ["qa.log"] }],
      },
    }, h.dependencies);
    state = await beginArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    const blobs = resolve(h.root, ".corgi/loop/change-a/runs/run-a/references/blobs");
    const blob = readdirSync(blobs)[0]!;
    writeFileSync(resolve(blobs, blob), "tampered evidence\n");
    await expect(materializeArchiveEvidenceV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies)).rejects.toMatchObject({ code: "LOOP_EVIDENCE_REFERENCE_CONFLICT" });
  });

  it("rejects multiple commits hidden inside one Task Group acknowledgement", async () => {
    const h = harness();
    const state = await startApplyV3({
      projectRoot: h.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies);
    h.setHead("multi-commit-head");

    await expect(completeTaskGroupV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      groupId: "1",
      workspaceFingerprint: H,
      evidence: {
        schemaVersion: 3,
        groupId: "1",
        checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }],
        automatedReview: { verdict: "pass", findings: [] },
        artifacts: ["test.log"],
        summary: "Task Group complete",
      },
    }, h.dependencies)).rejects.toMatchObject({ code: "GROUP_COMMIT_NOT_ATOMIC" });
  });

  it("turns missing Verify AC coverage into canonical implementation repair", async () => {
    const h = harness();
    const state = await applied(h);
    const failed = await submitVerifyV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: {
        checks: [{ name: "test", status: "pass", evidenceRefs: ["test.log"] }],
        acceptance: [],
      },
    }, h.dependencies);
    expect(failed).toMatchObject({ phase: "repair_required", repair: { kind: "implementation", failedPhase: "verify" } });
  });

  it("enforces Human QA skip reasons and routes failed paths to a repair successor", async () => {
    const h = harness();
    const state = await reviewed(h);
    await expect(submitHumanQaV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: { verdict: "skipped", reviewer: "human", reason: "docs only" },
    }, h.dependencies)).rejects.toMatchObject({ code: "RUN_QA_SKIP_INVALID" });

    const skipped = await submitHumanQaV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: {
        verdict: "skipped",
        reviewer: "human",
        reason: "no runtime path exists",
        noRuntimeImpact: true,
      },
    }, h.dependencies);
    expect(skipped.phase).toBe("ready_for_archive");

    const other = harness();
    const qaState = await reviewed(other);
    const failed = await submitHumanQaV3({
      projectRoot: other.root,
      changeName: "change-a",
      token: lifecycleTokenV3(qaState),
      report: {
        verdict: "fail",
        reviewer: "human",
        reason: "user path failed",
        acceptance: [{ id: "AC-001", automated: "not_applicable", human: "fail", evidenceRefs: ["qa.log"] }],
      },
    }, other.dependencies);
    expect(failed).toMatchObject({ phase: "repair_required", repair: { failedPhase: "human_qa" } });
  });

  it("keeps a tracked archive resumable between local and provider closeout", async () => {
    const h = harness(true);
    let state = await reviewed(h);
    expect(state.groups["1"]?.trackerCheckpoint).toMatch(
      /corgispec:checkpoint:v3 run=run-a group=1 key=[a-f0-9]{64}/,
    );
    state = await submitHumanQaV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: {
        verdict: "pass",
        reviewer: "human",
        evidenceRefs: ["qa.log"],
        acceptance: [{ id: "AC-001", automated: "not_applicable", human: "pass", evidenceRefs: ["qa.log"] }],
      },
    }, h.dependencies);
    state = await beginArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    h.setHead("unverified-commit");
    await expect(materializeArchiveEvidenceV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies)).rejects.toMatchObject({ code: "ARCHIVE_FINAL_REVISION_CHANGED" });
    h.setHead("commit-1");
    const first = await materializeArchiveEvidenceV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    const repeated = await materializeArchiveEvidenceV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    expect(repeated).toMatchObject({ idempotent: true, evidenceManifestHash: first.evidenceManifestHash });
    h.setHead("archive-closeout");
    state = await completeLocalArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      evidenceManifestHash: first.evidenceManifestHash,
      archivedRoot: resolve(h.root, "openspec/changes/archive/2026-08-14-change-a"),
      deliveryPage: resolve(h.root, "wiki/deliveries/maintenance-change-a.md"),
      deliveryRevision: null,
      closeoutCommit: "archive-closeout",
    }, h.dependencies);
    expect(state).toMatchObject({ phase: "archiving", archive: { localCompleted: true, trackerCompleted: false } });
    expect(h.store.inspect("change-a", state.runId).state).toMatchObject({ archive: { localCompleted: true } });
    state = await completeTrackerArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    state = await finishArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    expect(state.phase).toBe("archived");
  });

  it("requires one append-only Repair Task Group and carries predecessor evidence", async () => {
    const h = harness();
    let failed = await applied(h);
    failed = await submitVerifyV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(failed),
      report: {
        checks: [{ name: "integration", status: "pass", evidenceRefs: ["integration.log"] }],
        acceptance: [{
          id: "AC-001",
          automated: "fail",
          human: "not_applicable",
          evidenceRefs: ["failure.log"],
        }],
      },
    }, h.dependencies);
    expect(failed.phase).toBe("repair_required");

    await expect(createRepairSuccessorV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(failed),
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies)).rejects.toMatchObject({ code: "REPAIR_TASK_GROUP_REQUIRED" });

    h.plan.groups = [...h.plan.groups, { id: "2", fingerprint: H }];
    h.plan.planningRevision = H2;
    h.dependencies.runId = () => "run-repair";
    let successor = await createRepairSuccessorV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(failed),
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies);
    expect(successor).toMatchObject({
      phase: "planning_ready",
      supersedesRunId: failed.runId,
      currentGroupId: "2",
      groups: {
        "1": { status: "completed", carriedFromRunId: failed.runId },
        "2": { status: "pending" },
      },
    });
    successor = await startApplyV3({
      projectRoot: h.root,
      changeName: "change-a",
      sessionId: successor.sessionId,
      owner: successor.owner,
    }, h.dependencies);
    h.setHead("repair-commit");
    successor = await completeTaskGroupV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(successor),
      groupId: "2",
      workspaceFingerprint: H,
      evidence: {
        schemaVersion: 3,
        groupId: "2",
        checks: [{ name: "repair", status: "pass", evidenceRefs: ["repair.log"] }],
        automatedReview: { verdict: "pass", findings: [] },
        artifacts: ["repair.log"],
        summary: "Repair complete",
      },
    }, h.dependencies);
    expect(successor).toMatchObject({ phase: "awaiting_verify", groups: { "1": { status: "completed" }, "2": { status: "completed" } } });
  });

  it("adopts an Amendment in two stages, then invalidates the predecessor with retry recovery", async () => {
    const h = harness();
    const changeRoot = h.plan.changeRoot;
    const git = (...args: string[]) => execFileSync("git", args, { cwd: h.root, encoding: "utf8" }).trim();
    git("init", "-b", "main");
    git("config", "user.email", "human@example.test");
    git("config", "user.name", "Human Reviewer");
    writeFileSync(resolve(h.root, "openspec/config.yaml"), [
      "schema: custom",
      "corgi:",
      "  contract: rfc-v1",
      "  rfcRoot: rfcs",
      "  foundation: RFC-0001-project-foundation",
      "  governance:",
      "    integrationBranch: main",
      "  tracking:",
      "    provider: none",
      "",
    ].join("\n"));
    const completeRfc = (rfcId: string, sliceId: string, outcome: string) => {
      writeFileSync(resolve(h.root, "rfcs", rfcId, "rfc.md"), [
        `# ${rfcId}`,
        "",
        "## Goal",
        outcome,
        "",
        "## Non-goals",
        "No independent Slice.",
        "",
        "## Boundary",
        "Only the current Slice.",
        "",
        "## Slices",
        `### ${sliceId}: Current Slice`,
        "- AC-001 [evidence: both]: The outcome is observable.",
        "",
        "## Risks",
        "Compatibility.",
        "",
      ].join("\n"));
    };
    ensureFoundationRfc({ projectDir: h.root });
    completeRfc("RFC-0001-project-foundation", "S-01-project-foundation", "Establish the project contract.");
    acceptRfc({
      projectDir: h.root,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
    const original = createRfcDraft({ projectDir: h.root, slug: "old" });
    completeRfc(original.metadata.id, "S-01-example", "Deliver the original boundary.");
    acceptRfc({
      projectDir: h.root,
      rfcId: original.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    git("add", ".");
    git("commit", "-m", "accept original RFC");
    const effectiveOriginal = resolveAcceptedRfcSlice({
      projectDir: h.root,
      rfcId: original.metadata.id,
      sliceId: "S-01-example",
    });
    const originalDeliveryRef = `${effectiveOriginal.rfc.metadata.id}/${effectiveOriginal.slice.id}`;
    const originalMarker = featureIssueMarker({
      repository: repositoryIdentity(h.root),
      deliveryRef: originalDeliveryRef,
      rfcDigest: effectiveOriginal.rfc.digest,
    });
    const oldSource: RfcSliceSource = {
      schemaVersion: 1,
      kind: "rfc-slice",
      deliveryRef: originalDeliveryRef,
      rfc: {
        id: effectiveOriginal.rfc.metadata.id,
        path: relative(h.root, effectiveOriginal.rfc.directory).replace(/\\/gu, "/"),
        acceptedCommit: effectiveOriginal.acceptedCommit,
        digest: `sha256:${effectiveOriginal.rfc.digest}`,
      },
      slice: { id: effectiveOriginal.slice.id, digest: digestValue(effectiveOriginal.slice) },
      acceptance: effectiveOriginal.slice.acceptanceCriteria.map(({ id, evidence }) => ({ id, evidence })),
      deliveryBindingDigest: computeDeliveryBindingDigest({
        rfcId: effectiveOriginal.rfc.metadata.id,
        sliceId: effectiveOriginal.slice.id,
        change: "change-a",
        issue: { provider: "none" },
      }),
      tracker: { provider: "none", idempotencyKey: originalMarker.key },
    };
    const oldSourceDigest = writeChangeSource(changeRoot, oldSource) as ArtifactHashV3;
    const oldTraceabilityDigest = writeChangeTraceability(changeRoot, {
      schemaVersion: 1,
      sourceDigest: oldSourceDigest,
      acceptance: [{
        id: "AC-001",
        evidence: "both",
        planningRefs: [{ path: "tasks.md" }],
        taskGroups: ["1"],
      }],
    }) as ArtifactHashV3;
    const originalDelivery = loadRfcDelivery(h.root, effectiveOriginal.rfc.metadata.id);
    bindRfcSliceCas({
      projectDir: h.root,
      rfcId: effectiveOriginal.rfc.metadata.id,
      sliceId: effectiveOriginal.slice.id,
      expectedRevision: originalDelivery.revision,
      binding: {
        change: "change-a",
        issue: { provider: "none" },
        sourceDigest: oldSourceDigest,
        plannedAt: "2026-08-14T00:00:00.000Z",
      },
    });
    h.plan.contract = loadChangeContract(changeRoot, { required: true })!;
    h.plan.binding = {
      ...h.plan.binding,
      kind: "rfc-slice",
      deliveryRef: oldSource.deliveryRef,
      rfcId: oldSource.rfc.id,
      rfcDigest: oldSource.rfc.digest,
      acceptedCommit: oldSource.rfc.acceptedCommit,
      sliceId: oldSource.slice.id,
      sourceDigest: oldSourceDigest,
      traceabilityDigest: oldTraceabilityDigest,
    };
    writeProposeIntent(h.root, {
      schemaVersion: 1,
      operation: "propose",
      key: originalMarker.key,
      deliveryRef: oldSource.deliveryRef,
      changeName: "change-a",
      headRevision: "base",
      stage: "complete",
      sourceDigest: oldSourceDigest,
      updatedAt: "2026-08-14T00:00:00.000Z",
    });
    let state = await verified(h);
    state = await submitHumanReviewV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      decision: "require-rfc-amendment",
      reviewer: "human",
      reason: "the accepted boundary is incomplete",
    }, h.dependencies);
    const predecessorToken = lifecycleTokenV3(state);
    const amendment = createRfcDraft({
      projectDir: h.root,
      slug: "amend-example",
      amends: original.metadata.id,
    });
    completeRfc(amendment.metadata.id, "S-01-example", "Revise the current Slice boundary.");
    acceptRfc({
      projectDir: h.root,
      rfcId: amendment.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    git("add", ".");
    git("commit", "-m", "accept Amendment RFC");
    const acceptedAmendment = resolveAcceptedRfcSliceForAmendmentAdoption({
      projectDir: h.root,
      rfcId: amendment.metadata.id,
      sliceId: "S-01-example",
    });
    const effectiveAmendment = {
      rfcId: acceptedAmendment.rfc.metadata.id,
      amends: original.metadata.id,
      directory: acceptedAmendment.rfc.directory,
      acceptedCommit: acceptedAmendment.acceptedCommit,
      digest: `sha256:${acceptedAmendment.rfc.digest}` as ArtifactHashV3,
      slice: {
        id: acceptedAmendment.slice.id,
        digest: digestValue(acceptedAmendment.slice) as ArtifactHashV3,
        acceptance: acceptedAmendment.slice.acceptanceCriteria.map(({ id, evidence }) => ({ id, evidence })),
      },
    };
    h.dependencies.resolveAmendment = () => ({
      ...effectiveAmendment,
      slice: { ...effectiveAmendment.slice, id: "S-02-independent" },
    });
    await expect(adoptAmendmentV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: predecessorToken,
      sessionId: "session-successor",
      owner: { id: "agent", kind: "agent" },
      rfcId: amendment.metadata.id,
    }, h.dependencies)).rejects.toMatchObject({ code: "RFC_AMENDMENT_NEW_SLICE_REQUIRES_NEW_CHANGE" });
    delete h.dependencies.resolveAmendment;
    h.dependencies.resolveChangeContract = async () => ({
      changeRoot,
      contract: loadChangeContract(changeRoot, { required: true })!,
    });
    const prepared = await adoptAmendmentV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: predecessorToken,
      sessionId: "session-successor",
      owner: { id: "agent", kind: "agent" },
      rfcId: amendment.metadata.id,
    }, h.dependencies);
    expect(prepared).toMatchObject({
      status: "reconciliation_required",
      blockers: expect.arrayContaining([
        "TRACEABILITY_MISSING_PLANNING_REF: AC-001",
        "TRACEABILITY_MISSING_TASK_GROUP: AC-001",
      ]),
    });
    const amended = loadChangeContract(changeRoot, { required: true })!;
    expect(amended.source).toMatchObject({ kind: "rfc-slice", rfc: { id: amendment.metadata.id } });
    expect(amended.source.deliveryRef).toBe(`${amendment.metadata.id}/S-01-example`);
    expect(loadRfcDelivery(h.root, amendment.metadata.id).slices["S-01-example"]).toMatchObject({
      status: "planned",
      binding: { change: "change-a", issue: { provider: "none" }, sourceDigest: amended.sourceDigest },
    });
    expect(loadRfcDelivery(h.root, original.metadata.id).slices["S-01-example"]).toMatchObject({
      status: "superseded",
      supersededBy: { rfcId: amendment.metadata.id, sliceId: "S-01-example" },
    });
    expect(validateContractProvenance(h.root, "change-a", amended)).toEqual([]);
    const reconciledTraceDigest = writeChangeTraceability(changeRoot, {
      schemaVersion: 1,
      sourceDigest: amended.sourceDigest,
      acceptance: [{
        id: "AC-001",
        evidence: "both",
        planningRefs: [{ path: "tasks.md" }],
        taskGroups: ["1", "2"],
      }],
    }) as ArtifactHashV3;
    h.plan.contract = loadChangeContract(changeRoot, { required: true })!;
    h.plan.planningRevision = H2;
    h.plan.groups = [
      ...h.plan.groups,
      { id: "2", fingerprint: H },
    ];
    h.plan.binding = {
      ...h.plan.binding,
      deliveryRef: amended.source.deliveryRef,
      rfcId: amended.source.kind === "rfc-slice" ? amended.source.rfc.id : null,
      rfcDigest: amended.source.kind === "rfc-slice" ? amended.source.rfc.digest : null,
      acceptedCommit: amended.source.kind === "rfc-slice" ? amended.source.rfc.acceptedCommit : null,
      sliceId: amended.source.kind === "rfc-slice" ? amended.source.slice.id : null,
      sourceDigest: amended.sourceDigest as ArtifactHashV3,
      traceabilityDigest: reconciledTraceDigest,
      acceptance: [{ id: "AC-001", evidence: "both", taskGroups: ["1", "2"] }],
      tracker: structuredClone(amended.source.tracker),
    };
    h.dependencies.runId = () => "run-b";
    const adopted = await adoptAmendmentV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: predecessorToken,
      sessionId: "session-successor",
      owner: { id: "agent", kind: "agent" },
      rfcId: amendment.metadata.id,
    }, h.dependencies);
    expect(adopted.status).toBe("successor_created");
    const successor = adopted.state!;
    expect(successor).toMatchObject({
      phase: "planning_ready",
      supersedesRunId: "run-a",
      contract: { rfcId: amendment.metadata.id },
    });
    expect(h.store.inspect("change-a", "run-a").state?.phase).toBe("invalidated");
    const retry = await adoptAmendmentV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: predecessorToken,
      sessionId: "session-successor",
      owner: { id: "agent", kind: "agent" },
      rfcId: amendment.metadata.id,
    }, h.dependencies);
    expect(retry.state?.runId).toBe(successor.runId);
  });

  it("creates one planning-baseline commit only for the planning allowlist", async () => {
    const h = harness();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: h.root, encoding: "utf8" }).trim();
    git("init");
    git("config", "user.email", "corgi@example.test");
    git("config", "user.name", "Coding Corgi");
    writeFileSync(resolve(h.root, "README.md"), "base\n");
    git("add", "README.md", ".gitignore");
    git("commit", "-m", "base");
    writeFileSync(resolve(h.plan.changeRoot, "tasks.md"), "## 1. Plan\n- [ ] 1.1 task\n");
    const before = git("rev-parse", "HEAD");
    const committed = await commitPlanningBaselineV3(h.plan, new GitWorkspaceV2(h.root));
    expect(committed).toMatchObject({ clean: true });
    expect(committed.headRevision).not.toBe(before);
    expect(git("log", "-1", "--format=%s")).toBe("chore(corgi): establish change-a planning baseline");

    const rogueChangeFile = resolve(h.plan.changeRoot, "implementation.ts");
    writeFileSync(rogueChangeFile, "export const mixed = true;\n");
    await expect(commitPlanningBaselineV3(h.plan, new GitWorkspaceV2(h.root)))
      .rejects.toMatchObject({ code: "PLANNING_BASELINE_MIXED_DIRTY" });
    rmSync(rogueChangeFile);

    mkdirSync(resolve(h.root, "src"), { recursive: true });
    writeFileSync(resolve(h.plan.changeRoot, "tasks.md"), "## 1. Plan\n- [x] 1.1 task\n");
    writeFileSync(resolve(h.root, "src/app.ts"), "export const implemented = true;\n");
    const baseline = git("rev-parse", "HEAD");
    await expect(commitPlanningBaselineV3(h.plan, new GitWorkspaceV2(h.root)))
      .rejects.toMatchObject({ code: "PLANNING_BASELINE_MIXED_DIRTY" });
    expect(git("rev-parse", "HEAD")).toBe(baseline);
  });

  it("fails closed when the Propose handoff is incomplete, drifted, or its HEAD moved", async () => {
    const incomplete = harness();
    rmSync(resolve(incomplete.root, ".corgi/transactions/propose", `${INTENT_KEY}.json`));
    await expect(startApplyV3({
      projectRoot: incomplete.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, incomplete.dependencies)).rejects.toMatchObject({ code: "PLANNING_HANDOFF_INCOMPLETE" });

    for (const [label, patch] of [
      ["unfinished stage", { stage: "source_written" }],
      ["wrong change", { changeName: "change-b" }],
      ["wrong delivery", { deliveryRef: "maintenance/change-b" }],
      ["wrong source", { sourceDigest: H3 }],
    ] as const) {
      const h = harness();
      writeProposeIntent(h.root, {
        schemaVersion: 1,
        operation: "propose",
        key: INTENT_KEY,
        deliveryRef: "maintenance/change-a",
        changeName: "change-a",
        headRevision: "base",
        stage: "complete",
        sourceDigest: H2,
        updatedAt: "2026-08-14T00:00:00.000Z",
        ...patch,
      });
      await expect(startApplyV3({
        projectRoot: h.root,
        changeName: "change-a",
        sessionId: "session-a",
        owner: { id: "agent", kind: "agent" },
      }, h.dependencies), label).rejects.toMatchObject({ code: "PLANNING_HANDOFF_INCOMPLETE" });
    }

    const moved = harness();
    moved.setHead("other-commit");
    await expect(startApplyV3({
      projectRoot: moved.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, moved.dependencies)).rejects.toMatchObject({ code: "PLANNING_HANDOFF_HEAD_CHANGED" });

    const blocked = harness();
    blocked.plan.blockers = ["TRACEABILITY_MISSING_TASK_GROUP: AC-001"];
    await expect(startApplyV3({
      projectRoot: blocked.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, blocked.dependencies)).rejects.toMatchObject({ code: "PLANNING_NOT_READY" });
  });

  it("preserves planning ownership while allowing an in-progress Apply retry", async () => {
    const h = harness();
    const planning = createInitialRunStateV3({
      changeName: "change-a",
      runId: "run-planning",
      owner: { id: "agent", kind: "agent" },
      sessionId: "session-a",
      nonce: "planning-nonce",
      planningRevision: h.plan.planningRevision,
      baselineRevision: "base",
      contract: h.plan.binding,
      groups: h.plan.groups,
      startedAt: "2026-08-14T00:00:00.000Z",
    });
    h.store.initialize(planning, createRunInitializedEventV3(planning));
    await expect(startApplyV3({
      projectRoot: h.root,
      changeName: "change-a",
      sessionId: "another-session",
      owner: { id: "other-agent", kind: "agent" },
    }, h.dependencies)).rejects.toMatchObject({ code: "RUN_OWNERSHIP_CONFLICT" });

    const applying = await startApplyV3({
      projectRoot: h.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies);
    const retried = await startApplyV3({
      projectRoot: h.root,
      changeName: "change-a",
      sessionId: "another-session",
      owner: { id: "other-agent", kind: "agent" },
    }, h.dependencies);
    expect(retried).toEqual(applying);
  });

  it("requires every Task Group evidence invariant before recording a commit", async () => {
    const valid = {
      schemaVersion: 3 as const,
      groupId: "1",
      checks: [{ name: "unit", status: "pass" as const, evidenceRefs: ["test.log"] }],
      automatedReview: { verdict: "pass" as const, findings: [] },
      artifacts: ["test.log"],
      summary: "Task Group complete",
    };
    const invalidCases: Array<[string, (value: typeof valid) => void]> = [
      ["schema version", (value) => { value.schemaVersion = 2 as 3; }],
      ["group identity", (value) => { value.groupId = "2"; }],
      ["summary", (value) => { value.summary = " "; }],
      ["checks", (value) => { value.checks = []; }],
      ["check status", (value) => { value.checks[0]!.status = "fail"; }],
      ["check references", (value) => { value.checks[0]!.evidenceRefs = []; }],
      ["check name", (value) => { value.checks[0]!.name = " "; }],
      ["automated review verdict", (value) => { value.automatedReview.verdict = "fail"; }],
      ["automated review findings", (value) => { value.automatedReview.findings.push({ severity: "high", summary: "finding" }); }],
      ["artifact references", (value) => { value.artifacts = []; }],
    ];

    for (const [label, invalidate] of invalidCases) {
      const h = harness();
      const state = await startApplyV3({
        projectRoot: h.root,
        changeName: "change-a",
        sessionId: "session-a",
        owner: { id: "agent", kind: "agent" },
      }, h.dependencies);
      h.setHead("commit-1");
      const evidence = structuredClone(valid);
      invalidate(evidence);
      await expect(completeTaskGroupV3({
        projectRoot: h.root,
        changeName: "change-a",
        token: lifecycleTokenV3(state),
        groupId: "1",
        workspaceFingerprint: H,
        evidence,
      }, h.dependencies), label).rejects.toMatchObject({ code: "GROUP_EVIDENCE_FAILED" });
    }
  });

  it("rejects unsafe Task Group evidence references before they reach the evidence store", async () => {
    for (const [label, reference, setup] of [
      ["empty", "", () => undefined],
      ["URI", "https://example.test/evidence", () => undefined],
      ["parent traversal", "../outside.log", () => undefined],
      ["Git metadata", ".git/config", () => undefined],
      ["directory", "evidence-dir", (root: string) => mkdirSync(resolve(root, "evidence-dir"))],
    ] as const) {
      const h = harness();
      setup(h.root);
      const state = await startApplyV3({
        projectRoot: h.root,
        changeName: "change-a",
        sessionId: "session-a",
        owner: { id: "agent", kind: "agent" },
      }, h.dependencies);
      h.setHead("commit-1");
      await expect(completeTaskGroupV3({
        projectRoot: h.root,
        changeName: "change-a",
        token: lifecycleTokenV3(state),
        groupId: "1",
        workspaceFingerprint: H,
        evidence: {
          schemaVersion: 3,
          groupId: "1",
          checks: [{ name: "unit", status: "pass", evidenceRefs: [reference] }],
          automatedReview: { verdict: "pass", findings: [] },
          artifacts: ["test.log"],
          summary: "invalid evidence reference",
        },
      }, h.dependencies), label).rejects.toMatchObject({
        code: label === "directory" || label === "empty" || label === "URI" || label === "parent traversal" || label === "Git metadata"
          ? "EVIDENCE_REFERENCE_INVALID"
          : "EVIDENCE_REFERENCE_MISSING",
      });
    }
  });

  it("advances multi-Group Apply one atomic commit at a time", async () => {
    const h = harness();
    h.plan.groups = [
      { id: "1", fingerprint: H3 },
      { id: "2", fingerprint: H },
    ];
    h.plan.binding.acceptance = [{ id: "AC-001", evidence: "both", taskGroups: ["1", "2"] }];
    let state = await startApplyV3({
      projectRoot: h.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies);
    h.setHead("commit-1");
    state = await completeTaskGroupV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      groupId: "1",
      workspaceFingerprint: H,
      evidence: {
        schemaVersion: 3,
        groupId: "1",
        checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }],
        automatedReview: { verdict: "pass", findings: [] },
        artifacts: ["test.log"],
        summary: "first Group",
      },
    }, h.dependencies);
    expect(state).toMatchObject({ phase: "applying", currentGroupId: "2" });

    h.setHead("commit-2");
    h.setParents("commit-2", ["commit-1"]);
    state = await completeTaskGroupV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      groupId: "2",
      workspaceFingerprint: H,
      evidence: {
        schemaVersion: 3,
        groupId: "2",
        checks: [{ name: "integration", status: "pass", evidenceRefs: ["integration.log"] }],
        automatedReview: { verdict: "pass", findings: [] },
        artifacts: ["integration.log"],
        summary: "second Group",
      },
    }, h.dependencies);
    expect(state).toMatchObject({ phase: "awaiting_verify", currentGroupId: null });
  });

  it("writes only complete planning bridge checkpoints and rejects malformed bridge templates", () => {
    const h = harness(true);
    const bridgePath = resolve(h.root, "memory/session-bridge.md");
    mkdirSync(resolve(h.root, "memory"), { recursive: true });
    writeFileSync(bridgePath, [
      "# Session Bridge",
      "- **RFC**: stale",
      "- **RFC Revision**: stale",
      "- **Slice**: stale",
      "- **Issue**: stale",
      "- **Change**: stale",
      "- **Worktree**: stale",
      "- **Phase at Checkpoint**: stale",
      "- **Task Group at Checkpoint**: stale",
      "- **Observed Run Revision**: stale",
      "- **Last Verified HEAD**: stale",
      "",
      "## Next Action",
      "- stale action",
      "",
    ].join("\n"));

    writePlanningBridgeCheckpointV3(h.root, h.plan, "base");
    const content = readFileSync(bridgePath, "utf8");
    expect(content).toContain("- **RFC**: maintenance");
    expect(content).toContain("- **Issue**: 42 https://example.test/issues/42");
    expect(content).toContain("- **Phase at Checkpoint**: planning_ready");
    expect(content).toContain("- **Task Group at Checkpoint**: 1");
    expect(content).toContain("- Start Apply for `change-a` Task Group 1.");

    writeFileSync(bridgePath, "# Session Bridge\n- **RFC**: maintenance\n");
    expect(() => writePlanningBridgeCheckpointV3(h.root, h.plan, "base"))
      .toThrowError(expect.objectContaining({ code: "BRIDGE_CHECKPOINT_INVALID" }));
    rmSync(bridgePath);
    expect(() => writePlanningBridgeCheckpointV3(h.root, h.plan, "base"))
      .toThrowError(expect.objectContaining({ code: "BRIDGE_CHECKPOINT_MISSING" }));
  });

  it("rejects missing or stale Run state before applying a lifecycle action", async () => {
    const h = harness();
    const absentStore = {
      inspect: () => ({ state: null }),
    } as unknown as LoopStoreV3;
    await expect(submitVerifyV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: { runId: "unknown", sessionId: "session-a", stateRevision: 0, nonce: "nonce" },
      report: { checks: [], acceptance: [] },
    }, { ...h.dependencies, createStore: () => absentStore })).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });

    let state = await startApplyV3({
      projectRoot: h.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies);
    h.setHead("commit-1");
    const stale = { ...lifecycleTokenV3(state), nonce: "stale-nonce" };
    await expect(completeTaskGroupV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: stale,
      groupId: "1",
      workspaceFingerprint: H,
      evidence: {
        schemaVersion: 3,
        groupId: "1",
        checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }],
        automatedReview: { verdict: "pass", findings: [] },
        artifacts: ["test.log"],
        summary: "stale token must not mutate the Run",
      },
    }, h.dependencies)).rejects.toMatchObject({ code: "RUN_CAS_CONFLICT" });

    h.plan.planningRevision = H2;
    await expect(completeTaskGroupV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      groupId: "1",
      workspaceFingerprint: H,
      evidence: {
        schemaVersion: 3,
        groupId: "1",
        checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }],
        automatedReview: { verdict: "pass", findings: [] },
        artifacts: ["test.log"],
        summary: "planning drift must stop Apply",
      },
    }, h.dependencies)).rejects.toMatchObject({ code: "RUN_PLANNING_CHANGED" });
  });

  it("binds Verify to a clean final commit, closed maintenance scope, and exact AC coverage", async () => {
    const dirty = harness();
    let state = await applied(dirty);
    dirty.setClean(false);
    await expect(submitVerifyV3({
      projectRoot: dirty.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: { checks: [], acceptance: [] },
    }, dirty.dependencies)).rejects.toMatchObject({ code: "VERIFY_WORKTREE_DIRTY" });

    const moved = harness();
    state = await applied(moved);
    moved.setHead("unacknowledged");
    await expect(submitVerifyV3({
      projectRoot: moved.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: { checks: [], acceptance: [] },
    }, moved.dependencies)).rejects.toMatchObject({ code: "VERIFY_UNACKNOWLEDGED_COMMIT" });

    const scoped = harness();
    state = await applied(scoped);
    scoped.setChangedPaths(["src/public-api.ts"]);
    await expect(submitVerifyV3({
      projectRoot: scoped.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: { checks: [], acceptance: [] },
    }, scoped.dependencies)).rejects.toMatchObject({ code: "MAINTENANCE_DIFF_SCOPE_VIOLATION" });

    const humanOnly = harness();
    humanOnly.plan.binding.acceptance = [{ id: "AC-001", evidence: "human", taskGroups: ["1"] }];
    state = await applied(humanOnly);
    const verifiedHumanOnly = await submitVerifyV3({
      projectRoot: humanOnly.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: {
        checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }],
        acceptance: [{ id: "AC-001", automated: "not_applicable", human: "not_applicable", evidenceRefs: ["test.log"] }],
      },
    }, humanOnly.dependencies);
    expect(verifiedHumanOnly.phase).toBe("awaiting_human_review");

    const duplicate = harness();
    state = await applied(duplicate);
    const failedCoverage = await submitVerifyV3({
      projectRoot: duplicate.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: {
        checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }],
        acceptance: [
          { id: "AC-001", automated: "pass", human: "not_applicable", evidenceRefs: ["test.log"] },
          { id: "AC-001", automated: "pass", human: "not_applicable", evidenceRefs: ["test.log"] },
        ],
      },
    }, duplicate.dependencies);
    expect(failedCoverage).toMatchObject({ phase: "repair_required", repair: { failedPhase: "verify" } });
  });

  it("requires canonical Verify before Review and binds Review to the verified clean HEAD", async () => {
    const unverified = harness();
    let state = await applied(unverified);
    await expect(submitHumanReviewV3({
      projectRoot: unverified.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      decision: "approve",
      reviewer: "human",
    }, unverified.dependencies)).rejects.toMatchObject({ code: "VERIFY_REQUIRED" });

    const dirty = harness();
    state = await verified(dirty);
    dirty.setClean(false);
    await expect(submitHumanReviewV3({
      projectRoot: dirty.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      decision: "approve",
      reviewer: "human",
    }, dirty.dependencies)).rejects.toMatchObject({ code: "FINAL_REVISION_CHANGED" });

    const rejected = harness();
    state = await verified(rejected);
    await expect(submitHumanReviewV3({
      projectRoot: rejected.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      decision: "reject-implementation",
      reviewer: "human",
    }, rejected.dependencies)).rejects.toMatchObject({ code: "RUN_REVIEW_REASON_REQUIRED" });
    const implementationRepair = await submitHumanReviewV3({
      projectRoot: rejected.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      decision: "reject-implementation",
      reviewer: "human",
      reason: "implementation does not meet the accepted boundary",
    }, rejected.dependencies);
    expect(implementationRepair).toMatchObject({ phase: "repair_required", repair: { kind: "implementation", failedPhase: "human_review" } });
  });

  it("requires Human QA to bind the approved Review and a real user-path evidence file", async () => {
    const unverified = harness();
    let state = await applied(unverified);
    await expect(submitHumanQaV3({
      projectRoot: unverified.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: { verdict: "pass", reviewer: "human" },
    }, unverified.dependencies)).rejects.toMatchObject({ code: "VERIFY_REQUIRED" });

    const moved = harness();
    state = await reviewed(moved);
    moved.setHead("different-final");
    await expect(submitHumanQaV3({
      projectRoot: moved.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: { verdict: "pass", reviewer: "human", evidenceRefs: ["qa.log"] },
    }, moved.dependencies)).rejects.toMatchObject({ code: "FINAL_REVISION_CHANGED" });

    const emptyEvidence = harness();
    state = await reviewed(emptyEvidence);
    await expect(submitHumanQaV3({
      projectRoot: emptyEvidence.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: { verdict: "pass", reviewer: "human" },
    }, emptyEvidence.dependencies)).rejects.toMatchObject({ code: "RUN_QA_VERDICT_INVALID" });

    const skippedWithCriterion = harness();
    state = await reviewed(skippedWithCriterion);
    await expect(submitHumanQaV3({
      projectRoot: skippedWithCriterion.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: {
        verdict: "skipped",
        reviewer: "human",
        reason: "no runtime path",
        noRuntimeImpact: true,
        acceptance: [{ id: "AC-001", automated: "not_applicable", human: "pass", evidenceRefs: ["qa.log"] }],
      },
    }, skippedWithCriterion.dependencies)).rejects.toMatchObject({ code: "RUN_QA_SKIP_INVALID" });
  });

  it("materializes archive evidence only from a complete quality chain and tolerates a sealed closeout retry", async () => {
    const incomplete = harness();
    const incompleteState = await applied(incomplete);
    expect(() => canonicalEvidenceFilesV3(incompleteState))
      .toThrowError(expect.objectContaining({ code: "ARCHIVE_GATE_INCOMPLETE" }));

    const h = harness();
    let state = await archiving(h);
    expect(canonicalEvidenceFilesV3(state, {
      "1": { artifacts: ["bound-evidence"], checks: [{ evidenceRefs: ["bound-evidence"] }] },
    }).map((file) => file.path)).toContain("groups/1/evidence.json");

    mkdirSync(resolve(h.plan.contract.sourcePath, ".."), { recursive: true });
    writeFileSync(h.plan.contract.sourcePath, "source sentinel\n");
    h.setStatus(" M src/not-archive.ts");
    await expect(materializeArchiveEvidenceV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies)).rejects.toMatchObject({ code: "ARCHIVE_WORKTREE_DIRTY" });

    h.setStatus("");
    const materialized = await materializeArchiveEvidenceV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    h.setHead("archive-closeout");
    const retried = await materializeArchiveEvidenceV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    expect(retried).toMatchObject({ idempotent: true, evidenceManifestHash: materialized.evidenceManifestHash });
  });

  it("recovers archive evidence from exactly one archived Change after the active Change moved", async () => {
    const h = harness();
    const sourceDigest = writeChangeSource(h.plan.changeRoot, h.plan.contract.source) as ArtifactHashV3;
    const traceability = {
      ...h.plan.contract.traceability,
      sourceDigest,
    };
    const traceabilityDigest = writeChangeTraceability(h.plan.changeRoot, traceability) as ArtifactHashV3;
    h.plan.contract = {
      ...h.plan.contract,
      traceability,
      sourceDigest,
      traceabilityDigest,
    };
    h.plan.binding = {
      ...h.plan.binding,
      sourceDigest,
      traceabilityDigest,
    };
    writeProposeIntent(h.root, {
      schemaVersion: 1,
      operation: "propose",
      key: INTENT_KEY,
      deliveryRef: h.plan.contract.source.deliveryRef,
      changeName: "change-a",
      headRevision: "base",
      stage: "complete",
      sourceDigest,
      updatedAt: "2026-08-14T00:00:00.000Z",
    });
    const state = await archiving(h);
    const archiveRoot = resolve(h.root, "openspec/changes/archive/2026-08-14-change-a");
    mkdirSync(resolve(archiveRoot, ".."), { recursive: true });
    renameSync(h.plan.changeRoot, archiveRoot);
    const recovered = await materializeArchiveEvidenceV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    expect(recovered.changeEvidencePath).toBe(resolve(archiveRoot, "evidence"));
  });

  it("fails archive closeout if canonical evidence, closeout ancestry, or the sealed target drifts", async () => {
    const h = harness();
    let state = await archiving(h);
    await expect(assertArchiveCloseoutIntegrityV3(
      h.root,
      state,
      h.dependencies.createGit!(h.root),
      h.dependencies.verifyArchiveCheckpoint,
    )).rejects.toMatchObject({ code: "RUN_ARCHIVE_LOCAL_REQUIRED" });

    const evidence = await materializeArchiveEvidenceV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    await expect(completeLocalArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      evidenceManifestHash: H,
      archivedRoot: resolve(h.root, "openspec/changes/archive/2026-08-14-change-a"),
      deliveryPage: resolve(h.root, "wiki/deliveries/maintenance-change-a.md"),
      deliveryRevision: null,
      closeoutCommit: "archive-closeout",
    }, h.dependencies)).rejects.toMatchObject({ code: "ARCHIVE_EVIDENCE_CHANGED" });

    h.setHead("wrong-closeout");
    await expect(completeLocalArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      evidenceManifestHash: evidence.evidenceManifestHash,
      archivedRoot: resolve(h.root, "openspec/changes/archive/2026-08-14-change-a"),
      deliveryPage: resolve(h.root, "wiki/deliveries/maintenance-change-a.md"),
      deliveryRevision: null,
      closeoutCommit: "archive-closeout",
    }, h.dependencies)).rejects.toMatchObject({ code: "ARCHIVE_CLOSEOUT_COMMIT_CHANGED" });

    h.setHead("archive-closeout");
    h.setParents("archive-closeout", ["wrong-parent"]);
    await expect(completeLocalArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      evidenceManifestHash: evidence.evidenceManifestHash,
      archivedRoot: resolve(h.root, "openspec/changes/archive/2026-08-14-change-a"),
      deliveryPage: resolve(h.root, "wiki/deliveries/maintenance-change-a.md"),
      deliveryRevision: null,
      closeoutCommit: "archive-closeout",
    }, h.dependencies)).rejects.toMatchObject({ code: "ARCHIVE_CLOSEOUT_PARENT_CHANGED" });

    h.setParents("archive-closeout", ["commit-1"]);
    state = await completeLocalArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      evidenceManifestHash: evidence.evidenceManifestHash,
      archivedRoot: resolve(h.root, "openspec/changes/archive/2026-08-14-change-a"),
      deliveryPage: resolve(h.root, "wiki/deliveries/maintenance-change-a.md"),
      deliveryRevision: null,
      closeoutCommit: "archive-closeout",
    }, h.dependencies);

    h.setClean(false);
    await expect(assertArchiveCloseoutIntegrityV3(
      h.root,
      state,
      h.dependencies.createGit!(h.root),
      h.dependencies.verifyArchiveCheckpoint,
    )).rejects.toMatchObject({ code: "ARCHIVE_CLOSEOUT_COMMIT_CHANGED" });

    h.setClean(true);
    await expect(assertArchiveCloseoutIntegrityV3(
      h.root,
      state,
      h.dependencies.createGit!(h.root),
      () => ({ archivedRoot: resolve(h.root, "openspec/changes/archive/different-change") }),
    )).rejects.toMatchObject({ code: "ARCHIVE_TARGET_CHANGED" });

    await expect(completeTrackerArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies)).rejects.toMatchObject({ code: "RUN_TRACKER_NOT_CONFIGURED" });
    const archived = await finishArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    expect(archived.phase).toBe("archived");
  });

  it("requires a strictly append-only, contract-preserving repair successor and resumes its idempotent retry", async () => {
    const active = harness();
    let state = await applied(active);
    await expect(createRepairSuccessorV3({
      projectRoot: active.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
    }, active.dependencies)).rejects.toMatchObject({ code: "REPAIR_NOT_REQUIRED" });

    const failed = async (h: Harness): Promise<RunStateV3> => {
      const appliedState = await applied(h);
      return await submitVerifyV3({
        projectRoot: h.root,
        changeName: "change-a",
        token: lifecycleTokenV3(appliedState),
        report: {
          checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }],
          acceptance: [],
        },
      }, h.dependencies);
    };

    const wrongKind = harness();
    state = await failed(wrongKind);
    await expect(createRepairSuccessorV3({
      projectRoot: wrongKind.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
      amendmentRequired: true,
    }, wrongKind.dependencies)).rejects.toMatchObject({ code: "IMPLEMENTATION_REPAIR_REQUIRED" });

    const sourceDrift = harness();
    state = await failed(sourceDrift);
    sourceDrift.plan.binding.sourceDigest = H;
    sourceDrift.plan.groups = [...sourceDrift.plan.groups, { id: "2", fingerprint: H }];
    await expect(createRepairSuccessorV3({
      projectRoot: sourceDrift.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
    }, sourceDrift.dependencies)).rejects.toMatchObject({ code: "REPAIR_SOURCE_CHANGED" });

    const changedPrefix = harness();
    state = await failed(changedPrefix);
    changedPrefix.plan.groups = [
      { id: "changed", fingerprint: H3 },
      { id: "2", fingerprint: H },
    ];
    await expect(createRepairSuccessorV3({
      projectRoot: changedPrefix.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
    }, changedPrefix.dependencies)).rejects.toMatchObject({ code: "REPAIR_TASK_GROUP_CHANGED" });

    const duplicateGroup = harness();
    state = await failed(duplicateGroup);
    duplicateGroup.plan.groups = [...duplicateGroup.plan.groups, { id: "1", fingerprint: H }];
    await expect(createRepairSuccessorV3({
      projectRoot: duplicateGroup.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
    }, duplicateGroup.dependencies)).rejects.toMatchObject({ code: "REPAIR_TASK_GROUP_DUPLICATE" });

    const successorHarness = harness();
    state = await failed(successorHarness);
    successorHarness.plan.groups = [...successorHarness.plan.groups, { id: "2", fingerprint: H }];
    successorHarness.dependencies.runId = () => "run-repair";
    const token = lifecycleTokenV3(state);
    const successor = await createRepairSuccessorV3({
      projectRoot: successorHarness.root,
      changeName: "change-a",
      token,
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
    }, successorHarness.dependencies);
    const recovered = await createRepairSuccessorV3({
      projectRoot: successorHarness.root,
      changeName: "change-a",
      token,
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
    }, successorHarness.dependencies);
    expect(recovered.runId).toBe(successor.runId);
  });

  it("records a fresh nonce and fails Apply when the planning baseline cannot become clean", async () => {
    const nonceReuse = harness();
    nonceReuse.dependencies.nonce = () => "same-nonce";
    const started = await startApplyV3({
      projectRoot: nonceReuse.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, nonceReuse.dependencies);
    expect(started.nonce).not.toBe("same-nonce");

    const dirtyBaseline = harness();
    dirtyBaseline.dependencies.writePlanningBridgeCheckpoint = () => dirtyBaseline.setClean(false);
    dirtyBaseline.dependencies.commitPlanningBaseline = async () => ({ headRevision: "base", clean: false });
    await expect(startApplyV3({
      projectRoot: dirtyBaseline.root,
      changeName: "change-a",
      sessionId: "session-a",
      owner: { id: "agent", kind: "agent" },
    }, dirtyBaseline.dependencies)).rejects.toMatchObject({ code: "PLANNING_BASELINE_REQUIRED" });
  });

  it("handles clean, failed, and incomplete planning-baseline Git transactions", async () => {
    const h = harness();
    const cleanGit = {
      snapshot: async () => ({ headRevision: "base", clean: true }),
    } as unknown as GitWorkspaceV2;
    const cleanRunner = {
      run: async () => ({ exitCode: 0, signal: null, stdout: "", stderr: "", timedOut: false }),
    };
    await expect(commitPlanningBaselineV3(h.plan, cleanGit, cleanRunner)).resolves.toEqual({ headRevision: "base", clean: true });

    const failedRunner = {
      run: async () => ({ exitCode: 1, signal: null, stdout: "", stderr: "git failed", timedOut: false }),
    };
    await expect(commitPlanningBaselineV3(h.plan, cleanGit, failedRunner))
      .rejects.toMatchObject({ code: "PLANNING_BASELINE_GIT_FAILED" });

    const incompleteGit = {
      snapshot: async () => ({ headRevision: "base", clean: false }),
    } as unknown as GitWorkspaceV2;
    const dirtyPath = "openspec/changes/change-a/tasks.md\0";
    const dirtyRunner = {
      run: async () => ({ exitCode: 0, signal: null, stdout: dirtyPath, stderr: "", timedOut: false }),
    };
    await expect(commitPlanningBaselineV3(h.plan, incompleteGit, dirtyRunner))
      .rejects.toMatchObject({ code: "PLANNING_BASELINE_COMMIT_INCOMPLETE" });
  });

  it("carries predecessor evidence into a repaired Slice archive without recapturing it", async () => {
    const h = harness();
    let state = await applied(h);
    state = await submitVerifyV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: {
        checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }],
        acceptance: [],
      },
    }, h.dependencies);
    h.plan.groups = [...h.plan.groups, { id: "2", fingerprint: H }];
    h.dependencies.runId = () => "run-repair";
    const predecessor = lifecycleTokenV3(state);
    state = await createRepairSuccessorV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: predecessor,
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies);
    state = await startApplyV3({
      projectRoot: h.root,
      changeName: "change-a",
      sessionId: state.sessionId,
      owner: state.owner,
    }, h.dependencies);
    h.setHead("repair-commit");
    state = await completeTaskGroupV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      groupId: "2",
      workspaceFingerprint: H,
      evidence: {
        schemaVersion: 3,
        groupId: "2",
        checks: [{ name: "repair", status: "pass", evidenceRefs: ["repair.log"] }],
        automatedReview: { verdict: "pass", findings: [] },
        artifacts: ["repair.log"],
        summary: "repair Group complete",
      },
    }, h.dependencies);
    state = await submitVerifyV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: {
        checks: [{ name: "integration", status: "pass", evidenceRefs: ["integration.log"] }],
        acceptance: [{ id: "AC-001", automated: "pass", human: "not_applicable", evidenceRefs: ["integration.log"] }],
      },
    }, h.dependencies);
    state = await submitHumanReviewV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      decision: "approve",
      reviewer: "human",
    }, h.dependencies);
    state = await submitHumanQaV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: {
        verdict: "pass",
        reviewer: "human",
        evidenceRefs: ["qa.log"],
        acceptance: [{ id: "AC-001", automated: "not_applicable", human: "pass", evidenceRefs: ["qa.log"] }],
      },
    }, h.dependencies);
    state = await beginArchiveV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    const evidence = await materializeArchiveEvidenceV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, h.dependencies);
    expect(readFileSync(resolve(evidence.changeEvidencePath, "groups/1/evidence.json"), "utf8"))
      .toContain("file:test.log#sha256:");
  });

  it("rejects Amendment adoption unless the repair, RFC target, and retained Slice all match", async () => {
    const implementation = harness();
    let state = await applied(implementation);
    state = await submitVerifyV3({
      projectRoot: implementation.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: { checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }], acceptance: [] },
    }, implementation.dependencies);
    await expect(adoptAmendmentV3({
      projectRoot: implementation.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      sessionId: "amendment-session",
      owner: { id: "agent", kind: "agent" },
      rfcId: "RFC-0002-amendment",
    }, implementation.dependencies)).rejects.toMatchObject({ code: "RFC_AMENDMENT_NOT_REQUIRED" });

    const h = harness();
    h.plan.binding = {
      ...h.plan.binding,
      kind: "rfc-slice",
      deliveryRef: "RFC-0001-example/S-01-example",
      rfcId: "RFC-0001-example",
      rfcDigest: H,
      acceptedCommit: "accepted-rfc",
      sliceId: "S-01-example",
    };
    state = await verified(h);
    state = await submitHumanReviewV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      decision: "require-rfc-amendment",
      reviewer: "human",
      reason: "the accepted boundary must change",
    }, h.dependencies);
    const token = lifecycleTokenV3(state);
    const amendment = (patch: Partial<{
      rfcId: string;
      amends: string;
      sliceId: string;
    }> = {}) => ({
      rfcId: "RFC-0002-amendment",
      amends: "RFC-0001-example",
      directory: resolve(h.root, "rfcs/RFC-0002-amendment"),
      acceptedCommit: "accepted-amendment",
      digest: H,
      slice: {
        id: "S-01-example",
        digest: H,
        acceptance: [{ id: "AC-001", evidence: "both" as const }],
      },
      ...patch,
      ...(patch.sliceId ? { slice: { id: patch.sliceId, digest: H, acceptance: [{ id: "AC-001", evidence: "both" as const }] } } : {}),
    });

    h.dependencies.resolveAmendment = () => amendment({ amends: "RFC-elsewhere" });
    await expect(adoptAmendmentV3({
      projectRoot: h.root,
      changeName: "change-a",
      token,
      sessionId: "amendment-session",
      owner: { id: "agent", kind: "agent" },
      rfcId: "RFC-0002-amendment",
    }, h.dependencies)).rejects.toMatchObject({ code: "RFC_AMENDMENT_TARGET_MISMATCH" });

    h.dependencies.resolveAmendment = () => amendment({ sliceId: "S-02-independent" });
    await expect(adoptAmendmentV3({
      projectRoot: h.root,
      changeName: "change-a",
      token,
      sessionId: "amendment-session",
      owner: { id: "agent", kind: "agent" },
      rfcId: "RFC-0002-amendment",
    }, h.dependencies)).rejects.toMatchObject({ code: "RFC_AMENDMENT_NEW_SLICE_REQUIRES_NEW_CHANGE" });

    h.dependencies.resolveAmendment = () => amendment();
    h.dependencies.resolveChangeContract = async () => ({
      changeRoot: h.plan.changeRoot,
      contract: h.plan.contract,
    });
    await expect(adoptAmendmentV3({
      projectRoot: h.root,
      changeName: "change-a",
      token,
      sessionId: "amendment-session",
      owner: { id: "agent", kind: "agent" },
      rfcId: "RFC-0002-amendment",
    }, h.dependencies)).rejects.toMatchObject({ code: "RFC_SOURCE_REQUIRED" });

    await expect(createRepairSuccessorV3({
      projectRoot: h.root,
      changeName: "change-a",
      token,
      sessionId: "amendment-session",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies)).rejects.toMatchObject({ code: "RFC_AMENDMENT_REQUIRED" });
    h.plan.groups = [...h.plan.groups, { id: "2", fingerprint: H }];
    await expect(createRepairSuccessorV3({
      projectRoot: h.root,
      changeName: "change-a",
      token,
      sessionId: "amendment-session",
      owner: { id: "agent", kind: "agent" },
      amendmentRequired: true,
      expectedRfcId: "RFC-0002-amendment",
    }, h.dependencies)).rejects.toMatchObject({ code: "RFC_AMENDMENT_NOT_ADOPTED" });
  });

  it("fails archive evidence recovery when the active and archived Change contracts cannot be resolved uniquely", async () => {
    const missing = harness();
    const state = await archiving(missing);
    rmSync(missing.plan.changeRoot, { recursive: true });
    await expect(materializeArchiveEvidenceV3({
      projectRoot: missing.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, missing.dependencies)).rejects.toMatchObject({ code: "ARCHIVE_CHANGE_CONTRACT_NOT_FOUND" });
  });

  it("requires a clean verified HEAD and a nonempty archive intent before Archive starts", async () => {
    const dirty = harness();
    let state = await readyForArchive(dirty);
    dirty.setClean(false);
    await expect(beginArchiveV3({
      projectRoot: dirty.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, dirty.dependencies)).rejects.toMatchObject({ code: "FINAL_REVISION_CHANGED" });

    const noIntent = harness();
    state = await readyForArchive(noIntent);
    noIntent.dependencies.intentId = () => "";
    await expect(beginArchiveV3({
      projectRoot: noIntent.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
    }, noIntent.dependencies)).rejects.toMatchObject({ code: "RUN_ARCHIVE_INTENT_INVALID" });
  });

  it("stops repair successor creation if the repair planning baseline remains dirty", async () => {
    const h = harness();
    let state = await applied(h);
    state = await submitVerifyV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      report: { checks: [{ name: "unit", status: "pass", evidenceRefs: ["test.log"] }], acceptance: [] },
    }, h.dependencies);
    h.plan.groups = [...h.plan.groups, { id: "2", fingerprint: H }];
    h.setClean(false);
    h.dependencies.commitPlanningBaseline = async () => ({ headRevision: "commit-1", clean: false });
    await expect(createRepairSuccessorV3({
      projectRoot: h.root,
      changeName: "change-a",
      token: lifecycleTokenV3(state),
      sessionId: "repair-session",
      owner: { id: "agent", kind: "agent" },
    }, h.dependencies)).rejects.toMatchObject({ code: "REPAIR_BASELINE_DIRTY" });
  });
});
