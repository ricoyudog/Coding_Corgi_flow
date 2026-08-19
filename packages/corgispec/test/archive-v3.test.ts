import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completeArchiveTrackerCloseoutV3,
  type ArchiveV3CommandDependencies,
} from "../src/commands/archive-v3.js";
import type { LoadedChangeContract, TrackerBinding } from "../src/lib/change-contract.js";
import type { ArtifactHashV3, RunStateV3 } from "../src/lib/run-contract-v3.js";
import type { TrackerClient } from "../src/lib/tracker.js";

const SOURCE = `sha256:${"a".repeat(64)}` as ArtifactHashV3;
const TRACE = `sha256:${"b".repeat(64)}` as ArtifactHashV3;
const PLAN = `sha256:${"c".repeat(64)}` as ArtifactHashV3;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Archive v3 tracker closeout", () => {
  it("records tracker completion only after the bound Issue closes successfully", async () => {
    const root = temporaryRoot();
    const binding = trackedBinding();
    const state = archiveState(binding);
    const tracker = trackerClient();
    vi.mocked(tracker.close)
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(undefined);
    const completed = { ...state, archive: { ...state.archive!, trackerCompleted: true } };
    const recordTrackerCompleted = vi.fn(async () => completed);
    const dependencies = archiveDependencies(binding, tracker, recordTrackerCompleted);
    const input = {
      projectRoot: root,
      changeName: "change-a",
      token: {
        runId: state.runId,
        sessionId: state.sessionId,
        stateRevision: state.stateRevision,
        nonce: state.nonce,
      },
      state,
    };

    await expect(completeArchiveTrackerCloseoutV3(input, dependencies))
      .rejects.toThrow("provider unavailable");
    expect(recordTrackerCompleted).not.toHaveBeenCalled();
    expect(state.archive?.trackerCompleted).toBe(false);

    await expect(completeArchiveTrackerCloseoutV3(input, dependencies)).resolves.toBe(completed);
    expect(tracker.setState).toHaveBeenCalledTimes(2);
    expect(tracker.close).toHaveBeenCalledTimes(2);
    expect(recordTrackerCompleted).toHaveBeenCalledTimes(1);
  });

  it("completes provider-none closeout without constructing a tracker client", async () => {
    const root = temporaryRoot();
    const binding: TrackerBinding = { provider: "none", idempotencyKey: "local" };
    const state = archiveState(binding);
    const createTracker = vi.fn();
    const recordTrackerCompleted = vi.fn();

    await expect(completeArchiveTrackerCloseoutV3({
      projectRoot: root,
      changeName: "change-a",
      token: {
        runId: state.runId,
        sessionId: state.sessionId,
        stateRevision: state.stateRevision,
        nonce: state.nonce,
      },
      state,
    }, {
      resolveChangeContract: async () => ({
        changeRoot: "/repo/openspec/changes/change-a",
        contract: changeContract(binding),
      }),
      createTracker,
      recordTrackerCompleted,
      verifyCloseoutIntegrity: vi.fn(async () => undefined),
    })).resolves.toBe(state);
    expect(createTracker).not.toHaveBeenCalled();
    expect(recordTrackerCompleted).not.toHaveBeenCalled();
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), "corgispec-archive-tracker-v3-"));
  roots.push(root);
  return root;
}

function trackedBinding(): TrackerBinding {
  return {
    provider: "github",
    idempotencyKey: "delivery-key",
    issue: { id: "42", url: "https://example.test/issues/42" },
  };
}

function archiveState(tracker: TrackerBinding): RunStateV3 {
  return {
    schemaVersion: 3,
    changeName: "change-a",
    runId: "run-a",
    supersedesRunId: null,
    owner: { id: "agent", kind: "agent" },
    sessionId: "session-a",
    stateRevision: 8,
    nonce: "nonce-8",
    lastEventSeq: 8,
    phase: "archiving",
    planningRevision: PLAN,
    baselineRevision: "base",
    finalRevision: "final",
    currentGroupId: null,
    contract: {
      kind: "maintenance",
      deliveryRef: "maintenance/change-a",
      rfcId: null,
      rfcDigest: null,
      acceptedCommit: null,
      sliceId: null,
      sourcePath: "openspec/changes/change-a/corgi/source.yaml",
      sourceDigest: SOURCE,
      traceabilityPath: "openspec/changes/change-a/corgi/traceability.yaml",
      traceabilityDigest: TRACE,
      acceptance: [{ id: "MC-001", evidence: "automated", taskGroups: ["1"] }],
      tracker,
    },
    groups: {
      "1": {
        id: "1",
        ordinal: 1,
        fingerprint: PLAN,
        status: "completed",
        commitRevision: "final",
        commitTree: "tree-final",
        workspaceFingerprint: PLAN,
        evidenceHash: SOURCE,
        trackerCheckpoint: tracker.provider === "none" ? null : "<!-- corgispec:checkpoint:v3 run=run-a group=1 key=test -->",
        completedAt: "2026-08-14T00:00:01.000Z",
      },
    },
    verify: null,
    review: null,
    qa: null,
    repair: null,
    archive: {
      intentId: "archive-a",
      evidenceManifestHash: PLAN,
      archivedRoot: "/repo/openspec/changes/archive/2026-08-14-change-a",
      deliveryPage: "/repo/wiki/deliveries/maintenance-change-a.md",
      deliveryRevision: null,
      closeoutCommit: "archive-closeout",
      localCompleted: true,
      trackerCompleted: tracker.provider === "none",
      startedAt: "2026-08-14T00:00:00.000Z",
    },
    startedAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:08.000Z",
    completedAt: null,
  };
}

function changeContract(tracker: TrackerBinding): LoadedChangeContract {
  return {
    sourcePath: resolve("/repo/openspec/changes/change-a/corgi/source.yaml"),
    traceabilityPath: resolve("/repo/openspec/changes/change-a/corgi/traceability.yaml"),
    source: {
      schemaVersion: 1,
      kind: "maintenance",
      deliveryRef: "maintenance/change-a",
      maintenance: {
        category: "test-only",
        description: "coverage",
        reason: "coverage",
        boundary: "tests",
        contractRefs: ["spec:test"],
      },
      acceptance: [{ id: "MC-001", evidence: "automated" }],
      tracker,
    },
    traceability: {
      schemaVersion: 1,
      sourceDigest: SOURCE,
      acceptance: [{
        id: "MC-001",
        evidence: "automated",
        planningRefs: [{ path: "tasks.md" }],
        taskGroups: ["1"],
      }],
    },
    sourceDigest: SOURCE,
    traceabilityDigest: TRACE,
  };
}

function trackerClient(): TrackerClient {
  return {
    provider: "github",
    findByMarker: vi.fn(),
    getIssue: vi.fn(async (issue) => ({
      ...issue,
      body: [
        "Human content",
        "",
        "<!-- corgispec:task-dashboard:start -->",
        "## Task Dashboard",
        "",
        "0/1 tasks complete · 0/1 groups approved",
        "",
        "| Group | Name | Status | Tasks |",
        "|---:|---|---|---:|",
        "| 1 | Tests | done | 1/1 |",
        "",
        "### Group 1: Tests",
        "- [x] 1.1 coverage",
        "<!-- corgispec:task-dashboard:end -->",
      ].join("\n"),
    })),
    createIssue: vi.fn(),
    setState: vi.fn(async () => undefined),
    updateBody: vi.fn(),
    comment: vi.fn(),
    close: vi.fn(),
  };
}

function archiveDependencies(
  binding: TrackerBinding,
  tracker: TrackerClient,
  recordTrackerCompleted: ArchiveV3CommandDependencies["recordTrackerCompleted"],
): ArchiveV3CommandDependencies {
  return {
    resolveChangeContract: async () => ({
      changeRoot: "/repo/openspec/changes/change-a",
      contract: changeContract(binding),
    }),
    createTracker: () => tracker,
    recordTrackerCompleted,
    verifyCloseoutIntegrity: vi.fn(async () => undefined),
  };
}
