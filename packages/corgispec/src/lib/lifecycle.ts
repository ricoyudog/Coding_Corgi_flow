import { readFileSync } from "node:fs";
import type { OpenSpecConfig } from "./config.js";
import type {
  OpenSpecAdapter,
  OpenSpecAdapterError,
  OpenSpecArtifactPath,
  OpenSpecArtifactStatus,
  OpenSpecCommandOptions,
  OpenSpecValidationResponse,
} from "./openspec-adapter.js";
import type { ResolvedChangeArtifacts } from "./artifact-resolver.js";
import { buildReadyReport, type ReadyReport } from "./readiness.js";
import {
  findNextTaskGroup,
  parseTaskGroupsDocument,
  type ParsedTaskGroup,
  type TaskGroupParseResult,
} from "./task-groups.js";

export interface TaskGroupSummary extends TaskGroupParseResult {
  taskArtifactId: string;
  taskArtifactPath: string | null;
  completedTasks: number;
  totalTasks: number;
  implementationComplete: boolean;
  currentGroup: ParsedTaskGroup | null;
}

export interface ReadyLifecycleResult {
  report: ReadyReport;
  resolved: ResolvedChangeArtifacts;
}

export async function selectChangeName(
  adapter: Pick<OpenSpecAdapter, "listChanges">,
  requested: string | undefined,
  options: Pick<OpenSpecCommandOptions, "store"> = {},
): Promise<string> {
  if (requested?.trim()) return requested.trim();
  const response = await adapter.listChanges(options);
  const names = [...new Set(response.changes.map((change) => change.name))].sort();
  if (names.length === 0) {
    throw new Error("No changes found.");
  }
  if (names.length > 1) {
    throw new Error(`Multiple changes found. Specify one: ${names.join(", ")}`);
  }
  return names[0]!;
}

export function resolveTaskArtifactId(
  config: OpenSpecConfig,
  artifactPaths: Record<string, OpenSpecArtifactPath>,
): string {
  const configured = config.corgi?.taskArtifactId;
  if (configured) return configured;
  if (Object.prototype.hasOwnProperty.call(artifactPaths, "tasks")) return "tasks";
  throw new Error(
    "No task artifact is configured. Set 'corgi.taskArtifactId' in openspec/config.yaml.",
  );
}

export function resolveOptionalTaskArtifactId(
  config: OpenSpecConfig,
  artifactPaths: Record<string, OpenSpecArtifactPath>,
): string | null {
  if (config.corgi?.taskArtifactId) return config.corgi.taskArtifactId;
  return Object.prototype.hasOwnProperty.call(artifactPaths, "tasks") ? "tasks" : null;
}

export function summarizeOptionalTaskGroups(
  config: OpenSpecConfig,
  artifactPaths: Record<string, OpenSpecArtifactPath>,
): TaskGroupSummary {
  const artifactId = resolveOptionalTaskArtifactId(config, artifactPaths);
  if (artifactId) return summarizeTaskGroups(artifactPaths, artifactId);
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

/** Read task groups only from the concrete path supplied by OpenSpec. */
export function summarizeTaskGroups(
  artifactPaths: Record<string, OpenSpecArtifactPath>,
  taskArtifactId: string,
): TaskGroupSummary {
  const taskPaths = artifactPaths[taskArtifactId]?.existingOutputPaths ?? [];
  if (taskPaths.length > 1) {
    throw new Error(
      `Task artifact '${taskArtifactId}' must resolve to exactly one file; found ${taskPaths.length}`,
    );
  }

  if (taskPaths.length === 0) {
    return {
      taskArtifactId,
      taskArtifactPath: null,
      groups: [],
      issues: [],
      completedTasks: 0,
      totalTasks: 0,
      implementationComplete: false,
      currentGroup: null,
    };
  }

  const parsed = parseTaskGroupsDocument(readFileSync(taskPaths[0]!, "utf8"));
  const completedTasks = parsed.groups.reduce(
    (total, group) => total + group.completedTasks,
    0,
  );
  const totalTasks = parsed.groups.reduce((total, group) => total + group.totalTasks, 0);
  return {
    taskArtifactId,
    taskArtifactPath: taskPaths[0]!,
    ...parsed,
    completedTasks,
    totalTasks,
    implementationComplete:
      totalTasks > 0 && completedTasks === totalTasks && parsed.issues.every((issue) => issue.severity !== "error"),
    currentGroup: findNextTaskGroup(parsed.groups),
  };
}

export function compatibleArtifacts(
  artifacts: OpenSpecArtifactStatus[],
): Array<OpenSpecArtifactStatus & {
  description: string;
  generates: string;
  exists: boolean;
  ready: boolean;
  blocked: boolean;
  blockedBy: string[];
}> {
  return artifacts.map((artifact) => ({
    ...artifact,
    description:
      typeof artifact.description === "string" ? artifact.description : artifact.id,
    generates: artifact.outputPath,
    exists: artifact.status === "done",
    ready: artifact.status === "ready",
    blocked: artifact.status === "blocked",
    blockedBy: artifact.missingDeps ?? [],
  }));
}

export function compatibilityState(
  resolved: ResolvedChangeArtifacts,
  tasks: TaskGroupSummary,
): "empty" | "proposing" | "applying" | "all_done" | "blocked" {
  if (resolved.status.artifacts.every((artifact) => artifact.status !== "done")) {
    return "empty";
  }
  if (resolved.planningComplete && tasks.implementationComplete) return "all_done";
  if (resolved.planningComplete) return "applying";
  const actionable = resolved.status.artifacts.some((artifact) => artifact.status === "ready");
  return actionable ? "proposing" : "blocked";
}

export function flattenArtifactFiles(
  artifactPaths: Record<string, OpenSpecArtifactPath>,
): string[] {
  return [...new Set(
    Object.values(artifactPaths).flatMap((artifact) => artifact.existingOutputPaths),
  )].sort();
}

export async function buildLifecycleReadyReport(
  adapter: Pick<OpenSpecAdapter, "validateChange">,
  resolved: ResolvedChangeArtifacts,
  config: OpenSpecConfig,
  strictWarnings: boolean,
  options: OpenSpecCommandOptions = {},
): Promise<ReadyLifecycleResult> {
  let validation: OpenSpecValidationResponse;
  try {
    validation = await adapter.validateChange(resolved.changeName, {
      ...options,
      strict: true,
    });
  } catch (error) {
    const payload = validationPayloadFromError(error);
    if (!payload) throw error;
    validation = payload;
  }

  const normalized = normalizeValidation(validation);
  const taskArtifactId = resolveTaskArtifactId(config, resolved.artifactPaths);
  const report = buildReadyReport({
    status: resolved.status,
    validation: normalized,
    planningRevision: resolved.planningRevision,
    artifactPaths: resolved.artifactPaths,
    taskArtifactId,
    strict: strictWarnings,
  });
  return { report, resolved };
}

export function normalizeValidation(
  response: OpenSpecValidationResponse,
): { valid: boolean; issues: string[] } {
  const record = response as Record<string, unknown>;
  const directValid = typeof record.valid === "boolean" ? record.valid : undefined;
  const items = Array.isArray(record.items)
    ? record.items.filter(isRecord)
    : Array.isArray(record.results)
      ? record.results.filter(isRecord)
      : [];
  const itemValidity = items
    .map((item) => item.valid)
    .filter((value): value is boolean => typeof value === "boolean");
  const valid = directValid ?? (itemValidity.length > 0 && itemValidity.every(Boolean));

  const issues = [
    ...collectIssues(record.issues),
    ...items.flatMap((item) => collectIssues(item.issues)),
  ];
  return {
    valid,
    issues: [...new Set(issues)],
  };
}

function validationPayloadFromError(error: unknown): OpenSpecValidationResponse | null {
  if (!isRecord(error)) return null;
  const details = error.details;
  if (!isRecord(details) || !isRecord(details.payload)) return null;
  const payload = details.payload;
  if (!("valid" in payload || "items" in payload || "results" in payload || "issues" in payload)) {
    return null;
  }
  return payload as OpenSpecValidationResponse;
}

function collectIssues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((issue) => {
    if (typeof issue === "string") return issue;
    if (isRecord(issue)) {
      if (typeof issue.message === "string") return issue.message;
      if (typeof issue.path === "string" && typeof issue.reason === "string") {
        return `${issue.path}: ${issue.reason}`;
      }
    }
    return JSON.stringify(issue);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Stable JSON-safe error shape shared by lifecycle commands. */
export function lifecycleError(error: unknown): {
  code: string;
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    isRecord(error) && typeof error.code === "string"
      ? error.code
      : "lifecycle_contract_error";
  return { code, message };
}
