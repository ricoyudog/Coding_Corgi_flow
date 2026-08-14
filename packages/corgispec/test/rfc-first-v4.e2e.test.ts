import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProposeCommand } from "../src/commands/propose.js";
import { performLocalArchiveCloseoutV3 } from "../src/lib/archive-closeout-v3.js";
import type { ResolvedChangeArtifacts } from "../src/lib/artifact-resolver.js";
import { runBootstrap, type BootstrapResult } from "../src/lib/bootstrap.js";
import {
  loadChangeContract,
  writeChangeTraceability,
  type LoadedChangeContract,
} from "../src/lib/change-contract.js";
import { GitWorkspaceV2 } from "../src/lib/git-workspace-v2.js";
import {
  adoptAmendmentV3,
  beginArchiveV3,
  completeLocalArchiveV3,
  completeTaskGroupV3,
  completeTrackerArchiveV3,
  finishArchiveV3,
  lifecycleTokenV3,
  materializeArchiveEvidenceV3,
  startApplyV3,
  submitHumanQaV3,
  submitHumanReviewV3,
  submitVerifyV3,
  type LifecyclePlanV3,
  type LifecycleV3Dependencies,
} from "../src/lib/lifecycle-v3.js";
import { LoopStoreV3 } from "../src/lib/loop-store-v3.js";
import {
  acceptRfc,
  createRfcDraft,
  loadRfcDelivery,
  type LoadedRfc,
} from "../src/lib/rfc.js";
import type { ArtifactHashV3, RunStateV3 } from "../src/lib/run-contract-v3.js";
import { syncTrackerStateV3 } from "../src/lib/tracker-sync-v3.js";
import type {
  TrackerClient,
  TrackerIssue,
  TrackerWorkflowState,
} from "../src/lib/tracker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_ROOT = resolve(__dirname, "../assets");
const PLAN_1 = `sha256:${"1".repeat(64)}` as ArtifactHashV3;
const PLAN_2 = `sha256:${"2".repeat(64)}` as ArtifactHashV3;
const GROUP_1 = `sha256:${"3".repeat(64)}` as ArtifactHashV3;
const GROUP_2 = `sha256:${"4".repeat(64)}` as ArtifactHashV3;
const sandboxes: string[] = [];

type Provider = "github" | "gitlab" | "none";

interface ProjectHarness {
  sandbox: string;
  root: string;
  provider: Provider;
  bootstrap: BootstrapResult;
  tracker: MemoryTracker | null;
  trackerFactoryCalls: Provider[];
  legacy?: { session: Buffer; log: Buffer };
}

interface ProposedChange {
  project: ProjectHarness;
  changeName: string;
  changeRoot: string;
  contract: LoadedChangeContract;
  feature: LoadedRfc | null;
}

interface DeliveryRun {
  proposed: ProposedChange;
  plan: LifecyclePlanV3;
  dependencies: LifecycleV3Dependencies;
  store: LoopStoreV3;
  setRunId(value: string): void;
}

interface ArchiveResult {
  state: RunStateV3;
  deliveryPage: string;
  archivedRoot: string;
  closeRecovered: boolean;
}

afterEach(() => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

describe.sequential("CorgiSpec v4 RFC-first cross-module E2E", () => {
  it("Fresh Project Feature: bootstraps, delivers one RFC Slice, and closes one Issue", async () => {
    const result = await executeFeature({ provider: "github", name: "fresh-feature" });

    expect(result.project.bootstrap).toMatchObject({ status: "success", mode: "fresh" });
    expect(result.proposed.contract.source).toMatchObject({
      kind: "rfc-slice",
      slice: { id: "S-01-fresh-feature" },
      tracker: { provider: "github", issue: { id: "github-1" } },
    });
    expect(loadRfcDelivery(result.project.root, result.feature.metadata.id).slices["S-01-fresh-feature"])
      .toMatchObject({ status: "archived", binding: { change: "fresh-feature" } });
    expect(result.archive.state.phase).toBe("archived");
    expect(result.project.tracker).toMatchObject({ createCount: 1, closeCount: 1 });
    expect(readFileSync(result.archive.deliveryPage, "utf8")).toContain("AC-001");
  });

  it("v3 Migration Feature: preserves legacy knowledge and completes the v4 quality chain", async () => {
    const result = await executeFeature({ provider: "none", name: "migrated-feature", migrateV3: true });

    expect(result.project.bootstrap).toMatchObject({ status: "success" });
    expect(readFileSync(resolve(result.project.root, "wiki/sessions/legacy.md"))).toEqual(result.project.legacy?.session);
    expect(readFileSync(resolve(result.project.root, "wiki/log.md"))).toEqual(result.project.legacy?.log);
    expect(result.archive.state).toMatchObject({
      phase: "archived",
      verify: { verdict: "pass" },
      review: { decision: "approve" },
      qa: { verdict: "pass" },
    });
    expect(loadRfcDelivery(result.project.root, result.feature.metadata.id).slices["S-01-migrated-feature"]?.status)
      .toBe("archived");
  });

  it("Maintenance Exemption: classifies test-only work, enforces its diff scope, and archives", async () => {
    const project = await createProject("none");
    acceptFoundation(project.root);
    commitAll(project.root, "accept Foundation RFC");
    const proposed = await propose(project, {
      name: "coverage-maintenance",
      maintenance: "Improve test coverage assertions",
    });
    const run = createDeliveryRun(proposed);
    let state = await applyAndVerify(run, "test/coverage-maintenance.test.ts");
    state = await approveAndQa(run, state);
    const archive = await archiveDelivery(run, state);

    expect(proposed.contract.source).toMatchObject({
      kind: "maintenance",
      maintenance: { category: "test-only" },
      acceptance: [{ id: "MC-001", evidence: "automated" }],
    });
    expect(archive.state.phase).toBe("archived");
    expect(archive.deliveryPage).toMatch(/maintenance-coverage-maintenance\.md$/u);
    expect(readFileSync(archive.deliveryPage, "utf8")).toContain("maintenance/coverage-maintenance");
  });

  it("RFC Amendment Repair: stops code work, adopts an accepted Amendment, and runs a successor through Archive", async () => {
    const project = await createProject("none");
    acceptFoundation(project.root);
    const original = acceptedFeature(project.root, "amendable", "S-01-amendable");
    commitAll(project.root, "accept original RFC");
    const proposed = await propose(project, {
      name: "amendable-change",
      from: `${original.metadata.id}/S-01-amendable`,
      feature: original,
    });
    const run = createDeliveryRun(proposed);
    let predecessor = await applyAndVerify(run, "src/amendable-change.txt");
    predecessor = await submitHumanReviewV3({
      projectRoot: project.root,
      changeName: proposed.changeName,
      token: lifecycleTokenV3(predecessor),
      decision: "require-rfc-amendment",
      reviewer: "human@example.test",
      reason: "the accepted boundary is incomplete",
    }, run.dependencies);
    expect(predecessor).toMatchObject({ phase: "repair_required", repair: { kind: "rfc_amendment" } });

    const amendment = createRfcDraft({
      projectDir: project.root,
      slug: "amend-amendable",
      amends: original.metadata.id,
    });
    completeRfc(project.root, amendment.metadata.id, "S-01-amendable", "Deliver the corrected accepted boundary.");
    acceptRfc({
      projectDir: project.root,
      rfcId: amendment.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
      now: new Date("2026-08-14T00:10:00.000Z"),
    });
    git(project.root, ["add", "--", `rfcs/${amendment.metadata.id}`]);
    git(project.root, ["commit", "-m", "accept Amendment RFC"]);

    const predecessorToken = lifecycleTokenV3(predecessor);
    const prepared = await adoptAmendmentV3({
      projectRoot: project.root,
      changeName: proposed.changeName,
      token: predecessorToken,
      sessionId: "session-amendment",
      owner: { id: "agent", kind: "agent" },
      rfcId: amendment.metadata.id,
    }, run.dependencies);
    expect(prepared.status).toBe("reconciliation_required");

    const tasksPath = resolve(proposed.changeRoot, "tasks.md");
    writeFileSync(tasksPath, `${readFileSync(tasksPath, "utf8").trimEnd()}\n\n## 2. Amendment Repair\n\n- [ ] 2.1 Implement the corrected boundary.\n`);
    const amendedContract = loadChangeContract(proposed.changeRoot, { required: true })!;
    writeChangeTraceability(proposed.changeRoot, {
      schemaVersion: 1,
      sourceDigest: amendedContract.sourceDigest,
      acceptance: amendedContract.source.acceptance.map((criterion) => ({
        id: criterion.id,
        evidence: criterion.evidence,
        planningRefs: [{ path: "tasks.md" }],
        taskGroups: ["1", "2"],
      })),
    });
    run.plan = lifecyclePlan(project.root, proposed.changeName, PLAN_2, [
      { id: "1", fingerprint: GROUP_1 },
      { id: "2", fingerprint: GROUP_2 },
    ]);
    run.setRunId("run-amendment");
    const adopted = await adoptAmendmentV3({
      projectRoot: project.root,
      changeName: proposed.changeName,
      token: predecessorToken,
      sessionId: "session-amendment",
      owner: { id: "agent", kind: "agent" },
      rfcId: amendment.metadata.id,
    }, run.dependencies);
    expect(adopted).toMatchObject({
      status: "successor_created",
      state: { phase: "planning_ready", supersedesRunId: predecessor.runId, contract: { rfcId: amendment.metadata.id } },
    });
    expect(run.store.inspect(proposed.changeName, predecessor.runId).state?.phase).toBe("invalidated");

    let successor = await startApplyV3({
      projectRoot: project.root,
      changeName: proposed.changeName,
      sessionId: "session-amendment",
      owner: { id: "agent", kind: "agent" },
    }, run.dependencies);
    successor = await completeImplementationGroup(run, successor, "2", "src/amendment-repair.txt");
    successor = await verify(run, successor);
    successor = await approveAndQa(run, successor);
    const archive = await archiveDelivery(run, successor);

    expect(archive.state.phase).toBe("archived");
    expect(loadRfcDelivery(project.root, amendment.metadata.id).slices["S-01-amendable"]?.status).toBe("archived");
    expect(loadRfcDelivery(project.root, original.metadata.id).slices["S-01-amendable"]).toMatchObject({
      status: "superseded",
      supersededBy: { rfcId: amendment.metadata.id, sliceId: "S-01-amendable" },
    });
    expect(archive.state.groups).toMatchObject({
      "1": { carriedFromRunId: predecessor.runId, status: "completed" },
      "2": { status: "completed" },
    });
  });

  it("GitHub: resumes a failed tracker closeout from the durable outbox without duplicating the Issue", async () => {
    const result = await executeFeature({ provider: "github", name: "github-feature", failFirstClose: true });

    expect(result.archive.closeRecovered).toBe(true);
    expect(result.project.tracker).toMatchObject({ createCount: 1, closeCount: 1, closeAttempts: 2 });
    expect(result.project.tracker?.states).toEqual(expect.arrayContaining(["todo", "in-progress", "review", "done"]));
    expect(result.archive.state.phase).toBe("archived");
  });

  it("GitLab: uses the provider-neutral single-Issue flow through done and close", async () => {
    const result = await executeFeature({ provider: "gitlab", name: "gitlab-feature" });

    expect(result.proposed.contract.source.tracker).toMatchObject({
      provider: "gitlab",
      issue: { id: "gitlab-1", url: "https://gitlab.example.test/issues/gitlab-1" },
    });
    expect(result.project.tracker).toMatchObject({ createCount: 1, closeCount: 1 });
    expect(result.project.tracker?.states.at(-1)).toBe("done");
    expect(result.archive.state.phase).toBe("archived");
  });

  it("provider none: completes locally without creating tracker clients or outbox mutations", async () => {
    const result = await executeFeature({ provider: "none", name: "local-feature" });

    expect(result.proposed.contract.source.tracker).toMatchObject({ provider: "none" });
    expect(result.project.tracker).toBeNull();
    expect(result.project.trackerFactoryCalls).toEqual([]);
    expect(existsSync(resolve(result.project.root, ".corgi/loop/local-feature/tracker-outbox"))).toBe(false);
    expect(result.archive.state).toMatchObject({ phase: "archived", archive: { trackerCompleted: true } });
  });
});

async function executeFeature(input: {
  provider: Provider;
  name: string;
  migrateV3?: boolean;
  failFirstClose?: boolean;
}) {
  const project = await createProject(input.provider, input.migrateV3 ?? false);
  if (project.tracker) project.tracker.failFirstClose = input.failFirstClose ?? false;
  acceptFoundation(project.root);
  const feature = acceptedFeature(project.root, input.name, `S-01-${input.name}`);
  commitAll(project.root, "accept RFCs");
  const proposed = await propose(project, {
    name: input.name,
    from: `${feature.metadata.id}/S-01-${input.name}`,
    feature,
  });
  const run = createDeliveryRun(proposed);
  let state = await applyAndVerify(run, `src/${input.name}.txt`);
  state = await approveAndQa(run, state);
  const archive = await archiveDelivery(run, state, input.failFirstClose ?? false);
  return { project, feature, proposed, run, archive };
}

async function createProject(provider: Provider, migrateV3 = false): Promise<ProjectHarness> {
  const sandbox = mkdtempSync(resolve(tmpdir(), "corgispec-rfc-v4-e2e-"));
  sandboxes.push(sandbox);
  const root = resolve(sandbox, "project");
  mkdirSync(root, { recursive: true });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "human@example.test"]);
  git(root, ["config", "user.name", "Human Reviewer"]);
  writeFileSync(resolve(root, ".gitignore"), ".corgi/loop/\n");
  let legacy: ProjectHarness["legacy"];
  if (migrateV3) {
    mkdirSync(resolve(root, "openspec"), { recursive: true });
    writeFileSync(resolve(root, "openspec/config.yaml"), "schema: custom\ncorgi:\n  tracking:\n    provider: none\n");
    mkdirSync(resolve(root, "wiki/sessions"), { recursive: true });
    writeFileSync(resolve(root, "wiki/sessions/legacy.md"), "# Exact legacy session\n\nDo not rewrite.\n");
    writeFileSync(resolve(root, "wiki/log.md"), "legacy log bytes\n");
    legacy = {
      session: readFileSync(resolve(root, "wiki/sessions/legacy.md")),
      log: readFileSync(resolve(root, "wiki/log.md")),
    };
  }
  const fakeOpenSpec = createFakeOpenSpec(sandbox);
  const previous = process.env["CORGISPEC_OPENSPEC_BIN"];
  process.env["CORGISPEC_OPENSPEC_BIN"] = fakeOpenSpec;
  let bootstrap: BootstrapResult;
  try {
    bootstrap = await runBootstrap({
      target: root,
      schema: "custom",
      trackingProvider: "none",
      mode: "auto",
      yes: true,
      json: true,
      migrateV4: migrateV3,
      integrationBranch: "main",
      assetsRoot: ASSETS_ROOT,
      userStateDir: resolve(sandbox, "state"),
      platforms: [],
      scope: "local",
    });
  } finally {
    if (previous === undefined) delete process.env["CORGISPEC_OPENSPEC_BIN"];
    else process.env["CORGISPEC_OPENSPEC_BIN"] = previous;
  }
  expect(bootstrap.status, bootstrap.message).toBe("success");
  if (provider !== "none") {
    const configPath = resolve(root, "openspec/config.yaml");
    writeFileSync(
      configPath,
      readFileSync(configPath, "utf8").replace("provider: none", `provider: ${provider}`),
    );
  }
  const tracker = provider === "none" ? null : new MemoryTracker(provider);
  return { sandbox, root, provider, bootstrap, tracker, trackerFactoryCalls: [], ...(legacy ? { legacy } : {}) };
}

function acceptFoundation(root: string): void {
  completeRfc(root, "RFC-0001-project-foundation", "S-01-project-foundation", "Establish the project RFC contract.");
  acceptRfc({
    projectDir: root,
    rfcId: "RFC-0001-project-foundation",
    approver: "human@example.test",
    humanConfirmed: true,
    now: new Date("2026-08-14T00:00:00.000Z"),
  });
}

function acceptedFeature(root: string, slug: string, sliceId: string): LoadedRfc {
  const draft = createRfcDraft({ projectDir: root, slug });
  completeRfc(root, draft.metadata.id, sliceId, `Deliver ${slug}.`);
  return acceptRfc({
    projectDir: root,
    rfcId: draft.metadata.id,
    approver: "human@example.test",
    humanConfirmed: true,
    now: new Date("2026-08-14T00:01:00.000Z"),
  });
}

function completeRfc(root: string, rfcId: string, sliceId: string, goal: string): void {
  writeFileSync(resolve(root, "rfcs", rfcId, "rfc.md"), [
    `# ${rfcId}`,
    "",
    "## Goal",
    goal,
    "",
    "## Non-goals",
    "No unrelated behavior or independent Slice.",
    "",
    "## Boundary",
    "Only the named Slice and its acceptance criterion.",
    "",
    "## Slices",
    `### ${sliceId}: Delivery`,
    "- AC-001 [evidence: both]: The delivered outcome is observable.",
    "",
    "## Risks",
    "Compatibility and regression risk.",
    "",
  ].join("\n"));
}

async function propose(
  project: ProjectHarness,
  input: { name: string; from?: string; maintenance?: string; feature?: LoadedRfc },
): Promise<ProposedChange> {
  const changeRoot = resolve(project.root, "openspec/changes", input.name);
  let created = false;
  let planningReady = false;
  const adapter = {
    async createChange() {
      mkdirSync(changeRoot, { recursive: true });
      created = true;
      return { change: { id: input.name, path: changeRoot, metadataPath: resolve(changeRoot, ".openspec.yaml"), schema: "custom" } };
    },
    async validateChange() {
      return { valid: true, issues: [] };
    },
  };
  const resolver = {
    async resolve(): Promise<ResolvedChangeArtifacts> {
      if (!created) throw new Error("change not found");
      const contract = loadChangeContract(changeRoot);
      const artifactPaths = planningReady ? {
        tasks: {
          outputPath: "tasks.md",
          resolvedOutputPath: resolve(changeRoot, "tasks.md"),
          existingOutputPaths: [resolve(changeRoot, "tasks.md")],
        },
      } : {};
      const planningHome = {
        kind: "repo" as const,
        root: resolve(project.root, "openspec"),
        changesDir: resolve(project.root, "openspec/changes"),
        defaultSchema: "custom",
      };
      const actionContext = {
        mode: "repo" as const,
        sourceOfTruth: "repo" as const,
        planningArtifacts: [],
        linkedContext: [],
        allowedEditRoots: [changeRoot],
        requiresAffectedAreaSelection: false,
        constraints: [],
      };
      return {
        changeName: input.name,
        schemaName: "custom",
        planningHome,
        changeRoot,
        artifactPaths,
        actionContext,
        planningRevision: PLAN_1,
        contract,
        planningComplete: planningReady,
        status: {
          changeName: input.name,
          schemaName: "custom",
          planningHome,
          changeRoot,
          artifactPaths,
          nextSteps: [],
          actionContext,
          isComplete: planningReady,
          applyRequires: [],
          artifacts: planningReady ? [{ id: "tasks", outputPath: "tasks.md", status: "done" }] : [],
        },
      };
    },
  };
  const trackerFactory = (provider: "github" | "gitlab" | "none") => {
    project.trackerFactoryCalls.push(provider);
    if (!project.tracker || provider === "none") throw new Error("Tracker client was requested for provider none");
    return project.tracker;
  };
  const args = input.from
    ? [input.name, "--from", input.from]
    : [input.name, "--maintenance", "--description", input.maintenance!];
  const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    process.exitCode = 0;
    await createProposeCommand({
      createAdapter: () => adapter as never,
      createResolver: () => resolver as never,
      createTracker: trackerFactory,
      now: () => new Date("2026-08-14T00:02:00.000Z"),
    }).parseAsync([...args, "--json", "--path", project.root], { from: "user" });
    expect(process.exitCode, JSON.stringify({ logs: logs.mock.calls, errors: errors.mock.calls })).toBe(0);
    const initial = loadChangeContract(changeRoot, { required: true })!;
    writeFileSync(resolve(changeRoot, "tasks.md"), "## 1. Delivery\n\n- [ ] 1.1 Implement and verify the delivery.\n");
    writeChangeTraceability(changeRoot, {
      schemaVersion: 1,
      sourceDigest: initial.sourceDigest,
      acceptance: initial.source.acceptance.map((criterion) => ({
        id: criterion.id,
        evidence: criterion.evidence,
        planningRefs: [{ path: "tasks.md" }],
        taskGroups: ["1"],
      })),
    });
    planningReady = true;
    process.exitCode = 0;
    await createProposeCommand({
      createAdapter: () => adapter as never,
      createResolver: () => resolver as never,
      createTracker: trackerFactory,
      now: () => new Date("2026-08-14T00:03:00.000Z"),
    }).parseAsync([...args, "--finalize", "--json", "--path", project.root], { from: "user" });
    expect(process.exitCode, JSON.stringify({ logs: logs.mock.calls, errors: errors.mock.calls })).toBe(0);
  } finally {
    logs.mockRestore();
    errors.mockRestore();
    process.exitCode = 0;
  }
  const contract = loadChangeContract(changeRoot, { required: true })!;
  return { project, changeName: input.name, changeRoot, contract, feature: input.feature ?? null };
}

function createDeliveryRun(proposed: ProposedChange): DeliveryRun {
  let plan = lifecyclePlan(proposed.project.root, proposed.changeName, PLAN_1, [{ id: "1", fingerprint: GROUP_1 }]);
  let runId = `run-${proposed.changeName}`;
  let sequence = 0;
  const store = new LoopStoreV3(proposed.project.root);
  const run: DeliveryRun = {
    proposed,
    get plan() { return plan; },
    set plan(value) { plan = value; },
    store,
    dependencies: {
      createStore: () => store,
      inspectPlan: async () => plan,
      resolveChangeContract: async () => ({
        changeRoot: proposed.changeRoot,
        contract: loadChangeContract(proposed.changeRoot, { required: true })!,
      }),
      runId: () => runId,
      nonce: () => `nonce-${++sequence}`,
      intentId: () => `archive-${proposed.changeName}`,
      now: () => `2026-08-14T00:00:${String(++sequence).padStart(2, "0")}.000Z`,
    },
    setRunId(value: string) { runId = value; },
  };
  return run;
}

function lifecyclePlan(
  root: string,
  changeName: string,
  planningRevision: ArtifactHashV3,
  groups: LifecyclePlanV3["groups"],
): LifecyclePlanV3 {
  const changeRoot = resolve(root, "openspec/changes", changeName);
  const contract = loadChangeContract(changeRoot, { required: true })!;
  const source = contract.source;
  return {
    projectRoot: root,
    changeName,
    changeRoot,
    planningArtifactPaths: [resolve(changeRoot, "tasks.md")],
    planningRevision,
    contract,
    binding: {
      kind: source.kind,
      deliveryRef: source.deliveryRef,
      rfcId: source.kind === "rfc-slice" ? source.rfc.id : null,
      rfcDigest: source.kind === "rfc-slice" ? source.rfc.digest as ArtifactHashV3 : null,
      acceptedCommit: source.kind === "rfc-slice" ? source.rfc.acceptedCommit : null,
      sliceId: source.kind === "rfc-slice" ? source.slice.id : null,
      sourcePath: relative(root, contract.sourcePath).replace(/\\/gu, "/"),
      sourceDigest: contract.sourceDigest as ArtifactHashV3,
      traceabilityPath: relative(root, contract.traceabilityPath).replace(/\\/gu, "/"),
      traceabilityDigest: contract.traceabilityDigest as ArtifactHashV3,
      acceptance: contract.traceability.acceptance.map((criterion) => ({
        id: criterion.id,
        evidence: criterion.evidence,
        taskGroups: [...criterion.taskGroups],
      })),
      tracker: structuredClone(source.tracker),
    },
    groups,
    blockers: [],
  };
}

async function applyAndVerify(run: DeliveryRun, implementationPath: string): Promise<RunStateV3> {
  let state = await startApplyV3({
    projectRoot: run.proposed.project.root,
    changeName: run.proposed.changeName,
    sessionId: `session-${run.proposed.changeName}`,
    owner: { id: "agent", kind: "agent" },
  }, run.dependencies);
  await mirrorTracker(run, state);
  state = await completeImplementationGroup(run, state, "1", implementationPath);
  return await verify(run, state);
}

async function completeImplementationGroup(
  run: DeliveryRun,
  state: RunStateV3,
  groupId: string,
  implementationPath: string,
): Promise<RunStateV3> {
  const priorHead = git(run.proposed.project.root, ["rev-parse", "HEAD"]);
  writeProjectFile(run.proposed.project.root, implementationPath, `delivery ${groupId}\n`);
  writeGroupBridgeCheckpoint(run.proposed.project.root, state, groupId, priorHead);
  git(run.proposed.project.root, ["add", "--", implementationPath]);
  git(run.proposed.project.root, ["add", "--", "memory/session-bridge.md"]);
  git(run.proposed.project.root, ["commit", "-m", `feat: complete ${run.proposed.changeName} group ${groupId}`]);
  const workspace = new GitWorkspaceV2(run.proposed.project.root);
  const fingerprint = await workspace.workspaceFingerprint() as ArtifactHashV3;
  return await completeTaskGroupV3({
    projectRoot: run.proposed.project.root,
    changeName: run.proposed.changeName,
    token: lifecycleTokenV3(state),
    groupId,
    workspaceFingerprint: fingerprint,
    evidence: {
      schemaVersion: 3,
      groupId,
      checks: [{ name: "focused-test", status: "pass", evidenceRefs: [implementationPath] }],
      automatedReview: { verdict: "pass", findings: [] },
      artifacts: [implementationPath],
      summary: `Task Group ${groupId} completed in a committed workspace`,
    },
  }, run.dependencies);
}

function writeGroupBridgeCheckpoint(
  root: string,
  state: RunStateV3,
  groupId: string,
  priorHead: string,
): void {
  const path = resolve(root, "memory/session-bridge.md");
  let bridge = readFileSync(path, "utf8");
  const hasRemaining = Object.values(state.groups).some((group) =>
    group.id !== groupId && group.status !== "completed"
  );
  const issue = state.contract.tracker.issue;
  const fields: Record<string, string> = {
    RFC: state.contract.rfcId ?? "maintenance",
    "RFC Revision": state.contract.acceptedCommit ?? "rfc-exempt",
    Slice: state.contract.sliceId ?? "maintenance",
    Issue: issue ? `${issue.id} ${issue.url}` : "none",
    Change: state.changeName,
    Worktree: root,
    "Phase at Checkpoint": hasRemaining ? "applying" : "awaiting_verify",
    "Task Group at Checkpoint": groupId,
    "Observed Run Revision": String(state.stateRevision + 1),
    "Last Verified HEAD": priorHead,
  };
  for (const [name, value] of Object.entries(fields)) {
    bridge = bridge.replace(
      new RegExp(`^- \\*\\*${escapeRegExp(name)}\\*\\*:.*$`, "mu"),
      `- **${name}**: ${value}`,
    );
  }
  writeFileSync(path, bridge);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function verify(run: DeliveryRun, state: RunStateV3): Promise<RunStateV3> {
  const verified = await submitVerifyV3({
    projectRoot: run.proposed.project.root,
    changeName: run.proposed.changeName,
    token: lifecycleTokenV3(state),
    report: {
      checks: [{ name: "test-build-lint", status: "pass", evidenceRefs: ["openspec/config.yaml"] }],
      acceptance: state.contract.acceptance.map((criterion) => ({
        id: criterion.id,
        automated: criterion.evidence === "human" ? "not_applicable" : "pass",
        human: "not_applicable",
        evidenceRefs: ["openspec/config.yaml"],
      })),
    },
  }, run.dependencies);
  await mirrorTracker(run, verified);
  return verified;
}

async function approveAndQa(run: DeliveryRun, state: RunStateV3): Promise<RunStateV3> {
  let next = await submitHumanReviewV3({
    projectRoot: run.proposed.project.root,
    changeName: run.proposed.changeName,
    token: lifecycleTokenV3(state),
    decision: "approve",
    reviewer: "human@example.test",
  }, run.dependencies);
  next = await submitHumanQaV3({
    projectRoot: run.proposed.project.root,
    changeName: run.proposed.changeName,
    token: lifecycleTokenV3(next),
    report: {
      verdict: "pass",
      reviewer: "qa@example.test",
      evidenceRefs: ["openspec/config.yaml"],
      acceptance: next.contract.acceptance.map((criterion) => ({
        id: criterion.id,
        automated: "not_applicable",
        human: "pass",
        evidenceRefs: ["openspec/config.yaml"],
      })),
    },
  }, run.dependencies);
  await mirrorTracker(run, next);
  return next;
}

async function archiveDelivery(run: DeliveryRun, ready: RunStateV3, expectCloseRecovery = false): Promise<ArchiveResult> {
  let state = await beginArchiveV3({
    projectRoot: run.proposed.project.root,
    changeName: run.proposed.changeName,
    token: lifecycleTokenV3(ready),
  }, run.dependencies);
  const evidence = await materializeArchiveEvidenceV3({
    projectRoot: run.proposed.project.root,
    changeName: run.proposed.changeName,
    token: lifecycleTokenV3(state),
  }, run.dependencies);
  const local = await performLocalArchiveCloseoutV3({
    projectRoot: run.proposed.project.root,
    changeName: run.proposed.changeName,
    state,
    evidenceManifestHash: evidence.evidenceManifestHash,
  }, {
    archiveChange: async () => {
      const archiveRoot = resolve(
        run.proposed.project.root,
        "openspec/changes/archive",
        `2026-08-14-${run.proposed.changeName}`,
      );
      mkdirSync(dirname(archiveRoot), { recursive: true });
      renameSync(run.proposed.changeRoot, archiveRoot);
      return { path: archiveRoot };
    },
  });
  state = await completeLocalArchiveV3({
    projectRoot: run.proposed.project.root,
    changeName: run.proposed.changeName,
    token: lifecycleTokenV3(state),
    evidenceManifestHash: evidence.evidenceManifestHash,
    archivedRoot: local.archivedRoot,
    deliveryPage: local.deliveryPage,
    deliveryRevision: local.deliveryRevision,
    closeoutCommit: local.closeoutCommit,
  }, run.dependencies);
  let closeRecovered = false;
  if (state.contract.tracker.provider !== "none") {
    try {
      await mirrorTracker(run, state, { close: true, workflowState: "done" });
    } catch (error) {
      if (!expectCloseRecovery) throw error;
      closeRecovered = true;
      expect(error).toBeInstanceOf(Error);
      await mirrorTracker(run, state, { close: true, workflowState: "done" });
    }
    state = await completeTrackerArchiveV3({
      projectRoot: run.proposed.project.root,
      changeName: run.proposed.changeName,
      token: lifecycleTokenV3(state),
    }, run.dependencies);
  }
  state = await finishArchiveV3({
    projectRoot: run.proposed.project.root,
    changeName: run.proposed.changeName,
    token: lifecycleTokenV3(state),
  }, run.dependencies);
  expect(git(run.proposed.project.root, ["status", "--porcelain"])).toBe("");
  return { state, deliveryPage: local.deliveryPage, archivedRoot: local.archivedRoot, closeRecovered };
}

async function mirrorTracker(
  run: DeliveryRun,
  state: RunStateV3,
  options: { close?: boolean; workflowState?: TrackerWorkflowState } = {},
) {
  return await syncTrackerStateV3(run.proposed.project.root, state, {
    createTracker: (provider) => {
      run.proposed.project.trackerFactoryCalls.push(provider);
      if (!run.proposed.project.tracker) throw new Error("provider-none lifecycle requested a tracker");
      return run.proposed.project.tracker;
    },
    trackerNow: () => "2026-08-14T00:20:00.000Z",
  }, options);
}

function commitAll(root: string, message: string): void {
  git(root, ["add", "-A", "--", "."]);
  git(root, ["commit", "-m", message]);
}

function writeProjectFile(root: string, path: string, content: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function git(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function createFakeOpenSpec(sandbox: string): string {
  const path = resolve(sandbox, "openspec-bin");
  writeFileSync(path, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then printf '1.6.0\\n'; exit 0; fi",
    "if [ \"$1\" = \"list\" ]; then printf '{\"changes\":[]}'; exit 0; fi",
    "if [ \"$1\" = \"schema\" ] && [ \"$2\" = \"validate\" ]; then printf '{\"valid\":true,\"issues\":[]}'; exit 0; fi",
    "printf '{\"error\":{\"message\":\"unsupported\"}}'; exit 1",
    "",
  ].join("\n"));
  chmodSync(path, 0o755);
  return path;
}

class MemoryTracker implements TrackerClient {
  readonly states: TrackerWorkflowState[] = [];
  issue: TrackerIssue | null = null;
  createCount = 0;
  closeCount = 0;
  closeAttempts = 0;
  failFirstClose = false;

  constructor(readonly provider: "github" | "gitlab") {}

  async findByMarker(marker: string): Promise<TrackerIssue[]> {
    return this.issue?.body.includes(marker) ? [{ ...this.issue }] : [];
  }

  async getIssue(issue: TrackerIssue): Promise<TrackerIssue> {
    if (!this.issue || this.issue.id !== issue.id) throw new Error(`Issue '${issue.id}' not found`);
    return { ...this.issue };
  }

  async createIssue(input: { title: string; body: string }): Promise<TrackerIssue> {
    this.createCount += 1;
    this.issue = {
      id: `${this.provider}-1`,
      url: `https://${this.provider}.example.test/issues/${this.provider}-1`,
      title: input.title,
      body: input.body,
    };
    return { ...this.issue };
  }

  async setState(_issue: TrackerIssue, state: TrackerWorkflowState): Promise<void> {
    this.states.push(state);
  }

  async updateBody(_issue: TrackerIssue, body: string): Promise<void> {
    if (!this.issue) throw new Error("Issue not found");
    this.issue = { ...this.issue, body };
  }

  async comment(): Promise<void> {}

  async close(): Promise<void> {
    this.closeAttempts += 1;
    if (this.failFirstClose && this.closeAttempts === 1) throw new Error("provider close unavailable");
    this.closeCount += 1;
  }
}
