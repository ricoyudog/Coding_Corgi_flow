import type { ArtifactResolver, ResolvedChangeArtifacts } from "./artifact-resolver.js";
import {
  assertArtifactOutputPath,
  createArtifactResolver,
} from "./artifact-resolver.js";
import { loadConfigFromDir } from "./config.js";
import {
  compatibilityState,
  flattenArtifactFiles,
  resolveTaskArtifactId,
  summarizeTaskGroups,
  type TaskGroupSummary,
} from "./lifecycle.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
  type OpenSpecCommandOptions,
} from "./openspec-adapter.js";
import type { ParsedTaskGroup } from "./task-groups.js";
import {
  summarizeChangeContract,
  type ContractSummary,
} from "./change-contract.js";

export interface InstructionDependencies {
  adapter?: OpenSpecAdapter;
  resolver?: ArtifactResolver;
}

export class InstructionContractError extends Error {
  readonly code = "upstream_contract_mismatch" as const;

  constructor(
    message: string,
    public readonly field: string,
    public readonly expected: unknown,
    public readonly actual: unknown,
  ) {
    super(message);
    this.name = "InstructionContractError";
  }
}

export interface LifecycleCompatibility {
  schemaName: string;
  changeRoot: string;
  artifactPaths: ResolvedChangeArtifacts["artifactPaths"];
  planningRevision: string;
  contract: ContractSummary | null;
  planningComplete: boolean;
  implementationComplete: boolean;
  /** @deprecated Use planningComplete and implementationComplete. */
  isComplete: boolean;
}

export interface ArtifactInstruction extends LifecycleCompatibility {
  changeName: string;
  artifactId: string;
  template: string;
  instruction: string;
  outputPath: string;
  resolvedOutputPath: string;
  existingOutputPaths: string[];
  dependencies: string[];
  dependencyDetails: Array<Record<string, unknown>>;
  contextFiles: string[];
  projectContext: string;
  rules: string[];
  actionContext: ResolvedChangeArtifacts["actionContext"];
}

export interface ApplyInstruction extends LifecycleCompatibility {
  changeName: string;
  state: string;
  currentGroup: ParsedTaskGroup | null;
  taskGroups: ParsedTaskGroup[];
  taskArtifactId: string;
  instruction: string;
  contextFiles: string[];
  contextFilesByArtifact: Record<string, string[]>;
  projectContext: string;
  progress: { total: number; complete: number; remaining: number };
  tasks: Array<{ id: string; description: string; done: boolean }>;
  actionContext: ResolvedChangeArtifacts["actionContext"];
}

export interface ReviewInstruction extends LifecycleCompatibility {
  changeName: string;
  state: string;
  completedGroups: ParsedTaskGroup[];
  artifacts: string[];
  instruction: string;
  contextFiles: string[];
  actionContext: ResolvedChangeArtifacts["actionContext"];
}

export interface ArchiveInstruction extends LifecycleCompatibility {
  changeName: string;
  state: string;
  isReady: boolean;
  reason?: string;
  instruction: string;
  contextFiles: string[];
  actionContext: ResolvedChangeArtifacts["actionContext"];
}

function services(
  cwd: string,
  dependencies: InstructionDependencies,
): { adapter: OpenSpecAdapter; resolver: ArtifactResolver } {
  const adapter = dependencies.adapter ?? createOpenSpecAdapter(cwd);
  return {
    adapter,
    resolver: dependencies.resolver ?? createArtifactResolver(adapter),
  };
}

function compatibility(
  cwd: string,
  resolved: ResolvedChangeArtifacts,
  tasks: TaskGroupSummary,
): LifecycleCompatibility {
  return {
    schemaName: resolved.schemaName,
    changeRoot: resolved.changeRoot,
    artifactPaths: resolved.artifactPaths,
    planningRevision: resolved.planningRevision,
    contract: resolved.contract ? summarizeChangeContract(resolved.contract, cwd) : null,
    planningComplete: resolved.planningComplete,
    implementationComplete: tasks.implementationComplete,
    isComplete: resolved.planningComplete && tasks.implementationComplete,
  };
}

function taskSummary(
  cwd: string,
  resolved: ResolvedChangeArtifacts,
  required = false,
): TaskGroupSummary {
  const config = loadConfigFromDir(cwd);
  const configured = config.corgi?.taskArtifactId;
  const inferred = Object.prototype.hasOwnProperty.call(resolved.artifactPaths, "tasks")
    ? "tasks"
    : undefined;
  if (!configured && !inferred && !required) {
    return {
      taskArtifactId: "",
      taskArtifactPath: null,
      groups: [],
      issues: [],
      completedTasks: 0,
      totalTasks: 0,
      implementationComplete: false,
      currentGroup: null,
    };
  }
  return summarizeTaskGroups(
    resolved.artifactPaths,
    resolveTaskArtifactId(config, resolved.artifactPaths),
  );
}

/** Resolve artifact instructions from OpenSpec rather than local schema files. */
export async function resolveArtifactInstruction(
  cwd: string,
  changeName: string,
  artifactId: string,
  options: OpenSpecCommandOptions = {},
  dependencies: InstructionDependencies = {},
): Promise<ArtifactInstruction> {
  const { adapter, resolver } = services(cwd, dependencies);
  const [upstream, resolved] = await Promise.all([
    adapter.getArtifactInstructions(changeName, artifactId, options),
    resolver.resolve(changeName, options),
  ]);
  await assertArtifactInstructionContract(changeName, artifactId, upstream, resolved);
  const config = loadConfigFromDir(cwd);
  const tasks = taskSummary(cwd, resolved);
  const dependencyIds = upstream.dependencies
    .map(dependencyId)
    .filter((value): value is string => Boolean(value));
  const contextFiles = dependencyIds.flatMap(
    (dependency) => resolved.artifactPaths[dependency]?.existingOutputPaths ?? [],
  );

  return {
    changeName: upstream.changeName,
    artifactId: upstream.artifactId,
    template: upstream.template,
    instruction: upstream.instruction ?? upstream.description,
    outputPath: upstream.outputPath,
    resolvedOutputPath: upstream.resolvedOutputPath,
    existingOutputPaths: upstream.existingOutputPaths,
    dependencies: dependencyIds,
    dependencyDetails: upstream.dependencies,
    contextFiles: [...new Set([...contextFiles, ...contractContextFiles(resolved)])].sort(),
    projectContext: config.context ?? "",
    rules: config.rules?.[artifactId] ?? [],
    actionContext: resolved.actionContext,
    ...compatibility(cwd, resolved, tasks),
  };
}

async function assertArtifactInstructionContract(
  requestedChangeName: string,
  requestedArtifactId: string,
  upstream: Awaited<ReturnType<OpenSpecAdapter["getArtifactInstructions"]>>,
  resolved: ResolvedChangeArtifacts,
): Promise<void> {
  assertContractEqual("requested changeName", requestedChangeName, resolved.changeName);
  assertContractEqual("instructions.changeName", resolved.changeName, upstream.changeName);
  assertContractEqual("status.changeName", resolved.changeName, resolved.status.changeName);
  assertContractEqual("requested artifactId", requestedArtifactId, upstream.artifactId);
  assertContractEqual("instructions.schemaName", resolved.schemaName, upstream.schemaName);
  assertContractEqual("status.schemaName", resolved.schemaName, resolved.status.schemaName);
  assertContractPath("instructions.changeDir", resolved.changeRoot, upstream.changeDir);
  assertContractPath("status.changeRoot", resolved.changeRoot, resolved.status.changeRoot);

  const artifact = resolved.artifactPaths[requestedArtifactId];
  if (!artifact) {
    throw new InstructionContractError(
      `OpenSpec status does not contain requested artifact '${requestedArtifactId}'`,
      `artifactPaths.${requestedArtifactId}`,
      "present",
      undefined,
    );
  }

  const statusArtifactPath = resolved.status.artifactPaths[requestedArtifactId];
  if (!statusArtifactPath) {
    throw new InstructionContractError(
      `OpenSpec raw status does not contain requested artifact path '${requestedArtifactId}'`,
      `status.artifactPaths.${requestedArtifactId}`,
      "present",
      undefined,
    );
  }

  const statusArtifacts = resolved.status.artifacts.filter(
    (candidate) => candidate.id === requestedArtifactId,
  );
  if (statusArtifacts.length !== 1) {
    throw new InstructionContractError(
      `OpenSpec status must contain exactly one '${requestedArtifactId}' artifact summary`,
      `artifacts.${requestedArtifactId}`,
      1,
      statusArtifacts.length,
    );
  }

  assertContractOutput(
    `artifactPaths.${requestedArtifactId}.outputPath`,
    artifact.outputPath,
    upstream.outputPath,
  );
  assertContractOutput(
    `status.artifactPaths.${requestedArtifactId}.outputPath`,
    artifact.outputPath,
    statusArtifactPath.outputPath,
  );
  assertContractOutput(
    `artifacts.${requestedArtifactId}.outputPath`,
    artifact.outputPath,
    statusArtifacts[0]!.outputPath,
  );
  assertContractOutput(
    `artifactPaths.${requestedArtifactId}.resolvedOutputPath`,
    artifact.resolvedOutputPath,
    upstream.resolvedOutputPath,
  );
  assertContractOutput(
    `status.artifactPaths.${requestedArtifactId}.resolvedOutputPath`,
    artifact.resolvedOutputPath,
    statusArtifactPath.resolvedOutputPath,
  );
  assertContractPathSet(
    `artifactPaths.${requestedArtifactId}.existingOutputPaths`,
    artifact.existingOutputPaths,
    upstream.existingOutputPaths,
  );
  assertContractPathSet(
    `status.artifactPaths.${requestedArtifactId}.existingOutputPaths`,
    artifact.existingOutputPaths,
    statusArtifactPath.existingOutputPaths,
  );

  const isGlob = hasGlobMagic(upstream.outputPath) || hasGlobMagic(upstream.resolvedOutputPath);
  const outputTarget = await assertArtifactOutputPath(resolved, upstream.outputPath, isGlob);
  const resolvedOutputTarget = await assertArtifactOutputPath(
    resolved,
    upstream.resolvedOutputPath,
    isGlob,
  );
  assertContractPath("instructions.output target", outputTarget, resolvedOutputTarget);
}

function assertContractEqual(field: string, expected: string, actual: string): void {
  if (expected !== actual) contractMismatch(field, expected, actual);
}

function assertContractPath(field: string, expected: string, actual: string): void {
  if (normalizeContractPath(expected) !== normalizeContractPath(actual)) {
    contractMismatch(field, expected, actual);
  }
}

function assertContractOutput(field: string, expected: string, actual: string): void {
  if (normalizeOutputPath(expected) !== normalizeOutputPath(actual)) {
    contractMismatch(field, expected, actual);
  }
}

function assertContractPathSet(field: string, expected: string[], actual: string[]): void {
  const normalizedExpected = [...new Set(expected.map(normalizeContractPath))].sort();
  const normalizedActual = [...new Set(actual.map(normalizeContractPath))].sort();
  if (
    normalizedExpected.length !== normalizedActual.length ||
    normalizedExpected.some((value, index) => value !== normalizedActual[index])
  ) {
    contractMismatch(field, expected, actual);
  }
}

function normalizeContractPath(value: string): string {
  const portable = value.replace(/\\/g, "/");
  const normalized = portable.replace(/\/\.\//g, "/").replace(/\/{2,}/g, "/");
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function normalizeOutputPath(value: string): string {
  const normalized = normalizeContractPath(value);
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function hasGlobMagic(value: string): boolean {
  return ["*", "?", "[", "]", "{", "}"].some((token) => value.includes(token));
}

function contractMismatch(field: string, expected: unknown, actual: unknown): never {
  throw new InstructionContractError(
    `OpenSpec instructions/status mismatch for ${field}`,
    field,
    expected,
    actual,
  );
}

/** Resolve implementation instructions and context from OpenSpec apply JSON. */
export async function resolveApplyInstruction(
  cwd: string,
  changeName: string,
  options: OpenSpecCommandOptions = {},
  dependencies: InstructionDependencies = {},
): Promise<ApplyInstruction> {
  const { adapter, resolver } = services(cwd, dependencies);
  const [upstream, resolved] = await Promise.all([
    adapter.getApplyInstructions(changeName, options),
    resolver.resolve(changeName, options),
  ]);
  await assertApplyInstructionContract(changeName, upstream, resolved);
  const config = loadConfigFromDir(cwd);
  const tasks = taskSummary(cwd, resolved, true);
  const contractFiles = contractContextFiles(resolved);
  const contextFiles = [...new Set([
    ...Object.values(upstream.contextFiles).flat(),
    ...contractFiles,
  ])].sort();

  return {
    changeName: upstream.changeName,
    state: upstream.state,
    currentGroup: tasks.currentGroup,
    taskGroups: tasks.groups,
    taskArtifactId: tasks.taskArtifactId,
    instruction: upstream.instruction,
    contextFiles,
    contextFilesByArtifact: {
      ...upstream.contextFiles,
      ...(contractFiles.length > 0 ? { "corgi-contract": contractFiles } : {}),
    },
    projectContext: config.context ?? "",
    progress: upstream.progress,
    tasks: upstream.tasks,
    actionContext: resolved.actionContext,
    ...compatibility(cwd, resolved, tasks),
  };
}

async function assertApplyInstructionContract(
  requestedChangeName: string,
  upstream: Awaited<ReturnType<OpenSpecAdapter["getApplyInstructions"]>>,
  resolved: ResolvedChangeArtifacts,
): Promise<void> {
  assertContractEqual("requested changeName", requestedChangeName, resolved.changeName);
  assertContractEqual("apply.changeName", resolved.changeName, upstream.changeName);
  assertContractEqual("status.changeName", resolved.changeName, resolved.status.changeName);
  assertContractEqual("apply.schemaName", resolved.schemaName, upstream.schemaName);
  assertContractEqual("status.schemaName", resolved.schemaName, resolved.status.schemaName);
  assertContractPath("apply.changeDir", resolved.changeRoot, upstream.changeDir);
  assertContractPath("status.changeRoot", resolved.changeRoot, resolved.status.changeRoot);

  for (const [artifactId, contextPaths] of Object.entries(upstream.contextFiles)) {
    const artifact = resolved.artifactPaths[artifactId];
    if (!artifact) {
      throw new InstructionContractError(
        `OpenSpec apply context references unknown artifact '${artifactId}'`,
        `apply.contextFiles.${artifactId}`,
        Object.keys(resolved.artifactPaths).sort(),
        artifactId,
      );
    }

    const statusArtifact = resolved.status.artifactPaths[artifactId];
    if (!statusArtifact) {
      throw new InstructionContractError(
        `OpenSpec raw status does not contain apply context artifact '${artifactId}'`,
        `status.artifactPaths.${artifactId}`,
        "present",
        undefined,
      );
    }
    assertContractPathSet(
      `status.artifactPaths.${artifactId}.existingOutputPaths`,
      artifact.existingOutputPaths,
      statusArtifact.existingOutputPaths,
    );
    assertContractPathSet(
      `apply.contextFiles.${artifactId}`,
      artifact.existingOutputPaths,
      contextPaths,
    );
    for (const contextPath of contextPaths) {
      await assertArtifactOutputPath(resolved, contextPath, false);
    }
  }
}

export async function resolveReviewInstruction(
  cwd: string,
  changeName: string,
  options: OpenSpecCommandOptions = {},
  dependencies: InstructionDependencies = {},
): Promise<ReviewInstruction> {
  const { resolver } = services(cwd, dependencies);
  const resolved = await resolver.resolve(changeName, options);
  const tasks = taskSummary(cwd, resolved);
  const completedGroups = tasks.groups.filter((group) => group.status === "done");
  const contextFiles = allContextFiles(resolved);
  const artifacts = Object.entries(resolved.artifactPaths)
    .filter(([, artifact]) => artifact.existingOutputPaths.length > 0)
    .map(([artifactId]) => artifactId)
    .sort();

  return {
    changeName: resolved.changeName,
    state: compatibilityState(resolved, tasks),
    completedGroups,
    artifacts,
    instruction: `Review completed task groups against the authoritative planning artifacts.\n\nCompleted groups: ${completedGroups.map((group) => `${group.number}. ${group.name}`).join(", ") || "none"}\nTotal progress: ${tasks.completedTasks}/${tasks.totalTasks} tasks`,
    contextFiles,
    actionContext: resolved.actionContext,
    ...compatibility(cwd, resolved, tasks),
  };
}

export async function resolveArchiveInstruction(
  cwd: string,
  changeName: string,
  options: OpenSpecCommandOptions = {},
  dependencies: InstructionDependencies = {},
): Promise<ArchiveInstruction> {
  const { resolver } = services(cwd, dependencies);
  const resolved = await resolver.resolve(changeName, options);
  const tasks = taskSummary(cwd, resolved);
  const isReady = resolved.planningComplete && tasks.implementationComplete;
  const remaining = tasks.totalTasks - tasks.completedTasks;
  const reason = !resolved.planningComplete
    ? "Change not ready for archive: planning artifacts are incomplete"
    : !tasks.implementationComplete
      ? `Change not ready for archive: ${remaining} tasks remaining`
      : undefined;

  return {
    changeName: resolved.changeName,
    state: compatibilityState(resolved, tasks),
    isReady,
    ...(reason ? { reason } : {}),
    instruction: isReady
      ? "Archive this completed change with OpenSpec, preserving strict validation and scenario-drift guards."
      : reason!,
    contextFiles: allContextFiles(resolved),
    actionContext: resolved.actionContext,
    ...compatibility(cwd, resolved, tasks),
  };
}

function dependencyId(value: Record<string, unknown>): string | null {
  for (const key of ["id", "artifactId", "artifact", "name"] as const) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key];
  }
  return null;
}

function contractContextFiles(resolved: ResolvedChangeArtifacts): string[] {
  return resolved.contract
    ? [resolved.contract.sourcePath, resolved.contract.traceabilityPath]
    : [];
}

function allContextFiles(resolved: ResolvedChangeArtifacts): string[] {
  return [...new Set([
    ...flattenArtifactFiles(resolved.artifactPaths),
    ...contractContextFiles(resolved),
  ])].sort();
}
