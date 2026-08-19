import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  computeDeliveryBindingDigest,
  digestValue,
  createInitialTraceability,
  loadChangeContract,
  summarizeChangeContract,
  validateChangeTraceability,
  writeChangeSource,
  writeChangeTraceability,
  type ChangeSource,
  type LoadedChangeContract,
  type TrackerBinding,
} from "./change-contract.js";
import { verifySealedArchiveCheckpointV3 } from "./archive-closeout-v3.js";
import { loadConfigFromDir } from "./config.js";
import { validateMaintenanceDiffScope } from "./maintenance.js";
import {
  fingerprintTaskGroupV2,
} from "./converge-v2.js";
import { createGitWorkspaceV2, type GitWorkspaceV2 } from "./git-workspace-v2.js";
import { buildLifecycleReadyReport } from "./lifecycle.js";
import {
  LoopStoreV3,
  type EvidenceFileV3,
  type RunCasV3,
} from "./loop-store-v3.js";
import { createArtifactResolver } from "./artifact-resolver.js";
import { createOpenSpecAdapter } from "./openspec-adapter.js";
import { NodeCommandRunner, type CommandRunner } from "./openspec-runtime.js";
import {
  adoptRfcAmendmentSliceCas,
  bindRfcSliceCas,
  loadRfc,
  loadRfcDelivery,
  resolveAcceptedRfcSlice,
  resolveAcceptedRfcSliceForAmendmentAdoption,
  type RfcDeliveryBinding,
} from "./rfc.js";
import {
  featureIssueMarker,
  repositoryIdentity,
  taskGroupTrackerCheckpoint,
} from "./tracker.js";
import { loadProposeIntent } from "./workflow-intent.js";
import {
  createInitialRunStateV3,
  createRunInitializedEventV3,
  eventBaseV3,
  isArtifactHashV3,
  type ArtifactHashV3,
  type CriterionEvidenceV3,
  type HumanQaEvidenceV3,
  type HumanReviewDecisionV3,
  type HumanReviewEvidenceV3,
  type InitialRunGroupV3,
  type RunContractBindingV3,
  type RunEventV3,
  type RunOwnerV3,
  type RunStateV3,
  type VerifyEvidenceV3,
} from "./run-contract-v3.js";

export interface LifecyclePlanV3 {
  projectRoot: string;
  changeName: string;
  changeRoot: string;
  planningArtifactPaths: string[];
  planningRevision: ArtifactHashV3;
  contract: LoadedChangeContract;
  binding: RunContractBindingV3;
  groups: InitialRunGroupV3[];
  blockers: string[];
}

export interface LifecycleV3Dependencies {
  createStore?: (projectRoot: string) => LoopStoreV3;
  createGit?: (projectRoot: string) => GitWorkspaceV2;
  inspectPlan?: (projectRoot: string, changeName: string, store?: string) => Promise<LifecyclePlanV3>;
  now?: () => string;
  nonce?: () => string;
  runId?: () => string;
  intentId?: () => string;
  commitPlanningBaseline?: (
    plan: LifecyclePlanV3,
    git: GitWorkspaceV2,
  ) => Promise<{ headRevision: string; clean: boolean }>;
  resolveChangeContract?: (
    projectRoot: string,
    changeName: string,
    store?: string,
  ) => Promise<{ changeRoot: string; contract: LoadedChangeContract }>;
  resolveAmendment?: (
    projectRoot: string,
    rfcId: string,
    currentRfcId: string,
    currentSliceId: string | null,
  ) => EffectiveAmendmentV3;
  verifyArchiveCheckpoint?: (projectRoot: string, state: RunStateV3) => { archivedRoot: string };
  assertGroupBridgeCheckpoint?: (input: {
    projectRoot: string;
    state: RunStateV3;
    groupId: string;
    headRevision: string;
    nextPhase: "applying" | "awaiting_verify";
  }) => void;
  writePlanningBridgeCheckpoint?: (
    projectRoot: string,
    plan: LifecyclePlanV3,
    verifiedHead: string,
    nextGroupId?: string,
  ) => void;
}

export interface EffectiveAmendmentV3 {
  rfcId: string;
  amends: string;
  directory: string;
  acceptedCommit: string;
  digest: ArtifactHashV3;
  slice: {
    id: string;
    digest: ArtifactHashV3;
    acceptance: Array<{ id: string; evidence: "automated" | "human" | "both" }>;
  };
}

export interface LifecycleTokenV3 {
  runId: string;
  sessionId: string;
  stateRevision: number;
  nonce: string;
}

export interface VerifyInputV3 {
  checks: VerifyEvidenceV3["checks"];
  acceptance: CriterionEvidenceV3[];
}

export interface TaskGroupEvidenceV3 {
  schemaVersion: 3;
  groupId: string;
  checks: Array<{
    name: string;
    status: "pass" | "fail";
    evidenceRefs: string[];
  }>;
  automatedReview: {
    verdict: "pass" | "fail";
    findings: Array<{ severity: string; summary: string }>;
  };
  artifacts: string[];
  summary: string;
}

export interface QaInputV3 {
  verdict: "pass" | "fail" | "skipped";
  reviewer: string;
  reason?: string;
  noRuntimeImpact?: boolean;
  acceptance?: CriterionEvidenceV3[];
  evidenceRefs?: string[];
}

export class LifecycleV3Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LifecycleV3Error";
  }
}

function asHash(value: string, label: string): ArtifactHashV3 {
  if (!isArtifactHashV3(value)) throw new LifecycleV3Error("LIFECYCLE_HASH_INVALID", `${label} is not a sha256 digest`);
  return value;
}

function portable(root: string, path: string): string {
  return relative(root, path).replace(/\\/gu, "/");
}

function captureEvidenceRefsV3(
  projectRoot: string,
  state: RunStateV3,
  store: LoopStoreV3,
  scope: string,
  references: readonly string[],
): Map<string, string> {
  const root = resolve(projectRoot);
  const resolved = new Map<string, { sourcePath: string; content: Uint8Array }>();
  for (const rawReference of references) {
    const reference = rawReference.trim();
    if (!reference) {
      throw new LifecycleV3Error("EVIDENCE_REFERENCE_INVALID", `${scope} contains an empty evidence reference`);
    }
    if (isAbsolute(reference) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(reference)) {
      throw new LifecycleV3Error(
        "EVIDENCE_REFERENCE_INVALID",
        `${scope} evidence '${reference}' must be a repository-relative file path`,
      );
    }
    const sourcePath = reference.replace(/\\/gu, "/").replace(/^\.\//u, "");
    if (
      !sourcePath
      || sourcePath.split("/").some((part) => !part || part === "." || part === "..")
      || sourcePath === ".git"
      || sourcePath.startsWith(".git/")
      || sourcePath === ".corgi"
      || sourcePath.startsWith(".corgi/")
    ) {
      throw new LifecycleV3Error("EVIDENCE_REFERENCE_INVALID", `${scope} evidence path '${reference}' is unsafe`);
    }
    const absolute = resolve(root, sourcePath);
    const lexical = relative(root, absolute);
    if (lexical === ".." || lexical.startsWith("../") || isAbsolute(lexical) || !existsSync(absolute)) {
      throw new LifecycleV3Error("EVIDENCE_REFERENCE_MISSING", `${scope} evidence file '${sourcePath}' does not exist`);
    }
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new LifecycleV3Error("EVIDENCE_REFERENCE_INVALID", `${scope} evidence '${sourcePath}' is not a regular file`);
    }
    const real = realpathSync(absolute);
    const realRelative = relative(realpathSync(root), real);
    if (realRelative === ".." || realRelative.startsWith("../") || isAbsolute(realRelative)) {
      throw new LifecycleV3Error("EVIDENCE_REFERENCE_INVALID", `${scope} evidence '${sourcePath}' escapes the repository`);
    }
    if (!resolved.has(sourcePath)) {
      resolved.set(sourcePath, { sourcePath, content: readFileSync(absolute) });
    }
  }
  const captured = store.captureEvidenceReferences(cas(state), scope, [...resolved.values()]);
  return new Map(captured.map((entry) => [entry.sourcePath, entry.reference]));
}

function bindEvidenceRefsV3(references: readonly string[], captured: Map<string, string>): string[] {
  return references.map((reference) => {
    const sourcePath = reference.trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
    const bound = captured.get(sourcePath);
    if (!bound) {
      throw new LifecycleV3Error("EVIDENCE_REFERENCE_MISSING", `Evidence reference '${reference}' was not captured`);
    }
    return bound;
  });
}

async function gitOutput(
  runner: CommandRunner,
  root: string,
  args: string[],
): Promise<string> {
  const result = await runner.run({ command: "git", args, cwd: root });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new LifecycleV3Error(
      "PLANNING_BASELINE_GIT_FAILED",
      result.stderr.trim() || `git ${args[0] ?? "command"} failed`,
    );
  }
  return result.stdout;
}

function nulPaths(value: string): string[] {
  return value.split("\0").filter(Boolean).map((path) => path.replace(/\\/gu, "/"));
}

/** Commit only the planning handoff allowlist; any mixed implementation dirt fails closed. */
export async function commitPlanningBaselineV3(
  plan: LifecyclePlanV3,
  git: GitWorkspaceV2,
  runner: CommandRunner = new NodeCommandRunner(),
): Promise<{ headRevision: string; clean: boolean }> {
  const root = plan.projectRoot;
  const dirty = [...new Set((await Promise.all([
    gitOutput(runner, root, ["diff", "--name-only", "-z"]),
    gitOutput(runner, root, ["diff", "--cached", "--name-only", "-z"]),
    gitOutput(runner, root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ])).flatMap(nulPaths))].sort();
  if (dirty.length === 0) {
    const snapshot = await git.snapshot();
    return { headRevision: snapshot.headRevision, clean: snapshot.clean };
  }
  const exactAllowed = new Set<string>([
    "memory/session-bridge.md",
    portable(root, plan.contract.sourcePath),
    portable(root, plan.contract.traceabilityPath),
    ...plan.planningArtifactPaths.map((path) => portable(root, path)),
  ]);
  if (plan.contract.source.kind === "rfc-slice") {
    const configuredRfcPath = plan.contract.source.rfc.path;
    const absoluteRfcPath = isAbsolute(configuredRfcPath)
      ? resolve(configuredRfcPath)
      : resolve(root, configuredRfcPath);
    exactAllowed.add(portable(root, resolve(absoluteRfcPath, "delivery.yaml")));
    const currentRfc = loadRfc(root, plan.contract.source.rfc.id);
    if (currentRfc.metadata.type === "amendment" && currentRfc.metadata.amends) {
      exactAllowed.add(portable(root, loadRfc(root, currentRfc.metadata.amends).deliveryPath));
    }
  }
  const rejected = dirty.filter((path) => {
    return !exactAllowed.has(path);
  });
  if (rejected.length > 0) {
    throw new LifecycleV3Error(
      "PLANNING_BASELINE_MIXED_DIRTY",
      `Apply cannot commit mixed planning and implementation changes: ${rejected.join(", ")}`,
    );
  }
  await gitOutput(runner, root, ["add", "-A", "--", ...dirty]);
  await gitOutput(runner, root, [
    "commit",
    "--only",
    "-m",
    `chore(corgi): establish ${plan.changeName} planning baseline`,
    "--",
    ...dirty,
  ]);
  const snapshot = await git.snapshot();
  if (!snapshot.clean) {
    throw new LifecycleV3Error("PLANNING_BASELINE_COMMIT_INCOMPLETE", "planning baseline commit left the worktree dirty");
  }
  return { headRevision: snapshot.headRevision, clean: snapshot.clean };
}

export async function inspectLifecyclePlanV3(
  projectRoot: string,
  changeName: string,
  store?: string,
): Promise<LifecyclePlanV3> {
  const root = resolve(projectRoot);
  const config = loadConfigFromDir(root);
  const adapter = createOpenSpecAdapter(root);
  const resolved = await createArtifactResolver(adapter).resolve(changeName, { store });
  const { report } = await buildLifecycleReadyReport(adapter, resolved, config, true, { store }, root);
  const contract = resolved.contract;
  const blockers = report.checks
    .filter((check) => check.status !== "pass")
    .map((check) => `${check.code}: ${check.message}`);
  if (!contract) blockers.push("CHANGE_CONTRACT_REQUIRED: corgi/source.yaml and corgi/traceability.yaml are required");
  if (contract) {
    blockers.push(...validateChangeTraceability(
      contract,
      resolved.changeRoot,
      resolved.artifactPaths,
      report.taskGroups,
    ).map((error) => `${error.code}: ${error.message}`));
  }
  if (!contract) {
    throw new LifecycleV3Error("CHANGE_CONTRACT_REQUIRED", blockers.join("; "));
  }
  const planningRevision = asHash(resolved.planningRevision, "planningRevision");
  const binding: RunContractBindingV3 = {
    kind: contract.source.kind,
    deliveryRef: contract.source.deliveryRef,
    rfcId: contract.source.kind === "rfc-slice" ? contract.source.rfc.id : null,
    rfcDigest: contract.source.kind === "rfc-slice"
      ? asHash(contract.source.rfc.digest, "RFC digest")
      : null,
    acceptedCommit: contract.source.kind === "rfc-slice" ? contract.source.rfc.acceptedCommit : null,
    sliceId: contract.source.kind === "rfc-slice" ? contract.source.slice.id : null,
    sourcePath: portable(root, contract.sourcePath),
    sourceDigest: asHash(contract.sourceDigest, "sourceDigest"),
    traceabilityPath: portable(root, contract.traceabilityPath),
    traceabilityDigest: asHash(contract.traceabilityDigest, "traceabilityDigest"),
    acceptance: contract.traceability.acceptance.map((entry) => ({
      id: entry.id,
      evidence: entry.evidence,
      taskGroups: [...entry.taskGroups],
    })),
    tracker: structuredClone(contract.source.tracker),
  };
  return {
    projectRoot: root,
    changeName,
    changeRoot: resolved.changeRoot,
    planningArtifactPaths: [
      ...new Set([
        ...Object.values(resolved.artifactPaths).flatMap((artifact) => artifact.existingOutputPaths),
        ...[".openspec.yaml", ".openspec.json"]
          .map((name) => resolve(resolved.changeRoot, name))
          .filter((path) => existsSync(path)),
      ]),
    ].sort(),
    planningRevision,
    contract,
    binding,
    groups: report.taskGroups.map((group) => ({
      id: String(group.number),
      fingerprint: asHash(fingerprintTaskGroupV2(group), `Task Group ${group.number} fingerprint`),
    })),
    blockers: report.status === "ready" ? blockers : blockers.length > 0 ? blockers : ["Planning is not ready"],
  };
}

function services(projectRoot: string, dependencies: LifecycleV3Dependencies): {
  store: LoopStoreV3;
  git: GitWorkspaceV2;
  now: () => string;
  nonce: () => string;
} {
  return {
    store: (dependencies.createStore ?? ((root) => new LoopStoreV3(root)))(projectRoot),
    git: (dependencies.createGit ?? createGitWorkspaceV2)(projectRoot),
    now: dependencies.now ?? (() => new Date().toISOString()),
    nonce: dependencies.nonce ?? (() => randomUUID()),
  };
}

function nextNonce(current: string, generate: () => string): string {
  let candidate = generate();
  if (!candidate || candidate === current) candidate = randomUUID();
  return candidate;
}

function cas(state: RunStateV3): RunCasV3 {
  return {
    changeName: state.changeName,
    runId: state.runId,
    sessionId: state.sessionId,
    expectedStateRevision: state.stateRevision,
    expectedNonce: state.nonce,
  };
}

function tokenMatches(state: RunStateV3, token: LifecycleTokenV3): void {
  if (
    state.runId !== token.runId
    || state.sessionId !== token.sessionId
    || state.stateRevision !== token.stateRevision
    || state.nonce !== token.nonce
  ) {
    throw new LifecycleV3Error("RUN_CAS_CONFLICT", "Run Contract token is stale");
  }
}

function mutate(
  state: RunStateV3,
  store: LoopStoreV3,
  event: RunEventV3,
): RunStateV3 {
  return store.transition(cas(state), event);
}

async function requireState(
  projectRoot: string,
  changeName: string,
  token: LifecycleTokenV3,
  dependencies: LifecycleV3Dependencies,
): Promise<{ state: RunStateV3; plan: LifecyclePlanV3; store: LoopStoreV3; git: GitWorkspaceV2; now: () => string; nonce: () => string }> {
  const service = services(projectRoot, dependencies);
  const inspection = service.store.inspect(changeName, token.runId);
  if (!inspection.state) throw new LifecycleV3Error("RUN_NOT_FOUND", `Run '${token.runId}' was not found`);
  tokenMatches(inspection.state, token);
  const plan = await (dependencies.inspectPlan ?? inspectLifecyclePlanV3)(projectRoot, changeName);
  if (plan.blockers.length > 0) throw new LifecycleV3Error("PLANNING_NOT_READY", plan.blockers.join("; "));
  if (
    plan.planningRevision !== inspection.state.planningRevision
    || plan.binding.sourceDigest !== inspection.state.contract.sourceDigest
    || plan.binding.traceabilityDigest !== inspection.state.contract.traceabilityDigest
  ) {
    throw new LifecycleV3Error("RUN_PLANNING_CHANGED", "planning, source, or traceability changed after Run Contract initialization");
  }
  return { state: inspection.state, plan, ...service };
}

export async function startApplyV3(input: {
  projectRoot: string;
  changeName: string;
  sessionId: string;
  owner: RunOwnerV3;
  store?: string;
  runId?: string;
  supersedesRunId?: string;
}, dependencies: LifecycleV3Dependencies = {}): Promise<RunStateV3> {
  const root = resolve(input.projectRoot);
  const service = services(root, dependencies);
  const inspection = service.store.inspect(input.changeName);
  if (inspection.state && inspection.state.phase !== "planning_ready") return inspection.state;
  let state = inspection.state;
  if (state && (
    state.sessionId !== input.sessionId
    || state.owner.id !== input.owner.id
    || state.owner.kind !== input.owner.kind
  )) {
    throw new LifecycleV3Error(
      "RUN_OWNERSHIP_CONFLICT",
      "planning_ready Run Contract belongs to a different session or owner",
    );
  }
  if (!state) {
    const plan = await (dependencies.inspectPlan ?? inspectLifecyclePlanV3)(root, input.changeName, input.store);
    if (plan.blockers.length > 0) throw new LifecycleV3Error("PLANNING_NOT_READY", plan.blockers.join("; "));
    let snapshot = await service.git.snapshot();
    const handoff = loadProposeIntent(root, plan.contract.source.tracker.idempotencyKey);
    if (
      !handoff
      || handoff.stage !== "complete"
      || handoff.changeName !== input.changeName
      || handoff.deliveryRef !== plan.contract.source.deliveryRef
      || handoff.sourceDigest !== plan.contract.sourceDigest
    ) {
      throw new LifecycleV3Error(
        "PLANNING_HANDOFF_INCOMPLETE",
        "Apply requires a completed Propose intent bound to the current source contract",
      );
    }
    if (snapshot.headRevision !== handoff.headRevision) {
      throw new LifecycleV3Error(
        "PLANNING_HANDOFF_HEAD_CHANGED",
        `HEAD changed after Propose: expected '${handoff.headRevision}', found '${snapshot.headRevision}'`,
      );
    }
    (dependencies.writePlanningBridgeCheckpoint ?? writePlanningBridgeCheckpointV3)(
      root,
      plan,
      snapshot.headRevision,
    );
    snapshot = await service.git.snapshot();
    if (!snapshot.clean) {
      await (dependencies.commitPlanningBaseline ?? commitPlanningBaselineV3)(plan, service.git);
      snapshot = await service.git.snapshot();
    }
    if (!snapshot.clean) throw new LifecycleV3Error("PLANNING_BASELINE_REQUIRED", "planning baseline commit did not produce a clean worktree");
    state = createInitialRunStateV3({
      changeName: input.changeName,
      runId: input.runId ?? dependencies.runId?.() ?? `run-${randomUUID()}`,
      supersedesRunId: input.supersedesRunId,
      owner: input.owner,
      sessionId: input.sessionId,
      nonce: dependencies.nonce?.() ?? randomUUID(),
      planningRevision: plan.planningRevision,
      baselineRevision: snapshot.headRevision,
      contract: plan.binding,
      groups: plan.groups,
      startedAt: service.now(),
    });
    state = service.store.initialize(state, createRunInitializedEventV3(state));
  }
  const event: RunEventV3 = {
    ...eventBaseV3(state, "apply_started", {
      occurredAt: service.now(),
      nextNonce: nextNonce(state.nonce, service.nonce),
    }),
    type: "apply_started",
  };
  return mutate(state, service.store, event);
}

export async function completeTaskGroupV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
  groupId: string;
  workspaceFingerprint: ArtifactHashV3;
  evidence: TaskGroupEvidenceV3;
}, dependencies: LifecycleV3Dependencies = {}): Promise<RunStateV3> {
  const context = await requireState(input.projectRoot, input.changeName, input.token, dependencies);
  const current = context.state.groups[input.groupId];
  if (!current || context.state.currentGroupId !== input.groupId) {
    throw new LifecycleV3Error("RUN_GROUP_INVALID", `Task Group '${input.groupId}' is not current`);
  }
  if (
    input.evidence.schemaVersion !== 3
    || input.evidence.groupId !== input.groupId
    || !input.evidence.summary?.trim()
    || input.evidence.checks.length === 0
    || input.evidence.checks.some((check) =>
      check.status !== "pass" || check.evidenceRefs.length === 0 || !check.name?.trim()
    )
    || input.evidence.automatedReview.verdict !== "pass"
    || input.evidence.automatedReview.findings.length > 0
    || input.evidence.artifacts.length === 0
  ) {
    throw new LifecycleV3Error(
      "GROUP_EVIDENCE_FAILED",
      "Task Group completion requires passing checks, clean automated review, and artifact references",
    );
  }
  const carriedPrefix = context.state.supersedesRunId !== null
    && Object.values(context.state.groups).some((group) =>
      group.ordinal < current.ordinal && group.carriedFromRunId === context.state.supersedesRunId
    );
  const previous = carriedPrefix
    ? context.state.baselineRevision
    : Object.values(context.state.groups)
        .filter((group) => group.ordinal < current.ordinal && group.commitRevision)
        .sort((left, right) => right.ordinal - left.ordinal)[0]?.commitRevision
      ?? context.state.baselineRevision;
  const acknowledgement = await context.git.verifyCommittedWorkspace(input.workspaceFingerprint, {
    baselineRevision: previous,
  });
  const commitParents = await context.git.commitParents(acknowledgement.headRevision);
  if (commitParents.length !== 1 || commitParents[0] !== previous) {
    throw new LifecycleV3Error(
      "GROUP_COMMIT_NOT_ATOMIC",
      `Task Group '${input.groupId}' must be exactly one commit whose parent is '${previous}'`,
    );
  }
  enforceMaintenanceDiffScope(
    context.plan,
    await context.git.changedPaths(previous, acknowledgement.headRevision),
  );
  const remaining = Object.values(context.state.groups).some((group) =>
    group.id !== input.groupId && group.status !== "completed"
  );
  const nextPhase = remaining ? "applying" : "awaiting_verify";
  (dependencies.assertGroupBridgeCheckpoint ?? assertGroupBridgeCheckpointV3)({
    projectRoot: input.projectRoot,
    state: context.state,
    groupId: input.groupId,
    headRevision: previous,
    nextPhase,
  });
  const groupEvidence = structuredClone(input.evidence);
  const captured = captureEvidenceRefsV3(
    input.projectRoot,
    context.state,
    context.store,
    `group-${input.groupId}`,
    [
      ...groupEvidence.checks.flatMap((check) => check.evidenceRefs),
      ...groupEvidence.artifacts,
    ],
  );
  for (const check of groupEvidence.checks) {
    check.evidenceRefs = bindEvidenceRefsV3(check.evidenceRefs, captured);
  }
  groupEvidence.artifacts = bindEvidenceRefsV3(groupEvidence.artifacts, captured);
  const storedGroupEvidence = context.store.writeGroupEvidence(
    cas(context.state),
    input.groupId,
    groupEvidence,
  );
  const event: RunEventV3 = {
    ...eventBaseV3(context.state, "group_completed", {
      occurredAt: context.now(),
      nextNonce: nextNonce(context.state.nonce, context.nonce),
    }),
    type: "group_completed",
    groupId: input.groupId,
    commitRevision: acknowledgement.headRevision,
    commitTree: acknowledgement.treeRevision,
    workspaceFingerprint: input.workspaceFingerprint,
    evidenceHash: storedGroupEvidence.evidenceHash,
    trackerCheckpoint: context.state.contract.tracker.provider === "none"
      ? null
      : taskGroupTrackerCheckpoint({
          idempotencyKey: context.state.contract.tracker.idempotencyKey,
          runId: context.state.runId,
          groupId: input.groupId,
          commitRevision: acknowledgement.headRevision,
          evidenceHash: storedGroupEvidence.evidenceHash,
        }),
  };
  return mutate(context.state, context.store, event);
}

export function assertGroupBridgeCheckpointV3(input: {
  projectRoot: string;
  state: RunStateV3;
  groupId: string;
  headRevision: string;
  nextPhase: "applying" | "awaiting_verify";
}): void {
  const path = resolve(input.projectRoot, "memory", "session-bridge.md");
  if (!existsSync(path)) {
    throw new LifecycleV3Error("BRIDGE_CHECKPOINT_MISSING", "Task Group commit requires memory/session-bridge.md");
  }
  const content = readFileSync(path, "utf8");
  const field = (name: string): string | null => {
    const match = content.match(new RegExp(`^- \\*\\*${escapeRegExpV3(name)}\\*\\*:\\s*(.*)$`, "mu"));
    return match?.[1]?.trim() ?? null;
  };
  const issue = input.state.contract.tracker.issue;
  const expected: Record<string, string> = {
    RFC: input.state.contract.rfcId ?? "maintenance",
    "RFC Revision": input.state.contract.acceptedCommit ?? "rfc-exempt",
    Slice: input.state.contract.sliceId ?? "maintenance",
    Issue: issue ? `${issue.id} ${issue.url}` : "none",
    Change: input.state.changeName,
    Worktree: resolve(input.projectRoot),
    "Phase at Checkpoint": input.nextPhase,
    "Task Group at Checkpoint": input.groupId,
    "Observed Run Revision": String(input.state.stateRevision + 1),
    "Last Verified HEAD": input.headRevision,
  };
  const mismatches = Object.entries(expected).flatMap(([name, value]) => {
    const actual = field(name);
    return actual === value ? [] : [`${name}=${actual ?? "<missing>"} (expected ${value})`];
  });
  if (mismatches.length > 0) {
    throw new LifecycleV3Error(
      "BRIDGE_CHECKPOINT_STALE",
      `Task Group '${input.groupId}' commit must contain the next Session Bridge checkpoint: ${mismatches.join("; ")}`,
    );
  }
}

export function writePlanningBridgeCheckpointV3(
  projectRoot: string,
  plan: LifecyclePlanV3,
  verifiedHead: string,
  nextGroupId = plan.groups[0]?.id ?? "none",
): void {
  const root = resolve(projectRoot);
  const path = resolve(root, "memory", "session-bridge.md");
  if (!existsSync(path)) {
    throw new LifecycleV3Error("BRIDGE_CHECKPOINT_MISSING", "Planning baseline requires memory/session-bridge.md");
  }
  let content = readFileSync(path, "utf8");
  const issue = plan.binding.tracker.issue;
  const expected: Record<string, string> = {
    RFC: plan.binding.rfcId ?? "maintenance",
    "RFC Revision": plan.binding.acceptedCommit ?? "rfc-exempt",
    Slice: plan.binding.sliceId ?? "maintenance",
    Issue: issue ? `${issue.id} ${issue.url}` : "none",
    Change: plan.changeName,
    Worktree: root,
    "Phase at Checkpoint": "planning_ready",
    "Task Group at Checkpoint": nextGroupId,
    "Observed Run Revision": "none",
    "Last Verified HEAD": verifiedHead,
  };
  for (const [name, value] of Object.entries(expected)) {
    const pattern = new RegExp(`^- \\*\\*${escapeRegExpV3(name)}\\*\\*:.*$`, "mu");
    if (!pattern.test(content)) {
      throw new LifecycleV3Error("BRIDGE_CHECKPOINT_INVALID", `Session Bridge is missing '${name}'`);
    }
    content = content.replace(pattern, `- **${name}**: ${value}`);
  }
  content = content.replace(
    /^(## Next Action\s*\n)(?:- .*\n)?/mu,
    `$1- Start Apply for \`${plan.changeName}\` Task Group ${nextGroupId}.\n`,
  );
  writeFileSync(path, content);
}

function escapeRegExpV3(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export async function submitVerifyV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
  report: VerifyInputV3;
}, dependencies: LifecycleV3Dependencies = {}): Promise<RunStateV3> {
  const context = await requireState(input.projectRoot, input.changeName, input.token, dependencies);
  const snapshot = await context.git.snapshot();
  if (!snapshot.clean) throw new LifecycleV3Error("VERIFY_WORKTREE_DIRTY", "canonical Verify requires a clean worktree");
  const finalGroupRevision = Object.values(context.state.groups)
    .sort((left, right) => right.ordinal - left.ordinal)[0]?.commitRevision;
  if (!finalGroupRevision || snapshot.headRevision !== finalGroupRevision) {
    throw new LifecycleV3Error(
      "VERIFY_UNACKNOWLEDGED_COMMIT",
      "canonical Verify requires HEAD to equal the final acknowledged Task Group commit",
    );
  }
  enforceMaintenanceDiffScope(
    context.plan,
    await context.git.changedPaths(context.state.baselineRevision, snapshot.headRevision),
  );
  const acceptance = structuredClone(input.report.acceptance);
  const checks = structuredClone(input.report.checks);
  const captured = captureEvidenceRefsV3(
    input.projectRoot,
    context.state,
    context.store,
    "verify",
    [
      ...checks.flatMap((check) => check.evidenceRefs),
      ...acceptance.flatMap((criterion) => criterion.evidenceRefs),
    ],
  );
  for (const check of checks) check.evidenceRefs = bindEvidenceRefsV3(check.evidenceRefs, captured);
  for (const criterion of acceptance) {
    criterion.evidenceRefs = bindEvidenceRefsV3(criterion.evidenceRefs, captured);
  }
  const requirements = new Map(context.state.contract.acceptance.map((item) => [item.id, item.evidence]));
  const coverage = acceptance.length === requirements.size
    && new Set(acceptance.map((item) => item.id)).size === requirements.size
    && acceptance.every((item) => requirements.has(item.id));
  const automatedPass = coverage && acceptance.every((item) => {
    const requirement = requirements.get(item.id)!;
    return requirement === "human"
      ? item.automated === "not_applicable" || item.automated === "pass"
      : item.automated === "pass" && item.evidenceRefs.length > 0;
  });
  const checksPass = checks.length > 0
    && checks.every((check) => check.status === "pass" && check.evidenceRefs.length > 0);
  const evidence: VerifyEvidenceV3 = {
    verdict: coverage && automatedPass && checksPass ? "pass" : "fail",
    finalRevision: snapshot.headRevision,
    planningRevision: context.state.planningRevision,
    sourceDigest: context.state.contract.sourceDigest,
    traceabilityDigest: context.state.contract.traceabilityDigest,
    reportHash: asHash(digestValue({
      finalRevision: snapshot.headRevision,
      planningRevision: context.state.planningRevision,
      sourceDigest: context.state.contract.sourceDigest,
      traceabilityDigest: context.state.contract.traceabilityDigest,
      checks,
      acceptance,
    }), "verify report hash"),
    checks,
    acceptance,
    verifiedAt: context.now(),
  };
  const event: RunEventV3 = {
    ...eventBaseV3(context.state, "verify_submitted", {
      occurredAt: evidence.verifiedAt,
      nextNonce: nextNonce(context.state.nonce, context.nonce),
    }),
    type: "verify_submitted",
    evidence,
  };
  return mutate(context.state, context.store, event);
}

function enforceMaintenanceDiffScope(plan: LifecyclePlanV3, changedPaths: readonly string[]): void {
  if (plan.contract.source.kind !== "maintenance") return;
  const failures = validateMaintenanceDiffScope({
    category: plan.contract.source.maintenance.category,
    contractRefs: plan.contract.source.maintenance.contractRefs,
    changedPaths,
  });
  if (failures.length > 0) {
    throw new LifecycleV3Error(
      failures[0]!.code,
      failures.map((failure) => failure.message).join("; "),
    );
  }
}

export async function submitHumanReviewV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
  decision: HumanReviewDecisionV3;
  reviewer: string;
  reason?: string;
}, dependencies: LifecycleV3Dependencies = {}): Promise<RunStateV3> {
  const context = await requireState(input.projectRoot, input.changeName, input.token, dependencies);
  if (!context.state.verify || !context.state.finalRevision) throw new LifecycleV3Error("VERIFY_REQUIRED", "canonical Verify is missing");
  const snapshot = await context.git.snapshot();
  if (!snapshot.clean || snapshot.headRevision !== context.state.finalRevision) {
    throw new LifecycleV3Error("FINAL_REVISION_CHANGED", "Human Review must bind the verified clean HEAD");
  }
  const reviewedAt = context.now();
  const evidence: HumanReviewEvidenceV3 = {
    decision: input.decision,
    reviewer: input.reviewer.trim(),
    reason: input.reason?.trim() || null,
    finalRevision: context.state.finalRevision,
    planningRevision: context.state.planningRevision,
    verifyReportHash: context.state.verify.reportHash,
    reviewedAt,
  };
  const event: RunEventV3 = {
    ...eventBaseV3(context.state, "human_review_submitted", {
      occurredAt: reviewedAt,
      nextNonce: nextNonce(context.state.nonce, context.nonce),
      actor: { id: evidence.reviewer, kind: "human" },
    }),
    type: "human_review_submitted",
    evidence,
  };
  return mutate(context.state, context.store, event);
}

export async function submitHumanQaV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
  report: QaInputV3;
}, dependencies: LifecycleV3Dependencies = {}): Promise<RunStateV3> {
  const context = await requireState(input.projectRoot, input.changeName, input.token, dependencies);
  if (!context.state.finalRevision) throw new LifecycleV3Error("VERIFY_REQUIRED", "canonical Verify is missing");
  const snapshot = await context.git.snapshot();
  if (!snapshot.clean || snapshot.headRevision !== context.state.finalRevision) {
    throw new LifecycleV3Error("FINAL_REVISION_CHANGED", "Human QA must bind the verified clean HEAD");
  }
  const reviewedAt = context.now();
  const acceptance = structuredClone(input.report.acceptance ?? []);
  const qaReferences = [...(input.report.evidenceRefs ?? [])];
  const captured = captureEvidenceRefsV3(
    input.projectRoot,
    context.state,
    context.store,
    "human-qa",
    [
      ...qaReferences,
      ...acceptance.flatMap((criterion) => criterion.evidenceRefs),
    ],
  );
  const evidenceRefs = bindEvidenceRefsV3(qaReferences, captured);
  for (const criterion of acceptance) {
    criterion.evidenceRefs = bindEvidenceRefsV3(criterion.evidenceRefs, captured);
  }
  const evidence: HumanQaEvidenceV3 = {
    verdict: input.report.verdict,
    reviewer: input.report.reviewer.trim(),
    reason: input.report.reason?.trim() || null,
    noRuntimeImpact: input.report.noRuntimeImpact === true,
    finalRevision: context.state.finalRevision,
    planningRevision: context.state.planningRevision,
    reportHash: asHash(digestValue({
      verdict: input.report.verdict,
      reviewer: input.report.reviewer.trim(),
      reason: input.report.reason?.trim() || null,
      noRuntimeImpact: input.report.noRuntimeImpact === true,
      finalRevision: context.state.finalRevision,
      acceptance,
      evidenceRefs,
    }), "QA report hash"),
    acceptance,
    evidenceRefs,
    reviewedAt,
  };
  const event: RunEventV3 = {
    ...eventBaseV3(context.state, "human_qa_submitted", {
      occurredAt: reviewedAt,
      nextNonce: nextNonce(context.state.nonce, context.nonce),
      actor: { id: evidence.reviewer, kind: "human" },
    }),
    type: "human_qa_submitted",
    evidence,
  };
  return mutate(context.state, context.store, event);
}

export async function beginArchiveV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
}, dependencies: LifecycleV3Dependencies = {}): Promise<RunStateV3> {
  const context = await requireState(input.projectRoot, input.changeName, input.token, dependencies);
  const snapshot = await context.git.snapshot();
  if (!snapshot.clean || snapshot.headRevision !== context.state.finalRevision) {
    throw new LifecycleV3Error("FINAL_REVISION_CHANGED", "Archive requires the verified clean HEAD");
  }
  const event: RunEventV3 = {
    ...eventBaseV3(context.state, "archive_started", {
      occurredAt: context.now(),
      nextNonce: nextNonce(context.state.nonce, context.nonce),
    }),
    type: "archive_started",
    intentId: dependencies.intentId?.() ?? `archive-${randomUUID()}`,
  };
  return mutate(context.state, context.store, event);
}

export function canonicalEvidenceFilesV3(
  state: RunStateV3,
  groupEvidence: Record<string, Record<string, unknown>> = {},
): EvidenceFileV3[] {
  if (!state.verify || !state.review || !state.qa || !state.archive) {
    throw new LifecycleV3Error("ARCHIVE_GATE_INCOMPLETE", "Verify, Review, QA, and archive intent are required");
  }
  return [
    ...Object.values(state.groups)
      .sort((left, right) => left.ordinal - right.ordinal)
      .flatMap((group) => [
        { path: `groups/${group.id}/binding.json`, content: group },
        ...(groupEvidence[group.id]
          ? [{ path: `groups/${group.id}/evidence.json`, content: groupEvidence[group.id]! }]
          : []),
      ]),
    { path: "change-verify.json", content: state.verify },
    { path: "human-review.json", content: state.review },
    { path: "human-qa.json", content: state.qa },
    {
      path: "run-binding.json",
      content: {
        schemaVersion: 3,
        changeName: state.changeName,
        runId: state.runId,
        finalRevision: state.finalRevision,
        planningRevision: state.planningRevision,
        contract: state.contract,
        archiveIntentId: state.archive.intentId,
      },
    },
  ];
}

function canonicalEvidenceFromStoreV3(state: RunStateV3, store: LoopStoreV3): EvidenceFileV3[] {
  const referenceFiles: EvidenceFileV3[] = [];
  const evidence = Object.fromEntries(Object.values(state.groups).map((group) => {
    let stored: ReturnType<LoopStoreV3["readGroupEvidence"]>;
    let evidenceRunId = state.runId;
    try {
      stored = store.readGroupEvidence(state.changeName, state.runId, group.id);
    } catch (error) {
      if (
        !group.carriedFromRunId
        || !error
        || typeof error !== "object"
        || !("code" in error)
        || error.code !== "LOOP_GROUP_EVIDENCE_MISSING"
      ) {
        throw error;
      }
      evidenceRunId = group.carriedFromRunId;
      stored = store.readGroupEvidence(state.changeName, group.carriedFromRunId, group.id);
    }
    if (stored.evidenceHash !== group.evidenceHash) {
      throw new LifecycleV3Error(
        "GROUP_EVIDENCE_CHANGED",
        `Task Group '${group.id}' evidence no longer matches its acknowledged hash`,
      );
    }
    referenceFiles.push(...canonicalReferenceFilesV3(
      store,
      state.changeName,
      evidenceRunId,
      `group-${group.id}`,
      `groups/${group.id}`,
      groupEvidenceRefsV3(stored.evidence, group.id),
    ));
    return [group.id, stored.evidence];
  }));
  referenceFiles.push(...canonicalReferenceFilesV3(
    store,
    state.changeName,
    state.runId,
    "verify",
    "verify",
    [
      ...state.verify!.checks.flatMap((check) => check.evidenceRefs),
      ...state.verify!.acceptance.flatMap((criterion) => criterion.evidenceRefs),
    ],
  ));
  referenceFiles.push(...canonicalReferenceFilesV3(
    store,
    state.changeName,
    state.runId,
    "human-qa",
    "human-qa",
    [
      ...(state.qa!.evidenceRefs ?? []),
      ...state.qa!.acceptance.flatMap((criterion) => criterion.evidenceRefs),
    ],
  ));
  return mergeEvidenceFilesV3([
    ...canonicalEvidenceFilesV3(state, evidence),
    ...referenceFiles,
  ]);
}

function groupEvidenceRefsV3(evidence: Record<string, unknown>, groupId: string): string[] {
  const checks = evidence.checks;
  const artifacts = evidence.artifacts;
  if (!Array.isArray(checks) || !Array.isArray(artifacts) || !artifacts.every((entry) => typeof entry === "string")) {
    throw new LifecycleV3Error("GROUP_EVIDENCE_INVALID", `Task Group '${groupId}' evidence references are invalid`);
  }
  const refs = [...artifacts];
  for (const check of checks) {
    if (!check || typeof check !== "object" || Array.isArray(check)) {
      throw new LifecycleV3Error("GROUP_EVIDENCE_INVALID", `Task Group '${groupId}' evidence references are invalid`);
    }
    const evidenceRefs = (check as { evidenceRefs?: unknown }).evidenceRefs;
    if (!Array.isArray(evidenceRefs) || !evidenceRefs.every((entry) => typeof entry === "string")) {
      throw new LifecycleV3Error("GROUP_EVIDENCE_INVALID", `Task Group '${groupId}' evidence references are invalid`);
    }
    refs.push(...evidenceRefs);
  }
  return refs;
}

function canonicalReferenceFilesV3(
  store: LoopStoreV3,
  changeName: string,
  runId: string,
  scope: string,
  archiveScope: string,
  expectedRefs: readonly string[],
): EvidenceFileV3[] {
  const references = store.readEvidenceReferences(changeName, runId, scope);
  const expected = new Set(expectedRefs);
  const captured = new Set(references.map((entry) => entry.reference));
  if (
    expected.size !== captured.size
    || [...expected].some((reference) => !captured.has(reference))
    || [...captured].some((reference) => !expected.has(reference))
  ) {
    throw new LifecycleV3Error(
      "EVIDENCE_REFERENCE_CHANGED",
      `Captured evidence scope '${scope}' no longer matches canonical Run evidence`,
    );
  }
  return [
    {
      path: `references/scopes/${archiveScope}.json`,
      content: {
        schemaVersion: 3,
        scope,
        runId,
        references: references.map(({ content: _content, blobPath: _blobPath, ...entry }) => ({
          ...entry,
          archivePath: `references/blobs/${entry.digest.slice("sha256:".length)}`,
        })),
      },
    },
    ...references.map((entry) => ({
      path: `references/blobs/${entry.digest.slice("sha256:".length)}`,
      content: entry.content,
    })),
  ];
}

function mergeEvidenceFilesV3(files: EvidenceFileV3[]): EvidenceFileV3[] {
  const merged = new Map<string, EvidenceFileV3>();
  for (const file of files) {
    const existing = merged.get(file.path);
    if (!existing) {
      merged.set(file.path, file);
      continue;
    }
    const left = typeof existing.content === "string" || existing.content instanceof Uint8Array
      ? Buffer.from(existing.content)
      : Buffer.from(`${JSON.stringify(existing.content, null, 2)}\n`, "utf8");
    const right = typeof file.content === "string" || file.content instanceof Uint8Array
      ? Buffer.from(file.content)
      : Buffer.from(`${JSON.stringify(file.content, null, 2)}\n`, "utf8");
    if (!left.equals(right)) {
      throw new LifecycleV3Error("EVIDENCE_REFERENCE_CONFLICT", `Canonical evidence path '${file.path}' has conflicting bytes`);
    }
  }
  return [...merged.values()];
}

export async function materializeArchiveEvidenceV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
}, dependencies: LifecycleV3Dependencies = {}): Promise<{
  state: RunStateV3;
  evidenceManifestHash: ArtifactHashV3;
  changeEvidencePath: string;
  idempotent: boolean;
}> {
  const root = resolve(input.projectRoot);
  const service = services(root, dependencies);
  const inspection = service.store.inspect(input.changeName, input.token.runId);
  if (!inspection.state) throw new LifecycleV3Error("RUN_NOT_FOUND", `Run '${input.token.runId}' was not found`);
  tokenMatches(inspection.state, input.token);
  if (inspection.state.phase !== "archiving") throw new LifecycleV3Error("ARCHIVE_NOT_STARTED", "archive intent is not active");
  const changeRoot = await resolveArchiveEvidenceChangeRootV3(
    root,
    input.changeName,
    inspection.state,
    dependencies,
  );
  const activeChangeStillPresent = existsSync(resolve(root, inspection.state.contract.sourcePath));
  const archiveSnapshot = await service.git.snapshot();
  if (archiveSnapshot.headRevision !== inspection.state.finalRevision) {
    const parents = archiveSnapshot.clean
      ? await service.git.commitParents(archiveSnapshot.headRevision)
      : [];
    if (
      !archiveSnapshot.clean
      || parents.length !== 1
      || parents[0] !== inspection.state.finalRevision
    ) {
      throw new LifecycleV3Error(
        "ARCHIVE_FINAL_REVISION_CHANGED",
        "Archive evidence requires the verified final HEAD or its clean, direct archive closeout child",
      );
    }
    (dependencies.verifyArchiveCheckpoint ?? verifySealedArchiveCheckpointV3)(root, inspection.state);
  }
  const allowedEvidenceRoot = `${portable(root, resolve(changeRoot, "evidence"))}/`;
  const unexpectedDirty = porcelainPaths(archiveSnapshot.status).filter((path) =>
    path !== allowedEvidenceRoot.slice(0, -1)
    && !path.startsWith(allowedEvidenceRoot)
    && path !== ".corgi"
    && !path.startsWith(".corgi/")
  );
  if (activeChangeStillPresent && unexpectedDirty.length > 0) {
    throw new LifecycleV3Error(
      "ARCHIVE_WORKTREE_DIRTY",
      `Archive evidence found non-canonical dirty paths: ${unexpectedDirty.join(", ")}`,
    );
  }
  const files = canonicalEvidenceFromStoreV3(inspection.state, service.store);
  const result = service.store.materializeEvidence(cas(inspection.state), files);
  const changeEvidencePath = resolve(changeRoot, "evidence");
  const manifest = { ...result.manifest, manifestHash: result.manifestHash };
  let changeIdempotent = false;
  if (existsSync(resolve(changeEvidencePath, "manifest.json"))) {
    try {
      changeIdempotent = isDeepStrictEqual(
        JSON.parse(readFileSync(resolve(changeEvidencePath, "manifest.json"), "utf8")),
        manifest,
      );
    } catch {
      changeIdempotent = false;
    }
    if (!changeIdempotent) {
      throw new LifecycleV3Error("ARCHIVE_EVIDENCE_CONFLICT", "change evidence directory already contains different content");
    }
    for (const file of files) {
      const target = resolve(changeEvidencePath, file.path);
      const expected = typeof file.content === "string" || file.content instanceof Uint8Array
        ? Buffer.from(file.content)
        : Buffer.from(`${JSON.stringify(file.content, null, 2)}\n`, "utf8");
      if (!existsSync(target) || !readFileSync(target).equals(expected)) {
        throw new LifecycleV3Error(
          "ARCHIVE_EVIDENCE_CONFLICT",
          `change evidence file '${file.path}' no longer matches its manifest`,
        );
      }
    }
  } else {
    const staging = resolve(changeRoot, `.evidence-${randomUUID()}`);
    try {
      mkdirSync(staging, { recursive: false });
      for (const file of files) {
        const target = resolve(staging, file.path);
        mkdirSync(resolve(target, ".."), { recursive: true });
        const content = typeof file.content === "string" || file.content instanceof Uint8Array
          ? file.content
          : `${JSON.stringify(file.content, null, 2)}\n`;
        writeFileSync(target, content, { flag: "wx" });
      }
      writeFileSync(resolve(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
      renameSync(staging, changeEvidencePath);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  return {
    state: inspection.state,
    evidenceManifestHash: result.manifestHash,
    changeEvidencePath,
    idempotent: result.idempotent && changeIdempotent,
  };
}

async function resolveArchiveEvidenceChangeRootV3(
  projectRoot: string,
  changeName: string,
  state: RunStateV3,
  dependencies: LifecycleV3Dependencies,
): Promise<string> {
  const activeSource = resolve(projectRoot, state.contract.sourcePath);
  const activeChangeRoot = dirname(dirname(activeSource));
  if (existsSync(activeSource) || existsSync(activeChangeRoot)) {
    const plan = await (dependencies.inspectPlan ?? inspectLifecyclePlanV3)(projectRoot, changeName);
    if (plan.planningRevision !== state.planningRevision) {
      throw new LifecycleV3Error("RUN_PLANNING_CHANGED", "planning changed before archive evidence materialization");
    }
    return plan.changeRoot;
  }
  const archiveRoot = resolve(dirname(activeChangeRoot), "archive");
  if (!existsSync(archiveRoot)) {
    throw new LifecycleV3Error("ARCHIVE_CHANGE_CONTRACT_NOT_FOUND", "archived Change was not found during evidence recovery");
  }
  const matches = readdirSync(archiveRoot, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || (entry.name !== changeName && !entry.name.endsWith(`-${changeName}`))) return [];
    const candidate = resolve(archiveRoot, entry.name);
    try {
      const contract = loadChangeContract(candidate, { required: true })!;
      return contract.sourceDigest === state.contract.sourceDigest
        && contract.traceabilityDigest === state.contract.traceabilityDigest
        ? [candidate]
        : [];
    } catch {
      return [];
    }
  });
  if (matches.length !== 1) {
    throw new LifecycleV3Error(
      matches.length === 0 ? "ARCHIVE_CHANGE_CONTRACT_NOT_FOUND" : "ARCHIVE_CHANGE_CONTRACT_AMBIGUOUS",
      matches.length === 0
        ? "archived Change was not found during evidence recovery"
        : "multiple archived Changes match the Run Contract during evidence recovery",
    );
  }
  return matches[0]!;
}

export async function completeLocalArchiveV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
  evidenceManifestHash: ArtifactHashV3;
  archivedRoot: string;
  deliveryPage: string;
  deliveryRevision: number | null;
  closeoutCommit: string;
}, dependencies: LifecycleV3Dependencies = {}): Promise<RunStateV3> {
  const root = resolve(input.projectRoot);
  const service = services(root, dependencies);
  const inspection = service.store.inspect(input.changeName, input.token.runId);
  if (!inspection.state) throw new LifecycleV3Error("RUN_NOT_FOUND", `Run '${input.token.runId}' was not found`);
  tokenMatches(inspection.state, input.token);
  if (inspection.state.phase !== "archiving") throw new LifecycleV3Error("ARCHIVE_NOT_STARTED", "archive intent is not active");
  const result = service.store.materializeEvidence(
    cas(inspection.state),
    canonicalEvidenceFromStoreV3(inspection.state, service.store),
  );
  if (result.manifestHash !== input.evidenceManifestHash) {
    throw new LifecycleV3Error("ARCHIVE_EVIDENCE_CHANGED", "local archive confirmation does not bind canonical evidence");
  }
  const snapshot = await service.git.snapshot();
  if (!snapshot.clean || snapshot.headRevision !== input.closeoutCommit) {
    throw new LifecycleV3Error(
      "ARCHIVE_CLOSEOUT_COMMIT_CHANGED",
      "local archive completion requires the clean archive closeout commit at HEAD",
    );
  }
  const parents = await service.git.commitParents(input.closeoutCommit);
  if (parents.length !== 1 || parents[0] !== inspection.state.finalRevision) {
    throw new LifecycleV3Error(
      "ARCHIVE_CLOSEOUT_PARENT_CHANGED",
      "archive closeout commit must be a direct child of the verified final revision",
    );
  }
  const event: RunEventV3 = {
    ...eventBaseV3(inspection.state, "archive_local_completed", {
      occurredAt: service.now(),
      nextNonce: nextNonce(inspection.state.nonce, service.nonce),
    }),
    type: "archive_local_completed",
    evidenceManifestHash: input.evidenceManifestHash,
    archivedRoot: input.archivedRoot,
    deliveryPage: input.deliveryPage,
    deliveryRevision: input.deliveryRevision,
    closeoutCommit: input.closeoutCommit,
  };
  return mutate(inspection.state, service.store, event);
}

function porcelainPaths(status: string): string[] {
  return status.split(/\r?\n/u).filter(Boolean).map((line) => {
    const raw = line.length > 3 ? line.slice(3) : line;
    const renamed = raw.lastIndexOf(" -> ");
    return (renamed >= 0 ? raw.slice(renamed + 4) : raw).replace(/^"|"$/gu, "");
  });
}

export async function completeTrackerArchiveV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
}, dependencies: LifecycleV3Dependencies = {}): Promise<RunStateV3> {
  const root = resolve(input.projectRoot);
  const service = services(root, dependencies);
  const inspection = service.store.inspect(input.changeName, input.token.runId);
  if (!inspection.state) throw new LifecycleV3Error("RUN_NOT_FOUND", `Run '${input.token.runId}' was not found`);
  tokenMatches(inspection.state, input.token);
  await assertArchiveCloseoutIntegrityV3(
    root,
    inspection.state,
    service.git,
    dependencies.verifyArchiveCheckpoint,
  );
  const event: RunEventV3 = {
    ...eventBaseV3(inspection.state, "archive_tracker_completed", {
      occurredAt: service.now(),
      nextNonce: nextNonce(inspection.state.nonce, service.nonce),
    }),
    type: "archive_tracker_completed",
  };
  return mutate(inspection.state, service.store, event);
}

export async function finishArchiveV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
}, dependencies: LifecycleV3Dependencies = {}): Promise<RunStateV3> {
  const root = resolve(input.projectRoot);
  const service = services(root, dependencies);
  const inspection = service.store.inspect(input.changeName, input.token.runId);
  if (!inspection.state) throw new LifecycleV3Error("RUN_NOT_FOUND", `Run '${input.token.runId}' was not found`);
  tokenMatches(inspection.state, input.token);
  await assertArchiveCloseoutIntegrityV3(
    root,
    inspection.state,
    service.git,
    dependencies.verifyArchiveCheckpoint,
  );
  const event: RunEventV3 = {
    ...eventBaseV3(inspection.state, "run_archived", {
      occurredAt: service.now(),
      nextNonce: nextNonce(inspection.state.nonce, service.nonce),
    }),
    type: "run_archived",
  };
  return mutate(inspection.state, service.store, event);
}

export async function assertArchiveCloseoutIntegrityV3(
  projectRoot: string,
  state: RunStateV3,
  git: GitWorkspaceV2 = createGitWorkspaceV2(projectRoot),
  verifyCheckpoint: (projectRoot: string, state: RunStateV3) => { archivedRoot: string } = verifySealedArchiveCheckpointV3,
): Promise<void> {
  if (
    state.phase !== "archiving"
    || state.archive?.localCompleted !== true
    || !state.archive.closeoutCommit
    || !state.finalRevision
  ) {
    throw new LifecycleV3Error(
      "RUN_ARCHIVE_LOCAL_REQUIRED",
      "Archive closeout integrity requires a completed local transaction",
    );
  }
  const snapshot = await git.snapshot();
  if (!snapshot.clean || snapshot.headRevision !== state.archive.closeoutCommit) {
    throw new LifecycleV3Error(
      "ARCHIVE_CLOSEOUT_COMMIT_CHANGED",
      "Tracker closeout and finalization require the clean archive closeout commit at HEAD",
    );
  }
  const parents = await git.commitParents(state.archive.closeoutCommit);
  if (parents.length !== 1 || parents[0] !== state.finalRevision) {
    throw new LifecycleV3Error(
      "ARCHIVE_CLOSEOUT_PARENT_CHANGED",
      "Archive closeout commit must remain a direct child of the verified final revision",
    );
  }
  const checkpoint = verifyCheckpoint(projectRoot, state);
  if (!checkpoint?.archivedRoot) {
    throw new LifecycleV3Error(
      "ARCHIVE_CHECKPOINT_INVALID",
      "Archive checkpoint verifier did not return the archived root",
    );
  }
  if (resolve(checkpoint.archivedRoot) !== resolve(state.archive.archivedRoot ?? "")) {
    throw new LifecycleV3Error(
      "ARCHIVE_TARGET_CHANGED",
      "Run Contract archived root does not match the sealed Archive checkpoint",
    );
  }
}

export interface AdoptAmendmentResultV3 {
  status: "reconciliation_required" | "successor_created";
  rfcId: string;
  sliceId: string;
  sourcePath: string;
  traceabilityPath: string;
  blockers: string[];
  state?: RunStateV3;
}

function restoreContractBytes(path: string, content: Uint8Array): void {
  const temporary = resolve(`${path}.${process.pid}.${randomUUID()}.restore`);
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function resolveEffectiveAmendmentV3(
  projectRoot: string,
  rfcId: string,
  currentRfcId: string,
  currentSliceId: string | null,
): EffectiveAmendmentV3 {
  const amendment = loadRfc(projectRoot, rfcId);
  if (amendment.metadata.type !== "amendment" || amendment.metadata.amends !== currentRfcId) {
    throw new LifecycleV3Error(
      "RFC_AMENDMENT_TARGET_MISMATCH",
      `'${rfcId}' must be an Amendment RFC for '${currentRfcId}'`,
    );
  }
  const selectedSlice = currentSliceId
    ? amendment.slices.find((slice) => slice.id === currentSliceId)
    : undefined;
  if (!selectedSlice) {
    throw new LifecycleV3Error(
      "RFC_AMENDMENT_NEW_SLICE_REQUIRES_NEW_CHANGE",
      `Amendment '${rfcId}' must retain Slice '${currentSliceId ?? "<none>"}'; an independent Slice requires a new Issue and Change`,
    );
  }
  const effective = resolveAcceptedRfcSliceForAmendmentAdoption({
    projectDir: projectRoot,
    rfcId,
    sliceId: selectedSlice.id,
  });
  return {
    rfcId: effective.rfc.metadata.id,
    amends: currentRfcId,
    directory: effective.rfc.directory,
    acceptedCommit: effective.acceptedCommit,
    digest: asHash(`sha256:${effective.rfc.digest}`, "Amendment RFC digest"),
    slice: {
      id: effective.slice.id,
      digest: asHash(digestValue(effective.slice), "Amendment Slice digest"),
      acceptance: effective.slice.acceptanceCriteria.map((criterion) => ({
        id: criterion.id,
        evidence: criterion.evidence,
      })),
    },
  };
}

async function resolveCurrentChangeContractV3(
  projectRoot: string,
  changeName: string,
  store?: string,
): Promise<{ changeRoot: string; contract: LoadedChangeContract }> {
  const adapter = createOpenSpecAdapter(projectRoot);
  const resolved = await createArtifactResolver(adapter).resolve(changeName, { store });
  const contract = loadChangeContract(resolved.changeRoot, { required: true })!;
  return { changeRoot: resolved.changeRoot, contract };
}

function trackerDeliveryIssueV3(
  tracker: TrackerBinding,
): NonNullable<RfcDeliveryBinding["issue"]> {
  return {
    provider: tracker.provider,
    ...(tracker.issue ? { id: tracker.issue.id, url: tracker.issue.url } : {}),
  };
}

function ensureAmendmentDeliveryBindingV3(
  projectRoot: string,
  changeName: string,
  contract: LoadedChangeContract,
  plannedAt: string,
  amendedRfcId: string,
): void {
  if (contract.source.kind !== "rfc-slice") {
    throw new LifecycleV3Error("RFC_SOURCE_REQUIRED", "maintenance changes cannot adopt an RFC Amendment");
  }
  const rfcId = contract.source.rfc.id;
  const sliceId = contract.source.slice.id;
  const expectedDeliveryRef = `${rfcId}/${sliceId}`;
  const issue = trackerDeliveryIssueV3(contract.source.tracker);
  const expectedDigest = computeDeliveryBindingDigest({
    rfcId,
    sliceId,
    change: changeName,
    issue,
  });
  if (
    contract.source.deliveryRef !== expectedDeliveryRef
    || contract.source.deliveryBindingDigest !== expectedDigest
  ) {
    throw new LifecycleV3Error(
      "RFC_AMENDMENT_SOURCE_CONFLICT",
      "Amendment source does not contain the canonical delivery reference and binding digest",
    );
  }
  const delivery = loadRfcDelivery(projectRoot, rfcId);
  const amendedDelivery = loadRfcDelivery(projectRoot, amendedRfcId);
  const selected = delivery.slices[sliceId] ?? { status: "unbound" as const };
  const expectedBinding: RfcDeliveryBinding = {
    change: changeName,
    issue,
    sourceDigest: contract.sourceDigest,
    plannedAt,
  };
  const amended = amendedDelivery.slices[sliceId];
  if (selected.status === "unbound" && amended?.status === "planned") {
    adoptRfcAmendmentSliceCas({
      projectDir: projectRoot,
      fromRfcId: amendedRfcId,
      toRfcId: rfcId,
      sliceId,
      expectedFromRevision: amendedDelivery.revision,
      expectedToRevision: delivery.revision,
      binding: expectedBinding,
    });
    return;
  }
  if (
    selected.status !== "planned"
    || !selected.binding
    || selected.binding.change !== expectedBinding.change
    || selected.binding.sourceDigest !== expectedBinding.sourceDigest
    || !isDeepStrictEqual(selected.binding.issue, expectedBinding.issue)
    || amended?.status !== "superseded"
    || amended.supersededBy?.rfcId !== rfcId
    || amended.supersededBy.sliceId !== sliceId
  ) {
    throw new LifecycleV3Error(
      "RFC_AMENDMENT_SLICE_BOUND",
      `Amendment Slice '${sliceId}' is already ${selected.status} with a different binding`,
    );
  }
}

/**
 * Two-stage Amendment adoption. The first call is the sole writer for source.yaml,
 * resets traceability to an intentionally not-ready mapping, and stops. A later
 * call may create the successor only after planning and traceability reconcile.
 */
export async function adoptAmendmentV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
  sessionId: string;
  owner: RunOwnerV3;
  rfcId: string;
  store?: string;
}, dependencies: LifecycleV3Dependencies = {}): Promise<AdoptAmendmentResultV3> {
  const root = resolve(input.projectRoot);
  const service = services(root, dependencies);
  const priorInspection = service.store.inspect(input.changeName, input.token.runId);
  const prior = priorInspection.state;
  if (!prior) throw new LifecycleV3Error("RUN_NOT_FOUND", `Run '${input.token.runId}' was not found`);
  const recoveredSuccessor = service.store.inspect(input.changeName).state;
  if (
    recoveredSuccessor?.supersedesRunId === prior.runId
    && recoveredSuccessor.contract.rfcId === input.rfcId
    && priorInspection.events.some((record) =>
      record.event.type === "run_invalidated"
      && record.event.expectedStateRevision === input.token.stateRevision
      && record.event.expectedNonce === input.token.nonce
    )
  ) {
    return {
      status: "successor_created",
      rfcId: input.rfcId,
      sliceId: recoveredSuccessor.contract.sliceId ?? "",
      sourcePath: recoveredSuccessor.contract.sourcePath,
      traceabilityPath: recoveredSuccessor.contract.traceabilityPath,
      blockers: [],
      state: recoveredSuccessor,
    };
  }
  tokenMatches(prior, input.token);
  if (prior.phase !== "repair_required" || prior.repair?.kind !== "rfc_amendment") {
    throw new LifecycleV3Error("RFC_AMENDMENT_NOT_REQUIRED", "the current run is not waiting for an RFC Amendment");
  }
  if (!prior.contract.rfcId) throw new LifecycleV3Error("RFC_SOURCE_REQUIRED", "maintenance changes cannot adopt an RFC Amendment");
  const effective = (dependencies.resolveAmendment ?? resolveEffectiveAmendmentV3)(
    root,
    input.rfcId,
    prior.contract.rfcId,
    prior.contract.sliceId,
  );
  if (effective.amends !== prior.contract.rfcId || effective.rfcId !== input.rfcId) {
    throw new LifecycleV3Error("RFC_AMENDMENT_TARGET_MISMATCH", "resolved Amendment provenance does not match the requested RFC");
  }
  if (!prior.contract.sliceId || effective.slice.id !== prior.contract.sliceId) {
    throw new LifecycleV3Error(
      "RFC_AMENDMENT_NEW_SLICE_REQUIRES_NEW_CHANGE",
      "An Amendment may only revise the current Slice; an independent Slice requires a new Issue and Change",
    );
  }
  const resolved = await (dependencies.resolveChangeContract ?? resolveCurrentChangeContractV3)(
    root,
    input.changeName,
    input.store,
  );
  const current = resolved.contract;
  if (current.source.kind !== "rfc-slice") {
    throw new LifecycleV3Error("RFC_SOURCE_REQUIRED", "maintenance changes cannot adopt an RFC Amendment");
  }

  if (current.source.rfc.id !== input.rfcId) {
    if (
      current.source.rfc.id !== prior.contract.rfcId
      || current.sourceDigest !== prior.contract.sourceDigest
    ) {
      throw new LifecycleV3Error("RFC_AMENDMENT_SOURCE_CONFLICT", "source.yaml changed outside the audited Amendment adoption");
    }
    const delivery = loadRfcDelivery(root, effective.rfcId);
    const selectedDelivery = delivery.slices[effective.slice.id] ?? { status: "unbound" as const };
    if (selectedDelivery.status !== "unbound") {
      throw new LifecycleV3Error(
        "RFC_AMENDMENT_SLICE_BOUND",
        `Amendment Slice '${effective.slice.id}' is already ${selectedDelivery.status}`,
      );
    }
    const issue = trackerDeliveryIssueV3(current.source.tracker);
    const amendmentMarker = featureIssueMarker({
      repository: repositoryIdentity(root),
      deliveryRef: `${effective.rfcId}/${effective.slice.id}`,
      rfcDigest: effective.digest.replace(/^sha256:/u, ""),
    });
    const source: ChangeSource = {
      schemaVersion: 1,
      kind: "rfc-slice",
      deliveryRef: `${effective.rfcId}/${effective.slice.id}`,
      rfc: {
        id: effective.rfcId,
        path: portable(root, effective.directory),
        acceptedCommit: effective.acceptedCommit,
        digest: effective.digest,
      },
      slice: {
        id: effective.slice.id,
        digest: effective.slice.digest,
      },
      acceptance: effective.slice.acceptance.map((criterion) => ({
        id: criterion.id,
        evidence: criterion.evidence,
      })),
      deliveryBindingDigest: asHash(computeDeliveryBindingDigest({
        rfcId: effective.rfcId,
        sliceId: effective.slice.id,
        change: input.changeName,
        issue,
      }), "Amendment delivery binding digest"),
      tracker: {
        ...structuredClone(current.source.tracker),
        idempotencyKey: amendmentMarker.key,
      },
    };
    const oldSource = readFileSync(current.sourcePath);
    const oldTraceability = readFileSync(current.traceabilityPath);
    try {
      const sourceDigest = writeChangeSource(resolved.changeRoot, source);
      writeChangeTraceability(
        resolved.changeRoot,
        createInitialTraceability(source, sourceDigest),
      );
      const prepared = loadChangeContract(resolved.changeRoot, { required: true })!;
      const amendedDelivery = loadRfcDelivery(root, effective.amends);
      adoptRfcAmendmentSliceCas({
        projectDir: root,
        fromRfcId: effective.amends,
        toRfcId: effective.rfcId,
        sliceId: effective.slice.id,
        expectedFromRevision: amendedDelivery.revision,
        expectedToRevision: delivery.revision,
        binding: {
          change: input.changeName,
          issue,
          sourceDigest: prepared.sourceDigest,
          plannedAt: service.now(),
        },
      });
      return {
        status: "reconciliation_required",
        rfcId: effective.rfcId,
        sliceId: effective.slice.id,
        sourcePath: prepared.sourcePath,
        traceabilityPath: prepared.traceabilityPath,
        blockers: prepared.traceability.acceptance.flatMap((criterion) => [
          `TRACEABILITY_MISSING_PLANNING_REF: ${criterion.id}`,
          `TRACEABILITY_MISSING_TASK_GROUP: ${criterion.id}`,
        ]),
      };
    } catch (error) {
      restoreContractBytes(current.sourcePath, oldSource);
      restoreContractBytes(current.traceabilityPath, oldTraceability);
      throw error;
    }
  }

  ensureAmendmentDeliveryBindingV3(root, input.changeName, current, service.now(), effective.amends);

  const plan = await (dependencies.inspectPlan ?? inspectLifecyclePlanV3)(root, input.changeName, input.store);
  if (plan.blockers.length > 0) {
    return {
      status: "reconciliation_required",
      rfcId: input.rfcId,
      sliceId: effective.slice.id,
      sourcePath: current.sourcePath,
      traceabilityPath: current.traceabilityPath,
      blockers: plan.blockers,
    };
  }
  const state = await createRepairSuccessorV3({
    projectRoot: root,
    changeName: input.changeName,
    token: input.token,
    sessionId: input.sessionId,
    owner: input.owner,
    amendmentRequired: true,
    expectedRfcId: input.rfcId,
    store: input.store,
  }, dependencies);
  return {
    status: "successor_created",
    rfcId: input.rfcId,
    sliceId: effective.slice.id,
    sourcePath: current.sourcePath,
    traceabilityPath: current.traceabilityPath,
    blockers: [],
    state,
  };
}

export async function createRepairSuccessorV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
  sessionId: string;
  owner: RunOwnerV3;
  amendmentRequired?: boolean;
  expectedRfcId?: string;
  store?: string;
}, dependencies: LifecycleV3Dependencies = {}): Promise<RunStateV3> {
  const root = resolve(input.projectRoot);
  const service = services(root, dependencies);
  const priorInspection = service.store.inspect(input.changeName, input.token.runId);
  const prior = priorInspection.state;
  if (!prior) throw new LifecycleV3Error("RUN_NOT_FOUND", `Run '${input.token.runId}' was not found`);
  const existingSuccessor = service.store.inspect(input.changeName).state;
  if (
    existingSuccessor?.supersedesRunId === prior.runId
    && priorInspection.events.some((record) =>
      record.event.type === "run_invalidated"
      && record.event.expectedStateRevision === input.token.stateRevision
      && record.event.expectedNonce === input.token.nonce
    )
  ) {
    return existingSuccessor;
  }
  if (existingSuccessor?.supersedesRunId === prior.runId) {
    tokenMatches(prior, input.token);
    if (prior.phase !== "repair_required") {
      throw new LifecycleV3Error("REPAIR_SUCCESSOR_CONFLICT", "an unrecognized successor already exists for this run");
    }
    const invalidated: RunEventV3 = {
      ...eventBaseV3(prior, "run_invalidated", {
        occurredAt: service.now(),
        nextNonce: nextNonce(prior.nonce, service.nonce),
      }),
      type: "run_invalidated",
      reason: `superseded by ${existingSuccessor.runId}`,
    };
    mutate(prior, service.store, invalidated);
    service.store.inspect(input.changeName);
    return existingSuccessor;
  }
  tokenMatches(prior, input.token);
  if (prior.phase !== "repair_required" || !prior.repair) {
    throw new LifecycleV3Error("REPAIR_NOT_REQUIRED", "the current run does not require repair");
  }
  const needsAmendment = prior.repair.kind === "rfc_amendment";
  if (needsAmendment !== (input.amendmentRequired === true)) {
    throw new LifecycleV3Error(
      needsAmendment ? "RFC_AMENDMENT_REQUIRED" : "IMPLEMENTATION_REPAIR_REQUIRED",
      needsAmendment ? "adopt an accepted Amendment RFC" : "create an implementation repair successor",
    );
  }
  const plan = await (dependencies.inspectPlan ?? inspectLifecyclePlanV3)(root, input.changeName, input.store);
  if (plan.blockers.length > 0) throw new LifecycleV3Error("PLANNING_NOT_READY", plan.blockers.join("; "));
  if (needsAmendment) {
    if (plan.binding.kind !== "rfc-slice" || plan.binding.sourceDigest === prior.contract.sourceDigest) {
      throw new LifecycleV3Error("RFC_AMENDMENT_NOT_ADOPTED", "source.yaml must bind a newly accepted Amendment RFC");
    }
    if (input.expectedRfcId && plan.binding.rfcId !== input.expectedRfcId) {
      throw new LifecycleV3Error(
        "RFC_AMENDMENT_MISMATCH",
        `source.yaml binds '${plan.binding.rfcId ?? "none"}', expected '${input.expectedRfcId}'`,
      );
    }
  } else if (plan.binding.sourceDigest !== prior.contract.sourceDigest) {
    throw new LifecycleV3Error("REPAIR_SOURCE_CHANGED", "implementation repair cannot change the accepted source contract");
  }
  const previousGroups = Object.values(prior.groups).sort((left, right) => left.ordinal - right.ordinal);
  if (previousGroups.some((group) => group.status !== "completed")) {
    throw new LifecycleV3Error("REPAIR_PREDECESSOR_INCOMPLETE", "repair predecessor has incomplete Task Groups");
  }
  if (plan.groups.length !== previousGroups.length + 1) {
    throw new LifecycleV3Error(
      "REPAIR_TASK_GROUP_REQUIRED",
      "repair planning must preserve every prior Task Group and append exactly one new Repair Task Group",
    );
  }
  for (const [index, previous] of previousGroups.entries()) {
    const planned = plan.groups[index];
    if (!planned || planned.id !== previous.id || planned.fingerprint !== previous.fingerprint) {
      throw new LifecycleV3Error(
        "REPAIR_TASK_GROUP_CHANGED",
        `prior Task Group '${previous.id}' changed instead of remaining an immutable prefix`,
      );
    }
  }
  const repairGroup = plan.groups.at(-1)!;
  if (previousGroups.some((group) => group.id === repairGroup.id)) {
    throw new LifecycleV3Error("REPAIR_TASK_GROUP_DUPLICATE", "Repair Task Group id must be new");
  }
  let snapshot = await service.git.snapshot();
  (dependencies.writePlanningBridgeCheckpoint ?? writePlanningBridgeCheckpointV3)(
    root,
    plan,
    snapshot.headRevision,
    repairGroup.id,
  );
  snapshot = await service.git.snapshot();
  if (!snapshot.clean) {
    await (dependencies.commitPlanningBaseline ?? commitPlanningBaselineV3)(plan, service.git);
    snapshot = await service.git.snapshot();
  }
  if (!snapshot.clean) throw new LifecycleV3Error("REPAIR_BASELINE_DIRTY", "repair successor requires a clean baseline commit");
  const successor = createInitialRunStateV3({
    changeName: input.changeName,
    runId: dependencies.runId?.() ?? `run-${randomUUID()}`,
    supersedesRunId: prior.runId,
    owner: input.owner,
    sessionId: input.sessionId,
    nonce: dependencies.nonce?.() ?? randomUUID(),
    planningRevision: plan.planningRevision,
    baselineRevision: snapshot.headRevision,
    contract: plan.binding,
    groups: plan.groups,
    startedAt: service.now(),
  });
  for (const previous of previousGroups) {
    successor.groups[previous.id] = {
      ...structuredClone(previous),
      carriedFromRunId: previous.carriedFromRunId ?? prior.runId,
    };
  }
  successor.currentGroupId = repairGroup.id;
  const persisted = service.store.initialize(successor, createRunInitializedEventV3(successor));
  if (prior.phase === "repair_required") {
    const invalidated: RunEventV3 = {
      ...eventBaseV3(prior, "run_invalidated", {
        occurredAt: service.now(),
        nextNonce: nextNonce(prior.nonce, service.nonce),
      }),
      type: "run_invalidated",
      reason: `superseded by ${persisted.runId}`,
    };
    mutate(prior, service.store, invalidated);
    service.store.inspect(input.changeName);
  }
  return persisted;
}

export function lifecycleTokenV3(state: RunStateV3): LifecycleTokenV3 {
  return {
    runId: state.runId,
    sessionId: state.sessionId,
    stateRevision: state.stateRevision,
    nonce: state.nonce,
  };
}
