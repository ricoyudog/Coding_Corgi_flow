import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInitialLoopStateV2,
  createRunInitializedEventV2,
  reduceLoopEventV2,
} from "../../src/lib/loop-reducer-v2.js";
import { LoopStoreV2 } from "../../src/lib/loop-store-v2.js";
import type { ArtifactHashV2, LoopStateV2 } from "../../src/lib/run-contract-v2.js";

const CLI = resolve(__dirname, "../../dist/corgispec.js");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Run Contract v2 loop-check hook", () => {
  it("passes session identity through and returns a structured phase action", async () => {
    const root = project("active");
    await seed(root, "change-a", "run-a", "session-a");

    const result = runHook(root, {
      hook_event_name: "Stop",
      stop_hook_active: false,
      session_id: "session-a",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchObject({
      schemaVersion: 2,
      decision: "block",
      status: "active",
      changeName: "change-a",
      runId: "run-a",
      phase: "awaiting_group_result",
      terminal: false,
      action: { type: "dispatch_group", groupId: "1", attempt: 1 },
    });
  });

  it("fails session conflict without changing state, events, or current pointer", async () => {
    const root = project("session-conflict");
    await seed(root, "change-a", "run-a", "session-a");
    const runRoot = resolve(root, ".corgi/loop/change-a/runs/run-a");
    const watched = [
      resolve(runRoot, "state.json"),
      resolve(runRoot, "events.jsonl"),
      resolve(root, ".corgi/loop/change-a/current.json"),
    ];
    const before = watched.map((path) => readFileSync(path));

    const result = runHook(root, { session_id: "session-other" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({
      decision: "proceed",
      status: "contract_error",
      error: { code: "session_conflict" },
    });
    watched.forEach((path, index) => expect(readFileSync(path)).toEqual(before[index]));
  });

  it("does not repair a stale current pointer for a conflicting Stop-hook session", async () => {
    const root = project("session-conflict-stale-pointer");
    await seed(root, "change-a", "run-a", "session-a");
    const runRoot = resolve(root, ".corgi/loop/change-a/runs/run-a");
    const current = resolve(root, ".corgi/loop/change-a/current.json");
    const statePath = resolve(runRoot, "state.json");
    const eventsPath = resolve(runRoot, "events.jsonl");
    unlinkSync(current);
    const before = [readFileSync(statePath), readFileSync(eventsPath)];

    const result = runHook(root, { session_id: "session-other" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({
      status: "contract_error",
      error: { code: "session_conflict" },
    });
    expect(existsSync(current)).toBe(false);
    expect(readFileSync(statePath)).toEqual(before[0]);
    expect(readFileSync(eventsPath)).toEqual(before[1]);
  });

  it("fails closed when more than one change has an active run", async () => {
    const root = project("multiple");
    await seed(root, "change-a", "run-a", "session-a");
    await seed(root, "change-b", "run-b", "session-a");

    const result = runHook(root, { session_id: "session-a" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({
      status: "contract_error",
      error: { code: "multiple_active_changes" },
    });
  });

  it("relays terminal state without attempting another mutation", async () => {
    const root = project("terminal");
    const state = await seed(root, "change-a", "run-a", "session-a");
    const occurredAt = "2026-07-15T00:01:00.000Z";
    const event = {
      schemaVersion: 2 as const,
      type: "run_invalidated" as const,
      runId: state.runId,
      seq: 1,
      expectedStateRevision: 0,
      expectedNonce: state.nonce,
      nextNonce: "nonce-terminal",
      occurredAt,
      actor: state.owner,
      reason: {
        code: "manual" as const,
        message: "stopped by test",
        details: {},
      },
    };
    const next = reduceLoopEventV2(state, event).postState;
    await new LoopStoreV2({ projectRoot: root }).transition({
      changeName: state.changeName,
      runId: state.runId,
      sessionId: state.sessionId,
      expectedStateRevision: state.stateRevision,
      expectedNonce: state.nonce,
      event,
      nextState: next,
    });
    const eventsPath = resolve(root, ".corgi/loop/change-a/runs/run-a/events.jsonl");
    const before = readFileSync(eventsPath);

    const result = runHook(root, { session_id: "session-a" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchObject({
      decision: "proceed",
      status: "terminal",
      phase: "invalidated",
      terminal: true,
      action: { type: "terminal" },
      reason: "stopped by test",
    });
    expect(readFileSync(eventsPath)).toEqual(before);
  });

  it("honors stop-hook re-entry and an empty canonical store", () => {
    const root = project("idle");
    expect(runHook(root, { stop_hook_active: true }).stdout).toMatchObject({
      decision: "proceed",
      status: "idle",
    });
    expect(runHook(root, { session_id: "none" }).stdout).toMatchObject({
      decision: "proceed",
      status: "idle",
    });
  });

  it.each(["claude", "opencode"] as const)(
    "ignores an inactive %s legacy run whose planning change no longer exists",
    (platform) => {
      const root = project(`inactive-legacy-${platform}`);
      const statePath = legacy(root, platform, "archived-change", {
        schemaVersion: 1,
        changeName: "archived-change",
        active: false,
        sessionId: "legacy-session",
      });
      const before = readFileSync(statePath);

      const result = runHook(root, { session_id: "unrelated-session" });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toMatchObject({
        schemaVersion: 2,
        decision: "proceed",
        status: "idle",
      });
      expect(readFileSync(statePath)).toEqual(before);
      expect(existsSync(resolve(root, ".corgi/loop"))).toBe(false);
    },
  );

  it("ignores multiple inactive legacy changes", () => {
    const root = project("multiple-inactive-legacy");
    const watched = [
      legacy(root, "claude", "archived-a", {
        changeName: "archived-a",
        active: false,
      }),
      legacy(root, "opencode", "archived-b", {
        changeName: "archived-b",
        active: false,
      }),
    ];
    const before = watched.map((path) => readFileSync(path));

    const result = runHook(root, { session_id: "unrelated-session" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchObject({ decision: "proceed", status: "idle" });
    watched.forEach((path, index) => expect(readFileSync(path)).toEqual(before[index]));
    expect(existsSync(resolve(root, ".corgi/loop"))).toBe(false);
  });

  it("fails closed for ambiguous inactive legacy state on both platforms", () => {
    const root = project("ambiguous-inactive-legacy");
    const watched = [
      legacy(root, "claude", "ambiguous-change", {
        changeName: "ambiguous-change",
        active: false,
      }),
      legacy(root, "opencode", "ambiguous-change", {
        changeName: "ambiguous-change",
        active: false,
      }),
    ];
    const before = watched.map((path) => readFileSync(path));

    const result = runHook(root, { session_id: "unrelated-session" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({
      decision: "proceed",
      status: "contract_error",
      changeName: "ambiguous-change",
    });
    watched.forEach((path, index) => expect(readFileSync(path)).toEqual(before[index]));
    expect(existsSync(resolve(root, ".corgi/loop"))).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "does not let inactive legacy state mask a symlinked canonical run",
    () => {
      const root = project("inactive-legacy-canonical-symlink");
      const outside = project("inactive-legacy-canonical-symlink-outside");
      legacy(root, "opencode", "change-a", {
        changeName: "change-a",
        active: false,
      });
      const runs = resolve(root, ".corgi/loop/change-a/runs");
      mkdirSync(runs, { recursive: true });
      symlinkSync(outside, resolve(runs, "run-a"), "dir");

      const result = runHook(root, { session_id: "unrelated-session" });

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toMatchObject({
        decision: "proceed",
        status: "contract_error",
      });
    },
  );

  it.skipIf(process.platform === "win32")(
    "does not let inactive legacy state mask a symlinked canonical runs directory",
    () => {
      const root = project("inactive-legacy-canonical-runs-symlink");
      const outside = project("inactive-legacy-canonical-runs-symlink-outside");
      legacy(root, "opencode", "change-a", {
        changeName: "change-a",
        active: false,
      });
      const changeRoot = resolve(root, ".corgi/loop/change-a");
      mkdirSync(changeRoot, { recursive: true });
      symlinkSync(outside, resolve(changeRoot, "runs"), "dir");

      const result = runHook(root, { session_id: "unrelated-session" });

      expect(result.exitCode).toBe(2);
      expect(result.stdout).toMatchObject({
        decision: "proceed",
        status: "contract_error",
      });
    },
  );

  it("ignores inactive legacy state while selecting an active canonical run", async () => {
    const root = project("inactive-legacy-active-canonical");
    const legacyPath = legacy(root, "opencode", "archived-change", {
      changeName: "archived-change",
      active: false,
    });
    const legacyBefore = readFileSync(legacyPath);
    await seed(root, "change-a", "run-a", "session-a");

    const result = runHook(root, { session_id: "session-a" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatchObject({
      decision: "block",
      status: "active",
      changeName: "change-a",
      runId: "run-a",
    });
    expect(readFileSync(legacyPath)).toEqual(legacyBefore);
  });

  it("fails closed for an active legacy run whose planning change is missing", () => {
    const root = project("active-legacy-missing-change");
    const statePath = legacy(root, "opencode", "missing-active-change", {
      changeName: "missing-active-change",
      active: true,
      sessionId: "legacy-session",
    });
    const before = readFileSync(statePath);

    const result = runHook(root, { session_id: "legacy-session" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({
      decision: "proceed",
      status: "contract_error",
      changeName: "missing-active-change",
    });
    expect(readFileSync(statePath)).toEqual(before);
    expect(existsSync(resolve(root, ".corgi/loop"))).toBe(false);
  });

  it.each([
    ["corrupt", "{bad"],
    ["future", JSON.stringify({ schemaVersion: 99, changeName: "unsafe-change", active: false })],
  ])("fails closed for %s legacy state", (_label, content) => {
    const root = project(`unsafe-legacy-${_label}`);
    const statePath = legacy(root, "opencode", "unsafe-change", content);
    const before = readFileSync(statePath);

    const result = runHook(root, { session_id: "unrelated-session" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({
      decision: "proceed",
      status: "contract_error",
      changeName: "unsafe-change",
    });
    expect(readFileSync(statePath)).toEqual(before);
    expect(existsSync(resolve(root, ".corgi/loop"))).toBe(false);
  });

  it("returns pure JSON and exit 2 for malformed hook stdin", () => {
    const root = project("bad-stdin");
    const result = spawnSync(
      process.execPath,
      [CLI, "hook", "loop-check", "--path", root],
      { input: "{bad", encoding: "utf8" },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "contract_error",
      error: { code: "hook_contract_error" },
    });
  });
});

function project(label: string): string {
  const root = resolve(
    tmpdir(),
    `corgispec-loop-hook-v2-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  roots.push(root);
  mkdirSync(resolve(root, "openspec"), { recursive: true });
  writeFileSync(resolve(root, "openspec/config.yaml"), "schema: test\n");
  return root;
}

function legacy(
  root: string,
  platform: "claude" | "opencode",
  changeName: string,
  state: Record<string, unknown> | string,
): string {
  const directory = resolve(root, `.${platform}/corgi-loop/${changeName}`);
  const path = resolve(directory, "state.json");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, typeof state === "string" ? state : JSON.stringify(state), "utf8");
  return path;
}

async function seed(
  root: string,
  changeName: string,
  runId: string,
  sessionId: string,
): Promise<LoopStateV2> {
  const state = createInitialLoopStateV2({
    changeName,
    runId,
    owner: { id: "hook-test", kind: "automation" },
    sessionId,
    mode: "hook-driven",
    nonce: `nonce-${runId}`,
    planningRevision: hash("a"),
    baselineGitRevision: "baseline",
    workspaceFingerprint: hash("b"),
    policy: {
      requireCleanReview: true,
      requireCliPass: true,
      requireCleanWorktreeForCommit: true,
      requirePush: false,
    },
    limits: { maxGroups: 10, maxAttemptsPerGroup: 3, maxEvents: 100 },
    groups: [{ id: "1", taskGroupFingerprint: hash("c") }],
    startedAt: "2026-07-15T00:00:00.000Z",
  });
  await new LoopStoreV2({ projectRoot: root }).initialize({
    state,
    event: createRunInitializedEventV2(state),
  });
  return state;
}

function runHook(
  root: string,
  input: Record<string, unknown>,
): { exitCode: number | null; stdout: Record<string, unknown>; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [CLI, "hook", "loop-check", "--path", root],
    { input: JSON.stringify(input), encoding: "utf8" },
  );
  return {
    exitCode: result.status,
    stdout: JSON.parse(result.stdout),
    stderr: result.stderr,
  };
}

function hash(character: string): ArtifactHashV2 {
  return `sha256:${character.repeat(64)}` as ArtifactHashV2;
}
