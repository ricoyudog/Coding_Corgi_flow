import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as yaml from "js-yaml";

import type { TrackingProvider } from "./config.js";
import { NodeCommandRunner, type CommandRunner } from "./openspec-runtime.js";
import type {
  LoopGroupStateV2,
  LoopStateV2,
  LoopTrackerBindingV2,
} from "./run-contract-v2.js";

const DASHBOARD_START = "<!-- corgispec:task-dashboard:start -->";
const DASHBOARD_END = "<!-- corgispec:task-dashboard:end -->";

export type TrackerCheckpointErrorCodeV2 =
  | "tracker_binding_invalid"
  | "tracker_command_failed"
  | "tracker_response_invalid"
  | "tracker_lifecycle_invalid"
  | "tracker_dashboard_invalid";

export class TrackerCheckpointErrorV2 extends Error {
  constructor(
    message: string,
    readonly code: TrackerCheckpointErrorCodeV2,
  ) {
    super(message);
    this.name = "TrackerCheckpointErrorV2";
  }
}

export interface LoopTrackerCheckpointInputV2 {
  projectRoot: string;
  state: LoopStateV2;
  group: LoopGroupStateV2;
  runner?: CommandRunner;
}

export interface LoopTrackerCheckpointResultV2 {
  marker: string;
  alreadyPresent: boolean;
}

export async function resolveLoopTrackerBindingV2(input: {
  changeRoot: string;
  provider: TrackingProvider;
}): Promise<LoopTrackerBindingV2 | null> {
  if (input.provider === "none") return null;
  const filename = input.provider === "github" ? ".github.yaml" : ".gitlab.yaml";
  let content: string;
  try {
    content = await readFile(resolve(input.changeRoot, filename), "utf8");
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw new TrackerCheckpointErrorV2(
      `Could not read tracker binding '${filename}': ${error instanceof Error ? error.message : String(error)}`,
      "tracker_binding_invalid",
    );
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (error) {
    throw new TrackerCheckpointErrorV2(
      `Could not parse tracker binding '${filename}': ${error instanceof Error ? error.message : String(error)}`,
      "tracker_binding_invalid",
    );
  }
  if (!isRecord(parsed) || !isRecord(parsed["issue"])) {
    if (isRecord(parsed) && ("parent" in parsed || "groups" in parsed)) {
      throw new TrackerCheckpointErrorV2(
        `Unsupported legacy tracker state in '${filename}'. Convert it to the single Issue contract before running loop sync-tracker.`,
        "tracker_binding_invalid",
      );
    }
    throw new TrackerCheckpointErrorV2(
      `Tracker binding '${filename}' requires an issue mapping.`,
      "tracker_binding_invalid",
    );
  }
  const issue = parsed["issue"];
  const idField = input.provider === "github" ? "number" : "iid";
  const issueNumber = issue[idField];
  const issueUrl = issue["url"];
  if (!isPositiveInteger(issueNumber) || typeof issueUrl !== "string" || !issueUrl.trim()) {
    throw new TrackerCheckpointErrorV2(
      `Tracker binding '${filename}' requires issue.${idField} and issue.url.`,
      "tracker_binding_invalid",
    );
  }
  return parseTrackerUrl(input.provider, issueUrl.trim(), issueNumber);
}

export async function syncLoopTrackerCheckpointV2(
  input: LoopTrackerCheckpointInputV2,
): Promise<LoopTrackerCheckpointResultV2> {
  const binding = input.state.tracking.binding;
  if (binding === null) {
    throw new TrackerCheckpointErrorV2(
      "This loop run has no tracker binding; sync-tracker is not required.",
      "tracker_binding_invalid",
    );
  }
  if (input.group.commit.revision === null) {
    throw new TrackerCheckpointErrorV2(
      "Tracker checkpoint requires an acknowledged Task Group commit.",
      "tracker_binding_invalid",
    );
  }
  const marker = trackerCheckpointMarkerV2(input.state, input.group);
  const runner = input.runner ?? new NodeCommandRunner();
  const issue = await readIssue(binding, input.projectRoot, runner);
  if (issue.comments.some((comment) => comment.includes(marker))) {
    return { marker, alreadyPresent: true };
  }

  const description = updateTrackerDashboardV2(issue.description, input.group.ordinal);
  await moveIssueToInProgress(binding, input.projectRoot, issue.labels, runner);
  await updateIssue(binding, input.projectRoot, description, runner);
  await addCheckpointNote(binding, input.projectRoot, checkpointComment(input.group, marker), runner);
  return { marker, alreadyPresent: false };
}

/** A stable remote idempotency key for one run/group/commit checkpoint. */
export function trackerCheckpointMarkerV2(
  state: Pick<LoopStateV2, "runId">,
  group: Pick<LoopGroupStateV2, "id" | "commit">,
): string {
  const revision = group.commit.revision;
  if (!revision) throw new TrackerCheckpointErrorV2(
    "Tracker checkpoint requires a commit revision.",
    "tracker_binding_invalid",
  );
  return "<!-- corgispec:loop-checkpoint:v1 " +
    `run=${encodeURIComponent(state.runId)} ` +
    `group=${encodeURIComponent(group.id)} ` +
    `commit=${encodeURIComponent(revision)} -->`;
}

/** Replace only one managed dashboard block, preserving every other Issue byte. */
export function updateTrackerDashboardV2(description: string, groupOrdinal: number): string {
  const starts = indicesOf(description, DASHBOARD_START);
  const ends = indicesOf(description, DASHBOARD_END);
  if (starts.length !== 1 || ends.length !== 1 || starts[0]! >= ends[0]!) {
    throw new TrackerCheckpointErrorV2(
      "Issue description must contain exactly one ordered CorgiSpec task dashboard marker pair.",
      "tracker_dashboard_invalid",
    );
  }
  const start = starts[0]! + DASHBOARD_START.length;
  const end = ends[0]!;
  const updated = updateDashboardBlock(description.slice(start, end), groupOrdinal);
  return `${description.slice(0, start)}${updated}${description.slice(end)}`;
}

function updateDashboardBlock(block: string, groupOrdinal: number): string {
  const row = new RegExp(
    `^(\\|\\s*${groupOrdinal}\\s*\\|\\s*[^|\\n]+\\|\\s*)(?:pending|in_progress|in-progress|review|done)(\\s*\\|\\s*)$`,
    "gmu",
  );
  const rows = [...block.matchAll(row)];
  if (rows.length !== 1) {
    throw new TrackerCheckpointErrorV2(
      `Task dashboard must contain exactly one row for Group ${groupOrdinal}.`,
      "tracker_dashboard_invalid",
    );
  }
  let updated = block.replace(row, "$1done$2");

  const heading = new RegExp(`^### Group ${groupOrdinal}:.*$`, "gmu");
  const headings = [...updated.matchAll(heading)];
  if (headings.length !== 1 || headings[0]!.index === undefined) {
    throw new TrackerCheckpointErrorV2(
      `Task dashboard must contain exactly one section for Group ${groupOrdinal}.`,
      "tracker_dashboard_invalid",
    );
  }
  const sectionStart = headings[0]!.index + headings[0]![0].length;
  const following = updated.slice(sectionStart).match(/^### Group \d+:/mu);
  const sectionEnd = following?.index === undefined
    ? updated.length
    : sectionStart + following.index;
  const section = updated.slice(sectionStart, sectionEnd);
  const completed = section.replace(
    /^(\s*[-*]\s+\[)[ xX](\]\s+\d+(?:\.[0-9A-Za-z_-]+)+\s+.+)$/gmu,
    "$1x$2",
  );
  updated = `${updated.slice(0, sectionStart)}${completed}${updated.slice(sectionEnd)}`;

  const tasks = [...updated.matchAll(
    /^\s*[-*]\s+\[([ xX])\]\s+\d+(?:\.[0-9A-Za-z_-]+)+\s+.+$/gmu,
  )];
  if (tasks.length === 0) {
    throw new TrackerCheckpointErrorV2(
      "Task dashboard contains no numbered checkbox tasks.",
      "tracker_dashboard_invalid",
    );
  }
  const rowsAfter = [...updated.matchAll(
    /^\|\s*\d+\s*\|\s*[^|\n]+\|\s*(pending|in_progress|in-progress|review|done)\s*\|\s*$/gmu,
  )];
  if (rowsAfter.length === 0) {
    throw new TrackerCheckpointErrorV2(
      "Task dashboard contains no Group status rows.",
      "tracker_dashboard_invalid",
    );
  }
  const completedTasks = tasks.filter((task) => task[1]!.toLowerCase() === "x").length;
  const completedGroups = rowsAfter.filter((entry) => entry[1] === "done").length;
  const progress = /^\*\*Progress:\*\*\s+\d+\/\d+\s+tasks complete\s+·\s+\d+\/\d+\s+groups\s+(?:approved|complete)[ \t]*$/gmu;
  const progressRows = [...updated.matchAll(progress)];
  if (progressRows.length !== 1) {
    throw new TrackerCheckpointErrorV2(
      "Task dashboard must contain exactly one Progress line.",
      "tracker_dashboard_invalid",
    );
  }
  return updated.replace(
    progress,
    `**Progress:** ${completedTasks}/${tasks.length} tasks complete · ${completedGroups}/${rowsAfter.length} groups complete`,
  );
}

function checkpointComment(group: LoopGroupStateV2, marker: string): string {
  return [
    `## Loop Checkpoint: Group ${group.ordinal}`,
    "",
    marker,
    "",
    `Task Group ${group.ordinal} was committed as \`${group.commit.revision}\` and its managed dashboard section was synchronized.`,
  ].join("\n");
}

async function readIssue(
  binding: LoopTrackerBindingV2,
  cwd: string,
  runner: CommandRunner,
): Promise<{ description: string; comments: string[]; labels: string[] }> {
  const args = binding.provider === "github"
    ? ["issue", "view", String(binding.issueNumber), "--repo", binding.repository, "--json", "body,comments,labels"]
    : ["issue", "view", String(binding.issueNumber), "--repo", binding.repository, "--comments", "--output", "json"];
  const result = await runTrackerCommand(binding.provider === "github" ? "gh" : "glab", args, cwd, runner);
  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout);
  } catch (error) {
    throw new TrackerCheckpointErrorV2(
      `Tracker issue view returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      "tracker_response_invalid",
    );
  }
  if (!isRecord(payload)) {
    throw new TrackerCheckpointErrorV2("Tracker issue view returned a non-object JSON response.", "tracker_response_invalid");
  }
  const description = binding.provider === "github" ? payload["body"] : payload["description"];
  const comments = binding.provider === "github" ? payload["comments"] : payload["Notes"];
  const labels = labelNames(payload["labels"]);
  if (typeof description !== "string" || !Array.isArray(comments) || labels === null) {
    throw new TrackerCheckpointErrorV2("Tracker issue view response is missing its description, comments, or labels.", "tracker_response_invalid");
  }
  const bodies = comments.map((comment) => isRecord(comment) ? comment["body"] : undefined);
  if (bodies.some((body) => typeof body !== "string")) {
    throw new TrackerCheckpointErrorV2("Tracker issue comments must have string bodies.", "tracker_response_invalid");
  }
  return { description, comments: bodies as string[], labels };
}

async function moveIssueToInProgress(
  binding: LoopTrackerBindingV2,
  cwd: string,
  labels: string[],
  runner: CommandRunner,
): Promise<void> {
  const active = binding.provider === "github" ? "in-progress" : "workflow::in-progress";
  if (labels.includes(active)) return;
  const pending = binding.provider === "github"
    ? ["backlog", "todo"]
    : ["workflow::backlog", "workflow::todo"];
  const terminal = binding.provider === "github"
    ? ["review", "done"]
    : ["workflow::review", "workflow::done"];
  if (labels.some((label) => terminal.includes(label))) {
    throw new TrackerCheckpointErrorV2(
      `Issue is already in a terminal lifecycle state: ${labels.filter((label) => terminal.includes(label)).join(", ")}`,
      "tracker_lifecycle_invalid",
    );
  }
  const from = pending.find((label) => labels.includes(label));
  if (!from) return;
  const args = binding.provider === "github"
    ? ["issue", "edit", String(binding.issueNumber), "--repo", binding.repository, "--remove-label", from, "--add-label", active]
    : ["issue", "update", String(binding.issueNumber), "--repo", binding.repository, "--unlabel", from, "--label", active];
  await runTrackerCommand(binding.provider === "github" ? "gh" : "glab", args, cwd, runner);
}

async function updateIssue(
  binding: LoopTrackerBindingV2,
  cwd: string,
  description: string,
  runner: CommandRunner,
): Promise<void> {
  const args = binding.provider === "github"
    ? ["issue", "edit", String(binding.issueNumber), "--repo", binding.repository, "--body", description]
    : ["issue", "update", String(binding.issueNumber), "--repo", binding.repository, "--description", description];
  await runTrackerCommand(binding.provider === "github" ? "gh" : "glab", args, cwd, runner);
}

async function addCheckpointNote(
  binding: LoopTrackerBindingV2,
  cwd: string,
  message: string,
  runner: CommandRunner,
): Promise<void> {
  const args = binding.provider === "github"
    ? ["issue", "comment", String(binding.issueNumber), "--repo", binding.repository, "--body", message]
    : ["issue", "note", String(binding.issueNumber), "--repo", binding.repository, "--message", message];
  await runTrackerCommand(binding.provider === "github" ? "gh" : "glab", args, cwd, runner);
}

async function runTrackerCommand(
  command: "gh" | "glab",
  args: string[],
  cwd: string,
  runner: CommandRunner,
) {
  let result;
  try {
    result = await runner.run({ command, args, cwd });
  } catch (error) {
    throw new TrackerCheckpointErrorV2(
      `Could not start ${command}: ${error instanceof Error ? error.message : String(error)}`,
      "tracker_command_failed",
    );
  }
  if (result.timedOut || result.exitCode !== 0) {
    throw new TrackerCheckpointErrorV2(
      `${command} ${args.slice(0, 2).join(" ")} failed${result.timedOut ? " (timed out)" : ""}: ${result.stderr.trim() || result.stdout.trim() || `exit ${String(result.exitCode)}`}`,
      "tracker_command_failed",
    );
  }
  return result;
}

function parseTrackerUrl(
  provider: LoopTrackerBindingV2["provider"],
  issueUrl: string,
  configuredNumber: number,
): LoopTrackerBindingV2 {
  let url: URL;
  try {
    url = new URL(issueUrl);
  } catch {
    throw new TrackerCheckpointErrorV2(`Tracker issue.url is not a URL: ${issueUrl}`, "tracker_binding_invalid");
  }
  if (provider === "github") {
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/u);
    if (!match || Number(match[3]) !== configuredNumber) {
      throw new TrackerCheckpointErrorV2("GitHub issue.url must match issue.number.", "tracker_binding_invalid");
    }
    return {
      provider,
      issueUrl,
      repository: url.host === "github.com" ? `${match[1]}/${match[2]}` : `${url.host}/${match[1]}/${match[2]}`,
      issueNumber: configuredNumber,
    };
  }
  const match = url.pathname.match(/^\/(.+)\/-\/issues\/(\d+)\/?$/u);
  if (!match || Number(match[2]) !== configuredNumber) {
    throw new TrackerCheckpointErrorV2("GitLab issue.url must match issue.iid.", "tracker_binding_invalid");
  }
  return {
    provider,
    issueUrl,
    repository: `${url.origin}/${match[1]}`,
    issueNumber: configuredNumber,
  };
}

function indicesOf(text: string, needle: string): number[] {
  const indices: number[] = [];
  let index = text.indexOf(needle);
  while (index !== -1) {
    indices.push(index);
    index = text.indexOf(needle, index + needle.length);
  }
  return indices;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function labelNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const names = value.map((label) => typeof label === "string"
    ? label
    : isRecord(label) ? label["name"] : undefined);
  return names.every((name) => typeof name === "string") ? names as string[] : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
