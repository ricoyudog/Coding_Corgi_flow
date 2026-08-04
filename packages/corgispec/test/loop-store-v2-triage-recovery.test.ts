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
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LoopStoreCorruptionError,
  LegacyWriterDetectedError,
  LoopStorePathError,
  LoopStoreRecoveryRequiredError,
  LoopStoreV2,
  loopRunPathsV2,
  type LoopStoreFaultPoint,
  type LegacyMigrationMarkerV2,
  type ReviewTriageEntryV2,
} from "../src/lib/loop-store-v2.js";
import { reduceLoopEventV2 } from "../src/lib/loop-reducer-v2.js";
import type {
  BundleSubmittedEventV2,
  LoopStateV2,
  RunInitializedEventV2,
} from "../src/lib/run-contract-v2.js";

const roots: string[] = [];
const H = `sha256:${"a".repeat(64)}` as const;
const H2 = `sha256:${"b".repeat(64)}` as const;
const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";

function projectRoot(): string {
  const value = mkdtempSync(resolve(tmpdir(), "corgi-triage-recovery-"));
  roots.push(value);
  return value;
}

function initialState(): LoopStateV2 {
  return {
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
}

function initialization(state: LoopStateV2): RunInitializedEventV2 {
  return {
    schemaVersion: 2,
    type: "run_initialized",
    runId: state.runId,
    seq: 0,
    expectedStateRevision: -1,
    expectedNonce: null,
    nextNonce: state.nonce,
    occurredAt: state.updatedAt,
    actor: { id: "agent-a", kind: "agent" },
    initialState: state,
  };
}

function cas(state: LoopStateV2) {
  return {
    changeName: state.changeName,
    runId: state.runId,
    sessionId: state.sessionId,
    expectedStateRevision: state.stateRevision,
    expectedNonce: state.nonce,
  };
}

function triage(overrides: Partial<ReviewTriageEntryV2> = {}): ReviewTriageEntryV2 {
  return {
    schemaVersion: 2,
    runId: "run-a",
    groupId: "TG-1",
    attempt: 1,
    bundleId: "bundle-1",
    findingFingerprint: H,
    action: "dismissed",
    actor: { kind: "human", id: "reviewer" },
    reason: "False positive",
    occurredAt: T1,
    ...overrides,
  };
}

function submitted(state: LoopStateV2) {
  const event: BundleSubmittedEventV2 = {
    schemaVersion: 2,
    type: "bundle_submitted",
    runId: state.runId,
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
  return { event, nextState: reduceLoopEventV2(state, event).postState };
}

async function initialized(
  root: string,
  faults?: (point: LoopStoreFaultPoint) => void,
) {
  const store = new LoopStoreV2({ projectRoot: root, faults });
  const state = initialState();
  await store.initialize({ state, event: initialization(state) });
  return { store, state };
}

async function installLegacyProvenance(
  root: string,
  store: LoopStoreV2,
  state: LoopStateV2,
) {
  const source = resolve(root, ".claude/corgi-loop/change-a/state.json");
  mkdirSync(resolve(source, ".."), { recursive: true });
  const sourceBytes = Buffer.from('{"changeName":"change-a","active":true}\n');
  writeFileSync(source, sourceBytes);
  const metadata = lstatSync(source);
  const marker: LegacyMigrationMarkerV2 = {
    schemaVersion: 2,
    changeName: "change-a",
    runId: "run-a",
    sourcePlatform: "claude",
    migratedAt: T1,
    sources: [{
      path: ".claude/corgi-loop/change-a/state.json",
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
    }],
    absentSources: [],
    staleArtifacts: [],
  };
  await store.installLegacyMigration({
    ...cas(state),
    archiveFiles: { "claude/state.json": sourceBytes },
    marker,
  });
  return { marker, source, sourceBytes };
}

function canonicalBytes(store: LoopStoreV2): Buffer[] {
  const paths = store.paths("change-a", "run-a");
  return [paths.current, paths.state!, paths.events!, paths.reviewTriage!]
    .map((path) => readFileSync(path));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("LoopStoreV2 review triage JSONL recovery", () => {
  it("reports and explicitly truncates only an unterminated malformed final tail", async () => {
    const root = projectRoot();
    const { store, state } = await initialized(root);
    const path = store.paths("change-a", "run-a").reviewTriage!;
    const first = triage();
    await store.appendReviewTriage({ ...cas(state), entry: first });
    const valid = readFileSync(path);
    appendFileSync(path, '{"schemaVersion":2');
    const damaged = readFileSync(path);

    await expect(store.peek("change-a")).resolves.toMatchObject({
      state: { runId: "run-a" },
      recoveryRequired: true,
    });
    expect(readFileSync(path)).toEqual(damaged);
    await expect(store.appendReviewTriage({
      ...cas(state),
      entry: triage({ attempt: 2, bundleId: "bundle-2", findingFingerprint: H2 }),
    })).rejects.toBeInstanceOf(LoopStoreRecoveryRequiredError);
    expect(readFileSync(path)).toEqual(damaged);

    await expect(store.inspect("change-a")).resolves.toMatchObject({
      recovered: true,
      repairedTrailingTriage: true,
    });
    expect(readFileSync(path)).toEqual(valid);
    await store.appendReviewTriage({
      ...cas(state),
      entry: triage({ attempt: 2, bundleId: "bundle-2", findingFingerprint: H2 }),
    });
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line).attempt)).toEqual([1, 2]);
  });

  it("reports a valid final record without newline and appends only after inspect repairs it", async () => {
    const root = projectRoot();
    const { store, state } = await initialized(root);
    const path = store.paths("change-a", "run-a").reviewTriage!;
    writeFileSync(path, JSON.stringify(triage()));
    const unterminated = readFileSync(path);

    await expect(store.peek("change-a")).resolves.toMatchObject({ recoveryRequired: true });
    expect(readFileSync(path)).toEqual(unterminated);
    await expect(store.appendReviewTriage({
      ...cas(state),
      entry: triage({ attempt: 2, bundleId: "bundle-2", findingFingerprint: H2 }),
    })).rejects.toBeInstanceOf(LoopStoreRecoveryRequiredError);
    expect(readFileSync(path)).toEqual(unterminated);

    await expect(store.inspect("change-a")).resolves.toMatchObject({
      repairedTrailingTriage: true,
    });
    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(triage())}\n`);
    await store.appendReviewTriage({
      ...cas(state),
      entry: triage({ attempt: 2, bundleId: "bundle-2", findingFingerprint: H2 }),
    });
    const text = readFileSync(path, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trimEnd().split("\n")).toHaveLength(2);
  });

  it.each([
    ["middle corruption", `${JSON.stringify(triage())}\n{bad}\n${JSON.stringify(triage({ attempt: 2, bundleId: "bundle-2", findingFingerprint: H2 }))}\n`],
    ["terminated malformed tail", `${JSON.stringify(triage())}\n{bad}\n`],
    ["duplicate decision", `${JSON.stringify(triage())}\n${JSON.stringify(triage())}\n`],
  ])("fails closed for %s", async (_label, content) => {
    const root = projectRoot();
    const { store, state } = await initialized(root);
    const path = store.paths("change-a", "run-a").reviewTriage!;
    writeFileSync(path, content);
    const before = canonicalBytes(store);

    await expect(store.peek("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
    await expect(store.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
    await expect(store.appendReviewTriage({
      ...cas(state),
      entry: triage({ attempt: 3, bundleId: "bundle-3", findingFingerprint: H2 }),
    })).rejects.toBeInstanceOf(LoopStoreCorruptionError);
    expect(canonicalBytes(store)).toEqual(before);
  });

  it.each([
    ["future schema", triage({ schemaVersion: 3 as 2 })],
    ["wrong run binding", triage({ runId: "run-other" })],
    ["missing group binding", triage({ groupId: "" })],
    ["invalid attempt binding", triage({ attempt: 0 })],
    ["missing bundle binding", triage({ bundleId: "" })],
    ["non-human resolution", triage({ actor: { kind: "agent" as "human", id: "bot" } })],
    ["unreasoned resolution", triage({ reason: "" })],
    ["invalid timestamp", triage({ occurredAt: "not-a-time" })],
  ])("treats syntactically complete %s as corruption, not a truncation", async (_label, value) => {
    const root = projectRoot();
    const { store } = await initialized(root);
    const path = store.paths("change-a", "run-a").reviewTriage!;
    writeFileSync(path, JSON.stringify(value));
    const before = readFileSync(path);
    await expect(store.peek("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
    await expect(store.inspect("change-a")).rejects.toBeInstanceOf(LoopStoreCorruptionError);
    expect(readFileSync(path)).toEqual(before);
  });

  it.each(["before_triage_append", "after_triage_write", "after_triage_fsync"] as const)(
    "retries idempotently after %s",
    async (faultPoint) => {
      const root = projectRoot();
      let armed = false;
      const { store, state } = await initialized(root, (point) => {
        if (armed && point === faultPoint) throw new Error(`crash:${faultPoint}`);
      });
      const entry = triage();
      armed = true;
      await expect(store.appendReviewTriage({ ...cas(state), entry }))
        .rejects.toThrow(`crash:${faultPoint}`);
      armed = false;
      await expect(store.appendReviewTriage({ ...cas(state), entry })).resolves.toBeUndefined();
      const text = readFileSync(store.paths("change-a", "run-a").reviewTriage!, "utf8");
      expect(text).toBe(`${JSON.stringify(entry)}\n`);
    },
  );

  it.each(["truncated", "corrupt"] as const)(
    "keeps every canonical mutation at zero writes while triage is %s",
    async (failure) => {
      const root = projectRoot();
      const { store, state } = await initialized(root);
      const paths = store.paths("change-a", "run-a");
      if (failure === "truncated") {
        writeFileSync(paths.reviewTriage!, '{"schemaVersion":2');
      } else {
        writeFileSync(paths.reviewTriage!, "{bad}\n");
      }
      const before = canonicalBytes(store);
      const expected = failure === "truncated"
        ? LoopStoreRecoveryRequiredError
        : LoopStoreCorruptionError;
      const update = submitted(state);
      const mutations = [
        () => store.transition({ ...cas(state), ...update }),
        () => store.writeAttemptBundle({
          ...cas(state),
          groupId: "TG-1",
          attempt: 1,
          files: { "evidence.json": "ok\n" },
          bundle: {
            schemaVersion: 2 as const,
            runId: "run-a",
            groupId: "TG-1",
            attempt: 1,
            bundleId: "bundle-1",
          },
        }),
        () => store.appendReviewTriage({
          ...cas(state),
          entry: triage({ attempt: 2, bundleId: "bundle-2", findingFingerprint: H2 }),
        }),
      ];
      for (const mutate of mutations) {
        await expect(mutate()).rejects.toBeInstanceOf(expected);
        expect(canonicalBytes(store)).toEqual(before);
        expect(existsSync(resolve(paths.attempts!, "TG-1/1"))).toBe(false);
      }
    },
  );

  it("does not mistake a missing final newline for a partial record after byte truncation", async () => {
    const root = projectRoot();
    const { store } = await initialized(root);
    const path = store.paths("change-a", "run-a").reviewTriage!;
    writeFileSync(path, `${JSON.stringify(triage())}\n`);
    truncateSync(path, readFileSync(path).length - 1);
    await expect(store.peek("change-a")).resolves.toMatchObject({ recoveryRequired: true });
    await store.inspect("change-a");
    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(triage())}\n`);
  });
});

describe("LoopStoreV2 portable canonical identifiers", () => {
  it.each([
    "CON",
    "con.txt",
    "PRN",
    "prn.log",
    "AUX",
    "NUL.bin",
    "COM1",
    "com9.txt",
    "LPT1",
    "lpt9.ext",
    "trailing.",
    "trailing ",
  ])("rejects Windows-incompatible segment %s for changes and runs", (segment) => {
    const root = projectRoot();
    expect(() => loopRunPathsV2(root, segment)).toThrow(LoopStorePathError);
    expect(() => loopRunPathsV2(root, "change-a", segment)).toThrow(LoopStorePathError);
  });

  it("rejects unsafe mutation identities before touching canonical files", async () => {
    const root = projectRoot();
    const { store, state } = await initialized(root);
    const before = canonicalBytes(store);
    await expect(store.appendReviewTriage({
      ...cas(state),
      changeName: "NUL.txt",
      entry: triage(),
    })).rejects.toBeInstanceOf(LoopStorePathError);
    await expect(store.appendReviewTriage({
      ...cas(state),
      runId: "COM1.log",
      entry: triage({ runId: "COM1.log" }),
    })).rejects.toBeInstanceOf(LoopStorePathError);
    expect(canonicalBytes(store)).toEqual(before);
    expect(existsSync(resolve(root, ".corgi/loop/NUL.txt"))).toBe(false);
  });

  it("rejects an unsafe initialization identity before creating storage", async () => {
    const root = projectRoot();
    const store = new LoopStoreV2({ projectRoot: root });
    const state = initialState();
    state.runId = "AUX.json";
    await expect(store.initialize({ state, event: initialization(state) }))
      .rejects.toBeInstanceOf(LoopStorePathError);
    expect(existsSync(resolve(root, ".corgi"))).toBe(false);
  });

  it("rejects a case-fold colliding run id under the same change with zero writes", async () => {
    const root = projectRoot();
    const { store, state } = await initialized(root);
    const before = canonicalBytes(store);
    const beforeRunEntries = readdirSync(store.paths("change-a").runs).sort();
    const candidate = structuredClone(state);
    candidate.runId = "Run-A";
    candidate.nonce = "nonce-case-collision";
    const candidateEvent = initialization(candidate);
    await expect(store.initialize({ state: candidate, event: candidateEvent }))
      .rejects.toThrow(/case-fold collision/u);
    expect(canonicalBytes(store)).toEqual(before);
    expect(readdirSync(store.paths("change-a").runs).sort()).toEqual(beforeRunEntries);
  });
});

describe("LoopStoreV2 legacy provenance mutation gate", () => {
  it.each([
    ["missing marker", (store: LoopStoreV2, _marker: LegacyMigrationMarkerV2) => {
      rmSync(store.paths("change-a", "run-a").migrationMarker!);
    }],
    ["missing archive", (store: LoopStoreV2, _marker: LegacyMigrationMarkerV2) => {
      rmSync(resolve(store.paths("change-a", "run-a").runRoot!, "legacy"), {
        recursive: true,
        force: true,
      });
    }],
    ["empty sources", (store: LoopStoreV2, marker: LegacyMigrationMarkerV2) => {
      writeFileSync(
        store.paths("change-a", "run-a").migrationMarker!,
        JSON.stringify({ ...marker, sources: [] }),
      );
    }],
    ["wrong marker identity", (store: LoopStoreV2, marker: LegacyMigrationMarkerV2) => {
      writeFileSync(
        store.paths("change-a", "run-a").migrationMarker!,
        JSON.stringify({ ...marker, runId: "run-other" }),
      );
    }],
  ] as const)("blocks mutation with zero canonical writes for %s", async (_label, damage) => {
    const root = projectRoot();
    const { store, state } = await initialized(root);
    const { marker } = await installLegacyProvenance(root, store, state);
    damage(store, marker);
    const before = canonicalBytes(store);
    const update = submitted(state);
    await expect(store.transition({ ...cas(state), ...update }))
      .rejects.toBeInstanceOf(LoopStoreCorruptionError);
    expect(canonicalBytes(store)).toEqual(before);
  });

  it.each(["changed", "deleted"] as const)(
    "detects a %s legacy source before any canonical mutation write",
    async (damage) => {
      const root = projectRoot();
      const { store, state } = await initialized(root);
      const { source } = await installLegacyProvenance(root, store, state);
      if (damage === "changed") appendFileSync(source, "continued legacy writer\n");
      else rmSync(source);
      const before = canonicalBytes(store);
      const update = submitted(state);
      await expect(store.transition({ ...cas(state), ...update }))
        .rejects.toBeInstanceOf(LegacyWriterDetectedError);
      expect(canonicalBytes(store)).toEqual(before);
    },
  );

  it.skipIf(process.platform === "win32")(
    "detects a legacy source replaced by a symlink before any canonical write",
    async () => {
      const root = projectRoot();
      const outside = projectRoot();
      const { store, state } = await initialized(root);
      const { source, sourceBytes } = await installLegacyProvenance(root, store, state);
      const replacement = resolve(outside, "legacy-state.json");
      writeFileSync(replacement, sourceBytes);
      rmSync(source);
      symlinkSync(replacement, source);
      const before = canonicalBytes(store);
      const update = submitted(state);
      await expect(store.transition({ ...cas(state), ...update }))
        .rejects.toBeInstanceOf(LegacyWriterDetectedError);
      expect(canonicalBytes(store)).toEqual(before);
    },
  );
});
