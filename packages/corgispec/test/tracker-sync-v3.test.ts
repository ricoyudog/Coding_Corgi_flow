import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApplyV3Command } from "../src/commands/apply-v3.js";
import { renderIssueDashboard } from "../src/lib/issue-dashboard.js";
import type { TrackerBinding } from "../src/lib/change-contract.js";
import type { ArtifactHashV3, RunPhaseV3, RunStateV3 } from "../src/lib/run-contract-v3.js";
import {
  loadTrackerSyncIntentV3,
  syncTrackerStateV3,
  trackerSyncIntentPathV3,
  trackerWorkflowStateForRunV3,
} from "../src/lib/tracker-sync-v3.js";
import type { TrackerClient, TrackerIssue } from "../src/lib/tracker.js";

const HASH = `sha256:${"a".repeat(64)}` as ArtifactHashV3;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Run Contract v3 tracker synchronization", () => {
  it("does not expose a caller-supplied tracker checkpoint option", () => {
    expect(createApplyV3Command().options.map((option) => option.long))
      .not.toContain("--tracker-checkpoint");
  });

  it("persists a pending intent and resumes an interrupted remote mutation idempotently", async () => {
    const root = temporaryRoot();
    const state = runState("applying");
    const humanPrefix = "Human-owned preface";
    const humanSuffix = "Human-owned suffix";
    let issue: TrackerIssue = {
      id: "42",
      url: "https://example.test/issues/42",
      title: "Feature",
      body: `${humanPrefix}\n\n${renderIssueDashboard([{
        number: 1,
        name: "Build export",
        tasks: [{ id: "1.1", description: "ship", done: false, line: 2 }],
        totalTasks: 1,
        completedTasks: 0,
        status: "pending",
        line: 1,
      }])}\n\n${humanSuffix}`,
    };
    const setState = vi.fn()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(undefined);
    const tracker: TrackerClient = {
      provider: "github",
      findByMarker: vi.fn(),
      getIssue: vi.fn(async () => issue),
      createIssue: vi.fn(),
      setState,
      updateBody: vi.fn(async (_bound, body) => { issue = { ...issue, body }; }),
      comment: vi.fn(),
      close: vi.fn(),
    };
    const dependencies = {
      createTracker: () => tracker,
      trackerNow: () => "2026-08-14T00:00:00.000Z",
    };

    await expect(syncTrackerStateV3(root, state, dependencies)).rejects.toThrow("provider unavailable");
    const path = trackerSyncIntentPathV3(root, state.changeName, state.runId, state.stateRevision, false);
    expect(loadTrackerSyncIntentV3(path).status).toBe("pending");
    expect(issue.body).toContain(humanPrefix);
    expect(issue.body).toContain(humanSuffix);
    expect(issue.body).toContain("| 1 | Build export | in-progress | 0/1 |");

    await expect(syncTrackerStateV3(root, state, dependencies)).resolves.toMatchObject({ status: "complete" });
    expect(loadTrackerSyncIntentV3(path).status).toBe("complete");
    expect(tracker.updateBody).toHaveBeenCalledTimes(1);
    expect(setState).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["planning_ready", null, "todo"],
    ["planning_ready", "run-old", "in-progress"],
    ["applying", null, "in-progress"],
    ["awaiting_verify", null, "in-progress"],
    ["awaiting_human_review", null, "review"],
    ["awaiting_human_qa", null, "review"],
    ["ready_for_archive", null, "review"],
    ["repair_required", null, "in-progress"],
    ["archived", null, "done"],
  ] as const)("maps %s (supersedes %s) to %s", (phase, supersedes, expected) => {
    expect(trackerWorkflowStateForRunV3(runState(phase, supersedes))).toBe(expected);
  });

  it("does not persist or invoke provider work for provider none", async () => {
    const root = temporaryRoot();
    const state = runState("applying", null, { provider: "none", idempotencyKey: "local" });
    const createTracker = vi.fn();

    await expect(syncTrackerStateV3(root, state, { createTracker })).resolves.toBeNull();
    expect(createTracker).not.toHaveBeenCalled();
    expect(existsSync(resolve(root, ".corgi/loop/change-a/tracker-outbox"))).toBe(false);
  });
});

function temporaryRoot(): string {
  const root = mkdtempSync(resolve(tmpdir(), "corgispec-tracker-v3-"));
  roots.push(root);
  return root;
}

function runState(
  phase: RunPhaseV3,
  supersedesRunId: string | null = null,
  tracker: TrackerBinding = {
    provider: "github",
    idempotencyKey: "delivery-key",
    issue: { id: "42", url: "https://example.test/issues/42" },
  },
): RunStateV3 {
  const applying = phase === "applying";
  const completed = !["planning_ready", "applying"].includes(phase);
  return {
    schemaVersion: 3,
    changeName: "change-a",
    runId: supersedesRunId ? "run-repair" : "run-a",
    supersedesRunId,
    owner: { id: "agent", kind: "agent" },
    sessionId: "session-a",
    stateRevision: 3,
    nonce: "nonce-3",
    lastEventSeq: 3,
    phase,
    planningRevision: HASH,
    baselineRevision: "base",
    finalRevision: completed ? "commit-1" : null,
    currentGroupId: ["planning_ready", "applying"].includes(phase) ? "1" : null,
    contract: {
      kind: "maintenance",
      deliveryRef: "maintenance/change-a",
      rfcId: null,
      rfcDigest: null,
      acceptedCommit: null,
      sliceId: null,
      sourcePath: "openspec/changes/change-a/corgi/source.yaml",
      sourceDigest: HASH,
      traceabilityPath: "openspec/changes/change-a/corgi/traceability.yaml",
      traceabilityDigest: HASH,
      acceptance: [{ id: "MC-001", evidence: "automated", taskGroups: ["1"] }],
      tracker,
    },
    groups: {
      "1": {
        id: "1",
        ordinal: 1,
        fingerprint: HASH,
        status: completed ? "completed" : applying ? "in_progress" : "pending",
        commitRevision: completed ? "commit-1" : null,
        commitTree: completed ? "tree-1" : null,
        workspaceFingerprint: completed ? HASH : null,
        evidenceHash: completed ? HASH : null,
        trackerCheckpoint: completed && tracker.provider !== "none"
          ? "<!-- corgispec:checkpoint:v3 run=run-a group=1 key=test -->"
          : null,
        completedAt: completed ? "2026-08-14T00:00:01.000Z" : null,
      },
    },
    verify: null,
    review: null,
    qa: null,
    repair: null,
    archive: null,
    startedAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:03.000Z",
    completedAt: ["repair_required", "archived"].includes(phase)
      ? "2026-08-14T00:00:03.000Z"
      : null,
  };
}
