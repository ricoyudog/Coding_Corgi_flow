import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  closeBoundTrackerIssue,
  CommandTrackerClient,
  createTrackerClient,
  createOrRecoverIssue,
  featureIssueMarker,
  maintenanceIssueMarker,
  repositoryIdentity,
  taskGroupTrackerCheckpoint,
  TrackerError,
  type TrackerClient,
  type TrackerIssue,
} from "../src/lib/tracker.js";
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "../src/lib/openspec-runtime.js";

function client(find: TrackerIssue[][]): TrackerClient {
  return {
    provider: "github",
    findByMarker: vi.fn(async () => find.shift() ?? []),
    getIssue: vi.fn(async (issue) => issue),
    createIssue: vi.fn(async (input) => ({
      id: "12",
      url: "https://example.test/issues/12",
      title: input.title,
      body: input.body,
    })),
    setState: vi.fn(async () => undefined),
    updateBody: vi.fn(async () => undefined),
    comment: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("single-Issue tracker contract", () => {
  it("derives a stable repository/RFC/Slice marker", () => {
    const first = featureIssueMarker({
      repository: "git@example/repo.git",
      deliveryRef: "RFC-0002-export/S-01-csv",
      rfcDigest: `sha256:${"a".repeat(64)}`,
    });
    expect(featureIssueMarker({
      repository: "git@example/repo.git",
      deliveryRef: "RFC-0002-export/S-01-csv",
      rfcDigest: `sha256:${"a".repeat(64)}`,
    })).toEqual(first);
    expect(first.marker).toContain("corgispec:feature:v1");
  });

  it("derives the Task Group checkpoint from canonical run and commit evidence", () => {
    const input = {
      idempotencyKey: "delivery-key",
      runId: "run-a",
      groupId: "1",
      commitRevision: "commit-1",
      evidenceHash: `sha256:${"a".repeat(64)}`,
    };
    expect(taskGroupTrackerCheckpoint(input)).toBe(taskGroupTrackerCheckpoint(input));
    expect(taskGroupTrackerCheckpoint(input)).toMatch(/corgispec:checkpoint:v3 run=run-a group=1 key=[a-f0-9]{64}/);
    expect(taskGroupTrackerCheckpoint({ ...input, commitRevision: "commit-2" }))
      .not.toBe(taskGroupTrackerCheckpoint(input));
  });

  it("reuses the only exact marker match", async () => {
    const existing = {
      id: "7",
      url: "https://example.test/issues/7",
      title: "Feature",
      body: "<!-- exact -->",
    };
    const tracker = client([[existing]]);
    await expect(createOrRecoverIssue(tracker, {
      title: "Feature",
      body: "<!-- exact -->",
      marker: "<!-- exact -->",
    })).resolves.toEqual({ issue: existing, recovered: true });
    expect(tracker.createIssue).not.toHaveBeenCalled();
  });

  it("fails closed instead of choosing between duplicates", async () => {
    const duplicate = (id: string): TrackerIssue => ({
      id,
      url: `https://example.test/issues/${id}`,
      title: "Feature",
      body: "<!-- exact -->",
    });
    await expect(createOrRecoverIssue(client([[duplicate("1"), duplicate("2")]]), {
      title: "Feature",
      body: "<!-- exact -->",
      marker: "<!-- exact -->",
    })).rejects.toMatchObject({ code: "TRACKER_DUPLICATE_MARKER" });
  });

  it("recovers exactly one Issue after a create timeout and otherwise keeps the timeout fail-closed", async () => {
    const existing: TrackerIssue = {
      id: "7",
      url: "https://example.test/issues/7",
      title: "Feature",
      body: "<!-- exact -->",
    };
    const recovered = client([[], [existing]]);
    recovered.createIssue = vi.fn(async () => {
      throw new TrackerError("timed out", "TRACKER_TIMEOUT");
    });
    await expect(createOrRecoverIssue(recovered, {
      title: "Feature",
      body: "<!-- exact -->",
      marker: "<!-- exact -->",
    })).resolves.toEqual({ issue: existing, recovered: true });

    const absent = client([[], []]);
    absent.createIssue = vi.fn(async () => {
      throw new TrackerError("timed out", "TRACKER_TIMEOUT");
    });
    await expect(createOrRecoverIssue(absent, {
      title: "Feature",
      body: "<!-- exact -->",
      marker: "<!-- exact -->",
    })).rejects.toMatchObject({ code: "TRACKER_TIMEOUT" });

    const duplicate = client([[], [existing, { ...existing, id: "8", url: "https://example.test/issues/8" }]]);
    duplicate.createIssue = vi.fn(async () => {
      throw new TrackerError("timed out", "TRACKER_TIMEOUT");
    });
    await expect(createOrRecoverIssue(duplicate, {
      title: "Feature",
      body: "<!-- exact -->",
      marker: "<!-- exact -->",
    })).rejects.toMatchObject({ code: "TRACKER_DUPLICATE_MARKER" });
  });

  it("moves the Change-bound Issue to done before closing it", async () => {
    const tracker = client([]);
    await closeBoundTrackerIssue({
      provider: "github",
      idempotencyKey: "delivery-key",
      issue: { id: "42", url: "https://example.test/issues/42" },
    }, tracker);

    expect(tracker.setState).toHaveBeenCalledWith(expect.objectContaining({ id: "42" }), "done");
    expect(tracker.close).toHaveBeenCalledWith(expect.objectContaining({
      id: "42",
      url: "https://example.test/issues/42",
    }));
    expect((tracker.setState as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
      .toBeLessThan((tracker.close as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
  });

  it("does not create provider work for a provider-none Change", async () => {
    await expect(closeBoundTrackerIssue({
      provider: "none",
      idempotencyKey: "local",
    }, null)).resolves.toBeUndefined();
  });

  it("rejects tracker closeout without an exactly matching bound Issue client", async () => {
    const binding = {
      provider: "github" as const,
      idempotencyKey: "delivery-key",
      issue: { id: "42", url: "https://example.test/issues/42" },
    };
    await expect(closeBoundTrackerIssue(binding, null))
      .rejects.toMatchObject({ code: "TRACKER_CLIENT_REQUIRED" });
    await expect(closeBoundTrackerIssue(binding, { ...client([]), provider: "gitlab" }))
      .rejects.toMatchObject({ code: "TRACKER_PROVIDER_MISMATCH" });
    await expect(closeBoundTrackerIssue({
      provider: "github",
      idempotencyKey: "delivery-key",
    }, client([]))).rejects.toMatchObject({ code: "TRACKER_ISSUE_REQUIRED" });
  });

  it("creates all GitHub workflow labels before the first Issue mutation and reuses the result", async () => {
    const runner = new QueueRunner([
      result("[]\n"),
      result(),
      result(),
      result(),
      result(),
      result(),
      result("https://github.example.test/acme/widgets/issues/42\n"),
      result(),
    ]);
    const tracker = new CommandTrackerClient("github", "/repo", runner);

    const issue = await tracker.createIssue({
      title: "Feature",
      body: "<!-- marker -->",
      marker: "<!-- marker -->",
    });
    await tracker.setState(issue, "todo");

    expect(runner.requests.map(({ command, args }) => ({ command, args }))).toEqual([
      { command: "gh", args: ["label", "list", "--limit", "10000", "--json", "name"] },
      { command: "gh", args: ["label", "create", "backlog", "--color", "6A737D", "--description", "CorgiSpec work awaiting planning"] },
      { command: "gh", args: ["label", "create", "todo", "--color", "0366D6", "--description", "CorgiSpec work ready to apply"] },
      { command: "gh", args: ["label", "create", "in-progress", "--color", "FBCA04", "--description", "CorgiSpec work being implemented"] },
      { command: "gh", args: ["label", "create", "review", "--color", "8A2BE2", "--description", "CorgiSpec work awaiting review"] },
      { command: "gh", args: ["label", "create", "done", "--color", "2DA44E", "--description", "CorgiSpec work archived"] },
      { command: "gh", args: ["issue", "create", "--title", "Feature", "--body-file", "-", "--label", "backlog"] },
      { command: "gh", args: ["issue", "edit", "42", "--remove-label", "backlog,todo,in-progress,review,done", "--add-label", "todo"] },
    ]);
    expect(runner.requests[6]?.stdin).toBe("<!-- marker -->");
  });

  it("creates namespaced GitLab workflow labels before creating an Issue", async () => {
    const runner = new QueueRunner([
      result("[]\n"),
      result(),
      result(),
      result(),
      result(),
      result(),
      result("https://gitlab.example.test/acme/widgets/-/issues/17\n"),
    ]);
    const tracker = new CommandTrackerClient("gitlab", "/repo", runner);

    await tracker.createIssue({ title: "Feature", body: "body", marker: "marker" });

    expect(runner.requests.map(({ command, args }) => ({ command, args }))).toEqual([
      { command: "glab", args: ["label", "list", "--output", "json", "--per-page", "100", "--page", "1"] },
      { command: "glab", args: ["label", "create", "--name", "workflow::backlog", "--color", "#6A737D", "--description", "CorgiSpec work awaiting planning"] },
      { command: "glab", args: ["label", "create", "--name", "workflow::todo", "--color", "#0366D6", "--description", "CorgiSpec work ready to apply"] },
      { command: "glab", args: ["label", "create", "--name", "workflow::in-progress", "--color", "#FBCA04", "--description", "CorgiSpec work being implemented"] },
      { command: "glab", args: ["label", "create", "--name", "workflow::review", "--color", "#8A2BE2", "--description", "CorgiSpec work awaiting review"] },
      { command: "glab", args: ["label", "create", "--name", "workflow::done", "--color", "#2DA44E", "--description", "CorgiSpec work archived"] },
      { command: "glab", args: ["issue", "create", "--title", "Feature", "--description", "body", "--label", "workflow::backlog", "--yes"] },
    ]);
  });

  it("reconciles a label-create race by exact name instead of failing the Issue transaction", async () => {
    const withoutBacklog = '[{"name":"todo"},{"name":"in-progress"},{"name":"review"},{"name":"done"}]\n';
    const withBacklog = '[{"name":"backlog"},{"name":"todo"},{"name":"in-progress"},{"name":"review"},{"name":"done"}]\n';
    const runner = new QueueRunner([
      result(withoutBacklog),
      failure("label already exists"),
      result(withBacklog),
      result("https://github.example.test/acme/widgets/issues/43\n"),
    ]);
    const tracker = new CommandTrackerClient("github", "/repo", runner);

    await expect(tracker.createIssue({ title: "Feature", body: "body", marker: "marker" }))
      .resolves.toMatchObject({ id: "43" });
    expect(runner.requests.map(({ args }) => args.slice(0, 3))).toEqual([
      ["label", "list", "--limit"],
      ["label", "create", "backlog"],
      ["label", "list", "--limit"],
      ["issue", "create", "--title"],
    ]);
  });

  it("queries remote state and skips a duplicate close for an already closed Issue", async () => {
    const runner = new QueueRunner([
      result('[{"name":"backlog"},{"name":"todo"},{"name":"in-progress"},{"name":"review"},{"name":"done"}]\n'),
      result('{"state":"CLOSED"}\n'),
    ]);
    const tracker = new CommandTrackerClient("github", "/repo", runner);

    await tracker.close({
      id: "42",
      url: "https://example.test/issues/42",
      title: "",
      body: "",
    });

    expect(runner.requests).toEqual([
      expect.objectContaining({
        command: "gh",
        args: ["label", "list", "--limit", "10000", "--json", "name"],
        cwd: "/repo",
      }),
      expect.objectContaining({
        command: "gh",
        args: ["issue", "view", "42", "--json", "state"],
        cwd: "/repo",
      }),
    ]);
  });

  it("loads the current Issue body before a managed dashboard update", async () => {
    const runner = new QueueRunner([
      result('{"number":42,"url":"https://example.test/issues/42","title":"Feature","body":"Human content"}\n'),
    ]);
    const tracker = new CommandTrackerClient("github", "/repo", runner);

    await expect(tracker.getIssue({
      id: "42",
      url: "https://example.test/issues/42",
      title: "",
      body: "",
    })).resolves.toMatchObject({ id: "42", body: "Human content" });
    expect(runner.requests[0]).toMatchObject({
      command: "gh",
      args: ["issue", "view", "42", "--json", "number,url,title,body"],
    });
  });

  it("closes an open Issue after checking its remote state", async () => {
    const runner = new QueueRunner([
      result('[{"name":"workflow::backlog"},{"name":"workflow::todo"},{"name":"workflow::in-progress"},{"name":"workflow::review"},{"name":"workflow::done"}]\n'),
      result('{"state":"opened"}\n'),
      result(),
    ]);
    const tracker = new CommandTrackerClient("gitlab", "/repo", runner);

    await tracker.close({
      id: "17",
      url: "https://example.test/issues/17",
      title: "",
      body: "",
    });

    expect(runner.requests.map(({ command, args }) => ({ command, args }))).toEqual([
      { command: "glab", args: ["label", "list", "--output", "json", "--per-page", "100", "--page", "1"] },
      { command: "glab", args: ["issue", "view", "17", "--output", "json"] },
      { command: "glab", args: ["issue", "close", "17"] },
    ]);
  });

  it("filters marker searches, rejects malformed tracker responses, and preserves marker identity", async () => {
    const marker = "<!-- corgispec:feature:v1 key=exact -->";
    const runner = new QueueRunner([
      result(JSON.stringify([
        { number: 1, url: "https://example.test/issues/1", title: "keep", body: marker },
        { number: 2, url: "https://example.test/issues/2", title: "ignore", body: "human text" },
        { number: 3, title: "invalid", body: marker },
      ])),
    ]);
    const tracker = new CommandTrackerClient("github", "/repo", runner);
    await expect(tracker.findByMarker(marker)).resolves.toEqual([{
      id: "1",
      url: "https://example.test/issues/1",
      title: "keep",
      body: marker,
    }]);

    const malformed = new CommandTrackerClient("gitlab", "/repo", new QueueRunner([result("not json")]));
    await expect(malformed.findByMarker(marker)).rejects.toMatchObject({ code: "TRACKER_INVALID_OUTPUT" });
    expect(maintenanceIssueMarker({
      repository: "git@example/repo.git",
      changeName: "docs-only",
      description: "Clarify a guide.",
    })).toEqual(maintenanceIssueMarker({
      repository: "git@example/repo.git",
      changeName: "docs-only",
      description: "Clarify a guide.",
    }));
  });

  it("fails closed for malformed create, view, state, timeout, and command-launch responses", async () => {
    const labels = '[{"name":"backlog"},{"name":"todo"},{"name":"in-progress"},{"name":"review"},{"name":"done"}]\n';
    const create = new CommandTrackerClient("github", "/repo", new QueueRunner([
      result(labels),
      result("created without a URL\n"),
    ]));
    await expect(create.createIssue({ title: "Feature", body: "body", marker: "marker" }))
      .rejects.toMatchObject({ code: "TRACKER_INVALID_OUTPUT" });

    const mismatched = new CommandTrackerClient("github", "/repo", new QueueRunner([
      result('{"number":41,"url":"https://example.test/issues/41"}'),
    ]));
    await expect(mismatched.getIssue({ id: "42", url: "https://example.test/issues/42", title: "", body: "" }))
      .rejects.toMatchObject({ code: "TRACKER_INVALID_OUTPUT" });

    const invalidState = new CommandTrackerClient("github", "/repo", new QueueRunner([
      result(labels),
      result('{"state":"unexpected"}'),
    ]));
    await expect(invalidState.close({ id: "42", url: "https://example.test/issues/42", title: "", body: "" }))
      .rejects.toMatchObject({ code: "TRACKER_INVALID_OUTPUT" });

    const timedOut = new CommandTrackerClient("github", "/repo", new QueueRunner([{
      exitCode: null,
      signal: "SIGTERM",
      stdout: "",
      stderr: "",
      timedOut: true,
    }]));
    await expect(timedOut.findByMarker("marker")).rejects.toMatchObject({ code: "TRACKER_TIMEOUT" });

    const launchFailure = new CommandTrackerClient("github", "/repo", {
      run: async () => { throw new Error("missing gh"); },
    });
    await expect(launchFailure.findByMarker("marker")).rejects.toMatchObject({ code: "TRACKER_COMMAND_FAILED" });
  });

  it("uses GitLab pagination and provider-specific Issue mutations without recreating workflow labels", async () => {
    const marker = "<!-- marker -->";
    const firstPage = [
      "workflow::backlog",
      "workflow::todo",
      "workflow::in-progress",
      "workflow::review",
      "workflow::done",
      ...Array.from({ length: 95 }, () => undefined),
    ].map((name) => name === undefined ? {} : { name });
    const runner = new QueueRunner([
      result(JSON.stringify(firstPage)),
      result("[]"),
      result(),
      result(),
      result(),
      result('{"iid":17,"web_url":"https://gitlab.example.test/group/project/-/issues/17","title":"Feature","description":"<!-- marker -->"}'),
      result('[{"iid":17,"web_url":"https://gitlab.example.test/group/project/-/issues/17","title":"Feature","description":"<!-- marker -->"}]'),
    ]);
    const tracker = new CommandTrackerClient("gitlab", "/repo", runner);
    const issue = {
      id: "17",
      url: "https://gitlab.example.test/group/project/-/issues/17",
      title: "",
      body: "",
    };
    await tracker.setState(issue, "review");
    await tracker.updateBody(issue, "updated body");
    await tracker.comment(issue, "note body");
    await expect(tracker.getIssue(issue)).resolves.toMatchObject({ id: "17", body: marker });
    await expect(tracker.findByMarker(marker)).resolves.toMatchObject([{ id: "17", body: marker }]);
    expect(runner.requests.map((request) => request.args.slice(0, 2))).toEqual([
      ["label", "list"],
      ["label", "list"],
      ["issue", "update"],
      ["issue", "update"],
      ["issue", "note"],
      ["issue", "view"],
      ["issue", "list"],
    ]);
    expect(runner.requests[3]!.args).toContain("--description");
    expect(runner.requests[4]!.args).toContain("--message");
  });

  it("keeps provider construction and repository identity deterministic across remote and local repositories", async () => {
    expect(createTrackerClient("none", "/repo")).toBeNull();
    expect(createTrackerClient("github", "/repo")).toBeInstanceOf(CommandTrackerClient);

    const root = mkdtempSync(resolve(tmpdir(), "corgispec-tracker-identity-"));
    try {
      execFileSync("git", ["init"], { cwd: root });
      execFileSync("git", ["remote", "add", "origin", "git@example.test:group/project.git"], { cwd: root });
      expect(repositoryIdentity(root)).toBe("git@example.test:group/project.git");
      execFileSync("git", ["remote", "remove", "origin"], { cwd: root });
      expect(repositoryIdentity(root)).toBe(root);
      expect(repositoryIdentity(resolve(root, "missing"))).toBe(resolve(root, "missing"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

class QueueRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  constructor(private readonly responses: CommandResult[]) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error(`Unexpected command: ${request.command} ${request.args.join(" ")}`);
    return response;
  }
}

function result(stdout = ""): CommandResult {
  return { exitCode: 0, signal: null, stdout, stderr: "", timedOut: false };
}

function failure(stderr: string): CommandResult {
  return { exitCode: 1, signal: null, stdout: "", stderr, timedOut: false };
}
