import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  executeLoopV2,
  type LoopPlanningSnapshotV2,
  type LoopSubmissionBundleV2,
  type LoopV2Dependencies,
} from "../src/commands/loop-v2.js";
import { executeConvergeV2 } from "../src/commands/converge.js";
import {
  applyConfirmedConvergenceV2,
  evaluateConvergenceV2,
  fingerprintTaskGroupsV2,
  type ConvergencePlanningContextV2,
  type ConvergenceRunContextV2,
} from "../src/lib/converge-v2.js";
import {
  createEvidenceBundleV2,
  hashCanonicalArtifactV2,
  type EvidenceEntryV2,
} from "../src/lib/evidence-v2.js";
import { createGitWorkspaceV2, type GitWorkspaceV2 } from "../src/lib/git-workspace-v2.js";
import { migrateLegacyLoopV2 } from "../src/lib/loop-migration-v2.js";
import {
  createInitialLoopStateV2,
  createRunInitializedEventV2,
} from "../src/lib/loop-reducer-v2.js";
import { LoopStoreV2 } from "../src/lib/loop-store-v2.js";
import type { ArtifactHashV2, LoopStateV2 } from "../src/lib/run-contract-v2.js";
import { parseTaskGroupsDocument } from "../src/lib/task-groups.js";

const roots: string[] = [];
const CHANGE = "example";
const SESSION = "session-e2e";
const TASKS = [
  "## 1. Foundation",
  "",
  "- [ ] 1.1 Implement the foundation",
  "",
  "## 2. API",
  "",
  "- [ ] 2.1 Implement the API",
  "",
].join("\n");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface Runtime {
  root: string;
  store: LoopStoreV2;
  git: GitWorkspaceV2;
  planning: LoopPlanningSnapshotV2;
  dependencies: LoopV2Dependencies;
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  }).trim();
}

function repository(label: string): string {
  const root = mkdtempSync(resolve(tmpdir(), `corgispec-contract-${label}-`));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "corgispec@example.test");
  git(root, "config", "user.name", "CorgiSpec E2E");
  writeFileSync(resolve(root, ".gitignore"), ".claude/\n.opencode/\n.corgi/\n", "utf8");
  writeFileSync(resolve(root, "README.md"), "# Contract fixture\n", "utf8");
  writeFileSync(resolve(root, "tasks.md"), TASKS, "utf8");
  git(root, "add", ".gitignore", "README.md", "tasks.md");
  git(root, "commit", "-q", "-m", "baseline planning");
  return root;
}

function planningFromTasks(root: string): LoopPlanningSnapshotV2 {
  const content = readFileSync(resolve(root, "tasks.md"), "utf8");
  const parsed = parseTaskGroupsDocument(content);
  const fingerprints = fingerprintTaskGroupsV2(parsed.groups);
  return {
    ready: true,
    planningRevision: hashCanonicalArtifactV2({ schema: "e2e", tasks: content }),
    groups: parsed.groups.map((group) => ({
      id: String(group.number),
      fingerprint: fingerprints[String(group.number)]! as ArtifactHashV2,
    })),
    blockers: [],
  };
}

function runtime(root: string): Runtime {
  const store = new LoopStoreV2({ projectRoot: root });
  const workspace = createGitWorkspaceV2(root);
  let tick = 0;
  let nonce = 0;
  const value = {
    root,
    store,
    git: workspace,
    planning: planningFromTasks(root),
  } as Runtime;
  value.dependencies = {
    createStore: () => store,
    createGit: () => workspace,
    inspectPlanning: async () => structuredClone(value.planning),
    now: () => new Date(Date.UTC(2026, 5, 1, 0, 0, tick++)).toISOString(),
    newNonce: () => `e2e-nonce-${++nonce}`,
  };
  return value;
}

function token(state: LoopStateV2) {
  return {
    runId: state.runId,
    sessionId: state.sessionId,
    stateRevision: state.stateRevision,
    nonce: state.nonce,
  };
}

async function submission(
  value: Runtime,
  state: LoopStateV2,
  verdict: "PASS" | "FAIL",
  bundleId: string,
): Promise<LoopSubmissionBundleV2> {
  const snapshot = await value.git.snapshot();
  const binding = {
    runId: state.runId,
    groupId: state.currentGroupId!,
    attempt: state.currentAttempt,
    bundleId,
    planningRevision: state.planningRevision,
    taskGroupFingerprint: state.groups[state.currentGroupId!]!.taskGroupFingerprint,
    baselineGitRevision: state.git.baselineRevision,
    observedGitRevision: snapshot.headRevision,
    workspaceFingerprint: snapshot.workspaceFingerprint as ArtifactHashV2,
  };
  const cliEvidence: EvidenceEntryV2 = {
    id: `${bundleId}-test`,
    kind: "test",
    provenance: "cli",
    status: verdict === "PASS" ? "pass" : "fail",
    binding,
    command: "npm test",
    cwd: value.root,
    exitCode: verdict === "PASS" ? 0 : 1,
  };
  return {
    schemaVersion: 2,
    evidence: createEvidenceBundleV2({ binding, verdict, evidence: [cliEvidence] }),
    review: { findings: [] },
    artifacts: {
      "test-result.json": { command: "npm test", verdict, bundleId },
    },
  };
}

async function initialize(
  value: Runtime,
  runId: string,
  mode: "self-driven" | "hook-driven" = "self-driven",
): Promise<LoopStateV2> {
  const result = await executeLoopV2({
    operation: "init",
    projectRoot: value.root,
    changeName: CHANGE,
    sessionId: SESSION,
    ownerId: "e2e-agent",
    mode,
    runId,
    maxAttemptsPerGroup: 3,
  }, value.dependencies);
  expect(result.exitCode, JSON.stringify(result.output)).toBe(0);
  return result.output.state!;
}

async function submit(
  value: Runtime,
  state: LoopStateV2,
  verdict: "PASS" | "FAIL",
  bundleId: string,
): Promise<LoopStateV2> {
  const result = await executeLoopV2({
    operation: "submit",
    projectRoot: value.root,
    changeName: CHANGE,
    ...token(state),
    bundle: await submission(value, state, verdict, bundleId),
  }, value.dependencies);
  expect(result.exitCode, JSON.stringify(result.output)).toBe(0);
  return result.output.state!;
}

async function acknowledge(value: Runtime, state: LoopStateV2): Promise<LoopStateV2> {
  const result = await executeLoopV2({
    operation: "ack-commit",
    projectRoot: value.root,
    changeName: CHANGE,
    ...token(state),
  }, value.dependencies);
  expect(result.exitCode, JSON.stringify(result.output)).toBe(0);
  return result.output.state!;
}

async function finalize(value: Runtime, state: LoopStateV2): Promise<LoopStateV2> {
  const result = await executeLoopV2({
    operation: "finalize",
    projectRoot: value.root,
    changeName: CHANGE,
    ...token(state),
  }, value.dependencies);
  expect(result.exitCode, JSON.stringify(result.output)).toBe(0);
  return result.output.state!;
}

async function completeTwoGroupsWithRetry(
  value: Runtime,
  runId: string,
): Promise<{ state: LoopStateV2; group1Commit: string; group2Commit: string }> {
  let state = await initialize(value, runId);

  writeFileSync(resolve(value.root, "foundation.ts"), "export const foundation = 'first';\n", "utf8");
  state = await submit(value, state, "FAIL", `${runId}-g1-a1`);
  expect(state).toMatchObject({ phase: "fixing", currentGroupId: "1", currentAttempt: 2 });

  writeFileSync(resolve(value.root, "foundation.ts"), "export const foundation = 'fixed';\n", "utf8");
  state = await submit(value, state, "PASS", `${runId}-g1-a2`);
  expect(state.phase).toBe("awaiting_group_commit");
  git(value.root, "add", "foundation.ts");
  git(value.root, "commit", "-q", "-m", `${runId}: task group 1`);
  const group1Commit = git(value.root, "rev-parse", "HEAD");
  state = await acknowledge(value, state);
  expect(state).toMatchObject({ phase: "awaiting_group_result", currentGroupId: "2", currentAttempt: 1 });

  writeFileSync(resolve(value.root, "api.ts"), "export const api = 'implemented';\n", "utf8");
  state = await submit(value, state, "PASS", `${runId}-g2-a1`);
  git(value.root, "add", "api.ts");
  git(value.root, "commit", "-q", "-m", `${runId}: task group 2`);
  const group2Commit = git(value.root, "rev-parse", "HEAD");
  state = await acknowledge(value, state);
  expect(state.phase).toBe("awaiting_finalize");
  state = await finalize(value, state);
  return { state, group1Commit, group2Commit };
}

async function passCommitAndAcknowledge(
  value: Runtime,
  state: LoopStateV2,
  file: string,
  bundleId: string,
): Promise<LoopStateV2> {
  writeFileSync(resolve(value.root, file), `export const value = ${JSON.stringify(bundleId)};\n`, "utf8");
  state = await submit(value, state, "PASS", bundleId);
  git(value.root, "add", file);
  git(value.root, "commit", "-q", "-m", `complete ${state.currentGroupId}`);
  return await acknowledge(value, state);
}

function convergencePlanning(value: Runtime): ConvergencePlanningContextV2 {
  const taskArtifactPath = resolve(value.root, "tasks.md");
  const taskGroups = parseTaskGroupsDocument(readFileSync(taskArtifactPath, "utf8")).groups;
  return {
    valid: true,
    ready: true,
    planningRevision: value.planning.planningRevision,
    changeRoot: value.root,
    taskArtifactId: "tasks",
    taskArtifactPath,
    taskGroups,
    issues: [],
  };
}

describe("run-contract v2 cross-module E2E", () => {
  it("persists a two-group retry/pass/commit/finalize run against a real Git repository", async () => {
    const root = repository("two-groups");
    const value = runtime(root);
    const baseline = git(root, "rev-parse", "HEAD");

    const completed = await completeTwoGroupsWithRetry(value, "run-two-groups");

    expect(completed.group1Commit).not.toBe(baseline);
    expect(completed.group2Commit).not.toBe(completed.group1Commit);
    expect(git(root, "rev-parse", `${completed.group2Commit}^`)).toBe(completed.group1Commit);
    expect(completed.state).toMatchObject({
      phase: "done",
      git: { baselineRevision: baseline, finalRevision: completed.group2Commit },
      groups: {
        "1": { attempt: 2, status: "completed", commit: { revision: completed.group1Commit } },
        "2": { attempt: 1, status: "completed", commit: { revision: completed.group2Commit } },
      },
    });
    expect(git(root, "rev-list", "--count", "HEAD")).toBe("3");

    const paths = value.store.paths(CHANGE, completed.state.runId);
    expect(existsSync(resolve(paths.attempts!, "1/1/bundle.json"))).toBe(true);
    expect(existsSync(resolve(paths.attempts!, "1/2/bundle.json"))).toBe(true);
    expect(existsSync(resolve(paths.attempts!, "2/1/bundle.json"))).toBe(true);
    const inspection = await value.store.inspect(CHANGE, { runId: completed.state.runId });
    expect(inspection.events.map((record) => record.event.type)).toEqual([
      "run_initialized",
      "bundle_submitted",
      "evaluation_completed",
      "bundle_submitted",
      "evaluation_completed",
      "group_commit_acknowledged",
      "bundle_submitted",
      "evaluation_completed",
      "group_commit_acknowledged",
      "run_finalized",
    ]);
  });

  it("invalidates on external planning semantics before writing any attempt bytes", async () => {
    const root = repository("planning-change");
    const value = runtime(root);
    const state = await initialize(value, "run-planning-change");
    const validBundle = await submission(value, state, "PASS", "never-written");
    value.planning.planningRevision = hashCanonicalArtifactV2({ semantics: "externally changed" });

    const result = await executeLoopV2({
      operation: "submit",
      projectRoot: root,
      changeName: CHANGE,
      ...token(state),
      bundle: validBundle,
    }, value.dependencies);

    expect(result.exitCode).toBe(1);
    expect(result.output.state).toMatchObject({
      phase: "invalidated",
      blockedReason: {
        code: "planning_invalidated",
        details: { cause: "planning_revision_changed" },
      },
    });
    const paths = value.store.paths(CHANGE, state.runId);
    expect(existsSync(paths.attempts!)).toBe(false);
    const inspection = await value.store.inspect(CHANGE, { runId: state.runId });
    expect(inspection.events.map((record) => record.event.type)).toEqual([
      "run_initialized",
      "run_invalidated",
    ]);
  });

  it("auto-discovers one v1 run, preserves completed work, archives stale evidence, and continues", async () => {
    const root = repository("migration");
    const value = runtime(root);
    const legacyRoot = resolve(root, ".claude/corgi-loop", CHANGE);
    mkdirSync(resolve(legacyRoot, "groups/2"), { recursive: true });
    writeFileSync(resolve(legacyRoot, "state.json"), JSON.stringify({
      schemaVersion: 1,
      active: true,
      changeName: CHANGE,
      sessionId: SESSION,
      currentGroup: 2,
      totalGroups: 2,
      completedGroups: [1],
      groupStatuses: { "1": "completed", "2": "in_progress" },
      retryCount: 1,
      maxRetries: 3,
      selfDriven: true,
      startedAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:01:00.000Z",
    }), "utf8");
    writeFileSync(resolve(legacyRoot, "groups/2/verify.json"), JSON.stringify({ verdict: "PASS" }), "utf8");
    writeFileSync(resolve(legacyRoot, "groups/2/review.json"), JSON.stringify({ findings: [] }), "utf8");
    const baseline = git(root, "rev-parse", "HEAD");
    const snapshot = await value.git.snapshot();
    const migrated = await migrateLegacyLoopV2({
      projectRoot: root,
      changeName: CHANGE,
      planningRevision: value.planning.planningRevision,
      baselineGitRevision: baseline,
      baselineGitTree: git(root, "rev-parse", "HEAD^{tree}"),
      workspaceFingerprint: snapshot.workspaceFingerprint as ArtifactHashV2,
      taskGroups: value.planning.groups.map((group, index) => ({
        id: group.id,
        ordinal: index + 1,
        taskGroupFingerprint: group.fingerprint,
      })),
      runId: "run-migrated",
      sessionId: SESSION,
      owner: { id: "migration-e2e", kind: "automation" },
      mode: "self-driven",
      now: () => new Date("2026-05-01T00:02:00.000Z"),
    });

    expect(migrated).toMatchObject({
      status: "migrated",
      staleArtifacts: [
        "legacy/claude/current-group/verify.json",
        "legacy/claude/current-group/review.json",
      ],
      state: {
        currentGroupId: "2",
        currentAttempt: 2,
        groups: {
          "1": { status: "completed", commit: { revision: baseline } },
          "2": { status: "in_progress", bundle: { status: "none" } },
        },
      },
    });
    const paths = value.store.paths(CHANGE, "run-migrated");
    expect(existsSync(resolve(paths.runRoot!, "legacy/claude/current-group/verify.json"))).toBe(true);
    expect(existsSync(resolve(paths.runRoot!, "legacy/claude/current-group/review.json"))).toBe(true);
    expect(JSON.parse(readFileSync(resolve(paths.runRoot!, "legacy/claude/stale-artifacts.json"), "utf8")))
      .toMatchObject({ reason: expect.stringContaining("stale") });

    let state = migrated.state!;
    state = await passCommitAndAcknowledge(value, state, "migration-continuation.ts", "migrated-g2-a2");
    expect(state.phase).toBe("awaiting_finalize");
    state = await finalize(value, state);
    expect(state).toMatchObject({
      phase: "done",
      groups: {
        "1": { status: "completed", commit: { revision: baseline } },
        "2": { status: "completed", attempt: 2 },
      },
      git: { finalRevision: git(root, "rev-parse", "HEAD") },
    });
    expect(existsSync(resolve(paths.attempts!, "1"))).toBe(false);
    expect(existsSync(resolve(paths.attempts!, "2/2/bundle.json"))).toBe(true);
    const convergeDone = await executeConvergeV2({
      projectRoot: root,
      changeName: CHANGE,
    }, {
      inspectPlanning: async () => convergencePlanning(value),
      createGit: () => value.git,
      createLoopStore: () => value.store,
    });
    expect(convergeDone.exitCode, JSON.stringify(convergeDone.output)).toBe(0);
    expect(convergeDone.output).toMatchObject({ status: "converged" });
  });

  it("verifies a migrated prefix before reusing it through a failed-run successor", async () => {
    const root = repository("migration-successor");
    const value = runtime(root);
    const legacyRoot = resolve(root, ".claude/corgi-loop", CHANGE);
    mkdirSync(resolve(legacyRoot, "groups/2"), { recursive: true });
    writeFileSync(resolve(legacyRoot, "state.json"), JSON.stringify({
      schemaVersion: 1, active: true, changeName: CHANGE, sessionId: SESSION,
      currentGroup: 2, totalGroups: 2, completedGroups: [1],
      groupStatuses: { "1": "completed", "2": "in_progress" },
      retryCount: 0, maxRetries: 2, selfDriven: false,
      startedAt: "2026-05-01T00:00:00.000Z", updatedAt: "2026-05-01T00:01:00.000Z",
    }));
    writeFileSync(resolve(legacyRoot, "groups/2/verify.json"), "{\"verdict\":\"FAIL\"}\n");
    writeFileSync(resolve(legacyRoot, "groups/2/review.json"), "{\"findings\":[]}\n");
    const baseline = await value.git.snapshot();
    const migrated = await migrateLegacyLoopV2({
      projectRoot: root, changeName: CHANGE,
      planningRevision: value.planning.planningRevision,
      baselineGitRevision: baseline.headRevision,
      baselineGitTree: git(root, "rev-parse", "HEAD^{tree}"),
      workspaceFingerprint: baseline.workspaceFingerprint as ArtifactHashV2,
      taskGroups: value.planning.groups.map((group, index) => ({
        id: group.id, ordinal: index + 1, taskGroupFingerprint: group.fingerprint,
      })),
      runId: "run-migrated-failed", sessionId: SESSION,
      owner: { id: "migration-e2e", kind: "automation" }, mode: "hook-driven",
      now: () => new Date("2026-05-01T00:02:00.000Z"),
    });
    let state = migrated.state!;
    writeFileSync(resolve(root, "api-broken.ts"), "export const broken = true;\n");
    const failed = await executeLoopV2({
      operation: "submit", projectRoot: root, changeName: CHANGE, ...token(state),
      bundle: await submission(value, state, "FAIL", "migrated-g2-fail"),
    }, value.dependencies);
    state = failed.output.state!;
    expect(state.phase).toBe("verification_failed");

    const runPaths = value.store.paths(CHANGE, state.runId);
    const archivedVerify = resolve(runPaths.runRoot!, "legacy/claude/current-group/verify.json");
    const originalArchive = readFileSync(archivedVerify);
    const stateBefore = readFileSync(runPaths.state!);
    const eventsBefore = readFileSync(runPaths.events!);
    const tasksBefore = readFileSync(resolve(root, "tasks.md"));
    writeFileSync(archivedVerify, "{\"tampered\":true}\n");
    const inspectPlanning = async () => {
      value.planning = planningFromTasks(root);
      return convergencePlanning(value);
    };
    const blocked = await executeConvergeV2({ projectRoot: root, changeName: CHANGE }, {
      inspectPlanning, createGit: () => value.git, createLoopStore: () => value.store,
    });
    expect(blocked.exitCode).toBe(2);
    expect(readFileSync(runPaths.state!)).toEqual(stateBefore);
    expect(readFileSync(runPaths.events!)).toEqual(eventsBefore);
    expect(readFileSync(resolve(root, "tasks.md"))).toEqual(tasksBefore);
    writeFileSync(archivedVerify, originalArchive);

    const evaluated = await executeConvergeV2({ projectRoot: root, changeName: CHANGE }, {
      inspectPlanning, createGit: () => value.git, createLoopStore: () => value.store,
    });
    expect(evaluated.output.status).toBe("needs_work");
    const applied = await executeConvergeV2({
      projectRoot: root, changeName: CHANGE,
      confirmationToken: evaluated.output.confirmationToken,
    }, {
      inspectPlanning, createGit: () => value.git, createLoopStore: () => value.store,
      newRunId: () => "run-migrated-successor", newNonce: () => "migrated-successor-nonce",
      now: value.dependencies.now,
      loopDependencies: value.dependencies,
      previewPostPlanningRevision: async (_planning, postTaskBytes) =>
        hashCanonicalArtifactV2({
          schema: "e2e",
          tasks: Buffer.from(postTaskBytes).toString("utf8"),
        }),
    });
    expect(applied.exitCode, JSON.stringify(applied.output)).toBe(0);
    expect(applied.output.successor?.reusableEvidenceGroups).toEqual(["1"]);
    state = (await value.store.peek(CHANGE)).state!;
    expect(state.currentGroupId).toBe("2");
    rmSync(resolve(root, "api-broken.ts"));
    git(root, "add", "tasks.md");
    state = await passCommitAndAcknowledge(value, state, "migration-g2-fixed.ts", "migration-g2-fixed");
    state = await passCommitAndAcknowledge(value, state, "migration-g3.ts", "migration-g3");
    state = await finalize(value, state);
    expect(state).toMatchObject({
      phase: "done", supersedesRunId: "run-migrated-failed",
      groups: { "1": { status: "completed" }, "2": { status: "completed" }, "3": { status: "completed" } },
    });
  });

  it("converges append-only, invalidates the old run, reuses only unchanged evidence, and completes the successor", async () => {
    const root = repository("converge");
    const value = runtime(root);
    const old = await completeTwoGroupsWithRetry(value, "run-before-converge");
    const oldTaskBytes = readFileSync(resolve(root, "tasks.md"));
    const planning = convergencePlanning(value);
    const actualFingerprints = fingerprintTaskGroupsV2(planning.taskGroups);
    const gitSnapshot = await value.git.snapshot();
    const run: ConvergenceRunContextV2 = {
      runId: old.state.runId,
      stateRevision: old.state.stateRevision,
      nonce: old.state.nonce,
      sessionId: old.state.sessionId,
      planningRevision: old.state.planningRevision,
      observedGitRevision: gitSnapshot.headRevision,
      groupFingerprints: {
        "1": actualFingerprints["1"]!,
        "2": hashCanonicalArtifactV2({ changed: "group-2" }),
      },
      approvedEvidenceGroups: ["2", "1"],
    };
    const evaluation = evaluateConvergenceV2({
      changeName: CHANGE,
      planning,
      git: {
        revision: gitSnapshot.headRevision,
        workspaceFingerprint: gitSnapshot.workspaceFingerprint,
      },
      evidence: [{
        id: "post-run-evidence",
        planningRevision: planning.planningRevision,
        observedGitRevision: gitSnapshot.headRevision,
        workspaceFingerprint: gitSnapshot.workspaceFingerprint,
        status: "pass",
        summary: "A follow-up implementation gap remains",
      }],
      gaps: [{
        id: "gap-follow-up",
        summary: "Close the remaining integration gap",
        suggestedTasks: ["Implement the follow-up integration"],
      }],
      run,
    });
    expect(evaluation).toMatchObject({
      status: "needs_work",
      taskGroupDraft: { number: 3, tasks: [{ id: "3.1" }] },
    });

    let invalidatedOld: LoopStateV2 | undefined;
    let successorState: LoopStateV2 | undefined;
    const applied = await applyConfirmedConvergenceV2(
      evaluation,
      evaluation.confirmationToken!,
      {
        inspectPlanning: async () => convergencePlanning(value),
        invalidateRun: async (input) => {
          const result = await executeLoopV2({
            operation: "invalidate",
            projectRoot: root,
            changeName: input.changeName,
            runId: input.runId,
            sessionId: input.sessionId,
            stateRevision: input.expectedStateRevision,
            nonce: input.expectedNonce,
            reason: input.reason,
            reasonCode: "planning_invalidated",
          }, value.dependencies);
  expect(result.exitCode, JSON.stringify(result.output)).toBe(0);
          invalidatedOld = result.output.state;
        },
        refreshPlanningRevision: async () => {
          value.planning = planningFromTasks(root);
          return value.planning.planningRevision;
        },
        createSuccessorRun: async (input) => {
          git(root, "add", "tasks.md");
          git(root, "commit", "-q", "-m", "append convergence task group");
          const baseline = await value.git.snapshot();
          const startedAt = "2026-06-01T00:00:00.000Z";
          const state = createInitialLoopStateV2({
            changeName: CHANGE,
            runId: "run-after-converge",
            supersedesRunId: input.supersedesRunId,
            owner: { id: "converge-e2e", kind: "automation" },
            sessionId: SESSION,
            mode: "self-driven",
            nonce: "successor-nonce-0",
            planningRevision: input.planningRevision as ArtifactHashV2,
            baselineGitRevision: baseline.headRevision,
            workspaceFingerprint: baseline.workspaceFingerprint as ArtifactHashV2,
            policy: {
              requireCleanReview: true,
              requireCliPass: true,
              requireCleanWorktreeForCommit: true,
              requirePush: false,
            },
            limits: { maxGroups: 10, maxAttemptsPerGroup: 3, maxEvents: 100 },
            groups: value.planning.groups.map((group) => ({
              id: group.id,
              taskGroupFingerprint: group.fingerprint,
            })),
            startedAt,
          });
          const reusable = new Set(input.reusableEvidenceGroups);
          expect([...reusable]).toEqual(["1"]);
          state.groups["1"] = {
            ...structuredClone(old.state.groups["1"]!),
            taskGroupFingerprint: value.planning.groups.find((group) => group.id === "1")!.fingerprint,
            completedAt: startedAt,
          };
          state.groups["2"]!.status = "in_progress";
          state.groups["2"]!.attempt = 1;
          state.currentGroupId = "2";
          state.currentAttempt = 1;
          const event = createRunInitializedEventV2(state);
          successorState = await value.store.initialize({ state, event });
          return { runId: state.runId };
        },
      },
      run,
    );

    const newTaskBytes = readFileSync(resolve(root, "tasks.md"));
    expect(newTaskBytes.subarray(0, oldTaskBytes.length)).toEqual(oldTaskBytes);
    expect(newTaskBytes.toString("utf8").match(/^## 3\. Convergence follow-up$/gmu)).toHaveLength(1);
    expect(parseTaskGroupsDocument(newTaskBytes.toString("utf8")).groups).toHaveLength(3);
    expect(invalidatedOld).toMatchObject({ phase: "invalidated", runId: old.state.runId });
    expect(applied.successor).toEqual({
      supersedesRunId: old.state.runId,
      reusableEvidenceGroups: ["1"],
      planningRevision: value.planning.planningRevision,
      runId: "run-after-converge",
    });
    expect(successorState).toMatchObject({
      supersedesRunId: old.state.runId,
      phase: "awaiting_group_result",
      currentGroupId: "2",
      groups: {
        "1": { status: "completed", commit: { revision: old.group1Commit } },
        "2": { status: "in_progress" },
        "3": { status: "pending" },
      },
    });
    const successorPaths = value.store.paths(CHANGE, "run-after-converge");
    expect(existsSync(resolve(successorPaths.attempts!, "1"))).toBe(false);

    let continuation = successorState!;
    continuation = await passCommitAndAcknowledge(value, continuation, "successor-group-2.ts", "successor-g2-a1");
    expect(continuation.currentGroupId).toBe("3");
    continuation = await passCommitAndAcknowledge(value, continuation, "successor-group-3.ts", "successor-g3-a1");
    continuation = await finalize(value, continuation);
    expect(continuation).toMatchObject({
      phase: "done",
      supersedesRunId: old.state.runId,
      git: { finalRevision: git(root, "rev-parse", "HEAD") },
      groups: {
        "1": { commit: { revision: old.group1Commit } },
        "2": { status: "completed", attempt: 1 },
        "3": { status: "completed", attempt: 1 },
      },
    });
    expect(existsSync(resolve(successorPaths.attempts!, "1"))).toBe(false);
    expect(readdirSync(successorPaths.attempts!).sort()).toEqual(["2", "3"]);

    const convergedDone = await executeConvergeV2({
      projectRoot: root,
      changeName: CHANGE,
    }, {
      inspectPlanning: async () => convergencePlanning(value),
      createGit: () => value.git,
      createLoopStore: () => value.store,
    });
    expect(convergedDone.exitCode, JSON.stringify(convergedDone.output)).toBe(0);
    expect(convergedDone.output.status).toBe("converged");

    const currentState = readFileSync(successorPaths.state!);
    const currentEvents = readFileSync(successorPaths.events!);
    const currentTasks = readFileSync(resolve(root, "tasks.md"));
    const oldPaths = value.store.paths(CHANGE, old.state.runId);
    writeFileSync(
      resolve(oldPaths.attempts!, "1/2/artifacts/test-result.json"),
      "{\"tampered\":true}\n",
    );
    const sourceTampered = await executeConvergeV2({
      projectRoot: root,
      changeName: CHANGE,
    }, {
      inspectPlanning: async () => convergencePlanning(value),
      createGit: () => value.git,
      createLoopStore: () => value.store,
    });
    expect(sourceTampered.exitCode).toBe(2);
    expect(sourceTampered.output.reason?.code).toBe("canonical_hash_mismatch");
    expect(readFileSync(successorPaths.state!)).toEqual(currentState);
    expect(readFileSync(successorPaths.events!)).toEqual(currentEvents);
    expect(readFileSync(resolve(root, "tasks.md"))).toEqual(currentTasks);
  });
});
