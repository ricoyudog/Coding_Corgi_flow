import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";

import { createProposeCommand } from "../src/commands/propose.js";
import { createReadyCommand } from "../src/commands/ready.js";
import { createStatusCommand } from "../src/commands/status.js";
import { lifecycleCommandOutputV3 } from "../src/commands/lifecycle-v3-common.js";
import { summarizeChangeContract, type LoadedChangeContract } from "../src/lib/change-contract.js";
import type { ResolvedChangeArtifacts } from "../src/lib/artifact-resolver.js";
import type { RunStateV3 } from "../src/lib/run-contract-v3.js";

const HASH = `sha256:${"a".repeat(64)}`;

describe("v4 public contract summaries", () => {
  let root: string;
  let changeRoot: string;
  let resolved: ResolvedChangeArtifacts;
  let contract: LoadedChangeContract;
  let run: RunStateV3;
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = resolve(tmpdir(), `corgispec-public-contract-${Date.now()}-${Math.random()}`);
    changeRoot = resolve(root, "store/changes/change-a");
    mkdirSync(resolve(root, "openspec"), { recursive: true });
    mkdirSync(resolve(changeRoot, "corgi"), { recursive: true });
    writeFileSync(resolve(root, "openspec/config.yaml"), [
      "schema: custom",
      "corgi:",
      "  taskArtifactId: tasks",
      "  tracking:",
      "    provider: none",
      "",
    ].join("\n"));
    writeFileSync(resolve(changeRoot, "proposal.md"), "# Proposal\n");
    writeFileSync(resolve(changeRoot, "tasks.md"), [
      "## 1. First Group",
      "- [x] 1.1 first planned checkbox",
      "",
      "## 2. Second Group",
      "- [x] 2.1 second planned checkbox",
      "",
    ].join("\n"));

    const sourcePath = resolve(changeRoot, "corgi/source.yaml");
    const traceabilityPath = resolve(changeRoot, "corgi/traceability.yaml");
    contract = {
      sourcePath,
      traceabilityPath,
      source: {
        schemaVersion: 1,
        kind: "maintenance",
        deliveryRef: "maintenance/change-a",
        maintenance: {
          category: "docs-only",
          description: "Document the existing public behavior.",
          reason: "Documentation-only maintenance.",
          boundary: "Documentation files only.",
          contractRefs: [],
        },
        acceptance: [
          { id: "AC-001", evidence: "automated" },
          { id: "AC-002", evidence: "human" },
        ],
        tracker: { provider: "none", idempotencyKey: "maintenance-change-a" },
      },
      traceability: {
        schemaVersion: 1,
        sourceDigest: HASH,
        acceptance: [
          {
            id: "AC-001",
            evidence: "automated",
            planningRefs: [{ path: "tasks.md", anchor: "first-group" }],
            taskGroups: ["1"],
          },
          {
            id: "AC-002",
            evidence: "human",
            planningRefs: [{ path: "tasks.md", anchor: "second-group" }],
            taskGroups: ["2"],
          },
        ],
      },
      sourceDigest: HASH,
      traceabilityDigest: HASH,
    };
    resolved = {
      changeName: "change-a",
      schemaName: "custom",
      changeRoot,
      planningComplete: true,
      planningRevision: HASH,
      contract,
      status: {
        changeName: "change-a",
        schemaName: "custom",
        isComplete: true,
        artifacts: [
          { id: "proposal", outputPath: "proposal.md", status: "done" },
          { id: "tasks", outputPath: "tasks.md", status: "done" },
        ],
      },
      artifactPaths: {
        proposal: {
          outputPath: "proposal.md",
          resolvedOutputPath: resolve(changeRoot, "proposal.md"),
          existingOutputPaths: [resolve(changeRoot, "proposal.md")],
        },
        tasks: {
          outputPath: "tasks.md",
          resolvedOutputPath: resolve(changeRoot, "tasks.md"),
          existingOutputPaths: [resolve(changeRoot, "tasks.md")],
        },
      },
    } as unknown as ResolvedChangeArtifacts;
    run = {
      schemaVersion: 3,
      changeName: "change-a",
      runId: "run-change-a",
      supersedesRunId: null,
      owner: { id: "agent", kind: "agent" },
      sessionId: "session-a",
      stateRevision: 2,
      nonce: "nonce-2",
      lastEventSeq: 2,
      phase: "applying",
      planningRevision: HASH,
      baselineRevision: "baseline",
      finalRevision: null,
      currentGroupId: "2",
      contract: {
        kind: "maintenance",
        deliveryRef: "maintenance/change-a",
        rfcId: null,
        rfcDigest: null,
        acceptedCommit: null,
        sliceId: null,
        sourcePath: relative(root, sourcePath).replace(/\\/gu, "/"),
        sourceDigest: HASH,
        traceabilityPath: relative(root, traceabilityPath).replace(/\\/gu, "/"),
        traceabilityDigest: HASH,
        acceptance: [
          { id: "AC-001", evidence: "automated", taskGroups: ["1"] },
          { id: "AC-002", evidence: "human", taskGroups: ["2"] },
        ],
        tracker: { provider: "none", idempotencyKey: "maintenance-change-a" },
      },
      groups: {
        "1": {
          id: "1",
          ordinal: 1,
          fingerprint: HASH,
          status: "completed",
          commitRevision: "group-one",
          commitTree: "tree-one",
          workspaceFingerprint: HASH,
          evidenceHash: HASH,
          trackerCheckpoint: null,
          completedAt: "2026-08-14T00:00:00.000Z",
        },
        "2": {
          id: "2",
          ordinal: 2,
          fingerprint: HASH,
          status: "pending",
          commitRevision: null,
          commitTree: null,
          workspaceFingerprint: null,
          evidenceHash: null,
          trackerCheckpoint: null,
          completedAt: null,
        },
      },
      verify: null,
      review: null,
      qa: null,
      repair: null,
      archive: null,
      startedAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      completedAt: null,
    };
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = 0;
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  it("uses one project-relative contract summary and Run Contract progress", async () => {
    const expectedContract = summarizeChangeContract(contract, root);
    expect(Object.keys(expectedContract)).toEqual([
      "schemaVersion",
      "pathConvention",
      "kind",
      "deliveryRef",
      "rfcId",
      "rfcDigest",
      "acceptedCommit",
      "sliceId",
      "acceptanceIds",
      "sourcePath",
      "sourceDigest",
      "traceabilityPath",
      "traceabilityDigest",
      "tracker",
    ]);
    expect(expectedContract.tracker).toEqual({
      provider: "none",
      idempotencyKey: "maintenance-change-a",
      issue: null,
    });
    const resolver = { resolve: vi.fn(async () => resolved) } as never;

    await createStatusCommand({
      createAdapter: () => ({} as never),
      createResolver: () => resolver,
      createLoopStore: () => ({ inspect: () => ({ state: run }) }) as never,
    }).parseAsync(["change-a", "--json", "--path", root], { from: "user" });

    const status = JSON.parse(String(log.mock.calls[0]![0]));
    expect(status.contract).toEqual(expectedContract);
    expect(status.taskGroups).toEqual([
      expect.objectContaining({ id: "1", status: "completed", ordinal: 1 }),
      expect.objectContaining({ id: "2", status: "pending", ordinal: 2 }),
    ]);
    expect(status.completedTasks).toBe(1);
    expect(status.totalTasks).toBe(2);
    expect(status.progress).toEqual({
      authority: "run-contract-v3",
      total: 2,
      complete: 1,
      remaining: 1,
    });
    expect(status.planningTaskSnapshot).toMatchObject({
      authority: "non_authoritative",
      completedTasks: 2,
      totalTasks: 2,
    });

    log.mockClear();
    process.exitCode = 0;
    await createReadyCommand({
      createAdapter: () => ({ validateChange: async () => ({ valid: true, issues: [] }) }) as never,
      createResolver: () => resolver,
    }).parseAsync(["change-a", "--json", "--path", root], { from: "user" });

    const ready = JSON.parse(String(log.mock.calls[0]![0]));
    expect(ready.contract).toEqual(expectedContract);
    expect(lifecycleCommandOutputV3("apply", run).contract).toEqual(expectedContract);
  });

  it("includes schemaVersion and a null contract in Propose JSON errors", async () => {
    await createProposeCommand().parseAsync(
      ["change-a", "--json", "--path", root],
      { from: "user" },
    );

    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      schemaVersion: 2,
      changeName: "change-a",
      status: "contract_error",
      contract: null,
      error: { code: "PROJECT_REQUIRES_V4_MIGRATION" },
    });
  });
});
