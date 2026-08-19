import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  performLocalArchiveCloseoutV3,
  verifySealedArchiveCheckpointV3,
} from "../src/lib/archive-closeout-v3.js";
import {
  digestValue,
  type MaintenanceSource,
  writeChangeSource,
  writeChangeTraceability,
  type RfcSliceSource,
} from "../src/lib/change-contract.js";
import {
  acceptRfc,
  bindRfcSliceCas,
  createRfcDraft,
  ensureFoundationRfc,
  loadRfcDelivery,
} from "../src/lib/rfc.js";
import type { ArtifactHashV3, RunStateV3 } from "../src/lib/run-contract-v3.js";

const HASH = `sha256:${"a".repeat(64)}` as ArtifactHashV3;

describe("strong local Archive v3 closeout", () => {
  let root = "";

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("resumes after OpenSpec moved the Change and commits delivery, Wiki, and Bridge exactly once", async () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-archive-closeout-"));
    initializeProject(root);
    const feature = createRfcDraft({ projectDir: root, slug: "export" });
    completeRfc(root, feature.metadata.id, "S-01-export");
    acceptRfc({
      projectDir: root,
      rfcId: feature.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
      now: new Date("2026-08-14T00:00:00.000Z"),
    });

    const changeName = "export-data";
    const changeRoot = resolve(root, "openspec/changes", changeName);
    mkdirSync(changeRoot, { recursive: true });
    const delivery = loadRfcDelivery(root, feature.metadata.id);
    const source: RfcSliceSource = {
      schemaVersion: 1,
      kind: "rfc-slice",
      deliveryRef: `${feature.metadata.id}/S-01-export`,
      rfc: {
        id: feature.metadata.id,
        path: relative(root, feature.directory).replace(/\\/gu, "/"),
        acceptedCommit: "1".repeat(40),
        digest: `sha256:${feature.digest}`,
      },
      slice: { id: "S-01-export", digest: HASH },
      acceptance: [{ id: "AC-001", evidence: "both" }],
      deliveryBindingDigest: digestValue({
        rfcId: feature.metadata.id,
        sliceId: "S-01-export",
        revision: delivery.revision,
      }),
      tracker: { provider: "none", idempotencyKey: "local-export" },
    };
    const sourceDigest = writeChangeSource(changeRoot, source) as ArtifactHashV3;
    const traceabilityDigest = writeChangeTraceability(changeRoot, {
      schemaVersion: 1,
      sourceDigest,
      acceptance: [{
        id: "AC-001",
        evidence: "both",
        planningRefs: [{ path: "tasks.md", anchor: "delivery" }],
        taskGroups: ["1"],
      }],
    }) as ArtifactHashV3;
    writeFileSync(resolve(changeRoot, "tasks.md"), "## 1. Delivery\n- [ ] 1.1 implement\n");
    bindRfcSliceCas({
      projectDir: root,
      rfcId: feature.metadata.id,
      sliceId: "S-01-export",
      expectedRevision: delivery.revision,
      binding: {
        change: changeName,
        issue: { provider: "none" },
        sourceDigest,
        plannedAt: "2026-08-14T00:00:00.000Z",
      },
    });
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "verified implementation"]);
    const finalRevision = git(root, ["rev-parse", "HEAD"]);

    const state = archiveState({
      changeName,
      sourceDigest,
      traceabilityDigest,
      finalRevision,
      rfcId: feature.metadata.id,
    });
    mkdirSync(resolve(changeRoot, "evidence"), { recursive: true });
    writeFileSync(resolve(changeRoot, "evidence/manifest.json"), `${JSON.stringify({
      schemaVersion: 3,
      changeName,
      runId: state.runId,
      finalRevision,
      planningRevision: state.planningRevision,
      sourceDigest,
      traceabilityDigest,
      files: [],
      manifestHash: HASH,
    }, null, 2)}\n`);

    const archiveChange = vi.fn(async () => {
      const archivedRoot = resolve(root, "openspec/changes/archive/2026-08-14-export-data");
      mkdirSync(resolve(root, "openspec/changes/archive"), { recursive: true });
      renameSync(changeRoot, archivedRoot);
      return { path: archivedRoot };
    });
    writeFileSync(resolve(root, "unrelated.tmp"), "user work\n");
    await expect(performLocalArchiveCloseoutV3({
      projectRoot: root,
      changeName,
      state,
      evidenceManifestHash: HASH,
    }, { archiveChange })).rejects.toMatchObject({ code: "ARCHIVE_CLOSEOUT_MIXED_DIRTY" });

    const archivedRoot = resolve(root, "openspec/changes/archive/2026-08-14-export-data");
    const archivedTasks = resolve(archivedRoot, "tasks.md");
    const verifiedTasks = readFileSync(archivedTasks);
    writeFileSync(archivedTasks, "tampered after archive move\n");
    await expect(performLocalArchiveCloseoutV3({
      projectRoot: root,
      changeName,
      state,
      evidenceManifestHash: HASH,
    }, { archiveChange })).rejects.toMatchObject({ code: "ARCHIVE_DIGEST_CHANGED" });
    writeFileSync(archivedTasks, verifiedTasks);

    mkdirSync(resolve(root, "openspec/specs"), { recursive: true });
    writeFileSync(resolve(root, "openspec/specs/tampered.md"), "tampered specs\n");
    await expect(performLocalArchiveCloseoutV3({
      projectRoot: root,
      changeName,
      state,
      evidenceManifestHash: HASH,
    }, { archiveChange })).rejects.toMatchObject({ code: "ARCHIVE_DIGEST_CHANGED" });
    rmSync(resolve(root, "openspec/specs"), { recursive: true, force: true });

    rmSync(resolve(root, "unrelated.tmp"));
    const first = await performLocalArchiveCloseoutV3({
      projectRoot: root,
      changeName,
      state,
      evidenceManifestHash: HASH,
    }, { archiveChange });
    const repeated = await performLocalArchiveCloseoutV3({
      projectRoot: root,
      changeName,
      state,
      evidenceManifestHash: HASH,
    }, { archiveChange });

    expect(archiveChange).toHaveBeenCalledTimes(1);
    expect(repeated).toEqual(first);
    expect(git(root, ["status", "--porcelain"])).toBe("");
    expect(git(root, ["log", "-1", "--format=%s"])).toBe(
      `chore(corgi): archive ${feature.metadata.id}/S-01-export`,
    );
    expect(loadRfcDelivery(root, feature.metadata.id).slices["S-01-export"]).toMatchObject({
      status: "archived",
      archive: { evidenceManifest: HASH, commit: finalRevision },
    });
    expect(readFileSync(first.deliveryPage, "utf8")).toContain("| AC-001 | both |");
    expect(readFileSync(resolve(root, "wiki/hot.md"), "utf8")).toContain(source.deliveryRef);
    expect(readFileSync(resolve(root, "memory/session-bridge.md"), "utf8")).toContain(
      "**Phase at Checkpoint**: archiving",
    );
    expect(readFileSync(resolve(root, "wiki/architecture/_index.md"), "utf8")).toContain(source.deliveryRef);
    expect(readFileSync(resolve(root, "wiki/patterns/_index.md"), "utf8")).toContain(source.deliveryRef);
    expect(readFileSync(resolve(root, "memory/MEMORY.md"), "utf8")).toContain(source.deliveryRef);
  });

  it("fails closed on invalid, pending, or missing durable archive checkpoints", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-archive-checkpoint-"));
    initializeProject(root);
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "prepare archive checkpoint"]);
    const finalRevision = git(root, ["rev-parse", "HEAD"]);
    const state = archiveState({
      changeName: "export-data",
      sourceDigest: HASH,
      traceabilityDigest: HASH,
      finalRevision,
      rfcId: "RFC-0001-project-foundation",
    });

    expect(() => verifySealedArchiveCheckpointV3(root, {
      ...state,
      phase: "ready_for_archive",
      archive: null,
    })).toThrowError(expect.objectContaining({ code: "ARCHIVE_NOT_STARTED" }));
    expect(() => verifySealedArchiveCheckpointV3(root, state))
      .toThrowError(expect.objectContaining({ code: "ARCHIVE_JOURNAL_MISSING" }));

    const journal = archiveJournalPath(root, state);
    mkdirSync(resolve(journal, ".."), { recursive: true });
    writeFileSync(journal, "not json\n");
    expect(() => verifySealedArchiveCheckpointV3(root, state))
      .toThrowError(expect.objectContaining({ code: "ARCHIVE_JOURNAL_INVALID" }));

    writeFileSync(journal, `${JSON.stringify({
      schemaVersion: 3,
      intentId: state.archive!.intentId,
      finalRevision,
      activeChangeDigest: HASH,
      stage: "pending",
    })}\n`);
    expect(() => verifySealedArchiveCheckpointV3(root, state))
      .toThrowError(expect.objectContaining({ code: "ARCHIVE_JOURNAL_PENDING" }));

    writeFileSync(journal, `${JSON.stringify({
      schemaVersion: 3,
      intentId: state.archive!.intentId,
      finalRevision,
      activeChangeDigest: HASH,
      stage: "archived",
      archivedRoot: resolve(root, "openspec/changes/archive/missing-export-data"),
      archivedDigest: HASH,
      specsDigest: HASH,
    })}\n`);
    expect(() => verifySealedArchiveCheckpointV3(root, state))
      .toThrowError(expect.objectContaining({ code: "ARCHIVE_TARGET_MISSING" }));
  });

  it("refuses archive entry before it can mutate an unknown Change", async () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-archive-preflight-"));
    initializeProject(root);
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "prepare archive preflight"]);
    const finalRevision = git(root, ["rev-parse", "HEAD"]);
    const state = archiveState({
      changeName: "missing-change",
      sourceDigest: HASH,
      traceabilityDigest: HASH,
      finalRevision,
      rfcId: "RFC-0001-project-foundation",
    });

    await expect(performLocalArchiveCloseoutV3({
      projectRoot: root,
      changeName: state.changeName,
      state: { ...state, phase: "ready_for_archive", archive: null },
      evidenceManifestHash: HASH,
    })).rejects.toMatchObject({ code: "ARCHIVE_NOT_STARTED" });
    await expect(performLocalArchiveCloseoutV3({
      projectRoot: root,
      changeName: state.changeName,
      state: { ...state, finalRevision: "not-the-current-head" },
      evidenceManifestHash: HASH,
    })).rejects.toMatchObject({ code: "ARCHIVE_FINAL_REVISION_CHANGED" });
    await expect(performLocalArchiveCloseoutV3({
      projectRoot: root,
      changeName: state.changeName,
      state,
      evidenceManifestHash: HASH,
    })).rejects.toMatchObject({ code: "ARCHIVE_CHANGE_NOT_FOUND" });
  });

  it("archives a maintenance exemption without manufacturing RFC delivery state", async () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-archive-maintenance-"));
    initializeProject(root);
    const changeName = "guide-cleanup";
    const changeRoot = resolve(root, "openspec/changes", changeName);
    const source: MaintenanceSource = {
      schemaVersion: 1,
      kind: "maintenance",
      deliveryRef: `maintenance/${changeName}`,
      maintenance: {
        category: "docs-only",
        description: "Clarify the local guide.",
        reason: "The public behavior and API remain unchanged.",
        boundary: "Documentation only; no runtime impact.",
        contractRefs: [],
      },
      acceptance: [{ id: "MC-001", evidence: "automated" }],
      tracker: {
        provider: "github",
        idempotencyKey: "maintenance-guide-cleanup",
        issue: { id: "42", url: "https://example.test/issues/42" },
      },
    };
    const sourceDigest = writeChangeSource(changeRoot, source) as ArtifactHashV3;
    const traceabilityDigest = writeChangeTraceability(changeRoot, {
      schemaVersion: 1,
      sourceDigest,
      acceptance: [{
        id: "MC-001",
        evidence: "automated",
        planningRefs: [{ path: "tasks.md", anchor: "guide" }],
        taskGroups: ["1"],
      }],
    }) as ArtifactHashV3;
    writeFileSync(resolve(changeRoot, "tasks.md"), "## 1. Guide\n- [ ] 1.1 clarify\n");
    git(root, ["add", "."]);
    git(root, ["commit", "-m", "verified maintenance"]);
    const finalRevision = git(root, ["rev-parse", "HEAD"]);
    const state = maintenanceArchiveState({ changeName, sourceDigest, traceabilityDigest, finalRevision });
    mkdirSync(resolve(changeRoot, "evidence"), { recursive: true });
    writeFileSync(resolve(changeRoot, "evidence/manifest.json"), `${JSON.stringify({
      schemaVersion: 3,
      changeName,
      runId: state.runId,
      finalRevision,
      planningRevision: state.planningRevision,
      sourceDigest,
      traceabilityDigest,
      files: [],
      manifestHash: HASH,
    }, null, 2)}\n`);
    const archiveChange = vi.fn(async () => {
      const archivedRoot = resolve(root, "openspec/changes/archive/2026-08-14-guide-cleanup");
      mkdirSync(resolve(root, "openspec/changes/archive"), { recursive: true });
      renameSync(changeRoot, archivedRoot);
      return { path: archivedRoot };
    });

    const first = await performLocalArchiveCloseoutV3({
      projectRoot: root,
      changeName,
      state,
      evidenceManifestHash: HASH,
    }, { archiveChange });
    const repeated = await performLocalArchiveCloseoutV3({
      projectRoot: root,
      changeName,
      state,
      evidenceManifestHash: HASH,
    }, { archiveChange });

    expect(first.deliveryRevision).toBeNull();
    expect(repeated).toEqual(first);
    expect(archiveChange).toHaveBeenCalledTimes(1);
    expect(readFileSync(first.deliveryPage, "utf8")).toContain("# maintenance/guide-cleanup");
    expect(readFileSync(first.deliveryPage, "utf8")).toContain("Clarify the local guide.");
    expect(readFileSync(first.deliveryPage, "utf8")).toContain("https://example.test/issues/42");
    expect(readFileSync(resolve(root, "memory/session-bridge.md"), "utf8")).toContain("**RFC**: maintenance");
  });
});

function archiveJournalPath(root: string, state: RunStateV3): string {
  const key = createHash("sha256").update(state.archive!.intentId, "utf8").digest("hex");
  return resolve(root, ".corgi/loop", state.changeName, "archive-closeout", `${key}.json`);
}

function maintenanceArchiveState(input: {
  changeName: string;
  sourceDigest: ArtifactHashV3;
  traceabilityDigest: ArtifactHashV3;
  finalRevision: string;
}): RunStateV3 {
  const base = archiveState({
    changeName: input.changeName,
    sourceDigest: input.sourceDigest,
    traceabilityDigest: input.traceabilityDigest,
    finalRevision: input.finalRevision,
    rfcId: "RFC-0001-project-foundation",
  });
  return {
    ...base,
    contract: {
      ...base.contract,
      kind: "maintenance",
      deliveryRef: `maintenance/${input.changeName}`,
      rfcId: null,
      rfcDigest: null,
      acceptedCommit: null,
      sliceId: null,
      sourcePath: `openspec/changes/${input.changeName}/corgi/source.yaml`,
      sourceDigest: input.sourceDigest,
      traceabilityPath: `openspec/changes/${input.changeName}/corgi/traceability.yaml`,
      traceabilityDigest: input.traceabilityDigest,
      acceptance: [{ id: "MC-001", evidence: "automated", taskGroups: ["1"] }],
      tracker: {
        provider: "github",
        idempotencyKey: "maintenance-guide-cleanup",
        issue: { id: "42", url: "https://example.test/issues/42" },
      },
    },
    verify: {
      ...base.verify!,
      sourceDigest: input.sourceDigest,
      traceabilityDigest: input.traceabilityDigest,
      acceptance: [{ id: "MC-001", automated: "pass", human: "not_applicable", evidenceRefs: ["test.log"] }],
    },
    qa: {
      ...base.qa!,
      acceptance: [{ id: "MC-001", automated: "not_applicable", human: "not_applicable", evidenceRefs: [] }],
    },
  };
}

function initializeProject(root: string): void {
  mkdirSync(resolve(root, "openspec/changes"), { recursive: true });
  mkdirSync(resolve(root, "wiki/deliveries"), { recursive: true });
  mkdirSync(resolve(root, "wiki/architecture"), { recursive: true });
  mkdirSync(resolve(root, "wiki/patterns"), { recursive: true });
  mkdirSync(resolve(root, "memory"), { recursive: true });
  writeFileSync(resolve(root, ".gitignore"), ".corgi/loop/\n.corgi/transactions/\n");
  writeFileSync(resolve(root, "openspec/config.yaml"), [
    "schema: custom",
    "corgi:",
    "  contract: rfc-v1",
    "  tracking:",
    "    provider: none",
    "  rfcRoot: rfcs",
    "  foundation: RFC-0001-project-foundation",
    "  governance:",
    "    integrationBranch: main",
    "isolation:",
    "  mode: none",
    "",
  ].join("\n"));
  writeFileSync(resolve(root, "wiki/deliveries/_index.md"), [
    "# Delivery Index",
    "<!-- corgi:managed:start deliveries -->",
    "- none",
    "<!-- corgi:managed:end deliveries -->",
    "",
  ].join("\n"));
  writeFileSync(resolve(root, "wiki/hot.md"), [
    "# Hot",
    "<!-- corgi:managed:start active-deliveries -->",
    "- RFC-0002-export/S-01-export",
    "<!-- corgi:managed:end active-deliveries -->",
    "<!-- corgi:managed:start recently-shipped -->",
    "- none",
    "<!-- corgi:managed:end recently-shipped -->",
    "",
  ].join("\n"));
  writeFileSync(resolve(root, "wiki/architecture/_index.md"), [
    "# Architecture Index",
    "<!-- corgi:managed:start architecture-deliveries -->",
    "- none",
    "<!-- corgi:managed:end architecture-deliveries -->",
    "",
  ].join("\n"));
  writeFileSync(resolve(root, "wiki/patterns/_index.md"), [
    "# Patterns Index",
    "<!-- corgi:managed:start pattern-deliveries -->",
    "- none",
    "<!-- corgi:managed:end pattern-deliveries -->",
    "",
  ].join("\n"));
  writeFileSync(resolve(root, "memory/MEMORY.md"), [
    "# MEMORY",
    "<!-- corgi:managed:start verified-deliveries -->",
    "- none",
    "<!-- corgi:managed:end verified-deliveries -->",
    "",
  ].join("\n"));
  writeFileSync(resolve(root, "memory/session-bridge.md"), [
    "# Session Bridge",
    "## Delivery Pointer",
    "- **RFC**: RFC-0002-export",
    "- **RFC Revision**: 1",
    "- **Slice**: S-01-export",
    "- **Issue**: none",
    "- **Change**: export-data",
    "- **Worktree**: none",
    "- **Phase at Checkpoint**: awaiting_human_qa",
    "- **Task Group at Checkpoint**: 1",
    "- **Observed Run Revision**: 6",
    "- **Last Verified HEAD**: pending",
    "",
    "## Next Action",
    "- Archive this delivery.",
    "",
    "## Blockers",
    "- none",
    "",
  ].join("\n"));
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "human@example.test"]);
  git(root, ["config", "user.name", "Human Reviewer"]);
  ensureFoundationRfc({ projectDir: root });
  completeRfc(root, "RFC-0001-project-foundation", "S-01-project-foundation");
  acceptRfc({
    projectDir: root,
    rfcId: "RFC-0001-project-foundation",
    approver: "human@example.test",
    humanConfirmed: true,
    now: new Date("2026-08-14T00:00:00.000Z"),
  });
}

function completeRfc(root: string, rfcId: string, sliceId: string): void {
  writeFileSync(resolve(root, "rfcs", rfcId, "rfc.md"), [
    `# ${rfcId}`,
    "",
    "## Goal",
    "Users can export data.",
    "",
    "## Non-goals",
    "No unrelated formats.",
    "",
    "## Boundary",
    "Only the accepted export Slice.",
    "",
    "## Slices",
    `### ${sliceId}: Export delivery`,
    "- AC-001 [evidence: both]: Export is observable.",
    "",
    "## Risks",
    "Compatibility.",
    "",
  ].join("\n"));
}

function archiveState(input: {
  changeName: string;
  sourceDigest: ArtifactHashV3;
  traceabilityDigest: ArtifactHashV3;
  finalRevision: string;
  rfcId: string;
}): RunStateV3 {
  return {
    schemaVersion: 3,
    changeName: input.changeName,
    runId: "run-export",
    supersedesRunId: null,
    owner: { id: "agent", kind: "agent" },
    sessionId: "session-export",
    stateRevision: 7,
    nonce: "nonce-7",
    lastEventSeq: 7,
    phase: "archiving",
    planningRevision: HASH,
    baselineRevision: input.finalRevision,
    finalRevision: input.finalRevision,
    currentGroupId: null,
    contract: {
      kind: "rfc-slice",
      deliveryRef: `${input.rfcId}/S-01-export`,
      rfcId: input.rfcId,
      rfcDigest: HASH,
      acceptedCommit: "1".repeat(40),
      sliceId: "S-01-export",
      sourcePath: `openspec/changes/${input.changeName}/corgi/source.yaml`,
      sourceDigest: input.sourceDigest,
      traceabilityPath: `openspec/changes/${input.changeName}/corgi/traceability.yaml`,
      traceabilityDigest: input.traceabilityDigest,
      acceptance: [{ id: "AC-001", evidence: "both", taskGroups: ["1"] }],
      tracker: { provider: "none", idempotencyKey: "local-export" },
    },
    groups: {
      "1": {
        id: "1",
        ordinal: 1,
        fingerprint: HASH,
        status: "completed",
        commitRevision: input.finalRevision,
        commitTree: "tree-final",
        workspaceFingerprint: HASH,
        evidenceHash: HASH,
        trackerCheckpoint: null,
        completedAt: "2026-08-14T00:00:01.000Z",
      },
    },
    verify: {
      verdict: "pass",
      finalRevision: input.finalRevision,
      planningRevision: HASH,
      sourceDigest: input.sourceDigest,
      traceabilityDigest: input.traceabilityDigest,
      reportHash: HASH,
      checks: [{ name: "test", status: "pass", evidenceRefs: ["test.log"] }],
      acceptance: [{ id: "AC-001", automated: "pass", human: "not_applicable", evidenceRefs: ["test.log"] }],
      verifiedAt: "2026-08-14T00:00:02.000Z",
    },
    review: {
      decision: "approve",
      reviewer: "human@example.test",
      reason: null,
      finalRevision: input.finalRevision,
      planningRevision: HASH,
      verifyReportHash: HASH,
      reviewedAt: "2026-08-14T00:00:03.000Z",
    },
    qa: {
      verdict: "pass",
      reviewer: "human@example.test",
      reason: null,
      noRuntimeImpact: false,
      finalRevision: input.finalRevision,
      planningRevision: HASH,
      reportHash: HASH,
      acceptance: [{ id: "AC-001", automated: "not_applicable", human: "pass", evidenceRefs: ["qa.md"] }],
      evidenceRefs: ["qa.md"],
      reviewedAt: "2026-08-14T00:00:04.000Z",
    },
    repair: null,
    archive: {
      intentId: "archive-export",
      evidenceManifestHash: null,
      archivedRoot: null,
      deliveryPage: null,
      deliveryRevision: null,
      closeoutCommit: null,
      localCompleted: false,
      trackerCompleted: true,
      startedAt: "2026-08-14T00:00:05.000Z",
    },
    startedAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:05.000Z",
    completedAt: null,
  };
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
