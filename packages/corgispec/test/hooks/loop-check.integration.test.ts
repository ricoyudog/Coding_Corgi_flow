import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { LoopStoreV2 } from "../../src/lib/loop-store-v2.js";
import {
  createInitialLoopStateV2,
  createRunInitializedEventV2,
} from "../../src/lib/loop-reducer-v2.js";
import { LoopStoreV3 } from "../../src/lib/loop-store-v3.js";
import {
  createInitialRunStateV3,
  createRunInitializedEventV3,
  type ArtifactHashV3,
  type RunStateV3,
} from "../../src/lib/run-contract-v3.js";

const CLI = resolve(__dirname, "../../dist/corgispec.js");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Run Contract v3 loop-check hook", () => {
  it("returns the active v3 phase and required action without mutating canonical storage", () => {
    const root = project("active-v3");
    seedV3(root, "change-a", "run-a", "session-a");
    const watched = runFiles(root, "change-a", "run-a");
    const before = watched.map((path) => readFileSync(path));

    const result = runHook(root, { session_id: "session-a" });

    expect(result).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: {
        schemaVersion: 3,
        decision: "block",
        status: "active",
        changeName: "change-a",
        runId: "run-a",
        phase: "planning_ready",
        stateRevision: 0,
        action: { type: "apply", groupId: "1" },
      },
    });
    watched.forEach((path, index) => expect(readFileSync(path)).toEqual(before[index]));
  });

  it("finds an active v3 run from the primary worktree when it lives in a linked delivery", () => {
    const root = project("linked-active-v3");
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["add", "openspec/config.yaml"], { cwd: root, stdio: "ignore" });
    execFileSync(
      "git",
      ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "initial"],
      { cwd: root, stdio: "ignore" },
    );
    const delivery = resolve(root, ".worktrees/change-linked");
    mkdirSync(resolve(root, ".worktrees"), { recursive: true });
    execFileSync("git", ["worktree", "add", "-b", "change-linked", delivery], {
      cwd: root,
      stdio: "ignore",
    });
    seedV3(delivery, "change-linked", "run-linked", "session-linked");

    const result = runHook(root, { session_id: "session-linked" });

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: {
        schemaVersion: 3,
        decision: "block",
        status: "active",
        changeName: "change-linked",
        runId: "run-linked",
      },
    });
  });

  it("fails a conflicting Stop-hook session without repairing a missing pointer", () => {
    const root = project("session-conflict");
    seedV3(root, "change-a", "run-a", "session-a");
    const current = resolve(root, ".corgi/loop/change-a/current.json");
    unlinkSync(current);
    const watched = runFiles(root, "change-a", "run-a").filter((path) => path !== current);
    const before = watched.map((path) => readFileSync(path));

    const result = runHook(root, { session_id: "session-other" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({
      schemaVersion: 3,
      status: "contract_error",
      error: { code: "SESSION_CONFLICT" },
    });
    expect(existsSync(current)).toBe(false);
    watched.forEach((path, index) => expect(readFileSync(path)).toEqual(before[index]));
  });

  it("fails closed when more than one change has an active v3 run", () => {
    const root = project("multiple-v3");
    seedV3(root, "change-a", "run-a", "session-a");
    seedV3(root, "change-b", "run-b", "session-a");

    const result = runHook(root, { session_id: "session-a" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({
      status: "contract_error",
      error: { code: "MULTIPLE_ACTIVE_CHANGES" },
    });
  });

  it("rejects an active v2 run byte-for-byte and never migrates it", async () => {
    const root = project("active-v2");
    await seedActiveV2(root, "change-a", "run-v2", "session-v2");
    const watched = runFiles(root, "change-a", "run-v2");
    const before = watched.map((path) => readFileSync(path));

    const result = runHook(root, { session_id: "session-v2" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({
      schemaVersion: 3,
      status: "contract_error",
      changeName: "change-a",
      error: { code: "ACTIVE_V2_RUN_UNSUPPORTED" },
    });
    watched.forEach((path, index) => expect(readFileSync(path)).toEqual(before[index]));
  });

  it("ignores terminal v2 history", () => {
    const root = project("terminal-v2");
    const runRoot = resolve(root, ".corgi/loop/change-a/runs/run-v2");
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(resolve(runRoot, "state.json"), JSON.stringify({
      schemaVersion: 2,
      runId: "run-v2",
      phase: "completed",
    }));
    writeFileSync(resolve(root, ".corgi/loop/change-a/current.json"), JSON.stringify({
      schemaVersion: 2,
      runId: "run-v2",
    }));

    const result = runHook(root, { session_id: "unrelated" });

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: { schemaVersion: 3, decision: "proceed", status: "idle" },
    });
  });

  it("rejects an active legacy run and preserves it byte-for-byte", () => {
    const root = project("active-legacy");
    const statePath = resolve(root, ".opencode/corgi-loop/change-a/state.json");
    mkdirSync(resolve(statePath, ".."), { recursive: true });
    writeFileSync(statePath, JSON.stringify({
      schemaVersion: 1,
      changeName: "change-a",
      active: true,
      sessionId: "legacy-session",
    }));
    const before = readFileSync(statePath);

    const result = runHook(root, { session_id: "legacy-session" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({
      status: "contract_error",
      error: { code: "ACTIVE_LEGACY_RUN_UNSUPPORTED" },
    });
    expect(readFileSync(statePath)).toEqual(before);
    expect(existsSync(resolve(root, ".corgi/loop"))).toBe(false);
  });

  it("fails closed on a stale v3 pointer without repairing it", () => {
    const root = project("stale-pointer");
    seedV3(root, "change-a", "run-a", "session-a");
    const current = resolve(root, ".corgi/loop/change-a/current.json");
    writeFileSync(current, JSON.stringify({
      schemaVersion: 3,
      changeName: "change-a",
      runId: "run-a",
      stateRevision: 99,
      nonce: "stale",
      phase: "planning_ready",
    }));
    const before = readFileSync(current);

    const result = runHook(root, { session_id: "session-a" });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatchObject({ error: { code: "LOOP_POINTER_STALE" } });
    expect(readFileSync(current)).toEqual(before);
  });

  it("honors re-entry, an empty store, and malformed stdin", () => {
    const root = project("idle");
    expect(runHook(root, { stop_hook_active: true }).stdout).toMatchObject({
      schemaVersion: 3,
      decision: "proceed",
      status: "idle",
    });
    expect(runHook(root, { session_id: "none" }).stdout).toMatchObject({
      schemaVersion: 3,
      decision: "proceed",
      status: "idle",
    });
    const malformed = spawnSync(
      process.execPath,
      [CLI, "hook", "loop-check", "--path", root],
      { input: "{bad", encoding: "utf8" },
    );
    expect(malformed.status).toBe(2);
    expect(malformed.stderr).toBe("");
    expect(JSON.parse(malformed.stdout)).toMatchObject({
      schemaVersion: 3,
      status: "contract_error",
      error: { code: "HOOK_CONTRACT_ERROR" },
    });
  });
});

function project(label: string): string {
  const root = resolve(
    tmpdir(),
    `corgispec-loop-hook-v3-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  roots.push(root);
  mkdirSync(resolve(root, "openspec"), { recursive: true });
  writeFileSync(resolve(root, "openspec/config.yaml"), "schema: test\n");
  return root;
}

function seedV3(root: string, changeName: string, runId: string, sessionId: string): RunStateV3 {
  const state = createInitialRunStateV3({
    changeName,
    runId,
    owner: { id: "hook-test", kind: "automation" },
    sessionId,
    nonce: `nonce-${runId}`,
    planningRevision: hash3("a"),
    baselineRevision: "baseline",
    contract: {
      kind: "maintenance",
      deliveryRef: `maintenance/${changeName}`,
      rfcId: null,
      rfcDigest: null,
      acceptedCommit: null,
      sliceId: null,
      sourcePath: `openspec/changes/${changeName}/corgi/source.yaml`,
      sourceDigest: hash3("b"),
      traceabilityPath: `openspec/changes/${changeName}/corgi/traceability.yaml`,
      traceabilityDigest: hash3("c"),
      acceptance: [{ id: "MC-001", evidence: "automated", taskGroups: ["1"] }],
      tracker: { provider: "none", idempotencyKey: `local-${changeName}` },
    },
    groups: [{ id: "1", fingerprint: hash3("d") }],
    startedAt: "2026-08-14T00:00:00.000Z",
  });
  new LoopStoreV3(root).initialize(state, createRunInitializedEventV3(state));
  return state;
}

async function seedActiveV2(
  root: string,
  changeName: string,
  runId: string,
  sessionId: string,
): Promise<void> {
  const state = createInitialLoopStateV2({
    changeName,
    runId,
    owner: { id: "hook-test", kind: "automation" },
    sessionId,
    mode: "hook-driven",
    nonce: `nonce-${runId}`,
    planningRevision: hash2("a"),
    baselineGitRevision: "baseline",
    workspaceFingerprint: hash2("b"),
    policy: {
      requireCleanReview: true,
      requireCliPass: true,
      requireCleanWorktreeForCommit: true,
      requirePush: false,
    },
    tracking: { binding: null },
    limits: { maxGroups: 10, maxAttemptsPerGroup: 3, maxEvents: 100 },
    groups: [{ id: "1", taskGroupFingerprint: hash2("c") }],
    startedAt: "2026-07-15T00:00:00.000Z",
  });
  await new LoopStoreV2({ projectRoot: root }).initialize({
    state,
    event: createRunInitializedEventV2(state),
  });
}

function runFiles(root: string, changeName: string, runId: string): string[] {
  const runRoot = resolve(root, `.corgi/loop/${changeName}/runs/${runId}`);
  return [
    resolve(runRoot, "state.json"),
    resolve(runRoot, "events.jsonl"),
    resolve(root, `.corgi/loop/${changeName}/current.json`),
  ];
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
    stdout: JSON.parse(result.stdout) as Record<string, unknown>,
    stderr: result.stderr,
  };
}

function hash3(character: string): ArtifactHashV3 {
  return `sha256:${character.repeat(64)}` as ArtifactHashV3;
}

function hash2(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}
