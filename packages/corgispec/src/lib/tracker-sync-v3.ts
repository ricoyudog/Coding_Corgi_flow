import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { digestValue, type TrackerBinding } from "./change-contract.js";
import {
  trackerDashboardSnapshotV3,
  updateIssueDashboardFromRun,
  type TrackerDashboardSnapshotV3,
} from "./issue-dashboard.js";
import { LoopStoreV3 } from "./loop-store-v3.js";
import type { RunStateV3 } from "./run-contract-v3.js";
import {
  createTrackerClient,
  type TrackerClient,
  type TrackerIssue,
  type TrackerWorkflowState,
} from "./tracker.js";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export interface TrackerSyncIntentV3 {
  schemaVersion: 3;
  operation: "tracker-sync";
  key: string;
  changeName: string;
  runId: string;
  stateRevision: number;
  binding: TrackerBinding & { provider: "github" | "gitlab"; issue: { id: string; url: string } };
  workflowState: TrackerWorkflowState;
  dashboard: TrackerDashboardSnapshotV3;
  close: boolean;
  status: "pending" | "complete";
  updatedAt: string;
}

export interface TrackerSyncV3Dependencies {
  createTracker?: (provider: "github" | "gitlab", cwd: string) => TrackerClient;
  createStore?: (projectRoot: string) => LoopStoreV3;
  trackerNow?: () => string;
}

export class TrackerSyncV3Error extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "TrackerSyncV3Error";
  }
}

export function trackerWorkflowStateForRunV3(state: RunStateV3): TrackerWorkflowState {
  if (["repair_required", "invalidated", "corrupted"].includes(state.phase)) {
    return state.repair?.kind === "rfc_amendment" ? "review" : "in-progress";
  }
  if (state.phase === "archived") return "done";
  if (["awaiting_human_review", "awaiting_human_qa", "ready_for_archive", "archiving"].includes(state.phase)) {
    return "review";
  }
  if (state.phase === "planning_ready") return state.supersedesRunId ? "in-progress" : "todo";
  return "in-progress";
}

export function trackerSyncIntentPathV3(
  projectRoot: string,
  changeName: string,
  runId: string,
  stateRevision: number,
  close: boolean,
): string {
  assertSegment(changeName, "change name");
  assertSegment(runId, "run id");
  if (!Number.isSafeInteger(stateRevision) || stateRevision < 0) {
    throw new TrackerSyncV3Error("Tracker state revision is invalid", "TRACKER_INTENT_PATH_INVALID");
  }
  return resolve(
    projectRoot,
    ".corgi",
    "loop",
    changeName,
    "tracker-outbox",
    runId,
    `${String(stateRevision)}-${close ? "close" : "mirror"}.json`,
  );
}

export function enqueueTrackerSyncV3(
  projectRoot: string,
  state: RunStateV3,
  options: { close?: boolean; workflowState?: TrackerWorkflowState } = {},
  dependencies: TrackerSyncV3Dependencies = {},
): TrackerSyncIntentV3 | null {
  if (state.contract.tracker.provider === "none") return null;
  const binding = trackedBinding(state.contract.tracker);
  const close = options.close ?? state.phase === "archived";
  const workflowState = options.workflowState ?? trackerWorkflowStateForRunV3(state);
  const stable = {
    schemaVersion: 3 as const,
    operation: "tracker-sync" as const,
    changeName: state.changeName,
    runId: state.runId,
    stateRevision: state.stateRevision,
    binding,
    workflowState,
    dashboard: trackerDashboardSnapshotV3(state),
    close,
  };
  const key = digestValue(stable);
  const path = trackerSyncIntentPathV3(
    projectRoot,
    state.changeName,
    state.runId,
    state.stateRevision,
    close,
  );
  if (existsSync(path)) {
    const existing = loadTrackerSyncIntentV3(path);
    if (existing.key !== key) {
      throw new TrackerSyncV3Error(
        `Tracker intent '${path}' already contains different state`,
        "TRACKER_INTENT_CONFLICT",
      );
    }
    return existing;
  }
  const intent: TrackerSyncIntentV3 = {
    ...stable,
    key,
    status: "pending",
    updatedAt: now(dependencies),
  };
  atomicWrite(path, intent);
  return intent;
}

export async function flushTrackerSyncIntentV3(
  projectRoot: string,
  intent: TrackerSyncIntentV3,
  dependencies: TrackerSyncV3Dependencies = {},
): Promise<TrackerSyncIntentV3> {
  const path = trackerSyncIntentPathV3(
    projectRoot,
    intent.changeName,
    intent.runId,
    intent.stateRevision,
    intent.close,
  );
  const current = existsSync(path) ? loadTrackerSyncIntentV3(path) : intent;
  if (current.key !== intent.key) {
    throw new TrackerSyncV3Error("Tracker intent changed before flush", "TRACKER_INTENT_CONFLICT");
  }
  if (current.status === "complete") return current;
  const createTracker = dependencies.createTracker ?? ((provider: "github" | "gitlab", cwd: string) => {
    const client = createTrackerClient(provider, cwd);
    if (!client) throw new TrackerSyncV3Error("Tracker client is required", "TRACKER_CLIENT_REQUIRED");
    return client;
  });
  const client = createTracker(current.binding.provider, resolve(projectRoot));
  const boundIssue = trackerIssue(current.binding);
  const issue = await client.getIssue(boundIssue);
  const body = updateIssueDashboardFromRun(issue.body, current.dashboard);
  if (body !== issue.body) await client.updateBody(issue, body);
  await client.setState(issue, current.workflowState);
  if (current.close) await client.close(issue);
  const completed: TrackerSyncIntentV3 = {
    ...current,
    status: "complete",
    updatedAt: now(dependencies),
  };
  atomicWrite(path, completed);
  return completed;
}

export async function syncTrackerStateV3(
  projectRoot: string,
  state: RunStateV3,
  dependencies: TrackerSyncV3Dependencies = {},
  options: { close?: boolean; workflowState?: TrackerWorkflowState } = {},
): Promise<TrackerSyncIntentV3 | null> {
  const intent = enqueueTrackerSyncV3(projectRoot, state, options, dependencies);
  return intent ? await flushTrackerSyncIntentV3(projectRoot, intent, dependencies) : null;
}

export async function flushPendingTrackerSyncV3(
  projectRoot: string,
  changeName: string,
  dependencies: TrackerSyncV3Dependencies = {},
): Promise<TrackerSyncIntentV3[]> {
  assertSegment(changeName, "change name");
  const root = resolve(projectRoot, ".corgi", "loop", changeName, "tracker-outbox");
  if (!existsSync(root)) return [];
  const pending = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const runRoot = resolve(root, entry.name);
      return readdirSync(runRoot, { withFileTypes: true })
        .filter((file) => file.isFile() && file.name.endsWith(".json"))
        .map((file) => loadTrackerSyncIntentV3(resolve(runRoot, file.name)));
    })
    .filter((intent) => intent.status === "pending")
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)
      || left.stateRevision - right.stateRevision);
  const completed: TrackerSyncIntentV3[] = [];
  for (const intent of pending) {
    completed.push(await flushTrackerSyncIntentV3(projectRoot, intent, dependencies));
  }
  return completed;
}

/** Recover any missed post-transition enqueue, then make the current Run state visible remotely. */
export async function reconcileCurrentTrackerStateV3(
  projectRoot: string,
  changeName: string,
  dependencies: TrackerSyncV3Dependencies = {},
): Promise<TrackerSyncIntentV3 | null> {
  await flushPendingTrackerSyncV3(projectRoot, changeName, dependencies);
  const state = (dependencies.createStore?.(projectRoot) ?? new LoopStoreV3(projectRoot))
    .inspect(changeName).state;
  if (!state) return null;
  const closePath = trackerSyncIntentPathV3(
    projectRoot,
    state.changeName,
    state.runId,
    state.stateRevision,
    true,
  );
  if (existsSync(closePath)) {
    const closeIntent = loadTrackerSyncIntentV3(closePath);
    if (closeIntent.status === "complete") return closeIntent;
  }
  return await syncTrackerStateV3(projectRoot, state, dependencies);
}

export function loadTrackerSyncIntentV3(path: string): TrackerSyncIntentV3 {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new TrackerSyncV3Error(
      `Could not read tracker intent '${path}': ${error instanceof Error ? error.message : String(error)}`,
      "TRACKER_INTENT_CORRUPT",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw corrupt(path);
  const intent = value as TrackerSyncIntentV3;
  if (
    intent.schemaVersion !== 3
    || intent.operation !== "tracker-sync"
    || typeof intent.key !== "string"
    || typeof intent.changeName !== "string"
    || typeof intent.runId !== "string"
    || !Number.isSafeInteger(intent.stateRevision)
    || !["pending", "complete"].includes(intent.status)
    || !["backlog", "todo", "in-progress", "review", "done"].includes(intent.workflowState)
    || typeof intent.close !== "boolean"
    || !intent.dashboard
    || typeof intent.dashboard.sourceMarker !== "string"
    || !intent.dashboard.sourceMarker.startsWith("<!-- corgispec:")
    || !Array.isArray(intent.dashboard.groups)
    || !["github", "gitlab"].includes(intent.binding?.provider)
    || !intent.binding.issue?.id
    || !intent.binding.issue.url
  ) {
    throw corrupt(path);
  }
  return intent;
}

function trackedBinding(binding: TrackerBinding): TrackerSyncIntentV3["binding"] {
  if (binding.provider === "none" || !binding.issue) {
    throw new TrackerSyncV3Error("Tracked Run Contract requires one Issue binding", "TRACKER_ISSUE_REQUIRED");
  }
  return structuredClone(binding) as TrackerSyncIntentV3["binding"];
}

function trackerIssue(binding: TrackerSyncIntentV3["binding"]): TrackerIssue {
  return {
    id: binding.issue.id,
    url: binding.issue.url,
    title: "",
    body: "",
  };
}

function assertSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") {
    throw new TrackerSyncV3Error(`Unsafe ${label}: '${value}'`, "TRACKER_INTENT_PATH_INVALID");
  }
}

function atomicWrite(path: string, value: TrackerSyncIntentV3): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function now(dependencies: TrackerSyncV3Dependencies): string {
  return dependencies.trackerNow?.() ?? new Date().toISOString();
}

function corrupt(path: string): TrackerSyncV3Error {
  return new TrackerSyncV3Error(`Tracker intent '${path}' is invalid`, "TRACKER_INTENT_CORRUPT");
}
