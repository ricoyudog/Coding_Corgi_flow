import { resolve } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import {
  loadWorkflowSchema,
  loadTemplate,
  getChangeInfo,
  findNextTaskGroup,
  type SchemaArtifact,
  type ChangeInfo,
  type TaskGroup,
} from "./changes.js";
import { loadConfigFromDir, type OpenSpecConfig } from "./config.js";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ArtifactInstruction {
  changeName: string;
  artifactId: string;
  template: string;
  instruction: string;
  outputPath: string;
  dependencies: string[];
  contextFiles: string[];
  projectContext: string;
  rules: string[];
}

export interface ApplyInstruction {
  changeName: string;
  state: string;
  currentGroup: TaskGroup | null;
  instruction: string;
  contextFiles: string[];
  projectContext: string;
}

export interface ReviewInstruction {
  changeName: string;
  state: string;
  completedGroups: TaskGroup[];
  artifacts: string[];
  instruction: string;
  contextFiles: string[];
}

export interface ArchiveInstruction {
  changeName: string;
  state: string;
  isReady: boolean;
  reason?: string;
  instruction: string;
  contextFiles: string[];
}

// ─── Instruction Resolution ─────────────────────────────────────────────

/**
 * Generate instruction JSON for creating a specific artifact.
 */
export function resolveArtifactInstruction(
  cwd: string,
  changeName: string,
  artifactId: string
): ArtifactInstruction {
  const schema = loadWorkflowSchema(cwd);
  const config = loadConfigFromDir(cwd);
  const changeInfo = getChangeInfo(cwd, changeName);
  const changeDir = resolve(cwd, "openspec/changes", changeName);

  // Find the artifact definition
  const artifact = schema.artifacts.find((a) => a.id === artifactId);
  if (!artifact) {
    const validIds = schema.artifacts.map((a) => a.id).join(", ");
    throw new Error(
      `Unknown artifact '${artifactId}'. Valid artifacts: ${validIds}`
    );
  }

  // Check if blocked
  const status = changeInfo.artifacts.find((a) => a.id === artifactId);
  if (status?.blocked) {
    throw new Error(
      `Artifact '${artifactId}' is blocked. Missing: ${status.blockedBy.join(", ")}`
    );
  }

  // Load template
  const template = loadTemplate(cwd, schema.name, artifact.template);

  // Determine output path
  const outputPath = resolve(changeDir, artifact.generates);

  // Gather context files (existing artifacts that this one depends on)
  const contextFiles = gatherContextFiles(changeDir, artifact.requires, schema);

  // Get per-artifact rules
  const rules = getArtifactRules(config, artifactId);

  const templateVars: Record<string, string> = {
    changeName,
    outputPath,
    artifactId,
    schemaName: schema.name,
  };

  return {
    changeName,
    artifactId,
    template: resolveTemplateVars(template, templateVars),
    instruction: resolveTemplateVars(artifact.instruction, templateVars),
    outputPath,
    dependencies: artifact.requires,
    contextFiles,
    projectContext: config.context ?? "",
    rules,
  };
}

/**
 * Generate instruction JSON for the apply phase (next task group).
 */
export function resolveApplyInstruction(
  cwd: string,
  changeName: string
): ApplyInstruction {
  const schema = loadWorkflowSchema(cwd);
  const config = loadConfigFromDir(cwd);
  const changeInfo = getChangeInfo(cwd, changeName);
  const changeDir = resolve(cwd, "openspec/changes", changeName);

  const currentGroup = findNextTaskGroup(changeInfo.taskGroups);

  // Build context files list
  const contextFiles: string[] = [];

  // Always include tasks.md
  const tasksPath = resolve(changeDir, "tasks.md");
  if (existsSync(tasksPath)) contextFiles.push(tasksPath);

  // Include design.md if exists
  const designPath = resolve(changeDir, "design.md");
  if (existsSync(designPath)) contextFiles.push(designPath);

  // Include spec files
  const specsDir = resolve(changeDir, "specs");
  if (existsSync(specsDir)) {
    addMarkdownFilesFromDir(specsDir, contextFiles);
  }

  // Include proposal
  const proposalPath = resolve(changeDir, "proposal.md");
  if (existsSync(proposalPath)) contextFiles.push(proposalPath);

  return {
    changeName,
    state: changeInfo.state,
    currentGroup,
    instruction: schema.apply.instruction,
    contextFiles,
    projectContext: config.context ?? "",
  };
}

/**
 * Generate instruction JSON for the review phase.
 */
export function resolveReviewInstruction(
  cwd: string,
  changeName: string
): ReviewInstruction {
  const changeInfo = getChangeInfo(cwd, changeName);
  const changeDir = resolve(cwd, "openspec/changes", changeName);

  const completedGroups = changeInfo.taskGroups.filter(
    (g) => g.status === "done"
  );

  // Context files: all artifacts
  const contextFiles: string[] = [];
  const proposalPath = resolve(changeDir, "proposal.md");
  if (existsSync(proposalPath)) contextFiles.push(proposalPath);
  const designPath = resolve(changeDir, "design.md");
  if (existsSync(designPath)) contextFiles.push(designPath);
  const tasksPath = resolve(changeDir, "tasks.md");
  if (existsSync(tasksPath)) contextFiles.push(tasksPath);
  const specsDir = resolve(changeDir, "specs");
  if (existsSync(specsDir)) addMarkdownFilesFromDir(specsDir, contextFiles);

  // List of artifact IDs that exist
  const artifacts = changeInfo.artifacts
    .filter((a) => a.exists)
    .map((a) => a.id);

  const instruction = `Review the completed task groups against the specifications and design.

Check:
1. All spec scenarios are implemented and testable
2. Design decisions were followed
3. No tasks were skipped or partially implemented
4. Code quality meets project standards

Completed groups: ${completedGroups.map((g) => `${g.number}. ${g.name}`).join(", ")}
Total progress: ${changeInfo.completedTasks}/${changeInfo.totalTasks} tasks`;

  return {
    changeName,
    state: changeInfo.state,
    completedGroups,
    artifacts,
    instruction,
    contextFiles,
  };
}

/**
 * Generate instruction JSON for the archive phase.
 */
export function resolveArchiveInstruction(
  cwd: string,
  changeName: string
): ArchiveInstruction {
  const changeInfo = getChangeInfo(cwd, changeName);
  const changeDir = resolve(cwd, "openspec/changes", changeName);

  const isReady = changeInfo.isComplete;
  let reason: string | undefined;

  if (!isReady) {
    const remaining = changeInfo.totalTasks - changeInfo.completedTasks;
    reason = `Change not ready for archive: ${remaining} tasks remaining`;
  }

  // Context files
  const contextFiles: string[] = [];
  const specsDir = resolve(changeDir, "specs");
  if (existsSync(specsDir)) addMarkdownFilesFromDir(specsDir, contextFiles);
  const proposalPath = resolve(changeDir, "proposal.md");
  if (existsSync(proposalPath)) contextFiles.push(proposalPath);

  const instruction = isReady
    ? `Archive the completed change:
1. Merge delta specs from specs/ into the main openspec/specs/ directory
2. Move the change directory to openspec/archive/${changeName}/
3. Close any associated issues
4. Update any references to this change`
    : reason!;

  return {
    changeName,
    state: changeInfo.state,
    isReady,
    reason,
    instruction,
    contextFiles,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function resolveTemplateVars(
  text: string,
  vars: Record<string, string>
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in vars) {
      return vars[key]!;
    }
    console.error(`[template] Warning: unknown variable '${key}' replaced with empty string`);
    return "";
  });
}

function gatherContextFiles(
  changeDir: string,
  requires: string[],
  schema: { artifacts: SchemaArtifact[] }
): string[] {
  const files: string[] = [];

  for (const depId of requires) {
    const depArtifact = schema.artifacts.find((a) => a.id === depId);
    if (!depArtifact) continue;

    const generates = depArtifact.generates;
    if (generates.includes("*")) {
      // Spec files — add all from the directory
      const baseDir = generates.split("/")[0]!;
      const dir = resolve(changeDir, baseDir);
      if (existsSync(dir)) {
        addMarkdownFilesFromDir(dir, files);
      }
    } else {
      const filePath = resolve(changeDir, generates);
      if (existsSync(filePath)) {
        files.push(filePath);
      }
    }
  }

  return files;
}

function addMarkdownFilesFromDir(dir: string, files: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(full);
    } else if (entry.isDirectory()) {
      addMarkdownFilesFromDir(full, files);
    }
  }
}

function getArtifactRules(
  config: OpenSpecConfig,
  artifactId: string
): string[] {
  if (!config.rules) return [];
  const rules = config.rules[artifactId];
  if (!rules) return [];
  return Array.isArray(rules) ? rules : [];
}
