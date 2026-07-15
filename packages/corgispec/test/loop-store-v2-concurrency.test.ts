import { spawn } from "node:child_process";
import { hostname, tmpdir } from "node:os";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  LoopStoreConflictError,
  LoopStoreLockedError,
  LoopStoreV2,
} from "../src/lib/loop-store-v2.js";
import { reduceLoopEventV2 } from "../src/lib/loop-reducer-v2.js";
import type {
  BundleSubmittedEventV2,
  LoopStateV2,
  RunInitializedEventV2,
} from "../src/lib/run-contract-v2.js";

const roots: string[] = [];
const H = `sha256:${"c".repeat(64)}` as const;
const H2 = `sha256:${"d".repeat(64)}` as const;
const T0 = "2026-02-01T00:00:00.000Z";
const T1 = "2026-02-01T00:00:01.000Z";

function fixtureRoot(): string {
  const value = mkdtempSync(resolve(tmpdir(), "corgi-store-race-"));
  roots.push(value);
  return value;
}

function initial(): { state: LoopStateV2; event: RunInitializedEventV2 } {
  const state: LoopStateV2 = {
    schemaVersion: 2,
    changeName: "race-change",
    runId: "race-run",
    supersedesRunId: null,
    owner: { id: "racer", kind: "agent" },
    sessionId: "race-session",
    mode: "self-driven",
    stateRevision: 0,
    nonce: "race-0",
    lastEventSeq: 0,
    phase: "awaiting_group_result",
    currentGroupId: "TG-1",
    currentAttempt: 1,
    policy: {
      requireCleanReview: true,
      requireCliPass: true,
      requireCleanWorktreeForCommit: true,
      requirePush: false,
    },
    limits: { maxGroups: 1, maxAttemptsPerGroup: 2, maxEvents: 100 },
    blockedReason: null,
    planningRevision: H,
    git: { baselineRevision: "base", finalRevision: null, workspaceFingerprint: H },
    groups: {
      "TG-1": {
        id: "TG-1",
        ordinal: 1,
        status: "in_progress",
        taskGroupFingerprint: H,
        attempt: 1,
        bundle: {
          status: "none",
          bundleId: null,
          bundleHash: null,
          artifactHash: null,
          evidenceHash: null,
          reviewHash: null,
          observedGitRevision: null,
          workspaceFingerprint: null,
        },
        push: { status: "not_required", remoteRevision: null },
        commit: { status: "pending", revision: null, tree: null, workspaceFingerprint: null },
        completedAt: null,
      },
    },
    startedAt: T0,
    updatedAt: T0,
    completedAt: null,
  };
  return {
    state,
    event: {
      schemaVersion: 2,
      type: "run_initialized",
      runId: state.runId,
      seq: 0,
      expectedStateRevision: -1,
      expectedNonce: null,
      nextNonce: state.nonce,
      occurredAt: T0,
      actor: { id: "racer", kind: "agent" },
      initialState: state,
    },
  };
}

function transition(current: LoopStateV2, variant = "") {
  const event: BundleSubmittedEventV2 = {
    schemaVersion: 2,
    type: "bundle_submitted",
    runId: current.runId,
    seq: 1,
    expectedStateRevision: 0,
    expectedNonce: "race-0",
    nextNonce: `race-1${variant}`,
    occurredAt: T1,
    actor: { id: "racer", kind: "agent" },
    groupId: "TG-1",
    attempt: 1,
    bundleId: `bundle-race${variant}`,
    bundleHash: H2,
    artifactHash: H,
    observedGitRevision: "observed",
    workspaceFingerprint: H,
  };
  return {
    changeName: current.changeName,
    runId: current.runId,
    sessionId: current.sessionId,
    expectedStateRevision: 0,
    expectedNonce: "race-0",
    event,
    nextState: reduceLoopEventV2(current, event).postState,
  };
}

async function child(
  script: string,
  bundle: string,
  projectRoot: string,
  inputPath: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((settle) => {
    const childProcess = spawn(process.execPath, [script, bundle, projectRoot, inputPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    childProcess.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    childProcess.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    childProcess.on("close", (code) => settle({ code, stdout, stderr }));
  });
}

afterAll(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("LoopStoreV2 locking and multi-process CAS", () => {
  it("allows only one holder of the per-change wx lock", async () => {
    const projectRoot = fixtureRoot();
    let armed = false;
    let release!: () => void;
    let acquired!: () => void;
    const acquiredPromise = new Promise<void>((settle) => { acquired = settle; });
    const releasePromise = new Promise<void>((settle) => { release = settle; });
    const first = new LoopStoreV2({
      projectRoot,
      faults: async (point) => {
        if (armed && point === "after_lock_acquired") {
          acquired();
          await releasePromise;
        }
      },
    });
    const initialized = initial();
    await first.initialize(initialized);
    const input = transition(initialized.state);
    armed = true;
    const firstMutation = first.transition(input);
    await acquiredPromise;

    const second = new LoopStoreV2({ projectRoot, lockTimeoutMs: 0 });
    await expect(second.transition(input)).rejects.toBeInstanceOf(LoopStoreLockedError);
    release();
    await expect(firstMutation).resolves.toEqual(input.nextState);
  });

  it("serializes concurrent contenders and rejects the loser with stale CAS", async () => {
    const projectRoot = fixtureRoot();
    const initialized = initial();
    const seed = new LoopStoreV2({ projectRoot });
    await seed.initialize(initialized);
    const input = transition(initialized.state);
    const stores = [
      new LoopStoreV2({ projectRoot, lockTimeoutMs: 1_000, lockPollMs: 2 }),
      new LoopStoreV2({ projectRoot, lockTimeoutMs: 1_000, lockPollMs: 2 }),
    ];
    const outcomes = await Promise.allSettled([
      stores[0]!.transition(input),
      stores[1]!.transition(transition(initialized.state, "-other")),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({ reason: expect.any(LoopStoreConflictError) });
    const inspection = await seed.inspect("race-change");
    expect(inspection.events.map((record) => record.event.seq)).toEqual([0, 1]);
  });

  it("reclaims a dead-process lock but never steals a live-process lock", async () => {
    const projectRoot = fixtureRoot();
    const initialized = initial();
    const store = new LoopStoreV2({ projectRoot, lockStaleMs: 1_000 });
    await store.initialize(initialized);
    const lock = store.paths("race-change").lock;
    writeFileSync(lock, JSON.stringify({
      token: "dead",
      pid: 2_000_000_000,
      hostname: hostname(),
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }));
    await expect(store.inspect("race-change")).resolves.toMatchObject({ state: { runId: "race-run" } });
    expect(() => readFileSync(lock)).toThrow();

    writeFileSync(lock, JSON.stringify({
      token: "live",
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }));
    await expect(store.inspect("race-change")).rejects.toBeInstanceOf(LoopStoreLockedError);
    rmSync(lock);
  });

  it("recovers after process death before an initialization is published", async () => {
    const projectRoot = fixtureRoot();
    const initialized = initial();
    const buildRoot = resolve(projectRoot, "build-init-death");
    mkdirSync(buildRoot, { recursive: true });
    const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const tsupCli = resolve(packageRoot, "node_modules/tsup/dist/cli-default.js");
    const source = resolve(packageRoot, "src/lib/loop-store-v2.ts");
    const build = await child(
      tsupCli,
      source,
      "--format=esm",
      `--out-dir=${buildRoot}`,
    );
    expect(build.code, build.stderr).toBe(0);

    const bundle = resolve(buildRoot, "loop-store-v2.js");
    const inputPath = resolve(projectRoot, "initialize.json");
    writeFileSync(inputPath, JSON.stringify(initialized));
    const script = resolve(projectRoot, "initialize-and-die.mjs");
    writeFileSync(script, `
      import { pathToFileURL } from "node:url";
      import { readFile } from "node:fs/promises";
      const { LoopStoreV2 } = await import(pathToFileURL(process.argv[2]).href);
      const input = JSON.parse(await readFile(process.argv[4], "utf8"));
      const store = new LoopStoreV2({
        projectRoot: process.argv[3],
        faults(point) {
          if (point === "before_initialization_rename") process.kill(process.pid, "SIGKILL");
        },
      });
      await store.initialize(input);
    `);
    const died = await child(script, bundle, projectRoot, inputPath);
    expect(died.code).not.toBe(0);

    const paths = new LoopStoreV2({ projectRoot }).paths("race-change", "race-run");
    expect(existsSync(paths.runRoot!)).toBe(false);
    expect(readdirSync(paths.runs).some((name) => name.startsWith(".init-race-run-"))).toBe(true);

    const recovered = new LoopStoreV2({ projectRoot, lockStaleMs: 1_000 });
    await expect(recovered.initialize(initialized)).resolves.toEqual(initialized.state);
    await expect(recovered.inspect("race-change")).resolves.toMatchObject({
      state: { runId: "race-run" },
      events: [{ event: { type: "run_initialized" } }],
    });
  }, 20_000);

  it("enforces CAS across real Node processes", async () => {
    const projectRoot = fixtureRoot();
    const initialized = initial();
    await new LoopStoreV2({ projectRoot }).initialize(initialized);
    const input = transition(initialized.state);
    const buildRoot = resolve(projectRoot, "build");
    mkdirSync(buildRoot, { recursive: true });
    const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
    const tsupCli = resolve(packageRoot, "node_modules/tsup/dist/cli-default.js");
    const source = resolve(packageRoot, "src/lib/loop-store-v2.ts");
    const build = await child(
      tsupCli,
      source,
      "--format=esm",
      `--out-dir=${buildRoot}`,
    );
    expect(build.code, build.stderr).toBe(0);
    const bundle = resolve(buildRoot, "loop-store-v2.js");
    const inputPath = resolve(projectRoot, "transition.json");
    const otherInputPath = resolve(projectRoot, "transition-other.json");
    writeFileSync(inputPath, JSON.stringify(input));
    writeFileSync(otherInputPath, JSON.stringify(transition(initialized.state, "-other")));
    const script = resolve(projectRoot, "mutate.mjs");
    writeFileSync(script, `
      import { pathToFileURL } from "node:url";
      import { readFile } from "node:fs/promises";
      const { LoopStoreV2 } = await import(pathToFileURL(process.argv[2]).href);
      const input = JSON.parse(await readFile(process.argv[4], "utf8"));
      try {
        await new LoopStoreV2({ projectRoot: process.argv[3], lockTimeoutMs: 2000 }).transition(input);
        process.stdout.write("ok");
      } catch (error) {
        process.stdout.write(error.code ?? error.name);
        process.exitCode = 3;
      }
    `);
    const outcomes = await Promise.all([
      child(script, bundle, projectRoot, inputPath),
      child(script, bundle, projectRoot, otherInputPath),
    ]);
    expect(outcomes.map((outcome) => outcome.code).sort()).toEqual([0, 3]);
    expect(outcomes.map((outcome) => outcome.stdout).sort()).toEqual(["LOOP_CAS_CONFLICT", "ok"]);
  }, 20_000);
});
