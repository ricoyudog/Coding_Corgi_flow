import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ArtifactHashV3, RunStateV3 } from "../src/lib/run-contract-v3.js";
import {
  flushPendingTrackerSyncV3,
  loadTrackerSyncIntentV3,
  syncTrackerStateV3,
  trackerSyncIntentPathV3,
} from "../src/lib/tracker-sync-v3.js";

type Provider = "github" | "gitlab";

interface FakeTrackerState {
  labels: string[];
  issue: {
    id: string;
    url: string;
    title: string;
    body: string;
    state: string;
    workflow: string | null;
  };
  calls: Array<{ command: string; args: string[]; stdin: string }>;
  failWorkflowOnce: boolean;
}

const HASH = `sha256:${"a".repeat(64)}` as ArtifactHashV3;
const sandboxes: string[] = [];

afterEach(() => {
  for (const sandbox of sandboxes.splice(0)) rmSync(sandbox, { recursive: true, force: true });
});

describe.sequential("CommandTrackerClient provider adapters", () => {
  it.each(["github", "gitlab"] as const)(
    "executes the %s CLI and resumes a durable tracker outbox after a remote failure",
    async (provider) => {
      await withFakeTracker(provider, async ({ root, statePath }) => {
        const state = runState(provider);

        await expect(syncTrackerStateV3(root, state)).rejects.toMatchObject({
          code: "TRACKER_COMMAND_FAILED",
        });

        const mirrorPath = trackerSyncIntentPathV3(
          root,
          state.changeName,
          state.runId,
          state.stateRevision,
          false,
        );
        expect(loadTrackerSyncIntentV3(mirrorPath).status).toBe("pending");

        await expect(flushPendingTrackerSyncV3(root, state.changeName)).resolves.toEqual([
          expect.objectContaining({ status: "complete" }),
        ]);
        expect(loadTrackerSyncIntentV3(mirrorPath).status).toBe("complete");

        await expect(syncTrackerStateV3(root, state, {}, {
          close: true,
          workflowState: "done",
        })).resolves.toMatchObject({ status: "complete", close: true });
        await expect(syncTrackerStateV3(root, state, {}, {
          close: true,
          workflowState: "done",
        })).resolves.toMatchObject({ status: "complete", close: true });

        const fake = readFakeState(statePath);
        expect(fake.calls).not.toHaveLength(0);
        expect(fake.calls.every((call) => call.command === (provider === "github" ? "gh" : "glab"))).toBe(true);
        const workflowUpdates = fake.calls.filter((call) => isWorkflowUpdate(provider, call.args));
        expect(workflowUpdates.map((call) => workflowLabel(provider, call.args))).toEqual([
          workflowName(provider, "review"),
          workflowName(provider, "review"),
          workflowName(provider, "done"),
        ]);
        expect(fake.calls.filter((call) => isBodyUpdate(provider, call.args))).toHaveLength(1);
        expect(fake.calls.filter((call) => call.args[0] === "issue" && call.args[1] === "close"))
          .toHaveLength(1);
        expect(fake.issue.workflow).toBe(workflowName(provider, "done"));
        expect(fake.issue.state.toLowerCase()).toBe("closed");
        expect(fake.issue.body).toContain("Human-owned preface");
        expect(fake.issue.body).toContain("Human-owned suffix");
        expect(fake.issue.body).toContain("<!-- corgispec:task-dashboard:start -->");
      });
    },
  );
});

function runState(provider: Provider): RunStateV3 {
  const issue = provider === "github"
    ? { id: "42", url: "https://github.example.test/acme/widgets/issues/42" }
    : { id: "17", url: "https://gitlab.example.test/acme/widgets/-/issues/17" };
  return {
    schemaVersion: 3,
    changeName: "adapter-change",
    runId: "run-adapter",
    supersedesRunId: null,
    owner: { id: "agent", kind: "agent" },
    sessionId: "session-adapter",
    stateRevision: 3,
    nonce: "nonce-3",
    lastEventSeq: 3,
    phase: "awaiting_human_review",
    planningRevision: HASH,
    baselineRevision: "baseline",
    finalRevision: "implementation",
    currentGroupId: null,
    contract: {
      kind: "rfc-slice",
      deliveryRef: "RFC-0002-adapter/S-01-provider",
      rfcId: "RFC-0002-adapter",
      rfcDigest: HASH,
      acceptedCommit: "accepted",
      sliceId: "S-01-provider",
      sourcePath: "openspec/changes/adapter-change/corgi/source.yaml",
      sourceDigest: HASH,
      traceabilityPath: "openspec/changes/adapter-change/corgi/traceability.yaml",
      traceabilityDigest: HASH,
      acceptance: [{ id: "AC-001", evidence: "automated", taskGroups: ["1"] }],
      tracker: {
        provider,
        idempotencyKey: "adapter-key",
        issue,
      },
    },
    groups: {
      "1": {
        id: "1",
        ordinal: 1,
        fingerprint: HASH,
        status: "completed",
        commitRevision: "implementation",
        commitTree: "tree",
        workspaceFingerprint: HASH,
        evidenceHash: HASH,
        trackerCheckpoint: "<!-- corgispec:checkpoint:v3 run=run-adapter group=1 key=test -->",
        completedAt: "2026-08-14T00:00:01.000Z",
      },
    },
    verify: null,
    review: null,
    qa: null,
    repair: null,
    archive: null,
    startedAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:03.000Z",
    completedAt: null,
  };
}

async function withFakeTracker(
  provider: Provider,
  run: (input: { root: string; statePath: string }) => Promise<void>,
): Promise<void> {
  const sandbox = mkdtempSync(resolve(tmpdir(), "corgispec-command-tracker-"));
  sandboxes.push(sandbox);
  const root = resolve(sandbox, "project");
  const bin = resolve(sandbox, "bin");
  const statePath = resolve(sandbox, "tracker.json");
  mkdirSync(root, { recursive: true });
  mkdirSync(bin, { recursive: true });
  writeFileSync(resolve(bin, provider === "github" ? "gh" : "glab"), FAKE_TRACKER_CLI, "utf8");
  chmodSync(resolve(bin, provider === "github" ? "gh" : "glab"), 0o755);
  writeFileSync(statePath, JSON.stringify(initialFakeState(provider)), "utf8");

  const previousPath = process.env.PATH;
  const previousState = process.env.CORGISPEC_TRACKER_FAKE_STATE;
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ""}`;
  process.env.CORGISPEC_TRACKER_FAKE_STATE = statePath;
  try {
    await run({ root, statePath });
  } finally {
    restoreEnvironment("PATH", previousPath);
    restoreEnvironment("CORGISPEC_TRACKER_FAKE_STATE", previousState);
  }
}

function initialFakeState(provider: Provider): FakeTrackerState {
  const github = provider === "github";
  return {
    labels: github
      ? ["backlog", "todo", "in-progress", "review", "done"]
      : ["workflow::backlog", "workflow::todo", "workflow::in-progress", "workflow::review", "workflow::done"],
    issue: {
      id: github ? "42" : "17",
      url: github
        ? "https://github.example.test/acme/widgets/issues/42"
        : "https://gitlab.example.test/acme/widgets/-/issues/17",
      title: "Provider adapter",
      body: [
        "Human-owned preface",
        "",
        "<!-- corgispec:task-dashboard:start -->",
        "## Task Dashboard",
        "",
        "0/1 tasks complete · 0/1 groups approved",
        "",
        "| Group | Name | Status | Tasks |",
        "|---:|---|---|---:|",
        "| 1 | Provider adapter | pending | 0/1 |",
        "",
        "### Group 1: Provider adapter",
        "- [ ] 1.1 synchronize",
        "<!-- corgispec:task-dashboard:end -->",
        "",
        "Human-owned suffix",
      ].join("\n"),
      state: github ? "OPEN" : "opened",
      workflow: null,
    },
    calls: [],
    failWorkflowOnce: true,
  };
}

function readFakeState(path: string): FakeTrackerState {
  return JSON.parse(readFileSync(path, "utf8")) as FakeTrackerState;
}

function isBodyUpdate(provider: Provider, args: string[]): boolean {
  return provider === "github"
    ? args[0] === "issue" && args[1] === "edit" && args.includes("--body-file")
    : args[0] === "issue" && args[1] === "update" && args.includes("--description");
}

function isWorkflowUpdate(provider: Provider, args: string[]): boolean {
  return provider === "github"
    ? args[0] === "issue" && args[1] === "edit" && args.includes("--add-label")
    : args[0] === "issue" && args[1] === "update" && args.includes("--label");
}

function workflowLabel(provider: Provider, args: string[]): string | undefined {
  const flag = provider === "github" ? "--add-label" : "--label";
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function workflowName(provider: Provider, state: "review" | "done"): string {
  return provider === "github" ? state : `workflow::${state}`;
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const FAKE_TRACKER_CLI = String.raw`#!/usr/bin/env node
const fs = require("node:fs");

const statePath = process.env.CORGISPEC_TRACKER_FAKE_STATE;
if (!statePath) throw new Error("CORGISPEC_TRACKER_FAKE_STATE is required");
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const command = process.argv[1].split("/").pop();
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, "utf8");
state.calls.push({ command, args, stdin });

function save() {
  fs.writeFileSync(statePath, JSON.stringify(state));
}

function output(value) {
  save();
  process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
}

function fail(message) {
  save();
  process.stderr.write(message + "\\n");
  process.exit(1);
}

function option(name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function issuePayload() {
  if (command === "gh") {
    return {
      number: Number(state.issue.id),
      url: state.issue.url,
      title: state.issue.title,
      body: state.issue.body,
      state: state.issue.state,
    };
  }
  return {
    iid: Number(state.issue.id),
    web_url: state.issue.url,
    title: state.issue.title,
    description: state.issue.body,
    state: state.issue.state,
  };
}

if (args[0] === "label" && args[1] === "list") {
  output(state.labels.map((name) => ({ name })));
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "view") {
  output(issuePayload());
  process.exit(0);
}

const githubEdit = command === "gh" && args[0] === "issue" && args[1] === "edit";
const gitlabUpdate = command === "glab" && args[0] === "issue" && args[1] === "update";
if (githubEdit || gitlabUpdate) {
  const body = command === "gh" ? (args.includes("--body-file") ? stdin : undefined) : option("--description");
  if (body !== undefined) state.issue.body = body;
  const workflow = command === "gh" ? option("--add-label") : option("--label");
  if (workflow !== undefined) {
    if (state.failWorkflowOnce) {
      state.failWorkflowOnce = false;
      fail("planned fake provider outage");
    }
    state.issue.workflow = workflow;
  }
  output("");
  process.exit(0);
}

if (args[0] === "issue" && args[1] === "close") {
  state.issue.state = command === "gh" ? "CLOSED" : "closed";
  output("");
  process.exit(0);
}

fail("Unsupported fake " + command + " command: " + args.join(" "));
`;
