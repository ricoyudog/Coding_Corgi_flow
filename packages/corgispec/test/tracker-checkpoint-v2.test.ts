import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "../src/lib/openspec-runtime.js";
import type {
  LoopGroupStateV2,
  LoopStateV2,
  LoopTrackerBindingV2,
  LoopTrackerProviderV2,
} from "../src/lib/run-contract-v2.js";
import {
  resolveLoopTrackerBindingV2,
  syncLoopTrackerCheckpointV2,
  trackerCheckpointMarkerV2,
} from "../src/lib/tracker-checkpoint-v2.js";

const cleanup: string[] = [];
const HASH = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;

afterEach(() => {
  for (const root of cleanup.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("loop tracker checkpoint clients", () => {
  it("uses gh view/edit/comment argv and only changes the current managed Group", async () => {
    const description = dashboardDescription();
    const binding = trackerBinding("github");
    const state = loopState(binding, "run/github");
    const group = completedGroup(2, "abc123");
    const marker = trackerCheckpointMarkerV2(state, group);
    const runner = new QueueRunner([
      result(JSON.stringify({ body: description, comments: [], labels: ["backlog"] })),
      result(),
      result(),
      result(),
    ]);

    await expect(syncLoopTrackerCheckpointV2({
      projectRoot: "/project/root",
      state,
      group,
      runner,
    })).resolves.toEqual({ marker, alreadyPresent: false });

    expect(requests(runner)).toEqual([
      {
        command: "gh",
        args: ["issue", "view", "42", "--repo", "acme/widgets", "--json", "body,comments,labels"],
        cwd: "/project/root",
      },
      {
        command: "gh",
        args: ["issue", "edit", "42", "--repo", "acme/widgets", "--remove-label", "backlog", "--add-label", "in-progress"],
        cwd: "/project/root",
      },
      {
        command: "gh",
        args: ["issue", "edit", "42", "--repo", "acme/widgets", "--body", updatedDashboardDescription()],
        cwd: "/project/root",
      },
      {
        command: "gh",
        args: [
          "issue",
          "comment",
          "42",
          "--repo",
          "acme/widgets",
          "--body",
          checkpointComment(2, "abc123", marker),
        ],
        cwd: "/project/root",
      },
    ]);
  });

  it("uses glab view/update/note argv and preserves content outside the dashboard", async () => {
    const description = dashboardDescription();
    const binding = trackerBinding("gitlab");
    const state = loopState(binding, "run/gitlab");
    const group = completedGroup(2, "def456");
    const marker = trackerCheckpointMarkerV2(state, group);
    const runner = new QueueRunner([
      result(JSON.stringify({ description, Notes: [], labels: ["workflow::backlog"] })),
      result(),
      result(),
      result(),
    ]);

    await expect(syncLoopTrackerCheckpointV2({
      projectRoot: "/project/root",
      state,
      group,
      runner,
    })).resolves.toEqual({ marker, alreadyPresent: false });

    expect(requests(runner)).toEqual([
      {
        command: "glab",
        args: [
          "issue",
          "view",
          "17",
          "--repo",
          "https://gitlab.example.test/team/platform/widget",
          "--comments",
          "--output",
          "json",
        ],
        cwd: "/project/root",
      },
      {
        command: "glab",
        args: [
          "issue",
          "update",
          "17",
          "--repo",
          "https://gitlab.example.test/team/platform/widget",
          "--unlabel",
          "workflow::backlog",
          "--label",
          "workflow::in-progress",
        ],
        cwd: "/project/root",
      },
      {
        command: "glab",
        args: [
          "issue",
          "update",
          "17",
          "--repo",
          "https://gitlab.example.test/team/platform/widget",
          "--description",
          updatedDashboardDescription(),
        ],
        cwd: "/project/root",
      },
      {
        command: "glab",
        args: [
          "issue",
          "note",
          "17",
          "--repo",
          "https://gitlab.example.test/team/platform/widget",
          "--message",
          checkpointComment(2, "def456", marker),
        ],
        cwd: "/project/root",
      },
    ]);
  });

  it.each([
    { provider: "github" as const, command: "gh", response: "body" as const },
    { provider: "gitlab" as const, command: "glab", response: "description" as const },
  ])("does not write again when the $provider Issue already has its checkpoint marker", async ({ provider, command, response }) => {
    const binding = trackerBinding(provider);
    const state = loopState(binding, `run/${provider}`);
    const group = completedGroup(2, "already-there");
    const marker = trackerCheckpointMarkerV2(state, group);
    const payload = provider === "github"
      ? { [response]: "This body deliberately has no dashboard.", comments: [{ body: marker }], labels: ["in-progress"] }
      : { [response]: "This description deliberately has no dashboard.", Notes: [{ body: marker }], labels: ["workflow::in-progress"] };
    const runner = new QueueRunner([result(JSON.stringify(payload))]);

    await expect(syncLoopTrackerCheckpointV2({
      projectRoot: "/project/root",
      state,
      group,
      runner,
    })).resolves.toEqual({ marker, alreadyPresent: true });

    expect(requests(runner)).toEqual([
      expect.objectContaining({
        command,
        args: expect.arrayContaining(["issue", "view", String(binding.issueNumber)]),
        cwd: "/project/root",
      }),
    ]);
  });

  it.each([
    "Description without dashboard markers.",
    `${dashboardDescription()}\n<!-- corgispec:task-dashboard:start -->`,
    [
      "Intro maintained by people.",
      "<!-- corgispec:task-dashboard:end -->",
      "<!-- corgispec:task-dashboard:start -->",
      "Footer maintained by people.",
    ].join("\n"),
  ])("rejects an invalid dashboard marker pair before issuing an update or note", async (description) => {
    const binding = trackerBinding("github");
    const state = loopState(binding, "run/invalid-dashboard");
    const group = completedGroup(2, "bad-dashboard");
    const runner = new QueueRunner([
      result(JSON.stringify({ body: description, comments: [], labels: ["backlog"] })),
    ]);

    await expect(syncLoopTrackerCheckpointV2({
      projectRoot: "/project/root",
      state,
      group,
      runner,
    })).rejects.toMatchObject({ code: "tracker_dashboard_invalid" });

    expect(requests(runner)).toEqual([
      {
        command: "gh",
        args: ["issue", "view", "42", "--repo", "acme/widgets", "--json", "body,comments,labels"],
        cwd: "/project/root",
      },
    ]);
  });

  it("refuses a completed lifecycle label before changing a tracked Issue", async () => {
    const binding = trackerBinding("gitlab");
    const state = loopState(binding, "run/reviewed");
    const group = completedGroup(2, "reviewed");
    const runner = new QueueRunner([
      result(JSON.stringify({
        description: dashboardDescription(),
        Notes: [],
        labels: ["workflow::review"],
      })),
    ]);

    await expect(syncLoopTrackerCheckpointV2({
      projectRoot: "/project/root",
      state,
      group,
      runner,
    })).rejects.toMatchObject({ code: "tracker_lifecycle_invalid" });
    expect(requests(runner)).toHaveLength(1);
  });
});

describe("loop tracker binding resolution", () => {
  it("parses GitHub and nested GitLab Issue URLs without consulting git remotes", async () => {
    const githubRoot = tempRoot("github-binding");
    writeFileSync(resolve(githubRoot, ".github.yaml"), [
      "issue:",
      "  number: 42",
      "  url: https://github.com/acme/widgets/issues/42",
      "",
    ].join("\n"));
    const gitlabRoot = tempRoot("gitlab-binding");
    writeFileSync(resolve(gitlabRoot, ".gitlab.yaml"), [
      "issue:",
      "  iid: 17",
      "  url: https://gitlab.example.test/team/platform/widget/-/issues/17",
      "",
    ].join("\n"));

    await expect(resolveLoopTrackerBindingV2({
      changeRoot: githubRoot,
      provider: "github",
    })).resolves.toEqual(trackerBinding("github"));
    await expect(resolveLoopTrackerBindingV2({
      changeRoot: gitlabRoot,
      provider: "gitlab",
    })).resolves.toEqual(trackerBinding("gitlab"));
  });

  it.each([
    {
      label: "legacy GitHub state",
      provider: "github" as const,
      filename: ".github.yaml",
      content: "parent: 1\ngroups: []\n",
    },
    {
      label: "legacy GitLab state",
      provider: "gitlab" as const,
      filename: ".gitlab.yaml",
      content: "parent: 1\ngroups: []\n",
    },
    {
      label: "GitHub URL with a mismatched Issue number",
      provider: "github" as const,
      filename: ".github.yaml",
      content: "issue:\n  number: 42\n  url: https://github.com/acme/widgets/issues/41\n",
    },
    {
      label: "GitLab URL without the canonical issue route",
      provider: "gitlab" as const,
      filename: ".gitlab.yaml",
      content: "issue:\n  iid: 17\n  url: https://gitlab.example.test/team/platform/widget/issues/17\n",
    },
  ])("rejects $label before a tracker command can be selected", async ({ provider, filename, content }) => {
    const root = tempRoot("invalid-binding");
    writeFileSync(resolve(root, filename), content);

    await expect(resolveLoopTrackerBindingV2({ changeRoot: root, provider })).rejects.toMatchObject({
      code: "tracker_binding_invalid",
    });
  });

  it("returns null for an absent binding and for the none provider", async () => {
    const root = tempRoot("absent-binding");

    await expect(resolveLoopTrackerBindingV2({ changeRoot: root, provider: "github" })).resolves.toBeNull();
    await expect(resolveLoopTrackerBindingV2({ changeRoot: root, provider: "none" })).resolves.toBeNull();
  });
});

class QueueRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  constructor(private readonly responses: CommandResult[]) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error(`Unexpected tracker command: ${request.command} ${request.args.join(" ")}`);
    return response;
  }
}

function requests(runner: QueueRunner): Array<Pick<CommandRequest, "command" | "args" | "cwd">> {
  return runner.requests.map(({ command, args, cwd }) => ({ command, args: [...args], cwd }));
}

function result(stdout = ""): CommandResult {
  return { exitCode: 0, signal: null, stdout, stderr: "", timedOut: false };
}

function trackerBinding(provider: LoopTrackerProviderV2): LoopTrackerBindingV2 {
  if (provider === "github") {
    return {
      provider,
      issueUrl: "https://github.com/acme/widgets/issues/42",
      repository: "acme/widgets",
      issueNumber: 42,
    };
  }
  return {
    provider,
    issueUrl: "https://gitlab.example.test/team/platform/widget/-/issues/17",
    repository: "https://gitlab.example.test/team/platform/widget",
    issueNumber: 17,
  };
}

function loopState(binding: LoopTrackerBindingV2, runId: string): LoopStateV2 {
  return {
    schemaVersion: 2,
    changeName: "tracker-checkpoint",
    runId,
    supersedesRunId: null,
    owner: { id: "agent-1", kind: "agent" },
    sessionId: "session-1",
    mode: "hook-driven",
    stateRevision: 3,
    nonce: "nonce-3",
    lastEventSeq: 3,
    phase: "awaiting_tracker_sync",
    currentGroupId: "2",
    currentAttempt: 1,
    policy: {
      requireCleanReview: true,
      requireCliPass: true,
      requireCleanWorktreeForCommit: true,
      requirePush: false,
    },
    limits: { maxGroups: 2, maxAttemptsPerGroup: 1, maxEvents: 20 },
    blockedReason: null,
    planningRevision: HASH,
    git: { baselineRevision: "base", finalRevision: null, workspaceFingerprint: HASH },
    tracking: { binding },
    groups: {},
    startedAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    completedAt: null,
  };
}

function completedGroup(ordinal: number, revision: string): LoopGroupStateV2 {
  return {
    id: String(ordinal),
    ordinal,
    status: "completed",
    taskGroupFingerprint: HASH,
    attempt: 1,
    bundle: {
      status: "approved",
      bundleId: "bundle-1",
      bundleHash: HASH,
      artifactHash: HASH,
      evidenceHash: HASH,
      reviewHash: HASH,
      observedGitRevision: revision,
      workspaceFingerprint: HASH,
    },
    push: { status: "not_required", remoteRevision: null },
    commit: {
      status: "acknowledged",
      revision,
      tree: "tree-1",
      workspaceFingerprint: HASH,
    },
    tracker: { status: "pending", marker: null },
    completedAt: "2026-08-04T00:00:00.000Z",
  };
}

function dashboardDescription(): string {
  return [
    "Intro maintained by people.",
    "",
    "<!-- corgispec:task-dashboard:start -->",
    "## Task Dashboard",
    "> Managed by CorgiSpec from the authoritative task artifact.",
    "",
    "**Progress:** 1/3 tasks complete · 1/2 groups approved",
    "",
    "| Group | Name | Status |",
    "|---|---|---|",
    "| 1 | Discovery | done |",
    "| 2 | Delivery | pending |",
    "",
    "### Group 1: Discovery",
    "- [x] 1.1 Existing task",
    "",
    "### Group 2: Delivery",
    "- [ ] 2.1 Current task",
    "- [ ] 2.2 Another task",
    "<!-- corgispec:task-dashboard:end -->",
    "",
    "Footer maintained by people.",
  ].join("\n");
}

function updatedDashboardDescription(): string {
  return [
    "Intro maintained by people.",
    "",
    "<!-- corgispec:task-dashboard:start -->",
    "## Task Dashboard",
    "> Managed by CorgiSpec from the authoritative task artifact.",
    "",
    "**Progress:** 3/3 tasks complete · 2/2 groups complete",
    "",
    "| Group | Name | Status |",
    "|---|---|---|",
    "| 1 | Discovery | done |",
    "| 2 | Delivery | done |",
    "",
    "### Group 1: Discovery",
    "- [x] 1.1 Existing task",
    "",
    "### Group 2: Delivery",
    "- [x] 2.1 Current task",
    "- [x] 2.2 Another task",
    "<!-- corgispec:task-dashboard:end -->",
    "",
    "Footer maintained by people.",
  ].join("\n");
}

function checkpointComment(ordinal: number, revision: string, marker: string): string {
  return [
    `## Loop Checkpoint: Group ${ordinal}`,
    "",
    marker,
    "",
    `Task Group ${ordinal} was committed as \`${revision}\` and its managed dashboard section was synchronized.`,
  ].join("\n");
}

function tempRoot(name: string): string {
  const root = mkdtempSync(resolve(tmpdir(), `corgispec-${name}-`));
  cleanup.push(root);
  return root;
}
