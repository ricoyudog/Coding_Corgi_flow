import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendConvergenceTaskGroupAtomicallyV2,
  applyConfirmedConvergenceV2,
  computeRunPlanningRevisionV2,
  evaluateConvergenceV2,
  fingerprintTaskGroupV2,
  fingerprintTaskGroupsV2,
  renderConvergenceTaskContentV2,
  type ConvergenceAppendFaultsV2,
  type ConvergenceEvaluationInputV2,
  type ConvergencePlanningContextV2,
  type ConvergenceRunContextV2,
} from "../src/lib/converge-v2.js";
import { parseTaskGroupsDocument } from "../src/lib/task-groups.js";
import { createConvergeCommand, executeConvergeV2 } from "../src/commands/converge.js";
import { executeLoopV2 } from "../src/commands/loop-v2.js";
import { createGitWorkspaceV2, type GitWorkspaceV2 } from "../src/lib/git-workspace-v2.js";
import { createInitialLoopStateV2 } from "../src/lib/loop-reducer-v2.js";
import { hashCanonicalArtifactV2 } from "../src/lib/evidence-v2.js";
import { LoopStoreV2 } from "../src/lib/loop-store-v2.js";
import type { LoopStateV2 } from "../src/lib/run-contract-v2.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const root of cleanup.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("converge v2", () => {
  it("keeps initial command evaluation strictly filesystem read-only", async () => {
    const input = convergenceInput();
    const projectRoot = resolve(input.planning.changeRoot, "../../..");
    const before = snapshotFiles(projectRoot);

    const execution = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
      assessment: { evidence: input.evidence, gaps: input.gaps },
    }, {
      inspectPlanning: async () => input.planning,
      createGit: () => ({
        snapshot: async () => ({
          headRevision: input.git.revision,
          treeRevision: "tree",
          workspaceFingerprint: input.git.workspaceFingerprint,
          clean: true,
          status: "",
        }),
      }) as GitWorkspaceV2,
    });

    expect(execution.output.status).toBe("needs_work");
    expect(snapshotFiles(projectRoot)).toEqual(before);
    expect(readdirSync(projectRoot)).not.toContain(".corgi");
  });

  it("rejects incomplete evidence and unsafe, duplicate, multiline, or empty gaps with zero writes", async () => {
    const input = convergenceInput();
    const projectRoot = resolve(input.planning.changeRoot, "../../..");
    const before = snapshotFiles(projectRoot);
    const dependencies = {
      inspectPlanning: async () => input.planning,
      createGit: () => ({
        snapshot: async () => ({
          headRevision: input.git.revision,
          treeRevision: "tree",
          workspaceFingerprint: input.git.workspaceFingerprint,
          clean: true,
          status: "",
        }),
      }) as GitWorkspaceV2,
      inspectRun: async () => ({
        current: null,
        state: null,
        events: [],
        recovered: false,
        repairedTrailingEvent: false,
        recoveryRequired: false,
      }),
    };
    const baseline = { evidence: input.evidence, gaps: input.gaps };
    const invalidAssessments: unknown[] = [
      { ...baseline, evidence: [{ ...input.evidence[0], status: "unknown" }] },
      { ...baseline, evidence: [{ ...input.evidence[0], summary: undefined }] },
      { ...baseline, gaps: [{ ...input.gaps[0], id: "gap-api\n## 9. Injected" }] },
      { ...baseline, gaps: [input.gaps[0], { ...input.gaps[0] }] },
      { ...baseline, gaps: [{ ...input.gaps[0], summary: "Gap\n## 9. Injected" }] },
      { ...baseline, gaps: [{ ...input.gaps[0], suggestedTasks: [] }] },
      { ...baseline, gaps: [{ ...input.gaps[0], suggestedTasks: [""] }] },
    ];

    for (const assessment of invalidAssessments) {
      const result = await executeConvergeV2({
        projectRoot,
        changeName: input.changeName,
        assessment: assessment as ConvergenceEvaluationInputV2,
      }, dependencies);
      expect(result.exitCode).toBe(2);
      expect(result.output.reason?.code).toBe("assessment_invalid");
      expect(snapshotFiles(projectRoot)).toEqual(before);
      expect(readdirSync(projectRoot)).not.toContain(".corgi");
    }
  });

  it("derives a converged assessment from canonical run state without stdin", async () => {
    const input = convergenceInput();
    input.planning.planningRevision = hashCanonicalArtifactV2({ planning: "done" });
    input.git.workspaceFingerprint = hashCanonicalArtifactV2({ workspace: "done" });
    const projectRoot = resolve(input.planning.changeRoot, "../../..");
    const state = createInitialLoopStateV2({
      changeName: input.changeName,
      runId: "run-done",
      owner: { kind: "agent", id: "agent-1" },
      sessionId: "session-1",
      mode: "hook-driven",
      nonce: "nonce-1",
      planningRevision: input.planning.planningRevision as `sha256:${string}`,
      baselineGitRevision: "base",
      workspaceFingerprint: input.git.workspaceFingerprint as `sha256:${string}`,
      policy: {
        requireCleanReview: true,
        requireCliPass: true,
        requireCleanWorktreeForCommit: true,
        requirePush: false,
      },
      limits: { maxGroups: 10, maxAttemptsPerGroup: 2, maxEvents: 100 },
      groups: [{ id: "1", taskGroupFingerprint: hashCanonicalArtifactV2({ group: 1 }) }],
      startedAt: "2026-07-15T00:00:00.000Z",
    });
    state.phase = "done";
    state.currentGroupId = null;
    state.currentAttempt = 0;
    state.git.finalRevision = input.git.revision;
    state.completedAt = "2026-07-15T01:00:00.000Z";
    const group = state.groups["1"]!;
    group.status = "completed";
    group.bundle.status = "approved";
    group.bundle.bundleId = "bundle-1";
    group.bundle.bundleHash = hashCanonicalArtifactV2("bundle");
    group.bundle.artifactHash = hashCanonicalArtifactV2("artifact");
    group.bundle.evidenceHash = hashCanonicalArtifactV2("evidence");
    group.bundle.reviewHash = hashCanonicalArtifactV2("review");
    group.bundle.observedGitRevision = input.git.revision;
    group.bundle.workspaceFingerprint = input.git.workspaceFingerprint as `sha256:${string}`;
    group.commit = {
      status: "acknowledged",
      revision: input.git.revision,
      tree: "tree",
      workspaceFingerprint: input.git.workspaceFingerprint as `sha256:${string}`,
    };

    const result = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
    }, {
      inspectPlanning: async () => input.planning,
      createGit: () => ({
        snapshot: async () => ({
          headRevision: input.git.revision,
          treeRevision: "tree",
          workspaceFingerprint: input.git.workspaceFingerprint,
          clean: true,
          status: "",
        }),
      }) as GitWorkspaceV2,
      inspectRun: async () => ({
        current: null,
        state,
        events: [],
        recovered: false,
        repairedTrailingEvent: false,
        recoveryRequired: false,
      }),
      deriveCanonicalAssessment: async () => ({
        evidence: [{
          id: "run:run-done:final",
          planningRevision: input.planning.planningRevision,
          observedGitRevision: input.git.revision,
          workspaceFingerprint: input.git.workspaceFingerprint,
          status: "pass" as const,
          summary: "Canonical run is complete",
        }],
        gaps: [],
      }),
    });

    expect(result.exitCode).toBe(0);
    expect(result.output.status).toBe("converged");
    expect(result.output.evidence[0]?.id).toBe("run:run-done:final");
  });

  it("rejects confirmation without a canonical source run and leaves planning unchanged", async () => {
    const input = convergenceInput();
    const projectRoot = resolve(input.planning.changeRoot, "../../..");
    const dependencies = {
      inspectPlanning: async () => input.planning,
      createGit: () => ({
        snapshot: async () => ({
          headRevision: input.git.revision,
          treeRevision: "tree",
          workspaceFingerprint: input.git.workspaceFingerprint,
          clean: true,
          status: "",
        }),
      }) as GitWorkspaceV2,
      inspectRun: async () => ({
        current: null,
        state: null,
        events: [],
        recovered: false,
        repairedTrailingEvent: false,
        recoveryRequired: false,
      }),
    };
    const assessment = { evidence: input.evidence, gaps: input.gaps };
    const evaluated = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
      assessment,
    }, dependencies);
    expect(evaluated.exitCode).toBe(1);
    expect(evaluated.output.status).toBe("needs_work");

    const before = readFileSync(input.planning.taskArtifactPath);
    const applied = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
      assessment,
      confirmationToken: evaluated.output.confirmationToken,
    }, dependencies);
    expect(applied.exitCode).toBe(2);
    expect(applied.output.reason?.code).toBe("converge_run_required");
    expect(readFileSync(input.planning.taskArtifactPath)).toEqual(before);
  });

  it("rejects a no-run confirmation before taking a mutation lock", async () => {
    const input = convergenceInput();
    const projectRoot = resolve(input.planning.changeRoot, "../../..");
    const original = readFileSync(input.planning.taskArtifactPath);
    let snapshotCalls = 0;
    const dependencies = {
      inspectPlanning: async () => input.planning,
      createGit: () => ({
        snapshot: async () => {
          snapshotCalls += 1;
          const changed = snapshotCalls >= 3;
          return {
            headRevision: changed ? "git-changed-after-token" : input.git.revision,
            treeRevision: "tree",
            workspaceFingerprint: changed
              ? hashCanonicalArtifactV2({ workspace: "changed" })
              : input.git.workspaceFingerprint,
            clean: true,
            status: "",
          };
        },
      }) as GitWorkspaceV2,
      inspectRun: async () => ({
        current: null,
        state: null,
        events: [],
        recovered: false,
        repairedTrailingEvent: false,
        recoveryRequired: false,
      }),
    };
    const assessment = { evidence: input.evidence, gaps: input.gaps };
    const evaluated = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
      assessment,
    }, dependencies);
    const confirmed = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
      assessment,
      confirmationToken: evaluated.output.confirmationToken,
    }, dependencies);

    expect(snapshotCalls).toBe(2);
    expect(confirmed.exitCode).toBe(2);
    expect(confirmed.output.reason?.code).toBe("converge_run_required");
    expect(readFileSync(input.planning.taskArtifactPath)).toEqual(original);
  });

  it("normalizes malformed --input into pure JSON stdout and exit 2", async () => {
    const input = convergenceInput();
    const projectRoot = resolve(input.planning.changeRoot, "../../..");
    const malformed = resolve(projectRoot, "bad-assessment.json");
    writeFileSync(malformed, "{bad-json");
    const writes: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write);
    const originalExitCode = process.exitCode;
    try {
      await createConvergeCommand().parseAsync([
        "node", "test", "example", "--path", projectRoot,
        "--input", "bad-assessment.json", "--json",
      ]);
      expect(process.exitCode).toBe(2);
      expect(writes).toHaveLength(1);
      expect(JSON.parse(writes[0]!)).toMatchObject({
        status: "blocked",
        reason: { code: "input_invalid" },
      });
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      process.exitCode = originalExitCode;
    }
  });

  it("rejects a manually invalidated run that has no durable convergence intent", async () => {
    const input = convergenceInput();
    input.planning.planningRevision = hashCanonicalArtifactV2({ planning: "invalidated" });
    input.git.workspaceFingerprint = hashCanonicalArtifactV2({ workspace: "invalidated" });
    const projectRoot = resolve(input.planning.changeRoot, "../../..");
    const state = createInitialLoopStateV2({
      changeName: input.changeName,
      runId: "run-invalidated",
      owner: { kind: "agent", id: "agent-1" },
      sessionId: "session-1",
      mode: "hook-driven",
      nonce: "nonce-invalidated",
      planningRevision: input.planning.planningRevision as `sha256:${string}`,
      baselineGitRevision: input.git.revision,
      workspaceFingerprint: input.git.workspaceFingerprint as `sha256:${string}`,
      policy: {
        requireCleanReview: true,
        requireCliPass: true,
        requireCleanWorktreeForCommit: true,
        requirePush: false,
      },
      limits: { maxGroups: 10, maxAttemptsPerGroup: 2, maxEvents: 100 },
      groups: [{ id: "1", taskGroupFingerprint: hashCanonicalArtifactV2({ group: 1 }) }],
      startedAt: "2026-07-15T00:00:00.000Z",
    });
    state.phase = "invalidated";
    state.groups["1"]!.status = "invalidated";
    state.blockedReason = { code: "manual", message: "Needs convergence", details: {} };
    state.completedAt = "2026-07-15T00:01:00.000Z";
    const executeLoop = vi.fn();
    let canonicalAssessment = { evidence: [], gaps: [] } as {
      evidence: ConvergenceEvaluationInputV2["evidence"];
      gaps: ConvergenceEvaluationInputV2["gaps"];
    };
    const dependencies = {
      inspectPlanning: async () => input.planning,
      createGit: () => ({
        snapshot: async () => ({
          headRevision: input.git.revision,
          treeRevision: "tree",
          workspaceFingerprint: input.git.workspaceFingerprint,
          clean: true,
          status: "",
        }),
      }) as GitWorkspaceV2,
      inspectRun: async () => ({
        current: null,
        state,
        events: [],
        recovered: false,
        repairedTrailingEvent: false,
        recoveryRequired: false,
      }),
      createLoopStore: (root: string) => {
        const paths = new LoopStoreV2({ projectRoot: root });
        return {
          paths: paths.paths.bind(paths),
          peek: async () => ({
            current: null,
            state,
            events: [],
            recovered: false,
            repairedTrailingEvent: false,
            recoveryRequired: false,
          }),
        } as unknown as LoopStoreV2;
      },
      executeLoop,
      createSuccessorRun: async () => ({ runId: "run-successor" }),
      deriveCanonicalAssessment: async () => canonicalAssessment,
    };

    const noAttempt = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
    }, dependencies);
    expect(noAttempt.exitCode).toBe(1);
    expect(noAttempt.output.reason?.code).toBe("evidence_missing");

    input.evidence[0]!.planningRevision = input.planning.planningRevision;
    input.evidence[0]!.workspaceFingerprint = input.git.workspaceFingerprint;
    canonicalAssessment = { evidence: input.evidence, gaps: input.gaps };
    const cannotDelete = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
      assessment: { evidence: [], gaps: [] },
    }, dependencies);
    expect(cannotDelete.output.status).toBe("needs_work");
    expect(cannotDelete.output.gaps).toEqual(input.gaps);
    const evidenceOverride = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
      assessment: { evidence: input.evidence, gaps: [] },
    }, dependencies);
    expect(evidenceOverride.exitCode).toBe(2);
    expect(evidenceOverride.output.reason?.code).toBe("assessment_evidence_authoritative");
    const gapConflict = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
      assessment: {
        evidence: [],
        gaps: [{ ...input.gaps[0]!, summary: "Conflicting replacement" }],
      },
    }, dependencies);
    expect(gapConflict.exitCode).toBe(2);
    expect(gapConflict.output.reason?.code).toBe("assessment_gap_conflict");
    const evaluated = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
    }, dependencies);
    expect(evaluated.output.status).toBe("needs_work");
    const applied = await executeConvergeV2({
      projectRoot,
      changeName: input.changeName,
      confirmationToken: evaluated.output.confirmationToken,
    }, dependencies);
    expect(applied.exitCode).toBe(2);
    expect(applied.output.reason?.code).toBe("converge_recovery_intent_missing");
    expect(executeLoop).not.toHaveBeenCalled();
  });

  it("invalidates a completed canonical run and installs a prefix-reusing successor", async () => {
    const root = resolve(
      tmpdir(),
      `corgispec-converge-successor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    cleanup.push(root);
    mkdirSync(root, { recursive: true });
    git(root, "init", "-b", "main");
    git(root, "config", "user.email", "corgi@example.test");
    git(root, "config", "user.name", "Corgi Test");
    const changeRoot = resolve(root, "planning/changes/example");
    const taskArtifactPath = resolve(changeRoot, "work/items.md");
    mkdirSync(resolve(changeRoot, "work"), { recursive: true });
    writeFileSync(resolve(root, "README.md"), "baseline\n");
    writeFileSync(taskArtifactPath, "# Tasks\n\n## 1. Existing\n\n- [x] 1.1 Existing work\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "baseline planning");

    const inspectPlanning = async (): Promise<ConvergencePlanningContextV2> => {
      const content = readFileSync(taskArtifactPath, "utf8");
      const parsed = parseTaskGroupsDocument(content);
      const artifactPaths = {
        "work-items": {
          outputPath: "work/items.md",
          resolvedOutputPath: taskArtifactPath,
          existingOutputPaths: [taskArtifactPath],
        },
      };
      return {
        valid: true,
        ready: true,
        planningRevision: await computeRunPlanningRevisionV2({
          schemaName: "test-schema",
          changeRoot,
          artifactPaths,
          taskArtifactId: "work-items",
        }),
        changeRoot,
        taskArtifactId: "work-items",
        taskArtifactPath,
        taskGroups: parsed.groups,
        revisionInput: { schemaName: "test-schema", artifactPaths },
        issues: [],
      };
    };
    const initialPlanning = await inspectPlanning();
    const loopDependencies = {
      inspectPlanning: async () => ({
        ready: true,
        planningRevision: initialPlanning.planningRevision as `sha256:${string}`,
        groups: initialPlanning.taskGroups.map((group) => ({
          id: String(group.number),
          fingerprint: fingerprintTaskGroupV2(group) as `sha256:${string}`,
        })),
        blockers: [],
      }),
    };
    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-old", ownerId: "agent-old", runId: "run-old",
    }, loopDependencies);
    const state0 = initialized.output.state!;
    writeFileSync(resolve(root, "README.md"), "implemented\n");
    const submitted = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: "example",
      runId: state0.runId, sessionId: state0.sessionId,
      stateRevision: state0.stateRevision, nonce: state0.nonce,
      bundle: {
        schemaVersion: 2,
        evidence: {
          verdict: "PASS",
          evidence: [{
            id: "tests", kind: "test", status: "pass", provenance: "cli",
            command: "npm test", cwd: root, exitCode: 0,
          }],
        },
        review: { findings: [] },
        artifacts: { "result.json": { passed: true } },
      },
    }, loopDependencies);
    git(root, "add", "README.md");
    git(root, "commit", "-m", "implement existing group");
    const state1 = submitted.output.state!;
    const acknowledged = await executeLoopV2({
      operation: "ack-commit", projectRoot: root, changeName: "example",
      runId: state1.runId, sessionId: state1.sessionId,
      stateRevision: state1.stateRevision, nonce: state1.nonce,
    }, loopDependencies);
    const state2 = acknowledged.output.state!;
    const finalized = await executeLoopV2({
      operation: "finalize", projectRoot: root, changeName: "example",
      runId: state2.runId, sessionId: state2.sessionId,
      stateRevision: state2.stateRevision, nonce: state2.nonce,
    }, loopDependencies);
    expect(finalized.output.state?.phase).toBe("done");

    const assessment = {
      evidence: [],
      gaps: [{
        id: "gap-follow-up",
        summary: "Add the follow-up behavior",
        suggestedTasks: ["Implement and test the follow-up behavior"],
      }],
    };
    const convergeDependencies = {
      inspectPlanning: async () => await inspectPlanning(),
      newRunId: () => "run-successor",
      newNonce: () => "nonce-successor",
      now: () => "2026-07-15T12:00:00.000Z",
    };
    const evaluated = await executeConvergeV2({
      projectRoot: root, changeName: "example", assessment,
    }, convergeDependencies);
    expect(evaluated.output.status).toBe("needs_work");
    const applied = await executeConvergeV2({
      projectRoot: root, changeName: "example", assessment,
      confirmationToken: evaluated.output.confirmationToken,
    }, convergeDependencies);

    expect(applied.exitCode).toBe(0);
    expect(applied.output.successor).toEqual({
      supersedesRunId: "run-old",
      reusableEvidenceGroups: ["1"],
      planningRevision: expect.stringMatching(/^sha256:/),
      runId: "run-successor",
    });
    const store = new LoopStoreV2({ projectRoot: root });
    const current = await store.peek("example");
    expect(current.state).toMatchObject({
      runId: "run-successor",
      supersedesRunId: "run-old",
      owner: { id: "agent-old", kind: "agent" },
      sessionId: "session-old",
      phase: "awaiting_group_result",
      currentGroupId: "2",
      currentAttempt: 1,
      groups: {
        "1": { status: "completed", bundle: { status: "approved" } },
        "2": { status: "in_progress", bundle: { status: "none" } },
      },
    });
    const old = await store.peek("example", { runId: "run-old" });
    expect(old.state?.phase).toBe("invalidated");
    expect(JSON.parse(readFileSync(resolve(root, ".corgi/loop/example/current.json"), "utf8")))
      .toMatchObject({ runId: "run-successor" });
  });

  it("reuses a completed prefix from a partially failed run and finalizes its successor", async () => {
    const root = resolve(tmpdir(), `corgispec-partial-successor-${Date.now()}-${Math.random()}`);
    cleanup.push(root);
    mkdirSync(root, { recursive: true });
    git(root, "init", "-b", "main");
    git(root, "config", "user.email", "corgi@example.test");
    git(root, "config", "user.name", "Corgi Test");
    const changeRoot = resolve(root, "planning/changes/example");
    const taskArtifactPath = resolve(changeRoot, "tasks.md");
    mkdirSync(changeRoot, { recursive: true });
    writeFileSync(resolve(root, "README.md"), "baseline\n");
    writeFileSync(taskArtifactPath, [
      "## 1. Foundation", "", "- [x] 1.1 Build foundation", "",
      "## 2. API", "", "- [ ] 2.1 Build API", "",
    ].join("\n"));
    git(root, "add", ".");
    git(root, "commit", "-m", "baseline");
    const planning = async (): Promise<ConvergencePlanningContextV2> => {
      const content = readFileSync(taskArtifactPath, "utf8");
      const artifactPaths = {
        tasks: {
          outputPath: "tasks.md",
          resolvedOutputPath: taskArtifactPath,
          existingOutputPaths: [taskArtifactPath],
        },
      };
      return {
        valid: true,
        ready: true,
        planningRevision: await computeRunPlanningRevisionV2({
          schemaName: "test-schema",
          changeRoot,
          artifactPaths,
          taskArtifactId: "tasks",
        }),
        changeRoot,
        taskArtifactId: "tasks",
        taskArtifactPath,
        taskGroups: parseTaskGroupsDocument(content).groups,
        revisionInput: { schemaName: "test-schema", artifactPaths },
        issues: [],
      };
    };
    const loopDependencies = {
      inspectPlanning: async () => {
        const current = await planning();
        const fingerprints = fingerprintTaskGroupsV2(current.taskGroups);
        return {
          ready: true,
          planningRevision: current.planningRevision as `sha256:${string}`,
          groups: current.taskGroups.map((group) => ({
            id: String(group.number),
            fingerprint: fingerprints[String(group.number)]! as `sha256:${string}`,
          })),
          blockers: [],
        };
      },
    };
    const cas = (state: LoopStateV2) => ({
      runId: state.runId,
      sessionId: state.sessionId,
      stateRevision: state.stateRevision,
      nonce: state.nonce,
    });
    const submitDraft = async (state: LoopStateV2, verdict: "PASS" | "FAIL", id: string) =>
      await executeLoopV2({
        operation: "submit", projectRoot: root, changeName: "example", ...cas(state),
        bundle: {
          schemaVersion: 2,
          evidence: {
            verdict,
            evidence: [{
              id: `test-${id}`, kind: "test",
              status: verdict === "PASS" ? "pass" : "fail",
              provenance: "cli", command: "npm test", cwd: root,
              exitCode: verdict === "PASS" ? 0 : 1,
            }],
          },
          review: { findings: [] },
          artifacts: { [`${id}.json`]: { verdict } },
        },
      }, loopDependencies);

    const initialized = await executeLoopV2({
      operation: "init", projectRoot: root, changeName: "example",
      sessionId: "session-partial", ownerId: "agent-partial",
      mode: "hook-driven", runId: "run-partial-old",
    }, loopDependencies);
    let state = initialized.output.state!;
    writeFileSync(resolve(root, "foundation.ts"), "export const foundation = true;\n");
    state = (await submitDraft(state, "PASS", "g1")).output.state!;
    git(root, "add", "foundation.ts");
    git(root, "commit", "-m", "group 1");
    state = (await executeLoopV2({
      operation: "ack-commit", projectRoot: root, changeName: "example", ...cas(state),
    }, loopDependencies)).output.state!;
    writeFileSync(resolve(root, "api.ts"), "export const api = 'broken';\n");
    const failed = await submitDraft(state, "FAIL", "g2-fail");
    expect(failed.output.state?.phase).toBe("verification_failed");

    const evaluated = await executeConvergeV2({ projectRoot: root, changeName: "example" }, {
      inspectPlanning: async () => await planning(),
    });
    expect(evaluated.output.status).toBe("needs_work");
    const applied = await executeConvergeV2({
      projectRoot: root,
      changeName: "example",
      confirmationToken: evaluated.output.confirmationToken,
    }, {
      inspectPlanning: async () => await planning(),
      newRunId: () => "run-partial-successor",
      newNonce: () => "nonce-partial-successor",
    });
    expect(applied.exitCode).toBe(0);
    expect(applied.output.successor?.reusableEvidenceGroups).toEqual(["1"]);
    const store = new LoopStoreV2({ projectRoot: root });
    state = (await store.peek("example")).state!;
    expect(state).toMatchObject({
      runId: "run-partial-successor", currentGroupId: "2",
      groups: { "1": { status: "completed" }, "2": { status: "in_progress" } },
    });

    writeFileSync(resolve(root, "api.ts"), "export const api = 'fixed';\n");
    state = (await submitDraft(state, "PASS", "g2-fixed")).output.state!;
    git(root, "add", ".");
    git(root, "commit", "-m", "group 2 and convergence planning");
    state = (await executeLoopV2({
      operation: "ack-commit", projectRoot: root, changeName: "example", ...cas(state),
    }, loopDependencies)).output.state!;
    expect(state.currentGroupId).toBe("3");
    writeFileSync(resolve(root, "follow-up.ts"), "export const followUp = true;\n");
    state = (await submitDraft(state, "PASS", "g3")).output.state!;
    git(root, "add", "follow-up.ts");
    git(root, "commit", "-m", "group 3");
    state = (await executeLoopV2({
      operation: "ack-commit", projectRoot: root, changeName: "example", ...cas(state),
    }, loopDependencies)).output.state!;
    const finalized = await executeLoopV2({
      operation: "finalize", projectRoot: root, changeName: "example", ...cas(state),
    }, loopDependencies);
    expect(finalized.exitCode).toBe(0);
    expect(finalized.output.state).toMatchObject({
      phase: "done", supersedesRunId: "run-partial-old",
      groups: { "1": { status: "completed" }, "2": { status: "completed" }, "3": { status: "completed" } },
    });
  });

  it("treats checkbox completion as progress while task ID/description remain semantic", () => {
    const unchecked = parseTaskGroupsDocument("## 1. Work\n\n- [ ] 1.1 Implement API\n").groups[0]!;
    const checked = parseTaskGroupsDocument("## 1. Work\n\n- [x] 1.1 Implement API\n").groups[0]!;
    const changed = parseTaskGroupsDocument("## 1. Work\n\n- [x] 1.1 Change API semantics\n").groups[0]!;

    expect(fingerprintTaskGroupV2(checked)).toBe(fingerprintTaskGroupV2(unchecked));
    expect(fingerprintTaskGroupV2(changed)).not.toBe(fingerprintTaskGroupV2(unchecked));
  });

  it("normalizes task completion in run planning revision but keeps other artifact bytes strict", async () => {
    const root = resolve(tmpdir(), `corgispec-semantic-revision-${Date.now()}-${Math.random()}`);
    cleanup.push(root);
    const changeRoot = resolve(root, "change");
    const tasks = resolve(changeRoot, "nested/items.md");
    const proposal = resolve(changeRoot, "proposal.md");
    mkdirSync(resolve(changeRoot, "nested"), { recursive: true });
    writeFileSync(tasks, "## 1. Work\n\n- [ ] 1.1 Implement API\n");
    writeFileSync(proposal, "# Proposal\nOriginal\n");
    const input = {
      schemaName: "custom",
      changeRoot,
      taskArtifactId: "work-items",
      artifactPaths: {
        "work-items": {
          outputPath: "nested/items.md",
          resolvedOutputPath: tasks,
          existingOutputPaths: [tasks],
        },
        proposal: {
          outputPath: "proposal.md",
          resolvedOutputPath: proposal,
          existingOutputPaths: [proposal],
        },
      },
    };
    const initial = await computeRunPlanningRevisionV2(input);
    writeFileSync(tasks, "## 1. Work\n\n- [x] 1.1 Implement API\n");
    expect(await computeRunPlanningRevisionV2(input)).toBe(initial);
    writeFileSync(tasks, "## 1. Work\n\n- [x] 1.1 Change API semantics\n");
    expect(await computeRunPlanningRevisionV2(input)).not.toBe(initial);
    writeFileSync(tasks, "## 1. Work\n\n- [ ] 1.1 Implement API\n");
    writeFileSync(proposal, "# Proposal\nChanged\n");
    expect(await computeRunPlanningRevisionV2(input)).not.toBe(initial);
  });

  it("binds run planning revisions to the authoritative change root", async () => {
    const root = resolve(tmpdir(), `corgispec-target-revision-${Date.now()}-${Math.random()}`);
    cleanup.push(root);
    const firstRoot = resolve(root, "store-a/change");
    const secondRoot = resolve(root, "store-b/change");
    const revisions: string[] = [];
    for (const changeRoot of [firstRoot, secondRoot]) {
      mkdirSync(changeRoot, { recursive: true });
      const tasks = resolve(changeRoot, "tasks.md");
      writeFileSync(tasks, "## 1. Work\n\n- [ ] 1.1 Implement API\n");
      revisions.push(await computeRunPlanningRevisionV2({
        schemaName: "custom",
        changeRoot,
        taskArtifactId: "tasks",
        artifactPaths: {
          tasks: {
            outputPath: "tasks.md",
            resolvedOutputPath: tasks,
            existingOutputPaths: [tasks],
          },
        },
      }));
    }

    expect(revisions[0]).not.toBe(revisions[1]);
  });

  it("blocks invalid planning and directs the caller to update", () => {
    const input = convergenceInput();
    input.planning.valid = false;
    input.planning.ready = false;
    input.planning.issues = ["proposal and requirements disagree"];

    const result = evaluateConvergenceV2(input);

    expect(result.status).toBe("blocked");
    expect(result.reason).toMatchObject({
      code: "planning_invalid",
      nextCommand: "/corgi:update example",
    });
    expect(result.taskGroupDraft).toBeUndefined();
  });

  it("fails closed when evidence is stale", () => {
    const input = convergenceInput();
    input.evidence[0]!.observedGitRevision = "stale-revision";

    const result = evaluateConvergenceV2(input);

    expect(result.status).toBe("blocked");
    expect(result.reason?.code).toBe("evidence_stale");
  });

  it("returns converged without a write proposal when no gaps remain", () => {
    const input = convergenceInput();
    input.gaps = [];
    input.evidence[0]!.status = "pass";

    const result = evaluateConvergenceV2(input);

    expect(result.status).toBe("converged");
    expect(result.taskGroupDraft).toBeUndefined();
    expect(result.applied).toBeUndefined();
  });

  it("returns evidence and one deterministic append-only Task Group draft", () => {
    const result = evaluateConvergenceV2(convergenceInput());

    expect(result.status).toBe("needs_work");
    expect(result.taskGroupDraft).toMatchObject({
      number: 2,
      tasks: [
        { id: "2.1", gapId: "gap-api" },
        { id: "2.2", gapId: "gap-api" },
      ],
    });
    expect(result.taskGroupDraft?.markdown).toContain("## 2. Convergence follow-up");
    expect(result.evidence).toHaveLength(1);
    expect(result.confirmationToken).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("requires explicit confirmation and leaves the artifact byte-identical", async () => {
    const input = convergenceInput();
    const before = readFileSync(input.planning.taskArtifactPath, "utf8");
    const result = evaluateConvergenceV2(input);

    await expect(applyConfirmedConvergenceV2(result, false, {
      inspectPlanning: async () => input.planning,
    })).rejects.toMatchObject({ code: "converge_not_confirmed" });
    expect(readFileSync(input.planning.taskArtifactPath, "utf8")).toBe(before);
  });

  it("invalidates the old run, appends only the new group, and reuses only unchanged evidence", async () => {
    const input = convergenceInput();
    const before = readFileSync(input.planning.taskArtifactPath, "utf8");
    const fingerprints = fingerprintTaskGroupsV2(input.planning.taskGroups);
    const run: ConvergenceRunContextV2 = {
      runId: "run-old",
      sessionId: "session-1",
      stateRevision: 8,
      nonce: "nonce-8",
      planningRevision: input.planning.planningRevision,
      observedGitRevision: input.git.revision,
      groupFingerprints: { "1": fingerprints["1"]!, "9": "sha256:stale" },
      approvedEvidenceGroups: ["9", "1"],
    };
    input.run = run;
    const invalidateRun = vi.fn(async () => undefined);
    const createSuccessorRun = vi.fn(async () => ({ runId: "run-new" }));
    const result = evaluateConvergenceV2(input);

    const applied = await applyConfirmedConvergenceV2(
      result,
      result.confirmationToken!,
      {
        inspectPlanning: async () => readFileSync(input.planning.taskArtifactPath, "utf8")
          .includes("Convergence follow-up")
          ? planningContext(
              input.planning.changeRoot,
              input.planning.taskArtifactPath,
              "sha256:new-planning",
            )
          : input.planning,
        invalidateRun,
        createSuccessorRun,
        refreshPlanningRevision: async () => "sha256:new-planning",
      },
      run,
    );

    const after = readFileSync(input.planning.taskArtifactPath, "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect(after.slice(0, before.length)).toBe(before);
    expect(after).toContain("## 2. Convergence follow-up");
    expect(after.match(/^## 1\. Existing$/gm)).toHaveLength(1);
    expect(invalidateRun).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-old",
      expectedStateRevision: 8,
      expectedNonce: "nonce-8",
    }));
    expect(createSuccessorRun).toHaveBeenCalledWith(expect.objectContaining({
      supersedesRunId: "run-old",
      reusableEvidenceGroups: ["1"],
    }));
    expect(applied.successor).toEqual({
      supersedesRunId: "run-old",
      reusableEvidenceGroups: ["1"],
      planningRevision: "sha256:new-planning",
      runId: "run-new",
    });
  });

  it("refuses to append if an old Task Group changed after evaluation", async () => {
    const input = convergenceInput();
    const result = evaluateConvergenceV2(input);
    writeFileSync(
      input.planning.taskArtifactPath,
      "## 1. Existing\n\n- [ ] 1.1 Changed after evaluation\n",
    );
    const changed = planningContext(
      input.planning.changeRoot,
      input.planning.taskArtifactPath,
      input.planning.planningRevision,
    );

    await expect(applyConfirmedConvergenceV2(result, result.confirmationToken!, {
      inspectPlanning: async () => changed,
    })).rejects.toMatchObject({ code: "converge_task_artifact_changed" });
  });

  it("fails closed when a refreshed revision disagrees with authoritative post-append planning", async () => {
    const input = convergenceInput();
    const result = evaluateConvergenceV2(input);

    await expect(applyConfirmedConvergenceV2(
      result,
      result.confirmationToken!,
      {
        inspectPlanning: async () => input.planning,
        refreshPlanningRevision: async () => "sha256:disagrees",
      },
    )).rejects.toMatchObject({ code: "converge_post_append_revision_mismatch" });
  });

  it("allows checkbox-only progress between evaluation and confirmed append", async () => {
    const input = convergenceInput();
    const result = evaluateConvergenceV2(input);
    writeFileSync(
      input.planning.taskArtifactPath,
      "# Tasks\n\n## 1. Existing\n\n- [ ] 1.1 Keep original task\n",
    );
    const progressed = planningContext(
      input.planning.changeRoot,
      input.planning.taskArtifactPath,
      input.planning.planningRevision,
    );

    await expect(applyConfirmedConvergenceV2(
      result,
      result.confirmationToken!,
      { inspectPlanning: async () => progressed },
    )).resolves.toMatchObject({ applied: true });
  });

  it("rejects a confirmation token from any other evaluation", async () => {
    const input = convergenceInput();
    const result = evaluateConvergenceV2(input);

    await expect(applyConfirmedConvergenceV2(result, "sha256:wrong", {
      inspectPlanning: async () => input.planning,
    })).rejects.toMatchObject({ code: "converge_not_confirmed" });
  });

  it.skipIf(process.platform === "win32")(
    "preserves CRLF source bytes as an exact prefix and retains file mode",
    async () => {
      const input = convergenceInput();
      const original = "# Tasks\r\n\r\n## 1. Existing\r\n\r\n- [x] 1.1 Keep original task\r\n";
      writeFileSync(input.planning.taskArtifactPath, original);
      chmodSync(input.planning.taskArtifactPath, 0o640);
      input.planning = planningContext(
        input.planning.changeRoot,
        input.planning.taskArtifactPath,
        input.planning.planningRevision,
      );
      const result = evaluateConvergenceV2(input);

      await applyConfirmedConvergenceV2(result, result.confirmationToken!, {
        inspectPlanning: async () => input.planning,
      });

      const bytes = readFileSync(input.planning.taskArtifactPath);
      expect(bytes.subarray(0, Buffer.byteLength(original)).toString("utf8")).toBe(original);
      expect(statSync(input.planning.taskArtifactPath).mode & 0o777).toBe(0o640);
    },
  );

  it("recovers every pre-rename process-death residue without changing the Git fingerprint", async () => {
    const root = resolve(
      tmpdir(),
      `corgispec-converge-temporary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    cleanup.push(root);
    mkdirSync(root, { recursive: true });
    git(root, "init", "-b", "main");
    git(root, "config", "user.email", "corgi@example.test");
    git(root, "config", "user.name", "Corgi Test");
    const taskArtifactPath = resolve(root, "openspec/changes/example/tasks.md");
    const unrelatedSibling = resolve(
      root,
      "openspec/changes/example/.tasks.md.someone-else.tmp",
    );
    const unrelatedStateFile = resolve(root, ".corgi/loop/.converge-tmp/unrelated.tmp");
    mkdirSync(resolve(taskArtifactPath, ".."), { recursive: true });
    mkdirSync(resolve(unrelatedStateFile, ".."), { recursive: true });
    const original = "## 1. Existing\n\n- [x] 1.1 Existing work\n";
    const markdown = "## 2. Convergence follow-up\n\n- [ ] 2.1 Recover safely\n";
    const next = renderConvergenceTaskContentV2(original, markdown);
    writeFileSync(taskArtifactPath, original);
    git(root, "add", "openspec/changes/example/tasks.md");
    git(root, "commit", "-m", "baseline planning");
    writeFileSync(unrelatedSibling, "not owned by corgispec\n");
    writeFileSync(unrelatedStateFile, "also not owned by this append\n");

    const workspace = createGitWorkspaceV2(root);
    const baselineFingerprint = await workspace.workspaceFingerprint();
    const faultPoints: Array<keyof ConvergenceAppendFaultsV2> = [
      "afterTemporaryOpen",
      "afterTemporaryChmod",
      "afterTemporaryTruncate",
      "afterTemporaryWrite",
      "afterTemporaryFsync",
      "afterTemporaryClose",
      "beforeRename",
    ];

    for (const point of faultPoints) {
      let residuePath = "";
      let residue = Buffer.alloc(0);
      const fault = async (): Promise<void> => {
        const managed = findConvergenceTemporaryFiles(root);
        expect(managed).toHaveLength(1);
        residuePath = managed[0]!;
        residue = readFileSync(residuePath);
        throw new Error(`simulated process death at ${point}`);
      };

      await expect(appendConvergenceTaskGroupAtomicallyV2(
        taskArtifactPath,
        original,
        markdown,
        { [point]: fault },
      )).rejects.toThrow(`simulated process death at ${point}`);
      expect(residuePath).not.toBe("");
      expect(findConvergenceTemporaryFiles(root)).toEqual([]);

      // A real process death bypasses finally. Restore the bytes observed at
      // the exact fault point to model that durable residue.
      writeFileSync(residuePath, residue);
      expect(await workspace.workspaceFingerprint()).toBe(baselineFingerprint);

      await appendConvergenceTaskGroupAtomicallyV2(
        taskArtifactPath,
        original,
        markdown,
      );
      expect(readFileSync(taskArtifactPath, "utf8")).toBe(next);
      expect(findConvergenceTemporaryFiles(root)).toEqual([]);
      expect(readFileSync(unrelatedSibling, "utf8")).toBe("not owned by corgispec\n");
      expect(readFileSync(unrelatedStateFile, "utf8"))
        .toBe("also not owned by this append\n");

      writeFileSync(taskArtifactPath, original);
      expect(await workspace.workspaceFingerprint()).toBe(baselineFingerprint);
    }
  });

  it("fails closed and preserves a conflicting managed temporary file", async () => {
    const root = resolve(
      tmpdir(),
      `corgispec-converge-temp-conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    cleanup.push(root);
    mkdirSync(root, { recursive: true });
    git(root, "init", "-b", "main");
    const taskArtifactPath = resolve(root, "tasks.md");
    const original = "## 1. Existing\n\n- [ ] 1.1 Existing work\n";
    const markdown = "## 2. Follow-up\n\n- [ ] 2.1 Add safety\n";
    writeFileSync(taskArtifactPath, original);
    let residuePath = "";

    await expect(appendConvergenceTaskGroupAtomicallyV2(
      taskArtifactPath,
      original,
      markdown,
      {
        afterTemporaryOpen: () => {
          residuePath = findConvergenceTemporaryFiles(root)[0]!;
          throw new Error("capture managed name");
        },
      },
    )).rejects.toThrow("capture managed name");
    const next = renderConvergenceTaskContentV2(original, markdown);
    writeFileSync(residuePath, Buffer.from(next).subarray(0, Math.floor(next.length / 2)));
    await appendConvergenceTaskGroupAtomicallyV2(
      taskArtifactPath,
      original,
      markdown,
    );
    expect(readFileSync(taskArtifactPath, "utf8")).toBe(next);

    writeFileSync(taskArtifactPath, original);
    writeFileSync(residuePath, "foreign, non-prefix bytes");

    await expect(appendConvergenceTaskGroupAtomicallyV2(
      taskArtifactPath,
      original,
      markdown,
    )).rejects.toMatchObject({
      code: "converge_temporary_conflict",
      details: { temporary: residuePath },
    });
    expect(readFileSync(taskArtifactPath, "utf8")).toBe(original);
    expect(readFileSync(residuePath, "utf8")).toBe("foreign, non-prefix bytes");

    rmSync(residuePath);
    const outside = resolve(root, "outside-temporary.md");
    writeFileSync(outside, "outside must remain unchanged\n");
    symlinkSync(outside, residuePath, "file");
    await expect(appendConvergenceTaskGroupAtomicallyV2(
      taskArtifactPath,
      original,
      markdown,
    )).rejects.toMatchObject({ code: "converge_temporary_conflict" });
    expect(readFileSync(outside, "utf8")).toBe("outside must remain unchanged\n");
    expect(readFileSync(taskArtifactPath, "utf8")).toBe(original);
  });

  it("rejects a symlinked managed temporary directory without touching its target", async () => {
    const root = resolve(
      tmpdir(),
      `corgispec-converge-temp-dir-link-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    cleanup.push(root);
    mkdirSync(root, { recursive: true });
    git(root, "init", "-b", "main");
    const taskArtifactPath = resolve(root, "tasks.md");
    const outside = resolve(root, "outside-state");
    mkdirSync(resolve(root, ".corgi"));
    mkdirSync(outside);
    symlinkSync(outside, resolve(root, ".corgi/loop"), "dir");
    const original = "## 1. Existing\n\n- [ ] 1.1 Existing work\n";
    writeFileSync(taskArtifactPath, original);

    await expect(appendConvergenceTaskGroupAtomicallyV2(
      taskArtifactPath,
      original,
      "## 2. Follow-up\n\n- [ ] 2.1 Stay contained\n",
    )).rejects.toMatchObject({ code: "converge_temporary_conflict" });
    expect(readFileSync(taskArtifactPath, "utf8")).toBe(original);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("returns a structured recovery error if append fails after run invalidation", async () => {
    const input = convergenceInput();
    const fingerprints = fingerprintTaskGroupsV2(input.planning.taskGroups);
    const run: ConvergenceRunContextV2 = {
      runId: "run-old",
      sessionId: "session-1",
      stateRevision: 4,
      nonce: "nonce-4",
      planningRevision: input.planning.planningRevision,
      observedGitRevision: input.git.revision,
      groupFingerprints: fingerprints,
      approvedEvidenceGroups: ["1"],
    };
    input.run = run;
    const result = evaluateConvergenceV2(input);
    const invalidateRun = vi.fn(async () => undefined);

    await expect(applyConfirmedConvergenceV2(
      result,
      result.confirmationToken!,
      {
        inspectPlanning: async () => input.planning,
        invalidateRun,
        appendTaskGroup: async () => { throw new Error("disk full"); },
      },
      run,
    )).rejects.toMatchObject({
      code: "converge_append_failed_after_invalidation",
      details: { runId: "run-old", recovery: "/corgi:converge example" },
    });
    expect(invalidateRun).toHaveBeenCalledOnce();
  });
});

function convergenceInput(): ConvergenceEvaluationInputV2 {
  const root = resolve(
    tmpdir(),
    `corgispec-converge-v2-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  cleanup.push(root);
  const changeRoot = resolve(root, "planning", "changes", "example");
  const taskArtifactPath = resolve(changeRoot, "work", "items.md");
  mkdirSync(resolve(changeRoot, "work"), { recursive: true });
  writeFileSync(
    taskArtifactPath,
    "# Tasks\n\n## 1. Existing\n\n- [x] 1.1 Keep original task\n",
  );
  const planning = planningContext(changeRoot, taskArtifactPath, "sha256:planning");
  return {
    changeName: "example",
    planning,
    git: {
      revision: "git-revision",
      workspaceFingerprint: "sha256:workspace",
    },
    evidence: [{
      id: "evidence-1",
      planningRevision: planning.planningRevision,
      observedGitRevision: "git-revision",
      workspaceFingerprint: "sha256:workspace",
      status: "fail",
      summary: "API behavior is incomplete",
    }],
    gaps: [{
      id: "gap-api",
      summary: "Complete API behavior",
      suggestedTasks: ["Implement missing API branch", "Add regression coverage"],
    }],
  };
}

function planningContext(
  changeRoot: string,
  taskArtifactPath: string,
  planningRevision: string,
): ConvergencePlanningContextV2 {
  const parsed = parseTaskGroupsDocument(readFileSync(taskArtifactPath, "utf8"));
  return {
    valid: true,
    ready: true,
    planningRevision,
    changeRoot,
    taskArtifactId: "work-items",
    taskArtifactPath,
    taskGroups: parsed.groups,
    issues: [],
  };
}

function snapshotFiles(root: string): Record<string, string> {
  const output: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else output[absolute.slice(root.length + 1)] = readFileSync(absolute).toString("base64");
    }
  };
  visit(root);
  return output;
}

function findConvergenceTemporaryFiles(root: string): string[] {
  const directory = resolve(root, ".corgi/loop/.converge-tmp");
  try {
    return readdirSync(directory)
      .filter((file) => file.startsWith(".corgispec-converge-v2-") && file.endsWith(".tmp"))
      .map((file) => resolve(directory, file))
      .sort();
  } catch {
    return [];
  }
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
