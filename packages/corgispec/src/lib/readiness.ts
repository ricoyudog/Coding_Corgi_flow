import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { parseTaskGroupsDocument, type ParsedTaskGroup } from "./task-groups.js";
import type { ContractSummary } from "./change-contract.js";

export type ReadyCheckStatus = "pass" | "warning" | "fail";
export type ReadyCheckSeverity = "info" | "warning" | "error";

export interface ReadyCheck {
  code: string;
  status: ReadyCheckStatus;
  severity: ReadyCheckSeverity;
  message: string;
  paths?: string[];
}

export interface ReadyArtifactPath {
  outputPath: string;
  resolvedOutputPath: string;
  existingOutputPaths: string[];
}

export interface ReadyStatusInput {
  changeName: string;
  schemaName: string;
  isComplete: boolean;
  artifacts: Array<{
    id: string;
    status: "done" | "ready" | "blocked";
    missingDeps?: string[];
  }>;
}

export interface ReadyValidationInput {
  valid: boolean;
  issues?: string[];
}

export interface ReadyReport {
  schemaVersion: 1;
  changeName: string;
  schemaName: string;
  planningRevision: string;
  status: "ready" | "not_ready";
  taskArtifactId: string;
  artifactPaths: Record<string, ReadyArtifactPath>;
  checks: ReadyCheck[];
  taskGroups: ParsedTaskGroup[];
  contract: ContractSummary | null;
}

export interface BuildReadyReportInput {
  status: ReadyStatusInput;
  validation: ReadyValidationInput;
  planningRevision: string;
  artifactPaths: Record<string, ReadyArtifactPath>;
  taskArtifactId: string;
  strict: boolean;
}

const PLACEHOLDER = /\b(?:TBD|TODO|NEEDS\s+CLARIFICATION)\b|<(?!(?:!--|\/?(?:code|summary|details)\b))[^>\n]+>/i;

function check(
  code: string,
  ok: boolean,
  passMessage: string,
  failMessage: string,
  paths?: string[],
): ReadyCheck {
  return {
    code,
    status: ok ? "pass" : "fail",
    severity: ok ? "info" : "error",
    message: ok ? passMessage : failMessage,
    ...(paths && paths.length > 0 ? { paths } : {}),
  };
}

function readArtifacts(paths: Record<string, ReadyArtifactPath>): Array<{
  artifactId: string;
  path: string;
  content: string;
}> {
  const files: Array<{ artifactId: string; path: string; content: string }> = [];
  for (const [artifactId, summary] of Object.entries(paths)) {
    for (const path of summary.existingOutputPaths) {
      files.push({ artifactId, path, content: readFileSync(path, "utf-8") });
    }
  }
  return files;
}

function unresolvedOpenQuestions(content: string): boolean {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let openLevel: number | null = null;
  const body: string[] = [];
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      if (openLevel !== null && heading[1]!.length <= openLevel) break;
      if (/^open questions?$/i.test(heading[2]!.trim())) {
        openLevel = heading[1]!.length;
      }
      continue;
    }
    if (openLevel !== null) body.push(line.trim());
  }
  const meaningful = body.filter(
    (line) => line && !/^(?:none|n\/a|not applicable)[.!]?$/i.test(line),
  );
  return meaningful.length > 0;
}

function proposalCapabilities(content: string): Set<string> {
  const capabilities = new Set<string>();
  let inCapabilities = false;
  for (const line of content.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^##\s+Capabilities\s*$/i.test(line)) {
      inCapabilities = true;
      continue;
    }
    if (inCapabilities && /^##\s+/.test(line)) break;
    if (!inCapabilities) continue;
    const bullet = line.match(/^\s*[-*]\s+`?([a-z0-9][a-z0-9-]*)`?\s*:/i);
    if (bullet && !/^<.+>$/.test(bullet[1]!)) capabilities.add(bullet[1]!.toLowerCase());
  }
  return capabilities;
}

function specCapabilities(paths: string[]): Set<string> {
  return new Set(
    paths.map((path) => {
      const parent = basename(dirname(path));
      return parent.toLowerCase();
    }),
  );
}

export function buildReadyReport(input: BuildReadyReportInput): ReadyReport {
  const checks: ReadyCheck[] = [];
  const files = readArtifacts(input.artifactPaths);

  const incomplete = input.status.artifacts.filter((artifact) => artifact.status !== "done");
  checks.push(
    check(
      "ARTIFACTS_COMPLETE",
      input.status.isComplete && incomplete.length === 0,
      "All planning artifacts are complete",
      `Incomplete planning artifacts: ${incomplete.map((artifact) => artifact.id).join(", ") || "unknown"}`,
    ),
  );
  checks.push(
    check(
      "OPENSPEC_STRICT_VALIDATION",
      input.validation.valid,
      "OpenSpec strict validation passed",
      `OpenSpec strict validation failed${
        input.validation.issues?.length ? `: ${input.validation.issues.join("; ")}` : ""
      }`,
    ),
  );

  const taskSummary = input.artifactPaths[input.taskArtifactId];
  checks.push(
    check(
      "TASK_ARTIFACT_CONFIGURED",
      Boolean(taskSummary),
      `Task artifact '${input.taskArtifactId}' exists in the schema`,
      `Configured task artifact '${input.taskArtifactId}' does not exist in the schema`,
    ),
  );

  const taskPaths = taskSummary?.existingOutputPaths ?? [];
  checks.push(
    check(
      "TASK_ARTIFACT_UNIQUE",
      taskPaths.length === 1,
      "Exactly one concrete task artifact was resolved",
      `Expected exactly one task artifact, found ${taskPaths.length}`,
      taskPaths,
    ),
  );

  let taskGroups: ParsedTaskGroup[] = [];
  if (taskPaths.length === 1) {
    const parsed = parseTaskGroupsDocument(readFileSync(taskPaths[0]!, "utf-8"));
    taskGroups = parsed.groups;
    if (parsed.issues.length === 0) {
      checks.push({
        code: "TASK_GROUP_STRUCTURE",
        status: "pass",
        severity: "info",
        message: `${taskGroups.length} Task Group(s) have stable unique ids`,
        paths: taskPaths,
      });
    } else {
      for (const issue of parsed.issues) {
        checks.push({
          code: issue.code,
          status: issue.severity === "warning" ? "warning" : "fail",
          severity: issue.severity,
          message: issue.line ? `${issue.message} (line ${issue.line})` : issue.message,
          paths: taskPaths,
        });
      }
    }
  }

  const placeholderPaths = files
    .filter((file) => PLACEHOLDER.test(file.content))
    .map((file) => file.path);
  checks.push(
    check(
      "NO_PLACEHOLDERS",
      placeholderPaths.length === 0,
      "Planning artifacts contain no unresolved placeholders",
      "Planning artifacts contain TBD/TODO/NEEDS CLARIFICATION or template placeholders",
      placeholderPaths,
    ),
  );

  const openQuestionPaths = files
    .filter((file) => unresolvedOpenQuestions(file.content))
    .map((file) => file.path);
  checks.push(
    check(
      "NO_OPEN_QUESTIONS",
      openQuestionPaths.length === 0,
      "No unresolved Open Questions sections remain",
      "Planning artifacts contain unresolved Open Questions",
      openQuestionPaths,
    ),
  );

  const proposal = input.artifactPaths.proposal?.existingOutputPaths ?? [];
  const specs = input.artifactPaths.specs?.existingOutputPaths ?? [];
  if (proposal.length === 1 && specs.length > 0) {
    const proposed = proposalCapabilities(readFileSync(proposal[0]!, "utf-8"));
    const concrete = specCapabilities(specs);
    const missing = [...proposed].filter((name) => !concrete.has(name));
    const extra = [...concrete].filter((name) => !proposed.has(name));
    checks.push(
      check(
        "CAPABILITY_SPEC_PARITY",
        missing.length === 0 && extra.length === 0,
        "Proposal capability names match concrete delta specs",
        `Capability/spec mismatch (missing specs: ${missing.join(", ") || "none"}; unlisted specs: ${extra.join(", ") || "none"})`,
        [...proposal, ...specs],
      ),
    );
  }

  const blocks = checks.some(
    (item) => item.status === "fail" || (input.strict && item.status === "warning"),
  );
  return {
    schemaVersion: 1,
    changeName: input.status.changeName,
    schemaName: input.status.schemaName,
    planningRevision: input.planningRevision,
    status: blocks ? "not_ready" : "ready",
    taskArtifactId: input.taskArtifactId,
    artifactPaths: input.artifactPaths,
    checks,
    taskGroups,
    contract: null,
  };
}
