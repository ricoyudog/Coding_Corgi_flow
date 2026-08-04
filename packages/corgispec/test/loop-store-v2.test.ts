import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LegacyWriterDetectedError,
  LoopStoreConflictError,
  LoopStoreCorruptionError,
  LoopStoreLockedError,
  LoopStorePathError,
  LoopStoreRecoveryRequiredError,
  LoopStoreSessionConflictError,
  LoopStoreV2,
  MultipleActiveRunsError,
  loopRunPathsV2,
  type LegacyMigrationMarkerV2,
  type LoopStoreFaultPoint,
  type WriteAttemptBundleV2Input,
} from "../src/lib/loop-store-v2.js";
import type {
  BundleSubmittedEventV2,
  EvaluationCompletedEventV2,
  LoopStateV2,
  RunInitializedEventV2,
  RunResumedEventV2,
} from "../src/lib/run-contract-v2.js";
import { reduceLoopEventV2 } from "../src/lib/loop-reducer-v2.js";

const roots: string[] = [];
const H = `sha256:${"a".repeat(64)}` as const;
const H2 = `sha256:${"b".repeat(64)}` as const;
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";

function root(): string {
  const value = mkdtempSync(resolve(tmpdir(), "corgi-store-v2-"));
  roots.push(value);
  return value;
}

function state(overrides: Partial<LoopStateV2> = {}): LoopStateV2 {
  const base: LoopStateV2 = {
    schemaVersion: 2,
    changeName: "change-a",
    runId: "run-a",
    supersedesRunId: null,
    owner: { id: "agent-a", kind: "agent" },
    sessionId: "session-a",
    mode: "self-driven",
    stateRevision: 0,
    nonce: "nonce-0",
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
    limits: { maxGroups: 2, maxAttemptsPerGroup: 3, maxEvents: 100 },
    blockedReason: null,
    planningRevision: H,
    git: {
      baselineRevision: "git-base",
      finalRevision: null,
      workspaceFingerprint: H,
    },
    tracking: { binding: null },
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
        commit: {
          status: "pending",
          revision: null,
          tree: null,
          workspaceFingerprint: null,
        },
        tracker: { status: "not_required", marker: null },
        completedAt: null,
      },
    },
    startedAt: T0,
    updatedAt: T0,
    completedAt: null,
  };
  return { ...base, ...overrides };
}

function initialEvent(value: LoopStateV2): RunInitializedEventV2 {
  return {
    schemaVersion: 2,
    type: "run_initialized",
    runId: value.runId,
    seq: 0,
    expectedStateRevision: -1,
    expectedNonce: null,
    nextNonce: value.nonce,
    occurredAt: value.updatedAt,
    actor: { id: "agent-a", kind: "agent" },
    initialState: value,
  };
}

function submitted(current: LoopStateV2): {
  event: BundleSubmittedEventV2;
  nextState: LoopStateV2;
} {
  const nextState = structuredClone(current);
  nextState.stateRevision = 1;
  nextState.lastEventSeq = 1;
  nextState.nonce = "nonce-1";
  nextState.updatedAt = T1;
  nextState.phase = "awaiting_evaluation";
  nextState.groups["TG-1"]!.bundle = {
    status: "submitted",
    bundleId: "bundle-1",
    bundleHash: H2,
    artifactHash: H,
    evidenceHash: null,
    reviewHash: null,
    observedGitRevision: "git-observed",
    workspaceFingerprint: H,
  };
  const event: BundleSubmittedEventV2 = {
    schemaVersion: 2,
    type: "bundle_submitted",
    runId: current.runId,
    seq: 1,
    expectedStateRevision: 0,
    expectedNonce: "nonce-0",
    nextNonce: "nonce-1",
    occurredAt: T1,
    actor: { id: "agent-a", kind: "agent" },
    groupId: "TG-1",
    attempt: 1,
    bundleId: "bundle-1",
    bundleHash: H2,
    artifactHash: H,
    observedGitRevision: "git-observed",
    workspaceFingerprint: H,
  };
  return { event, nextState };
}

function evaluated(current: LoopStateV2): {
  event: EvaluationCompletedEventV2;
  nextState: LoopStateV2;
} {
  const event: EvaluationCompletedEventV2 = {
    schemaVersion: 2,
    type: "evaluation_completed",
    runId: current.runId,
    seq: current.lastEventSeq + 1,
    expectedStateRevision: current.stateRevision,
    expectedNonce: current.nonce,
    nextNonce: "nonce-2",
    occurredAt: "2026-01-01T00:00:02.000Z",
    actor: { id: "agent-a", kind: "agent" },
    groupId: "TG-1",
    attempt: 1,
    result: "pass",
    evidenceHash: H,
    reviewHash: H2,
    reviewClean: true,
    reason: null,
  };
  return { event, nextState: reduceLoopEventV2(current, event).postState };
}

function cas(current: LoopStateV2) {
  return {
    changeName: current.changeName,
    runId: current.runId,
    sessionId: current.sessionId,
    expectedStateRevision: current.stateRevision,
    expectedNonce: current.nonce,
  };
}

async function initializedStore(
  projectRoot: string,
  faults?: (point: LoopStoreFaultPoint, context: { path?: string }) => void | Promise<void>,
) {
  const store = new LoopStoreV2({ projectRoot, faults });
  const value = state();
  await store.initialize({ state: value, event: initialEvent(value) });
  return { store, value };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe("LoopStoreV2 layout and transitions", () => {
  it("initializes the platform-independent layout and inspects it", async () => {
    const projectRoot = root();
    const store = new LoopStoreV2({ projectRoot });
    const value = state();
    await expect(store.initialize({ state: value, event: initialEvent(value) })).resolves.toEqual(value);

    const paths = loopRunPathsV2(projectRoot, "change-a", "run-a");
    expect(JSON.parse(readFileSync(paths.current, "utf8"))).toEqual({
      schemaVersion: 2,
      changeName: "change-a",
      runId: "run-a",
      stateRevision: 0,
      nonce: "nonce-0",
      updatedAt: T0,
    });
    expect(JSON.parse(readFileSync(paths.state!, "utf8"))).toEqual(value);
    expect(readFileSync(paths.events!, "utf8").trim().split("\n")).toHaveLength(1);
    expect(readFileSync(paths.reviewTriage!, "utf8")).toBe("");
    expect(existsSync(paths.lock)).toBe(false);

    await expect(store.inspect("change-a")).resolves.toMatchObject({
      current: { runId: "run-a", stateRevision: 0 },
      state: { runId: "run-a", nonce: "nonce-0" },
      events: [{ event: { type: "run_initialized", seq: 0 } }],
      recovered: false,
      repairedTrailingEvent: false,
    });
  });

  it("returns an empty inspection for an unknown change", async () => {
    const store = new LoopStoreV2({ projectRoot: root() });
    await expect(store.inspect("missing")).resolves.toEqual({
      current: null,
      state: null,
      events: [],
      recovered: false,
      repairedTrailingEvent: false,
    });
  });

  it("peeks without a lock or repairs and reports a stale pointer", async () => {
    const projectRoot = root();
    const { store } = await initializedStore(projectRoot);
    const current = store.paths("change-a").current;
    const stale = JSON.parse(readFileSync(current, "utf8"));
    stale.nonce = "stale-pointer";
    writeFileSync(current, JSON.stringify(stale));
    const before = readFileSync(current);
    await expect(store.peek("change-a")).resolves.toMatchObject({
      current: { nonce: "stale-pointer" },
      state: { nonce: "nonce-0" },
      recoveryRequired: true,
    });
    await expect(store.inspect("change-a", { readOnly: true })).resolves.toMatchObject({
      recoveryRequired: true,
    });
    expect(readFileSync(current)).toEqual(before);
    expect(existsSync(store.paths("change-a").lock)).toBe(false);
  });

  it("commits an event before an atomic state and current snapshot", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const update = submitted(value);
    await expect(store.transition({ ...cas(value), ...update })).resolves.toEqual(update.nextState);

    const paths = store.paths("change-a", "run-a");
    const lines = readFileSync(paths.events!, "utf8").trim().split("\n").map(JSON.parse);
    expect(lines.map((line) => line.event.seq)).toEqual([0, 1]);
    expect(JSON.parse(readFileSync(paths.state!, "utf8"))).toEqual(update.nextState);
    expect(JSON.parse(readFileSync(paths.current, "utf8"))).toMatchObject({
      stateRevision: 1,
      nonce: "nonce-1",
    });
    expect(readdirSync(paths.runRoot!).some((name) => name.includes(".tmp-"))).toBe(false);
    await expect(store.transition({ ...cas(value), ...update })).resolves.toEqual(update.nextState);
    await expect(
      store.transition({ ...cas(value), sessionId: "wrong", ...update }),
    ).rejects.toBeInstanceOf(LoopStoreSessionConflictError);
    expect(readFileSync(paths.events!, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("replays a latest resume with its superseded source session and exact CAS only", async () => {
    const projectRoot = root();
    const store = new LoopStoreV2({ projectRoot });
    const value = state({ mode: "hook-driven" });
    await store.initialize({ state: value, event: initialEvent(value) });

    const submit = submitted(value);
    await store.transition({ ...cas(value), ...submit });
    const failureEvent: EvaluationCompletedEventV2 = {
      schemaVersion: 2,
      type: "evaluation_completed",
      runId: value.runId,
      seq: 2,
      expectedStateRevision: 1,
      expectedNonce: "nonce-1",
      nextNonce: "nonce-2",
      occurredAt: "2026-01-01T00:00:02.000Z",
      actor: { id: "agent-a", kind: "agent" },
      groupId: "TG-1",
      attempt: 1,
      result: "verification_failed",
      evidenceHash: H,
      reviewHash: H2,
      reviewClean: true,
      reason: { code: "verification_failed", message: "tests failed", details: {} },
    };
    const failed = reduceLoopEventV2(submit.nextState, failureEvent).postState;
    await store.transition({ ...cas(submit.nextState), event: failureEvent, nextState: failed });

    const resumeEvent: RunResumedEventV2 = {
      schemaVersion: 2,
      type: "run_resumed",
      runId: value.runId,
      seq: 3,
      expectedStateRevision: 2,
      expectedNonce: "nonce-2",
      nextNonce: "nonce-3",
      occurredAt: "2026-01-01T00:00:03.000Z",
      actor: { id: "agent-a", kind: "agent" },
      sessionId: "session-b",
      targetPhase: "fixing",
      maxAttemptsPerGroup: 3,
    };
    const resumed = reduceLoopEventV2(failed, resumeEvent).postState;
    const resumeInput = { ...cas(failed), event: resumeEvent, nextState: resumed };
    await expect(store.transition(resumeInput)).resolves.toEqual(resumed);

    const paths = store.paths(value.changeName, value.runId);
    const beforeRetry = [paths.current, paths.events!, paths.state!]
      .map((path) => readFileSync(path));
    await expect(store.transition(resumeInput)).resolves.toEqual(resumed);
    expect([paths.current, paths.events!, paths.state!].map((path) => readFileSync(path)))
      .toEqual(beforeRetry);

    await expect(store.transition({ ...resumeInput, sessionId: "session-other" }))
      .rejects.toBeInstanceOf(LoopStoreSessionConflictError);
    await expect(store.transition({ ...resumeInput, expectedNonce: "different-cas" }))
      .rejects.toBeInstanceOf(LoopStoreSessionConflictError);
    expect([paths.current, paths.events!, paths.state!].map((path) => readFileSync(path)))
      .toEqual(beforeRetry);
  });

  it("supports idempotent initialization but rejects a competing active run", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    await expect(store.initialize({ state: value, event: initialEvent(value) })).resolves.toEqual(value);

    const competitor = state({ runId: "run-b", nonce: "nonce-b" });
    await expect(
      store.initialize({ state: competitor, event: initialEvent(competitor) }),
    ).rejects.toBeInstanceOf(LoopStoreConflictError);
  });

  it.each(["before_event_append", "after_event_write"] as const)(
    "retries initialization after crash point %s",
    async (faultPoint) => {
      const projectRoot = root();
      let armed = true;
      const store = new LoopStoreV2({
        projectRoot,
        faults: (point) => {
          if (armed && point === faultPoint) throw new Error(`init:${faultPoint}`);
        },
      });
      const value = state();
      const event = initialEvent(value);
      await expect(store.initialize({ state: value, event })).rejects.toThrow(`init:${faultPoint}`);
      if (faultPoint === "before_event_append") {
        expect(existsSync(store.paths("change-a", "run-a").runRoot!)).toBe(false);
      }
      armed = false;
      await expect(store.initialize({ state: value, event })).resolves.toEqual(value);
      await expect(store.inspect("change-a")).resolves.toMatchObject({
        state: { runId: "run-a" },
        events: [{ event: { type: "run_initialized" } }],
      });
    },
  );

  it.each([
    ["before_initialization_rename", false],
    ["after_initialization_rename", true],
  ] as const)(
    "retries initialization across publication fault %s",
    async (faultPoint, published) => {
      const projectRoot = root();
      let armed = true;
      const store = new LoopStoreV2({
        projectRoot,
        faults: (point) => {
          if (armed && point === faultPoint) throw new Error(`init:${faultPoint}`);
        },
      });
      const value = state();
      const event = initialEvent(value);
      const paths = store.paths("change-a", "run-a");

      await expect(store.initialize({ state: value, event }))
        .rejects.toThrow(`init:${faultPoint}`);
      expect(existsSync(paths.runRoot!)).toBe(published);
      expect(readdirSync(paths.runs).filter((name) => name.startsWith(".init-"))).toEqual([]);
      if (published) {
        expect(JSON.parse(readFileSync(paths.state!, "utf8"))).toEqual(value);
        expect(readFileSync(paths.events!, "utf8").trim().split("\n")).toHaveLength(1);
        expect(existsSync(paths.current)).toBe(false);
      }

      armed = false;
      await expect(store.initialize({ state: value, event })).resolves.toEqual(value);
      await expect(store.inspect("change-a")).resolves.toMatchObject({
        state: { runId: "run-a" },
        events: [{ event: { type: "run_initialized" } }],
      });
    },
  );

  it("fails stale and session-conflicting CAS without changing canonical files", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const update = submitted(value);
    const paths = store.paths("change-a", "run-a");
    const before = [paths.state!, paths.events!, paths.current].map((path) => readFileSync(path));

    await expect(
      store.transition({ ...cas(value), expectedNonce: "stale", ...update }),
    ).rejects.toBeInstanceOf(LoopStoreConflictError);
    await expect(
      store.transition({ ...cas(value), sessionId: "other", ...update }),
    ).rejects.toBeInstanceOf(LoopStoreSessionConflictError);
    expect([paths.state!, paths.events!, paths.current].map((path) => readFileSync(path))).toEqual(before);
  });

  it("rejects event/state identity and monotonicity violations", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const update = submitted(value);
    await expect(
      store.transition({
        ...cas(value),
        event: { ...update.event, runId: "run-b" },
        nextState: update.nextState,
      }),
    ).rejects.toThrow();
    await expect(
      store.transition({
        ...cas(value),
        event: { ...update.event, seq: 2 },
        nextState: { ...update.nextState, lastEventSeq: 2, stateRevision: 2 },
      }),
    ).rejects.toThrow();
    const badInitial = initialEvent(value);
    badInitial.initialState = { ...value, sessionId: "wrong" };
    await expect(
      new LoopStoreV2({ projectRoot: root() }).initialize({ state: value, event: badInitial }),
    ).rejects.toBeInstanceOf(LoopStoreConflictError);
    const wrongActor = initialEvent(value);
    wrongActor.actor = { id: "different-owner", kind: "agent" };
    await expect(
      new LoopStoreV2({ projectRoot: root() }).initialize({ state: value, event: wrongActor }),
    ).rejects.toBeInstanceOf(LoopStoreConflictError);
  });
});

describe("LoopStoreV2 recovery and corruption handling", () => {
  it.each([
    ["after_event_fsync", "ENOSPC"],
    ["before_state_temp_write", "EACCES"],
  ] as const)("recovers event-first crash at %s", async (faultPoint, code) => {
    const projectRoot = root();
    let armed = false;
    const { store, value } = await initializedStore(projectRoot, (point) => {
      if (armed && point === faultPoint) throw Object.assign(new Error(code), { code });
    });
    const update = submitted(value);
    armed = true;
    await expect(store.transition({ ...cas(value), ...update })).rejects.toMatchObject({ code });
    armed = false;

    const inspection = await new LoopStoreV2({ projectRoot }).inspect("change-a");
    expect(inspection.state).toEqual(update.nextState);
    expect(inspection.events).toHaveLength(2);
    expect(inspection.recovered).toBe(true);
  });

  it("repairs a stale current pointer after state rename crash", async () => {
    const projectRoot = root();
    let armed = false;
    const { store, value } = await initializedStore(projectRoot, (point) => {
      if (armed && point === "after_state_rename") throw new Error("power loss");
    });
    const update = submitted(value);
    armed = true;
    await expect(store.transition({ ...cas(value), ...update })).rejects.toThrow("power loss");
    armed = false;
    const inspection = await new LoopStoreV2({ projectRoot }).inspect("change-a");
    expect(inspection).toMatchObject({
      state: { stateRevision: 1 },
      current: { stateRevision: 1 },
      recovered: true,
    });
  });

  it.each([
    "before_event_append",
    "after_event_write",
    "after_state_temp_fsync",
    "before_state_rename",
    "after_state_directory_fsync",
    "before_current_rename",
    "after_current_rename",
  ] as const)("is crash-consistent at injected fault %s", async (faultPoint) => {
    const projectRoot = root();
    let armed = false;
    const { store, value } = await initializedStore(projectRoot, (point) => {
      if (armed && point === faultPoint) throw new Error(`crash:${faultPoint}`);
    });
    const update = submitted(value);
    armed = true;
    await expect(store.transition({ ...cas(value), ...update })).rejects.toThrow(`crash:${faultPoint}`);
    armed = false;
    const inspection = await store.inspect("change-a");
    if (faultPoint === "before_event_append") {
      expect(inspection.state?.stateRevision).toBe(0);
      await expect(store.transition({ ...cas(value), ...update })).resolves.toEqual(update.nextState);
    } else {
      expect(inspection.state?.stateRevision).toBe(1);
      expect(inspection.events).toHaveLength(2);
    }
  });

  it("truncates only a malformed final unterminated JSONL record", async () => {
    const projectRoot = root();
    const { store } = await initializedStore(projectRoot);
    const events = store.paths("change-a", "run-a").events!;
    const validLength = readFileSync(events).length;
    appendFileSync(events, '{"schemaVersion":2');
    await expect(store.inspect("change-a")).resolves.toMatchObject({
      repairedTrailingEvent: true,
      events: [{ event: { seq: 0 } }],
    });
    expect(lstatSync(events).size).toBe(validLength);
  });

  it("makes read-only inspection reject a truncated tail without repairing it", async () => {
    const projectRoot = root();
    const { store } = await initializedStore(projectRoot);
    const events = store.paths("change-a", "run-a").events!;
    appendFileSync(events, "{truncated");
    const before = readFileSync(events);
    await expect(store.peek("change-a")).rejects.toBeInstanceOf(
      LoopStoreRecoveryRequiredError,
    );
    expect(readFileSync(events)).toEqual(before);
  });

  it("durably restores a missing final JSONL delimiter only in mutating inspection", async () => {
    const projectRoot = root();
    const { store } = await initializedStore(projectRoot);
    const events = store.paths("change-a", "run-a").events!;
    const terminated = readFileSync(events);
    truncateSync(events, terminated.length - 1);
    const before = readFileSync(events);
    await expect(store.peek("change-a")).rejects.toBeInstanceOf(
      LoopStoreRecoveryRequiredError,
    );
    expect(readFileSync(events)).toEqual(before);
    await expect(store.inspect("change-a")).resolves.toMatchObject({
      repairedTrailingEvent: true,
    });
    expect(readFileSync(events, "utf8").endsWith("\n")).toBe(true);
  });

  it("fails closed for middle corruption and a complete invalid final line", async () => {
    for (const suffix of ["{bad}\n{}\n", "{bad}\n"]) {
      const projectRoot = root();
      const { store } = await initializedStore(projectRoot);
      const events = store.paths("change-a", "run-a").events!;
      appendFileSync(events, suffix);
      const before = readFileSync(events);
      await expect(store.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
      expect(readFileSync(events)).toEqual(before);
    }
  });

  it("fails when state is ahead of or disagrees with its event log", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const paths = store.paths("change-a", "run-a");
    writeFileSync(paths.state!, JSON.stringify({ ...value, sessionId: "tampered" }));
    await expect(store.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);

    writeFileSync(paths.state!, JSON.stringify({
      ...value,
      stateRevision: 1,
      lastEventSeq: 1,
      nonce: "nonce-1",
      updatedAt: T1,
    }));
    await expect(store.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
  });

  it("recovers a missing snapshot from the durable event post-state", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const paths = store.paths("change-a", "run-a");
    rmSync(paths.state!);
    const inspection = await store.inspect("change-a");
    expect(inspection.state).toEqual(value);
    expect(inspection.recovered).toBe(true);
  });

  it("requires mutating recovery when read-only state is missing or behind", async () => {
    const missingRoot = root();
    const { store: missingStore } = await initializedStore(missingRoot);
    rmSync(missingStore.paths("change-a", "run-a").state!);
    await expect(missingStore.peek("change-a")).rejects.toBeInstanceOf(
      LoopStoreRecoveryRequiredError,
    );

    const behindRoot = root();
    const { store, value } = await initializedStore(behindRoot);
    const update = submitted(value);
    appendFileSync(store.paths("change-a", "run-a").events!, `${JSON.stringify({
      schemaVersion: 2,
      event: update.event,
      postState: update.nextState,
    })}\n`);
    await expect(store.peek("change-a")).rejects.toBeInstanceOf(
      LoopStoreRecoveryRequiredError,
    );
  });

  it("rejects an orphan snapshot without the initialization event", async () => {
    const projectRoot = root();
    const { store } = await initializedStore(projectRoot);
    writeFileSync(store.paths("change-a", "run-a").events!, "");
    await expect(store.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
  });

  it("rejects missing events, an empty run, invalid state, and empty JSONL records", async () => {
    const missingEvents = root();
    const { store: first } = await initializedStore(missingEvents);
    rmSync(first.paths("change-a", "run-a").events!);
    await expect(first.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);

    const emptyRun = root();
    mkdirSync(resolve(emptyRun, ".corgi/loop/change-a/runs/run-empty"), { recursive: true });
    await expect(new LoopStoreV2({ projectRoot: emptyRun }).inspect("change-a"))
      .rejects.toBeInstanceOf(LoopStoreCorruptionError);

    const invalidState = root();
    const { store: second } = await initializedStore(invalidState);
    writeFileSync(second.paths("change-a", "run-a").state!, "{");
    await expect(second.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);

    const emptyLine = root();
    const { store: third } = await initializedStore(emptyLine);
    appendFileSync(third.paths("change-a", "run-a").events!, "\n");
    await expect(third.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
  });

  it("rejects a structurally valid event that cannot follow the previous event", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    appendFileSync(store.paths("change-a", "run-a").events!, `${JSON.stringify({
      schemaVersion: 2,
      event: initialEvent(value),
      postState: value,
    })}\n`);
    await expect(store.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
  });

  it("replays every record through the reducer and rejects forged post-state", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const update = submitted(value);
    const paths = store.paths("change-a", "run-a");
    appendFileSync(paths.events!, `${JSON.stringify({
      schemaVersion: 2,
      event: update.event,
      postState: { ...update.nextState, sessionId: "forged" },
    })}\n`);
    writeFileSync(paths.state!, JSON.stringify({ ...update.nextState, sessionId: "forged" }));
    await expect(store.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
  });

  it("detects multiple active runs instead of selecting the first", async () => {
    const projectRoot = root();
    const { store } = await initializedStore(projectRoot);
    const other = state({ runId: "run-b", nonce: "nonce-b" });
    const paths = store.paths("change-a", "run-b");
    mkdirSync(paths.runRoot!, { recursive: true });
    writeFileSync(paths.state!, `${JSON.stringify(other)}\n`);
    writeFileSync(paths.events!, `${JSON.stringify({
      schemaVersion: 2,
      event: initialEvent(other),
      postState: other,
    })}\n`);
    await expect(store.inspect("change-a")).rejects.toBeInstanceOf(MultipleActiveRunsError);
    await expect(store.peek("change-a")).rejects.toBeInstanceOf(MultipleActiveRunsError);
    const third = state({ runId: "run-c", nonce: "nonce-c" });
    await expect(store.initialize({ state: third, event: initialEvent(third) }))
      .rejects.toBeInstanceOf(MultipleActiveRunsError);
    await expect(store.writeAttemptBundle({
      ...cas(state()),
      groupId: "TG-1",
      attempt: 1,
      files: {},
      bundle: { schemaVersion: 2, runId: "run-a", groupId: "TG-1", attempt: 1 },
    })).rejects.toBeInstanceOf(MultipleActiveRunsError);
  });

  it("uses active fallback without current.json and keeps read-only inspection inert", async () => {
    const projectRoot = root();
    const { store } = await initializedStore(projectRoot);
    const current = store.paths("change-a").current;
    rmSync(current);
    await expect(store.peek("change-a")).resolves.toMatchObject({
      current: null,
      state: { runId: "run-a" },
      recoveryRequired: true,
    });
    expect(existsSync(current)).toBe(false);
    await expect(store.inspect("change-a")).resolves.toMatchObject({
      current: { runId: "run-a" },
      recovered: true,
    });
    expect(existsSync(current)).toBe(true);
  });

  it("does not invent a current terminal run without an explicit run id", async () => {
    const projectRoot = root();
    const terminal = state({
      runId: "run-terminal",
      nonce: "terminal-nonce",
      phase: "invalidated",
      blockedReason: { code: "manual", message: "stopped", details: {} },
      completedAt: T0,
      groups: {
        "TG-1": {
          ...state().groups["TG-1"]!,
          status: "invalidated",
        },
      },
    });
    const store = new LoopStoreV2({ projectRoot });
    await store.initialize({ state: terminal, event: initialEvent(terminal) });
    await expect(store.initialize({ state: terminal, event: initialEvent(terminal) }))
      .resolves.toEqual(terminal);
    rmSync(store.paths("change-a").current);
    await expect(store.inspect("change-a")).resolves.toMatchObject({ state: null, current: null });
    await expect(store.peek("change-a")).resolves.toMatchObject({ state: null, current: null });
    await expect(store.inspect("change-a", { runId: "run-terminal" })).resolves.toMatchObject({
      state: { phase: "invalidated" },
    });
    expect(existsSync(store.paths("change-a").current)).toBe(false);
  });

  it("prefers and repairs the unique active run over a stale terminal pointer", async () => {
    const projectRoot = root();
    let armed = false;
    const store = new LoopStoreV2({
      projectRoot,
      faults: (point) => {
        if (armed && point === "before_current_rename") throw new Error("crash-before-current");
      },
    });
    const terminal = state({
      runId: "run-old",
      nonce: "old-nonce",
      phase: "invalidated",
      blockedReason: { code: "manual", message: "old", details: {} },
      completedAt: T0,
      groups: { "TG-1": { ...state().groups["TG-1"]!, status: "invalidated" } },
    });
    await store.initialize({ state: terminal, event: initialEvent(terminal) });
    const active = state({ runId: "run-new", nonce: "new-nonce" });
    const activeEvent = initialEvent(active);
    armed = true;
    await expect(store.initialize({ state: active, event: activeEvent }))
      .rejects.toThrow("crash-before-current");
    armed = false;
    expect(JSON.parse(readFileSync(store.paths("change-a").current, "utf8")).runId).toBe("run-old");
    await expect(store.peek("change-a")).resolves.toMatchObject({
      current: { runId: "run-old" },
      state: { runId: "run-new" },
      recoveryRequired: true,
    });
    await expect(store.inspect("change-a")).resolves.toMatchObject({
      current: { runId: "run-new" },
      state: { runId: "run-new" },
      recovered: true,
    });
  });
});

describe("LoopStoreV2 attempt and review artifacts", () => {
  function bundleInput(value: LoopStateV2): WriteAttemptBundleV2Input {
    return {
      ...cas(value),
      groupId: "TG-1",
      attempt: 1,
      files: {
        "evidence.json": { status: "pass" },
        "logs/test.txt": "ok\n",
      },
      bundle: {
        schemaVersion: 2,
        runId: value.runId,
        groupId: "TG-1",
        attempt: 1,
        bundleId: "bundle-1",
      },
    };
  }

  it("publishes bundle.json last and makes identical submits idempotent", async () => {
    const projectRoot = root();
    let checked = false;
    const { store, value } = await initializedStore(projectRoot, (point, context) => {
      if (point === "before_bundle_marker") {
        checked = true;
        expect(existsSync(resolve(context.path!, "evidence.json"))).toBe(true);
        expect(existsSync(resolve(context.path!, "logs/test.txt"))).toBe(true);
        expect(existsSync(resolve(context.path!, "bundle.json"))).toBe(false);
      }
    });
    const input = bundleInput(value);
    const first = await store.writeAttemptBundle(input);
    expect(first.idempotent).toBe(false);
    expect(checked).toBe(true);
    expect(JSON.parse(readFileSync(resolve(first.path, "bundle.json"), "utf8"))).toEqual(input.bundle);
    await expect(store.writeAttemptBundle(input)).resolves.toEqual({
      path: first.path,
      idempotent: true,
    });
  });

  it("rejects conflicting, incomplete, and unsafe attempt bundles", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const input = bundleInput(value);
    const committed = await store.writeAttemptBundle(input);
    await expect(
      store.writeAttemptBundle({ ...input, files: { ...input.files, "logs/test.txt": "changed" } }),
    ).rejects.toBeInstanceOf(LoopStoreConflictError);
    await expect(
      store.writeAttemptBundle({ ...input, attempt: 2, bundle: { ...input.bundle, attempt: 1 } }),
    ).rejects.toBeInstanceOf(LoopStoreConflictError);
    await expect(
      store.writeAttemptBundle({ ...input, attempt: 0, bundle: { ...input.bundle, attempt: 0 } }),
    ).rejects.toBeInstanceOf(LoopStorePathError);
    await expect(
      store.writeAttemptBundle({
        ...input,
        attempt: 2,
        files: { "../escape": "bad" },
        bundle: { ...input.bundle, attempt: 2 },
      }),
    ).rejects.toBeInstanceOf(LoopStorePathError);
    rmSync(resolve(committed.path, "bundle.json"));
    await expect(store.writeAttemptBundle(input)).rejects.toBeInstanceOf(LoopStoreCorruptionError);
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinked bundle, evidence, and review leaves before transaction logs change",
    async () => {
      const projectRoot = root();
      const outside = root();
      const { store, value } = await initializedStore(projectRoot);
      const input = bundleInput(value);
      input.files["review.json"] = { findings: [] };
      const committed = await store.writeAttemptBundle(input);
      const submit = submitted(value);
      const triage = {
        schemaVersion: 2 as const,
        runId: value.runId,
        groupId: "TG-1",
        attempt: 1,
        bundleId: "bundle-1",
        findingFingerprint: H,
        action: "dismissed" as const,
        actor: { kind: "human" as const, id: "reviewer" },
        reason: "Must remain unwritten on unsafe storage",
        occurredAt: T1,
      };
      const paths = store.paths("change-a", "run-a");

      for (const leaf of ["bundle.json", "evidence.json", "review.json"]) {
        const canonical = resolve(committed.path, leaf);
        const external = resolve(outside, leaf);
        const original = readFileSync(canonical);
        writeFileSync(external, original);
        rmSync(canonical);
        symlinkSync(external, canonical);
        const before = [paths.events!, paths.reviewTriage!].map((path) => readFileSync(path));

        await expect(store.submitAttemptTransaction({
          ...input,
          transitions: [submit],
          triageEntries: [triage],
        })).rejects.toBeInstanceOf(LoopStorePathError);
        expect([paths.events!, paths.reviewTriage!].map((path) => readFileSync(path))).toEqual(before);

        rmSync(canonical);
        writeFileSync(canonical, original);
      }
    },
  );

  it("does not expose a partial attempt when artifact or marker writes fail", async () => {
    for (const faultPoint of ["after_bundle_artifacts_fsync", "after_bundle_marker_fsync"] as const) {
      const projectRoot = root();
      let armed = false;
      const { store, value } = await initializedStore(projectRoot, (point) => {
        if (armed && point === faultPoint) {
          throw Object.assign(new Error("disk failure"), { code: "ENOSPC" });
        }
      });
      armed = true;
      await expect(store.writeAttemptBundle(bundleInput(value))).rejects.toMatchObject({ code: "ENOSPC" });
      const groupRoot = resolve(store.paths("change-a", "run-a").attempts!, "TG-1");
      expect(readdirSync(groupRoot)).toEqual([]);
    }
  });

  it.each([
    ["before_bundle_artifacts", "ENOSPC", false],
    ["before_bundle_marker", "EACCES", false],
    ["before_bundle_rename", "ENOSPC", false],
    ["after_bundle_rename", "EACCES", true],
  ] as const)(
    "recovers an exact transaction at bundle fault %s",
    async (faultPoint, code, targetVisibleAfterFailure) => {
      const projectRoot = root();
      let armed = false;
      const { store, value } = await initializedStore(projectRoot, (point) => {
        if (armed && point === faultPoint) {
          throw Object.assign(new Error(`${faultPoint}:${code}`), { code });
        }
      });
      const submit = submitted(value);
      const evaluate = evaluated(submit.nextState);
      const transaction = {
        ...bundleInput(value),
        transitions: [submit, evaluate],
      };
      const paths = store.paths("change-a", "run-a");
      const target = resolve(paths.attempts!, "TG-1/1");
      armed = true;
      await expect(store.submitAttemptTransaction(transaction)).rejects.toMatchObject({ code });
      expect(existsSync(target)).toBe(targetVisibleAfterFailure);
      expect(readFileSync(paths.events!, "utf8").trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(readFileSync(paths.state!, "utf8")).stateRevision).toBe(0);

      armed = false;
      await expect(store.submitAttemptTransaction(transaction)).resolves.toMatchObject({
        state: { stateRevision: 2, phase: "awaiting_group_commit" },
      });
      expect(existsSync(resolve(target, "bundle.json"))).toBe(true);
      expect(readFileSync(paths.events!, "utf8").trim().split("\n")).toHaveLength(3);
    },
  );

  it.each([
    ["artifact-open", "EACCES"],
    ["attempt-rename", "ENOSPC"],
  ] as const)(
    "recovers a transaction from real filesystem %s failure (%s)",
    async (failure, code) => {
      const projectRoot = root();
      const { open: realOpen, rename: realRename } = await import("node:fs/promises");
      let armed = false;
      const store = new LoopStoreV2({
        projectRoot,
        fs: {
          open: async (path, flags, mode) => {
            if (
              armed &&
              failure === "artifact-open" &&
              path.includes(`${sep}attempts${sep}`) &&
              path.endsWith("evidence.json")
            ) {
              throw Object.assign(new Error(code), { code });
            }
            return realOpen(path, flags, mode);
          },
          rename: async (from, to) => {
            if (
              armed &&
              failure === "attempt-rename" &&
              from.includes(`${sep}.tmp-1-`) &&
              to.endsWith(`${sep}attempts${sep}TG-1${sep}1`)
            ) {
              throw Object.assign(new Error(code), { code });
            }
            await realRename(from, to);
          },
        },
      });
      const value = state();
      await store.initialize({ state: value, event: initialEvent(value) });
      const submit = submitted(value);
      const evaluate = evaluated(submit.nextState);
      const transaction = {
        ...bundleInput(value),
        transitions: [submit, evaluate],
      };
      const paths = store.paths("change-a", "run-a");
      const target = resolve(paths.attempts!, "TG-1/1");
      armed = true;
      await expect(store.submitAttemptTransaction(transaction)).rejects.toMatchObject({ code });
      expect(existsSync(target)).toBe(false);
      expect(readFileSync(paths.events!, "utf8").trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(readFileSync(paths.state!, "utf8")).stateRevision).toBe(0);

      armed = false;
      await expect(store.submitAttemptTransaction(transaction)).resolves.toMatchObject({
        state: { stateRevision: 2 },
      });
      expect(existsSync(resolve(target, "bundle.json"))).toBe(true);
    },
  );

  it("appends only reasoned human review triage under CAS", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const entry = {
      schemaVersion: 2 as const,
      runId: "run-a",
      groupId: "TG-1",
      attempt: 1,
      bundleId: "bundle-1",
      findingFingerprint: H,
      action: "accepted-risk" as const,
      actor: { kind: "human" as const, id: "reviewer" },
      reason: "Known compatibility constraint",
      occurredAt: T1,
    };
    await store.appendReviewTriage({ ...cas(value), entry });
    await store.appendReviewTriage({ ...cas(value), entry });
    expect(readFileSync(store.paths("change-a", "run-a").reviewTriage!, "utf8").trim()).toBe(
      JSON.stringify(entry),
    );
    await expect(
      store.appendReviewTriage({
        ...cas(value),
        entry: { ...entry, actor: { kind: "agent" as "human", id: "bot" } },
      }),
    ).rejects.toBeInstanceOf(LoopStoreConflictError);
    await expect(
      store.appendReviewTriage({ ...cas(value), entry: { ...entry, reason: "" } }),
    ).rejects.toBeInstanceOf(LoopStoreConflictError);
    await expect(
      store.appendReviewTriage({ ...cas(value), entry: { ...entry, reason: "different" } }),
    ).rejects.toBeInstanceOf(LoopStoreConflictError);
    await expect(
      store.appendReviewTriage({ ...cas(value), entry: { ...entry, action: "dismissed" } }),
    ).rejects.toBeInstanceOf(LoopStoreConflictError);
    await store.appendReviewTriage({
      ...cas(value),
      entry: { ...entry, attempt: 2, bundleId: "bundle-2" },
    });
    expect(readFileSync(store.paths("change-a", "run-a").reviewTriage!, "utf8").trim().split("\n"))
      .toHaveLength(2);
  });

  it("commits bundle, triage, submit, and evaluation under one idempotent transaction", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const bundle = bundleInput(value);
    const submit = submitted(value);
    const evaluate = evaluated(submit.nextState);
    const triage = {
      schemaVersion: 2 as const,
      runId: "run-a",
      groupId: "TG-1",
      attempt: 1,
      bundleId: "bundle-1",
      findingFingerprint: H,
      action: "dismissed" as const,
      actor: { kind: "human" as const, id: "reviewer" },
      reason: "False positive",
      occurredAt: T1,
    };
    const transaction = {
      ...bundle,
      triageEntries: [triage],
      transitions: [submit, evaluate],
    };
    const first = await store.submitAttemptTransaction(transaction);
    expect(first).toMatchObject({
      state: { stateRevision: 2, phase: "awaiting_group_commit" },
      bundle: { idempotent: false },
      idempotent: false,
    });
    const paths = store.paths("change-a", "run-a");
    expect(readFileSync(paths.events!, "utf8").trim().split("\n")).toHaveLength(3);
    expect(readFileSync(paths.reviewTriage!, "utf8").trim().split("\n")).toHaveLength(1);

    const second = await store.submitAttemptTransaction(transaction);
    expect(second).toMatchObject({ idempotent: true, state: { stateRevision: 2 } });
    expect(readFileSync(paths.events!, "utf8").trim().split("\n")).toHaveLength(3);
    expect(readFileSync(paths.reviewTriage!, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it.each(["after_bundle_rename", "after_state_directory_fsync"] as const)(
    "resumes an exact transaction after crash point %s",
    async (faultPoint) => {
      const projectRoot = root();
      let armed = false;
      let stateFaulted = false;
      const { store, value } = await initializedStore(projectRoot, (point, context) => {
        if (!armed || point !== faultPoint) return;
        if (point === "after_state_directory_fsync") {
          const snapshot = JSON.parse(readFileSync(resolve(context.path!, "state.json"), "utf8"));
          if (snapshot.stateRevision !== 1 || stateFaulted) return;
          stateFaulted = true;
        }
        throw new Error("simulated crash");
      });
      const submit = submitted(value);
      const evaluate = evaluated(submit.nextState);
      const transaction = {
        ...bundleInput(value),
        transitions: [submit, evaluate],
      };
      armed = true;
      await expect(store.submitAttemptTransaction(transaction)).rejects.toThrow("simulated crash");
      armed = false;
      await expect(store.submitAttemptTransaction(transaction)).resolves.toMatchObject({
        state: { stateRevision: 2, phase: "awaiting_group_commit" },
      });
      expect(readFileSync(store.paths("change-a", "run-a").events!, "utf8").trim().split("\n"))
        .toHaveLength(3);
    },
  );

  it("rejects a conflicting transaction before writing triage or artifacts", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const submit = submitted(value);
    const evaluate = evaluated(submit.nextState);
    const base = { ...bundleInput(value), transitions: [submit, evaluate] };
    await store.submitAttemptTransaction(base);
    const paths = store.paths("change-a", "run-a");
    const before = [paths.events!, paths.reviewTriage!].map((path) => readFileSync(path));
    const different = submitted(value);
    different.event.bundleId = "different";
    different.nextState.groups["TG-1"]!.bundle.bundleId = "different";
    await expect(store.submitAttemptTransaction({
      ...base,
      triageEntries: [{
        schemaVersion: 2,
        runId: "run-a",
        groupId: "TG-1",
        attempt: 1,
        bundleId: "bundle-1",
        findingFingerprint: H,
        action: "dismissed",
        actor: { kind: "human", id: "reviewer" },
        reason: "No write",
        occurredAt: T1,
      }],
      transitions: [different, evaluate],
    })).rejects.toBeInstanceOf(LoopStoreConflictError);
    expect([paths.events!, paths.reviewTriage!].map((path) => readFileSync(path))).toEqual(before);
  });

  it("prevalidates artifact paths and triage batches before any transaction write", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const submit = submitted(value);
    const paths = store.paths("change-a", "run-a");
    const before = [paths.events!, paths.reviewTriage!].map((path) => readFileSync(path));
    const triage = {
      schemaVersion: 2 as const,
      runId: "run-a",
      groupId: "TG-1",
      attempt: 1,
      bundleId: "bundle-1",
      findingFingerprint: H,
      action: "dismissed" as const,
      actor: { kind: "human" as const, id: "reviewer" },
      reason: "first",
      occurredAt: T1,
    };
    const base = {
      ...bundleInput(value),
      triageEntries: [triage],
      transitions: [submit],
    };
    for (const files of [
      { "bundle.json": "reserved" },
      { "BUNDLE.JSON": "reserved case-fold" },
      { "../escape": "bad" },
      { a: "file", "a/b": "child" },
      { "A.txt": "upper", "a.txt": "lower" },
      { Dir: "file", "dir/file.txt": "child" },
    ]) {
      await expect(store.submitAttemptTransaction({ ...base, files }))
        .rejects.toBeInstanceOf(LoopStorePathError);
      expect([paths.events!, paths.reviewTriage!].map((path) => readFileSync(path))).toEqual(before);
      expect(existsSync(resolve(paths.attempts!, "TG-1/1"))).toBe(false);
    }
    for (const invalidPath of [
      "bad\u0001control",
      "bad\u007fcontrol",
      "bad<name",
      "bad>name",
      "bad:name",
      'bad"name',
      "bad|name",
      "bad?name",
      "bad*name",
      "trailing.",
      "trailing ",
      "CON",
      "prn.txt",
      "Aux",
      "NUL.bin",
      "COM1",
      "com9.log",
      "LPT1",
      "lpt9.txt",
      "a//b",
      "a/../b",
      "./a",
      "C:/absolute",
      "C:drive-relative",
      String.raw`\\server\share\file`,
      "//server/share/file",
      String.raw`dir\windows-separator`,
    ]) {
      await expect(store.submitAttemptTransaction({
        ...base,
        files: { [invalidPath]: "bad" },
      })).rejects.toBeInstanceOf(LoopStorePathError);
      expect([paths.events!, paths.reviewTriage!].map((path) => readFileSync(path))).toEqual(before);
      expect(existsSync(resolve(paths.attempts!, "TG-1/1"))).toBe(false);
    }
    for (const mismatched of [
      { ...triage, groupId: "TG-other" },
      { ...triage, attempt: 2 },
      { ...triage, bundleId: "bundle-other" },
    ]) {
      await expect(store.submitAttemptTransaction({ ...base, triageEntries: [mismatched] }))
        .rejects.toBeInstanceOf(LoopStoreConflictError);
      expect([paths.events!, paths.reviewTriage!].map((path) => readFileSync(path))).toEqual(before);
      expect(existsSync(resolve(paths.attempts!, "TG-1/1"))).toBe(false);
    }
    await expect(store.submitAttemptTransaction({
      ...base,
      triageEntries: [triage, { ...triage, reason: "conflict" }],
    })).rejects.toBeInstanceOf(LoopStoreConflictError);
    await expect(store.submitAttemptTransaction({
      ...base,
      triageEntries: [triage, { ...triage, action: "accepted-risk" }],
    })).rejects.toBeInstanceOf(LoopStoreConflictError);
    expect([paths.events!, paths.reviewTriage!].map((path) => readFileSync(path))).toEqual(before);

    await store.appendReviewTriage({ ...cas(value), entry: triage });
    const withExisting = [paths.events!, paths.reviewTriage!].map((path) => readFileSync(path));
    await expect(store.submitAttemptTransaction({
      ...base,
      triageEntries: [
        { ...triage, findingFingerprint: H2 },
        { ...triage, reason: "different-existing" },
      ],
    })).rejects.toBeInstanceOf(LoopStoreConflictError);
    expect([paths.events!, paths.reviewTriage!].map((path) => readFileSync(path))).toEqual(withExisting);
  });

  it("validates transaction attempt, transitions, session, and historical token", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const submit = submitted(value);
    const evaluate = evaluated(submit.nextState);
    const base = { ...bundleInput(value), transitions: [submit, evaluate] };
    await expect(store.submitAttemptTransaction({
      ...base,
      attempt: 0,
      bundle: { ...base.bundle, attempt: 0 },
    })).rejects.toBeInstanceOf(LoopStorePathError);
    await expect(store.submitAttemptTransaction({ ...base, transitions: [] }))
      .rejects.toBeInstanceOf(LoopStoreConflictError);
    await expect(store.submitAttemptTransaction({ ...base, sessionId: "wrong" }))
      .rejects.toBeInstanceOf(LoopStoreSessionConflictError);

    await store.submitAttemptTransaction(base);
    await expect(store.submitAttemptTransaction({ ...base, expectedNonce: "wrong-history" }))
      .rejects.toBeInstanceOf(LoopStoreConflictError);
  });

  it("rejects a partial historical transaction after unrelated advancement", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const submit = submitted(value);
    const evaluate = evaluated(submit.nextState);
    const base = { ...bundleInput(value), transitions: [submit, evaluate] };
    await store.submitAttemptTransaction(base);
    const impossibleTail = {
      ...evaluate,
      event: { ...evaluate.event, seq: 3, expectedStateRevision: 2, expectedNonce: "nonce-2", nextNonce: "nonce-3", occurredAt: "2026-01-01T00:00:03.000Z" },
      nextState: { ...evaluate.nextState, stateRevision: 3, lastEventSeq: 3, nonce: "nonce-3", updatedAt: "2026-01-01T00:00:03.000Z" },
    };
    await expect(store.submitAttemptTransaction({
      ...base,
      transitions: [submit, impossibleTail],
    })).rejects.toBeInstanceOf(LoopStoreConflictError);
  });
});

describe("LoopStoreV2 path and legacy guards", () => {
  it.each(["../change", "a/b", ".", "..", ""])("rejects unsafe change segment %j", (name) => {
    expect(() => loopRunPathsV2(root(), name)).toThrow(LoopStorePathError);
  });

  it("rejects symlinks in canonical storage", async () => {
    const projectRoot = root();
    const outside = root();
    symlinkSync(outside, resolve(projectRoot, ".corgi"), "dir");
    const store = new LoopStoreV2({ projectRoot });
    const value = state();
    await expect(store.initialize({ state: value, event: initialEvent(value) })).rejects.toBeInstanceOf(
      LoopStorePathError,
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked canonical run discovered without a current pointer",
    async () => {
      const projectRoot = root();
      const outside = root();
      const runs = resolve(projectRoot, ".corgi/loop/change-a/runs");
      mkdirSync(runs, { recursive: true });
      symlinkSync(outside, resolve(runs, "run-a"), "dir");

      await expect(new LoopStoreV2({ projectRoot }).peek("change-a"))
        .rejects.toBeInstanceOf(LoopStoreCorruptionError);
    },
  );

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked canonical runs directory",
    async () => {
      const projectRoot = root();
      const outside = root();
      const changeRoot = resolve(projectRoot, ".corgi/loop/change-a");
      mkdirSync(changeRoot, { recursive: true });
      symlinkSync(outside, resolve(changeRoot, "runs"), "dir");

      await expect(new LoopStoreV2({ projectRoot }).peek("change-a"))
        .rejects.toBeInstanceOf(LoopStorePathError);
    },
  );

  it("rejects a non-directory canonical run entry", async () => {
    const projectRoot = root();
    const runs = resolve(projectRoot, ".corgi/loop/change-a/runs");
    mkdirSync(runs, { recursive: true });
    writeFileSync(resolve(runs, "run-a"), "not a run directory", "utf8");

    await expect(new LoopStoreV2({ projectRoot }).peek("change-a"))
      .rejects.toBeInstanceOf(LoopStoreCorruptionError);
  });

  it.skipIf(process.platform === "win32")("rejects symlinked canonical event and attempt leaves", async () => {
    const projectRoot = root();
    const outside = root();
    const { store, value } = await initializedStore(projectRoot);
    const paths = store.paths("change-a", "run-a");
    const outsideEvents = resolve(outside, "events.jsonl");
    writeFileSync(outsideEvents, readFileSync(paths.events!));
    rmSync(paths.events!);
    symlinkSync(outsideEvents, paths.events!);
    await expect(store.inspect("change-a")).rejects.toBeInstanceOf(LoopStorePathError);

    rmSync(paths.events!);
    writeFileSync(paths.events!, readFileSync(outsideEvents));
    const attempt = resolve(paths.attempts!, "TG-1/1");
    mkdirSync(dirname(attempt), { recursive: true });
    symlinkSync(outside, attempt, "dir");
    await expect(store.writeAttemptBundle({
      ...cas(value),
      groupId: "TG-1",
      attempt: 1,
      files: {},
      bundle: { schemaVersion: 2, runId: "run-a", groupId: "TG-1", attempt: 1 },
    })).rejects.toBeInstanceOf(LoopStorePathError);
  });

  it("detects changed and newly-created legacy writer sources", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const source = resolve(projectRoot, ".claude/corgi-loop/change-a/state.json");
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, "legacy");
    const metadata = lstatSync(source);
    const { createHash } = await import("node:crypto");
    const marker: LegacyMigrationMarkerV2 = {
      schemaVersion: 2,
      changeName: "change-a",
      runId: "run-a",
      sourcePlatform: "claude",
      migratedAt: T0,
      sources: [{
        path: ".claude/corgi-loop/change-a/state.json",
        sha256: createHash("sha256").update("legacy").digest("hex"),
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
      }],
      absentSources: [".claude/corgi-loop/change-a/groups/1/verify.json"],
      staleArtifacts: [],
    };
    await store.installLegacyMigration({
      ...cas(value),
      archiveFiles: { "claude/state.json": "legacy" },
      marker,
    });
    const update = submitted(value);
    writeFileSync(source, "continued writer");
    await expect(store.transition({ ...cas(value), ...update })).rejects.toBeInstanceOf(
      LegacyWriterDetectedError,
    );

    writeFileSync(source, "legacy");
    const reset = lstatSync(source);
    marker.sources[0]!.mtimeMs = reset.mtimeMs;
    writeFileSync(store.paths("change-a", "run-a").migrationMarker!, JSON.stringify(marker));
    const previouslyAbsent = resolve(projectRoot, marker.absentSources[0]!);
    mkdirSync(dirname(previouslyAbsent), { recursive: true });
    writeFileSync(previouslyAbsent, "{}");
    await expect(store.transition({ ...cas(value), ...update })).rejects.toBeInstanceOf(
      LegacyWriterDetectedError,
    );
  });

  it("fails a malformed migration marker and supports injected filesystem methods", async () => {
    const projectRoot = root();
    const access = vi.fn(async (path: string, mode?: number) => {
      const { access: realAccess } = await import("node:fs/promises");
      return realAccess(path, mode);
    });
    const store = new LoopStoreV2({ projectRoot, fs: { access } });
    const value = state();
    await store.initialize({ state: value, event: initialEvent(value) });
    expect(access).toHaveBeenCalled();
    writeFileSync(store.paths("change-a", "run-a").migrationMarker!, "{}");
    const update = submitted(value);
    await expect(store.transition({ ...cas(value), ...update })).rejects.toBeInstanceOf(
      LoopStoreCorruptionError,
    );
  });

  it("rejects reserved, absolute, empty, NUL, and non-file attempt paths", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const base = {
      ...cas(value),
      groupId: "TG-1",
      attempt: 2,
      bundle: { schemaVersion: 2 as const, runId: "run-a", groupId: "TG-1", attempt: 2 },
    };
    for (const path of ["bundle.json", "", "bad\0path", resolve(projectRoot, "absolute")]) {
      await expect(store.writeAttemptBundle({ ...base, files: { [path]: "bad" } }))
        .rejects.toBeInstanceOf(LoopStorePathError);
    }
    await expect(store.writeAttemptBundle({
      ...base,
      attempt: 3,
      bundle: { ...base.bundle, attempt: 3 },
      files: { "binary.bin": new Uint8Array([1, 2, 3]) },
    })).resolves.toMatchObject({ idempotent: false });
    await expect(store.writeAttemptBundle({
      ...base,
      groupId: "bad/group",
      bundle: { ...base.bundle, groupId: "bad/group" },
      files: {},
    })).rejects.toBeInstanceOf(LoopStorePathError);
  });

  it("fails malformed triage logs and missing committed artifacts", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const triage = store.paths("change-a", "run-a").reviewTriage!;
    writeFileSync(triage, "{bad}\n");
    const entry = {
      schemaVersion: 2 as const,
      runId: "run-a",
      groupId: "TG-1",
      attempt: 1,
      bundleId: "bundle-1",
      findingFingerprint: H,
      action: "dismissed" as const,
      actor: { kind: "human" as const, id: "reviewer" },
      reason: "reason",
      occurredAt: T1,
    };
    await expect(store.appendReviewTriage({ ...cas(value), entry }))
      .rejects.toBeInstanceOf(LoopStoreCorruptionError);
    writeFileSync(triage, "");
    const input = {
      ...cas(value),
      groupId: "TG-1",
      attempt: 1,
      files: { "evidence.json": "ok" },
      bundle: { schemaVersion: 2 as const, runId: "run-a", groupId: "TG-1", attempt: 1 },
    };
    const result = await store.writeAttemptBundle(input);
    rmSync(resolve(result.path, "evidence.json"));
    await expect(store.writeAttemptBundle(input)).rejects.toBeInstanceOf(LoopStoreCorruptionError);
  });

  it("covers every human triage identity requirement", async () => {
    const projectRoot = root();
    const { store, value } = await initializedStore(projectRoot);
    const valid = {
      schemaVersion: 2 as const,
      runId: "run-a",
      groupId: "TG-1",
      attempt: 1,
      bundleId: "bundle-1",
      findingFingerprint: H,
      action: "dismissed" as const,
      actor: { kind: "human" as const, id: "reviewer" },
      reason: "reason",
      occurredAt: T1,
    };
    const invalid = [
      { ...valid, schemaVersion: 1 as 2 },
      { ...valid, runId: "other" },
      { ...valid, findingFingerprint: "" },
      { ...valid, action: "ignored" as "dismissed" },
      { ...valid, actor: { kind: "agent" as "human", id: "reviewer" } },
      { ...valid, actor: { kind: "human" as const, id: "" } },
      { ...valid, reason: "" },
      { ...valid, occurredAt: "not-a-date" },
    ];
    for (const entry of invalid) {
      await expect(store.appendReviewTriage({ ...cas(value), entry }))
        .rejects.toBeInstanceOf(LoopStoreConflictError);
    }
    rmSync(store.paths("change-a", "run-a").reviewTriage!);
    await expect(store.appendReviewTriage({ ...cas(value), entry: valid })).resolves.toBeUndefined();
  });

  it("handles missing run directories, explicit runs, and invalid current pointers", async () => {
    const projectRoot = root();
    const emptyChange = resolve(projectRoot, ".corgi/loop/empty");
    mkdirSync(emptyChange, { recursive: true });
    const empty = new LoopStoreV2({ projectRoot });
    await expect(empty.inspect("empty")).resolves.toMatchObject({ state: null });
    await expect(empty.peek("unknown")).resolves.toMatchObject({ recoveryRequired: false });

    const { store, value } = await initializedStore(projectRoot);
    await expect(store.inspect("change-a", { runId: "run-a" })).resolves.toMatchObject({
      state: { runId: "run-a" },
    });
    await expect(store.peek("change-a", { runId: "run-a" })).resolves.toMatchObject({
      state: { runId: "run-a" },
    });
    writeFileSync(store.paths("change-a").current, JSON.stringify({ schemaVersion: 2, runId: "bad" }));
    await expect(store.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
    writeFileSync(store.paths("change-a").current, JSON.stringify({
      schemaVersion: 2,
      changeName: "change-a",
      runId: "missing-run",
      stateRevision: 0,
      nonce: "x",
      updatedAt: T0,
    }));
    await expect(store.peek("change-a", { runId: "missing-run" }))
      .rejects.toBeInstanceOf(LoopStoreCorruptionError);
    await expect(store.writeAttemptBundle({
      ...cas(value),
      runId: "missing-run",
      groupId: "TG-1",
      attempt: 1,
      files: {},
      bundle: { schemaVersion: 2, runId: "missing-run", groupId: "TG-1", attempt: 1 },
    })).rejects.toBeInstanceOf(LoopStoreConflictError);
    await expect(store.writeAttemptBundle({
      changeName: "never-created",
      runId: "run-a",
      sessionId: "session-a",
      expectedStateRevision: 0,
      expectedNonce: "nonce-0",
      groupId: "TG-1",
      attempt: 1,
      files: {},
      bundle: { schemaVersion: 2, runId: "run-a", groupId: "TG-1", attempt: 1 },
    })).rejects.toBeInstanceOf(LoopStoreConflictError);
  });

  it("rejects mutation of a terminal run while another run is active", async () => {
    const projectRoot = root();
    const store = new LoopStoreV2({ projectRoot });
    const terminal = state({
      runId: "run-terminal",
      nonce: "terminal-nonce",
      phase: "invalidated",
      blockedReason: { code: "manual", message: "terminal", details: {} },
      completedAt: T0,
      groups: { "TG-1": { ...state().groups["TG-1"]!, status: "invalidated" } },
    });
    await store.initialize({ state: terminal, event: initialEvent(terminal) });
    const active = state({ runId: "run-active", nonce: "active-nonce" });
    await store.initialize({ state: active, event: initialEvent(active) });
    await expect(store.writeAttemptBundle({
      changeName: "change-a",
      runId: terminal.runId,
      sessionId: terminal.sessionId,
      expectedStateRevision: 0,
      expectedNonce: terminal.nonce,
      groupId: "TG-1",
      attempt: 1,
      files: {},
      bundle: { schemaVersion: 2, runId: terminal.runId, groupId: "TG-1", attempt: 1 },
    })).rejects.toBeInstanceOf(LoopStoreConflictError);
    await expect(store.writeAttemptBundle({
      ...cas(active),
      sessionId: "wrong",
      groupId: "TG-1",
      attempt: 1,
      files: {},
      bundle: { schemaVersion: 2, runId: active.runId, groupId: "TG-1", attempt: 1 },
    })).rejects.toBeInstanceOf(LoopStoreSessionConflictError);
  });

  it("propagates unexpected access, lstat, lock-open, and directory-sync errors", async () => {
    const projectRoot = root();
    const { access: realAccess, lstat: realLstat, open: realOpen } = await import("node:fs/promises");
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    const accessStore = new LoopStoreV2({
      projectRoot,
      fs: { access: async () => { throw denied; } },
    });
    await expect(accessStore.inspect("change-a")).rejects.toBe(denied);

    const lstatRoot = root();
    const lstatStore = new LoopStoreV2({
      projectRoot: lstatRoot,
      fs: {
        lstat: async (path) => {
          if (path.endsWith(".corgi")) throw denied;
          return realLstat(path);
        },
      },
    });
    const initial = state();
    await expect(lstatStore.initialize({ state: initial, event: initialEvent(initial) })).rejects.toBe(denied);

    const lockRoot = root();
    const lockStore = new LoopStoreV2({
      projectRoot: lockRoot,
      fs: {
        open: async (path, flags, mode) => {
          if (path.endsWith(".lock")) throw denied;
          return realOpen(path, flags, mode);
        },
      },
    });
    await expect(lockStore.initialize({ state: initial, event: initialEvent(initial) })).rejects.toBe(denied);

    const syncRoot = root();
    const syncStore = new LoopStoreV2({
      projectRoot: syncRoot,
      fs: {
        open: async (path, flags, mode) => {
          if (typeof flags === "number" && flags === 0 && path.includes(".init-run-a-")) throw denied;
          return realOpen(path, flags, mode);
        },
      },
    });
    await expect(syncStore.initialize({ state: initial, event: initialEvent(initial) })).rejects.toBe(denied);
    void realAccess;
  });

  it("ignores supported directory fsync errors", async () => {
    const projectRoot = root();
    const { open: realOpen } = await import("node:fs/promises");
    const store = new LoopStoreV2({
      projectRoot,
      fs: {
        open: async (path, flags, mode) => {
          if (typeof flags === "number" && flags === 0 && (path.endsWith("run-a") || path.endsWith("change-a"))) {
            throw Object.assign(new Error("unsupported"), { code: "EINVAL" });
          }
          return realOpen(path, flags, mode);
        },
      },
    });
    const value = state();
    await expect(store.initialize({ state: value, event: initialEvent(value) })).resolves.toEqual(value);
  });

  it("preserves the primary crash error when best-effort temp cleanup also fails", async () => {
    const projectRoot = root();
    const { rm: realRm } = await import("node:fs/promises");
    let armed = false;
    const store = new LoopStoreV2({
      projectRoot,
      faults: (point) => {
        if (armed && point === "before_state_rename") throw new Error("primary-crash");
      },
      fs: {
        rm: async (path, options) => {
          if (armed && path.includes(".tmp-")) throw new Error("cleanup-failed");
          return realRm(path, options);
        },
      },
    });
    const value = state();
    await store.initialize({ state: value, event: initialEvent(value) });
    const update = submitted(value);
    armed = true;
    await expect(store.transition({ ...cas(value), ...update })).rejects.toThrow("primary-crash");
  });

  it("leaves replaced or malformed lock files untouched during fail-closed release", async () => {
    for (const replacement of [JSON.stringify({ token: "replacement" }), "{"]) {
      const projectRoot = root();
      const value = state();
      const store = new LoopStoreV2({
        projectRoot,
        faults: (point, context) => {
          if (point === "after_lock_acquired") {
            writeFileSync(context.path!, replacement);
            throw new Error("stop");
          }
        },
      });
      await expect(store.initialize({ state: value, event: initialEvent(value) })).rejects.toThrow("stop");
      expect(readFileSync(store.paths("change-a").lock, "utf8")).toBe(replacement);
    }
  });

  it("reclaims malformed and foreign-host expired locks but not a fresh foreign lock", async () => {
    const projectRoot = root();
    const { store } = await initializedStore(projectRoot);
    const lock = store.paths("change-a").lock;
    writeFileSync(lock, "{");
    utimesSync(lock, new Date(0), new Date(0));
    await expect(new LoopStoreV2({ projectRoot, lockStaleMs: 1_000 }).inspect("change-a"))
      .resolves.toMatchObject({ state: { runId: "run-a" } });

    writeFileSync(lock, JSON.stringify({
      token: "foreign-old",
      pid: 1,
      hostname: "remote-host",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }));
    await expect(new LoopStoreV2({ projectRoot, lockStaleMs: 1_000 }).inspect("change-a"))
      .resolves.toMatchObject({ state: { runId: "run-a" } });

    writeFileSync(lock, JSON.stringify({
      token: "foreign-fresh",
      pid: 1,
      hostname: "remote-host",
      acquiredAt: new Date().toISOString(),
    }));
    await expect(new LoopStoreV2({ projectRoot, lockStaleMs: 60_000 }).inspect("change-a"))
      .rejects.toBeInstanceOf(LoopStoreLockedError);
    rmSync(lock);
  });

  it("restores a replacement owner raced into stale-lock reclamation", async () => {
    const projectRoot = root();
    const { store } = await initializedStore(projectRoot);
    const lock = store.paths("change-a").lock;
    writeFileSync(lock, JSON.stringify({
      token: "stale-owner",
      pid: 1,
      hostname: "remote-host",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }));
    utimesSync(lock, new Date(0), new Date(0));
    const replacement = JSON.stringify({
      token: "replacement-owner",
      pid: process.pid,
      hostname: (await import("node:os")).hostname(),
      acquiredAt: new Date().toISOString(),
    });
    const { rename: realRename } = await import("node:fs/promises");
    let replaced = false;
    const contender = new LoopStoreV2({
      projectRoot,
      lockStaleMs: 1_000,
      fs: {
        rename: async (from, to) => {
          if (!replaced && from === lock && to.includes(".stale-")) {
            rmSync(from);
            writeFileSync(from, replacement);
            replaced = true;
          }
          await realRename(from, to);
        },
      },
    });

    await expect(contender.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreLockedError);
    expect(replaced).toBe(true);
    expect(readFileSync(lock, "utf8")).toBe(replacement);
    expect(readdirSync(dirname(lock)).filter((name) => name.includes(".stale-"))).toEqual([]);
    rmSync(lock);
  });

  it("never uses an untrusted stale-lock token as a quarantine path", async () => {
    const projectRoot = root();
    const outsideRoot = root();
    const { store } = await initializedStore(projectRoot);
    const lock = store.paths("change-a").lock;
    const sentinel = resolve(outsideRoot, "sentinel.txt");
    writeFileSync(sentinel, "outside-must-remain\n");

    // With the historical `${lock}.stale-${token}` construction, this token
    // resolves to the sentinel on POSIX and lets rename/rm escape the repo.
    const maliciousToken = `x/../../../../../${basename(outsideRoot)}/sentinel.txt`;
    writeFileSync(lock, JSON.stringify({
      token: maliciousToken,
      pid: 1,
      hostname: "remote-host",
      acquiredAt: "2000-01-01T00:00:00.000Z",
    }));

    await expect(new LoopStoreV2({ projectRoot, lockStaleMs: 1_000 }).inspect("change-a"))
      .resolves.toMatchObject({ state: { runId: "run-a" } });
    expect(readFileSync(sentinel, "utf8")).toBe("outside-must-remain\n");
    expect(existsSync(lock)).toBe(false);
  });
});
