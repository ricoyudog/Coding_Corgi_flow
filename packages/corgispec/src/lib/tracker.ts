import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import type { TrackerBinding } from "./change-contract.js";
import type { TrackingProvider } from "./config.js";
import {
  NodeCommandRunner,
  type CommandResult,
  type CommandRunner,
} from "./openspec-runtime.js";

export type TrackerWorkflowState =
  | "backlog"
  | "todo"
  | "in-progress"
  | "review"
  | "done";

const WORKFLOW_LABELS: ReadonlyArray<{
  state: TrackerWorkflowState;
  color: string;
  description: string;
}> = [
  { state: "backlog", color: "6A737D", description: "CorgiSpec work awaiting planning" },
  { state: "todo", color: "0366D6", description: "CorgiSpec work ready to apply" },
  { state: "in-progress", color: "FBCA04", description: "CorgiSpec work being implemented" },
  { state: "review", color: "8A2BE2", description: "CorgiSpec work awaiting review" },
  { state: "done", color: "2DA44E", description: "CorgiSpec work archived" },
];

export interface TrackerIssue {
  id: string;
  url: string;
  title: string;
  body: string;
}

export interface CreateTrackerIssueInput {
  title: string;
  body: string;
  marker: string;
}

export interface TrackerClient {
  readonly provider: TrackingProvider;
  findByMarker(marker: string): Promise<TrackerIssue[]>;
  getIssue(issue: TrackerIssue): Promise<TrackerIssue>;
  createIssue(input: CreateTrackerIssueInput): Promise<TrackerIssue>;
  setState(issue: TrackerIssue, state: TrackerWorkflowState): Promise<void>;
  updateBody(issue: TrackerIssue, body: string): Promise<void>;
  comment(issue: TrackerIssue, body: string): Promise<void>;
  close(issue: TrackerIssue): Promise<void>;
}

export class TrackerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "TrackerError";
  }
}

export class CommandTrackerClient implements TrackerClient {
  private workflowLabelsReady: Promise<void> | null = null;

  constructor(
    public readonly provider: Exclude<TrackingProvider, "none">,
    private readonly cwd: string,
    private readonly runner: CommandRunner = new NodeCommandRunner(),
  ) {}

  async findByMarker(marker: string): Promise<TrackerIssue[]> {
    const result = this.provider === "github"
      ? await this.run("gh", ["issue", "list", "--state", "all", "--search", marker,
          "--json", "number,url,title,body"])
      : await this.run("glab", ["issue", "list", "--all", "--search", marker, "--output", "json"]);
    const parsed = parseJsonArray(result.stdout, this.provider);
    return parsed
      .map((value) => normalizeIssue(value))
      .filter((issue): issue is TrackerIssue => issue !== null && issue.body.includes(marker));
  }

  async getIssue(issue: TrackerIssue): Promise<TrackerIssue> {
    const result = this.provider === "github"
      ? await this.run("gh", ["issue", "view", issue.id, "--json", "number,url,title,body"])
      : await this.run("glab", ["issue", "view", issue.id, "--output", "json"]);
    const parsed = normalizeIssue(parseJsonObject(result.stdout, this.provider));
    if (!parsed || parsed.id !== issue.id) {
      throw new TrackerError("Tracker issue view did not match the bound Issue", "TRACKER_INVALID_OUTPUT", {
        provider: this.provider,
        issueId: issue.id,
      });
    }
    return parsed;
  }

  async createIssue(input: CreateTrackerIssueInput): Promise<TrackerIssue> {
    await this.ensureWorkflowLabels();
    const result = this.provider === "github"
      ? await this.run(
          "gh",
          ["issue", "create", "--title", input.title, "--body-file", "-", "--label", "backlog"],
          input.body,
        )
      : await this.run("glab", [
          "issue", "create", "--title", input.title, "--description", input.body,
          "--label", "workflow::backlog", "--yes",
        ]);
    const url = extractUrl(result.stdout);
    const id = url.split("/").filter(Boolean).at(-1);
    if (!id) {
      throw new TrackerError("Tracker create output did not contain an issue id", "TRACKER_INVALID_OUTPUT", {
        provider: this.provider,
        stdout: result.stdout,
      });
    }
    return { id, url, title: input.title, body: input.body };
  }

  async setState(issue: TrackerIssue, state: TrackerWorkflowState): Promise<void> {
    await this.ensureWorkflowLabels();
    if (this.provider === "github") {
      await this.run("gh", [
        "issue", "edit", issue.id,
        "--remove-label", "backlog,todo,in-progress,review,done",
        "--add-label", state,
      ]);
      return;
    }
    await this.run("glab", [
      "issue", "update", issue.id,
      "--unlabel", "workflow::backlog,workflow::todo,workflow::in-progress,workflow::review,workflow::done",
      "--label", `workflow::${state}`,
    ]);
  }

  async updateBody(issue: TrackerIssue, body: string): Promise<void> {
    await this.ensureWorkflowLabels();
    if (this.provider === "github") {
      await this.run("gh", ["issue", "edit", issue.id, "--body-file", "-"], body);
      return;
    }
    await this.run("glab", ["issue", "update", issue.id, "--description", body]);
  }

  async comment(issue: TrackerIssue, body: string): Promise<void> {
    await this.ensureWorkflowLabels();
    if (this.provider === "github") {
      await this.run("gh", ["issue", "comment", issue.id, "--body-file", "-"], body);
      return;
    }
    await this.run("glab", ["issue", "note", issue.id, "--message", body]);
  }

  async close(issue: TrackerIssue): Promise<void> {
    await this.ensureWorkflowLabels();
    const status = this.provider === "github"
      ? await this.run("gh", ["issue", "view", issue.id, "--json", "state"])
      : await this.run("glab", ["issue", "view", issue.id, "--output", "json"]);
    if (issueIsClosed(status.stdout, this.provider)) return;
    await this.run(this.provider === "github" ? "gh" : "glab", ["issue", "close", issue.id]);
  }

  private async ensureWorkflowLabels(): Promise<void> {
    if (!this.workflowLabelsReady) {
      this.workflowLabelsReady = this.ensureWorkflowLabelsOnce();
    }
    const pending = this.workflowLabelsReady;
    try {
      await pending;
    } catch (error) {
      if (this.workflowLabelsReady === pending) this.workflowLabelsReady = null;
      throw error;
    }
  }

  private async ensureWorkflowLabelsOnce(): Promise<void> {
    const existing = await this.listLabelNames();
    for (const label of WORKFLOW_LABELS) {
      const name = this.provider === "github" ? label.state : `workflow::${label.state}`;
      if (existing.has(name)) continue;
      try {
        if (this.provider === "github") {
          await this.run("gh", [
            "label", "create", name,
            "--color", label.color,
            "--description", label.description,
          ]);
        } else {
          await this.run("glab", [
            "label", "create",
            "--name", name,
            "--color", `#${label.color}`,
            "--description", label.description,
          ]);
        }
      } catch (error) {
        // Another process may have created the same label after our read-only
        // list. Reconcile by exact name before deciding the command failed.
        if (!(await this.listLabelNames()).has(name)) throw error;
      }
      existing.add(name);
    }
  }

  private async listLabelNames(): Promise<Set<string>> {
    if (this.provider === "github") {
      const result = await this.run("gh", ["label", "list", "--limit", "10000", "--json", "name"]);
      return labelNames(parseJsonArray(result.stdout, this.provider));
    }

    const names = new Set<string>();
    for (let page = 1; ; page += 1) {
      const result = await this.run("glab", [
        "label", "list", "--output", "json", "--per-page", "100", "--page", String(page),
      ]);
      const values = parseJsonArray(result.stdout, this.provider);
      for (const name of labelNames(values)) names.add(name);
      if (values.length < 100) return names;
    }
  }

  private async run(command: string, args: string[], stdin?: string): Promise<CommandResult> {
    let result: CommandResult;
    try {
      result = await this.runner.run({ command, args, cwd: this.cwd, stdin, timeoutMs: 30_000 });
    } catch (error) {
      throw new TrackerError(
        `Failed to start ${this.provider} tracker command: ${error instanceof Error ? error.message : String(error)}`,
        "TRACKER_COMMAND_FAILED",
        { provider: this.provider },
      );
    }
    if (result.timedOut) {
      throw new TrackerError("Tracker command timed out; reconcile by idempotency marker", "TRACKER_TIMEOUT", {
        provider: this.provider,
        args,
      });
    }
    if (result.exitCode !== 0) {
      throw new TrackerError(
        `${this.provider} tracker command failed: ${result.stderr.trim() || `exit ${String(result.exitCode)}`}`,
        "TRACKER_COMMAND_FAILED",
        { provider: this.provider, args, exitCode: result.exitCode },
      );
    }
    return result;
  }
}

export function createTrackerClient(
  provider: TrackingProvider,
  cwd: string,
  runner?: CommandRunner,
): TrackerClient | null {
  return provider === "none" ? null : new CommandTrackerClient(provider, cwd, runner);
}

/**
 * Complete the provider portion of Archive from the validated Change binding.
 * The done label and closed state are both idempotent, so a failed closeout can
 * retry without inventing a second Issue or advancing local archive state.
 */
export async function closeBoundTrackerIssue(
  binding: TrackerBinding,
  client: TrackerClient | null,
): Promise<void> {
  if (binding.provider === "none") return;
  if (!client) {
    throw new TrackerError("Tracked archive closeout requires a tracker client", "TRACKER_CLIENT_REQUIRED", {
      provider: binding.provider,
    });
  }
  if (client.provider !== binding.provider) {
    throw new TrackerError("Tracker client does not match the Change contract provider", "TRACKER_PROVIDER_MISMATCH", {
      expected: binding.provider,
      actual: client.provider,
    });
  }
  if (!binding.issue) {
    throw new TrackerError("Tracked Change contract is missing its Issue binding", "TRACKER_ISSUE_REQUIRED", {
      provider: binding.provider,
    });
  }
  const issue: TrackerIssue = {
    id: binding.issue.id,
    url: binding.issue.url,
    title: "",
    body: "",
  };
  await client.setState(issue, "done");
  await client.close(issue);
}

export async function createOrRecoverIssue(
  client: TrackerClient,
  input: CreateTrackerIssueInput,
): Promise<{ issue: TrackerIssue; recovered: boolean }> {
  const matches = await client.findByMarker(input.marker);
  if (matches.length > 1) {
    throw new TrackerError(
      `Multiple issues contain the exact Corgi marker '${input.marker}'`,
      "TRACKER_DUPLICATE_MARKER",
      { issues: matches.map((issue) => issue.url) },
    );
  }
  if (matches.length === 1) return { issue: matches[0]!, recovered: true };
  try {
    return { issue: await client.createIssue(input), recovered: false };
  } catch (error) {
    if (!(error instanceof TrackerError) || error.code !== "TRACKER_TIMEOUT") throw error;
    const afterTimeout = await client.findByMarker(input.marker);
    if (afterTimeout.length === 1) return { issue: afterTimeout[0]!, recovered: true };
    if (afterTimeout.length > 1) {
      throw new TrackerError(
        "Tracker create timed out and reconciliation found duplicate issues",
        "TRACKER_DUPLICATE_MARKER",
        { issues: afterTimeout.map((issue) => issue.url) },
      );
    }
    throw error;
  }
}

export function featureIssueMarker(input: {
  repository: string;
  deliveryRef: string;
  rfcDigest: string;
}): { key: string; marker: string } {
  const key = createHash("sha256")
    .update(`${input.repository}\0${input.rfcDigest}\0${input.deliveryRef}`)
    .digest("hex");
  return {
    key,
    marker: `<!-- corgispec:feature:v1 key=${key} delivery=${input.deliveryRef} -->`,
  };
}

export function maintenanceIssueMarker(input: {
  repository: string;
  changeName: string;
  description: string;
}): { key: string; marker: string } {
  const key = createHash("sha256")
    .update(`${input.repository}\0${input.changeName}\0${input.description}`)
    .digest("hex");
  return {
    key,
    marker: `<!-- corgispec:maintenance:v1 key=${key} change=${input.changeName} -->`,
  };
}

export function taskGroupTrackerCheckpoint(input: {
  idempotencyKey: string;
  runId: string;
  groupId: string;
  commitRevision: string;
  evidenceHash: string;
}): string {
  const key = createHash("sha256")
    .update([
      input.idempotencyKey,
      input.runId,
      input.groupId,
      input.commitRevision,
      input.evidenceHash,
    ].join("\0"))
    .digest("hex");
  return `<!-- corgispec:checkpoint:v3 run=${input.runId} group=${input.groupId} key=${key} -->`;
}

export function repositoryIdentity(cwd: string): string {
  const remote = spawnSync("git", ["config", "--get", "remote.origin.url"], {
    cwd,
    encoding: "utf8",
    timeout: 5_000,
  });
  if (!remote.error && remote.status === 0 && remote.stdout.trim()) return remote.stdout.trim();
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
    timeout: 5_000,
  });
  return !top.error && top.status === 0 && top.stdout.trim() ? top.stdout.trim() : cwd;
}

function parseJsonArray(content: string, provider: string): Record<string, unknown>[] {
  try {
    const value: unknown = JSON.parse(content);
    if (!Array.isArray(value)) throw new Error("expected an array");
    return value.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item));
  } catch (error) {
    throw new TrackerError(
      `Failed to parse ${provider} issue list: ${error instanceof Error ? error.message : String(error)}`,
      "TRACKER_INVALID_OUTPUT",
    );
  }
}

function parseJsonObject(content: string, provider: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected an object");
    return value as Record<string, unknown>;
  } catch (error) {
    throw new TrackerError(
      `Failed to parse ${provider} issue: ${error instanceof Error ? error.message : String(error)}`,
      "TRACKER_INVALID_OUTPUT",
    );
  }
}

function issueIsClosed(content: string, provider: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new TrackerError(
      `Failed to parse ${provider} issue state: ${error instanceof Error ? error.message : String(error)}`,
      "TRACKER_INVALID_OUTPUT",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TrackerError(`${provider} issue state was not an object`, "TRACKER_INVALID_OUTPUT");
  }
  const state = (value as Record<string, unknown>).state;
  if (typeof state !== "string" || !["open", "opened", "closed"].includes(state.toLowerCase())) {
    throw new TrackerError(`${provider} issue state was missing or invalid`, "TRACKER_INVALID_OUTPUT");
  }
  return state.toLowerCase() === "closed";
}

function normalizeIssue(value: Record<string, unknown>): TrackerIssue | null {
  const id = value.number ?? value.iid ?? value.id;
  const url = value.url ?? value.web_url ?? value.webUrl;
  const title = value.title;
  const body = value.body ?? value.description;
  if ((typeof id !== "string" && typeof id !== "number") || typeof url !== "string") return null;
  return {
    id: String(id),
    url,
    title: typeof title === "string" ? title : "",
    body: typeof body === "string" ? body : "",
  };
}

function labelNames(values: Record<string, unknown>[]): Set<string> {
  return new Set(values.flatMap((value) => typeof value.name === "string" ? [value.name] : []));
}

function extractUrl(content: string): string {
  const match = content.match(/https?:\/\/[^\s]+/);
  if (!match) {
    throw new TrackerError("Tracker create output did not contain an issue URL", "TRACKER_INVALID_OUTPUT", {
      stdout: content,
    });
  }
  return match[0]!.replace(/[),.;]+$/, "");
}
