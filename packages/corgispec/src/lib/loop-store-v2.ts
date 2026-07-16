import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, type Dirent, type Stats } from "node:fs";
import {
  access as nodeAccess,
  link as nodeLink,
  lstat as nodeLstat,
  mkdir as nodeMkdir,
  open as nodeOpen,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  realpath as nodeRealpath,
  rename as nodeRename,
  rm as nodeRm,
  stat as nodeStat,
  truncate as nodeTruncate,
  unlink as nodeUnlink,
  type FileHandle,
} from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { hostname } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  ACTIVE_PHASES_V2,
  assertLoopEventRecordV2,
  assertLoopEventV2,
  assertLoopStateV2,
  type LoopEventRecordV2,
  type LoopEventV2,
  type LoopStateV2,
} from "./run-contract-v2.js";
import { reduceLoopEventV2 } from "./loop-reducer-v2.js";
import { validateFindingTriageV2 } from "./evidence-v2.js";
import {
  assertConvergenceIntentV2,
  type ConvergenceIntentV2,
} from "./convergence-intent-v2.js";

export type LoopStoreFaultPoint =
  | "after_lock_acquired"
  | "before_initialization_rename"
  | "after_initialization_rename"
  | "before_event_append"
  | "after_event_write"
  | "after_event_fsync"
  | "before_triage_append"
  | "after_triage_write"
  | "after_triage_fsync"
  | "before_state_temp_write"
  | "after_state_temp_fsync"
  | "before_state_rename"
  | "after_state_rename"
  | "after_state_directory_fsync"
  | "before_current_rename"
  | "after_current_rename"
  | "before_bundle_artifacts"
  | "after_bundle_artifacts_fsync"
  | "before_bundle_marker"
  | "after_bundle_marker_fsync"
  | "before_bundle_rename"
  | "after_bundle_rename";

export interface LoopStoreFaultContext {
  changeName: string;
  runId?: string;
  path?: string;
}

export type LoopStoreFaultInjector = (
  point: LoopStoreFaultPoint,
  context: LoopStoreFaultContext,
) => void | Promise<void>;

/** The deliberately small filesystem surface used by the store. */
export interface LoopStoreFileSystem {
  access(path: string, mode?: number): Promise<void>;
  link(existingPath: string, newPath: string): Promise<void>;
  lstat(path: string): Promise<Stats>;
  mkdir(path: string, options: { recursive: true }): Promise<string | undefined>;
  open(path: string, flags: string | number, mode?: number): Promise<FileHandle>;
  readFile(path: string): Promise<Buffer>;
  readdir(path: string, options: { withFileTypes: true }): Promise<Dirent[]>;
  realpath(path: string): Promise<string>;
  rename(oldPath: string, newPath: string): Promise<void>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
  stat(path: string): Promise<Stats>;
  truncate(path: string, length: number): Promise<void>;
  unlink(path: string): Promise<void>;
}

const defaultFileSystem: LoopStoreFileSystem = {
  access: nodeAccess,
  link: nodeLink,
  lstat: nodeLstat,
  mkdir: nodeMkdir,
  open: nodeOpen,
  readFile: nodeReadFile,
  readdir: nodeReaddir,
  realpath: nodeRealpath,
  rename: nodeRename,
  rm: nodeRm,
  stat: nodeStat,
  truncate: nodeTruncate,
  unlink: nodeUnlink,
};

export interface LoopStoreV2Options {
  projectRoot: string;
  fs?: Partial<LoopStoreFileSystem>;
  faults?: LoopStoreFaultInjector;
  now?: () => Date;
  lockTimeoutMs?: number;
  lockPollMs?: number;
  lockStaleMs?: number;
}

export interface CurrentRunPointerV2 {
  schemaVersion: 2;
  changeName: string;
  runId: string;
  stateRevision: number;
  nonce: string;
  updatedAt: string;
}

export interface LoopStoreInspectionV2 {
  current: CurrentRunPointerV2 | null;
  state: LoopStateV2 | null;
  events: LoopEventRecordV2[];
  recovered: boolean;
  repairedTrailingEvent: boolean;
  /** True when explicit inspection repaired the review-triage JSONL tail. */
  repairedTrailingTriage?: boolean;
  /** Present for read-only inspection; true means a mutating inspect must repair. */
  recoveryRequired?: boolean;
}

export interface InitializeLoopRunV2Input {
  state: LoopStateV2;
  event: LoopEventV2;
}

export interface LoopStoreCasV2 {
  changeName: string;
  runId: string;
  sessionId: string;
  expectedStateRevision: number;
  expectedNonce: string;
}

export interface TransitionLoopRunV2Input extends LoopStoreCasV2 {
  event: LoopEventV2;
  nextState: LoopStateV2;
}

export interface AttemptBundleV2 {
  schemaVersion: 2;
  runId: string;
  groupId: string;
  attempt: number;
  [key: string]: unknown;
}

export interface WriteAttemptBundleV2Input extends LoopStoreCasV2 {
  groupId: string;
  attempt: number;
  files: Record<string, string | Uint8Array | object>;
  bundle: AttemptBundleV2;
}

export interface AttemptBundleWriteResultV2 {
  path: string;
  idempotent: boolean;
}

export interface LoopStoreTransitionV2 {
  event: LoopEventV2;
  nextState: LoopStateV2;
}

export interface SubmitAttemptTransactionV2Input extends WriteAttemptBundleV2Input {
  /** Usually bundle_submitted followed by evaluation_completed. */
  transitions: readonly LoopStoreTransitionV2[];
  triageEntries?: readonly ReviewTriageEntryV2[];
}

export interface SubmitAttemptTransactionV2Result {
  state: LoopStateV2;
  bundle: AttemptBundleWriteResultV2;
  idempotent: boolean;
}

export interface ReviewTriageEntryV2 {
  schemaVersion: 2;
  runId: string;
  groupId: string;
  attempt: number;
  bundleId: string;
  findingFingerprint: string;
  action: "dismissed" | "accepted-risk";
  actor: { kind: "human"; id: string };
  reason: string;
  occurredAt: string;
  [key: string]: unknown;
}

export interface AppendReviewTriageV2Input extends LoopStoreCasV2 {
  entry: ReviewTriageEntryV2;
}

export interface LegacyMigrationSourceV2 {
  path: string;
  sha256: string;
  size: number;
  mtimeMs: number;
}

export interface LegacyMigrationMarkerV2 {
  schemaVersion: 2;
  changeName: string;
  runId: string;
  sourcePlatform: "claude" | "opencode";
  migratedAt: string;
  sources: LegacyMigrationSourceV2[];
  absentSources: string[];
  staleArtifacts: string[];
}

export interface InstallLegacyMigrationV2Input extends LoopStoreCasV2 {
  archiveFiles: Record<string, string | Uint8Array | object>;
  marker: LegacyMigrationMarkerV2;
}

export interface LoopRunPathsV2 {
  projectRoot: string;
  loopRoot: string;
  changeRoot: string;
  lock: string;
  current: string;
  runs: string;
  runRoot?: string;
  state?: string;
  events?: string;
  reviewTriage?: string;
  attempts?: string;
  migrationMarker?: string;
}

export class LoopStoreV2Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class LoopStorePathError extends LoopStoreV2Error {
  constructor(message: string) {
    super("LOOP_PATH_UNSAFE", message);
  }
}

export class LoopStoreLockedError extends LoopStoreV2Error {
  constructor(changeName: string) {
    super("LOOP_LOCKED", `Change '${changeName}' is locked by another process`);
  }
}

export class LoopStoreConflictError extends LoopStoreV2Error {
  constructor(message: string) {
    super("LOOP_CAS_CONFLICT", message);
  }
}

export class LoopStoreSessionConflictError extends LoopStoreV2Error {
  constructor(expected: string, actual: string) {
    super(
      "LOOP_SESSION_CONFLICT",
      `Session conflict: expected '${expected}', current session is '${actual}'`,
    );
  }
}

export class LoopStoreCorruptionError extends LoopStoreV2Error {
  constructor(message: string, cause?: unknown) {
    super("LOOP_CORRUPTION", message, cause === undefined ? undefined : { cause });
  }
}

export class LoopStoreRecoveryRequiredError extends LoopStoreV2Error {
  constructor(message: string) {
    super("LOOP_RECOVERY_REQUIRED", message);
  }
}

export class ConvergenceRecoveryRequiredError extends LoopStoreV2Error {
  constructor(changeName: string) {
    super(
      "CONVERGENCE_RECOVERY_REQUIRED",
      `Change '${changeName}' has a durable convergence intent; recover its exact successor first`,
    );
  }
}

export class MultipleActiveRunsError extends LoopStoreV2Error {
  constructor(changeName: string, runIds: string[]) {
    super(
      "LOOP_MULTIPLE_ACTIVE_RUNS",
      `Change '${changeName}' has multiple active runs: ${runIds.join(", ")}`,
    );
  }
}

export class LegacyWriterDetectedError extends LoopStoreV2Error {
  constructor(path: string) {
    super(
      "LOOP_LEGACY_WRITER_DETECTED",
      `Legacy loop file changed after migration: ${path}`,
    );
  }
}

interface ParsedEventLog {
  records: LoopEventRecordV2[];
  repairedTrailingEvent: boolean;
}

function pendingConvergenceIntentV2(state: LoopStateV2): ConvergenceIntentV2 | undefined {
  if (state.phase !== "invalidated") return undefined;
  const details = state.blockedReason?.details;
  if (!details || details["operation"] !== "converge") return undefined;
  const intent = details["convergenceIntent"];
  assertConvergenceIntentV2(intent);
  return intent;
}

function isBoundConvergenceSuccessorV2(
  source: LoopStateV2,
  successor: LoopStateV2,
  intent: ConvergenceIntentV2,
): boolean {
  return intent.changeName === source.changeName &&
    intent.sourceRunId === source.runId &&
    intent.sourceSessionId === source.sessionId &&
    successor.changeName === source.changeName &&
    successor.runId === intent.successorRunId &&
    successor.supersedesRunId === source.runId &&
    successor.sessionId === source.sessionId &&
    isDeepStrictEqual(successor.owner, source.owner) &&
    successor.mode === source.mode &&
    isDeepStrictEqual(successor.policy, source.policy) &&
    successor.nonce === intent.successorNonce &&
    successor.startedAt === intent.successorStartedAt &&
    successor.updatedAt === intent.successorStartedAt &&
    successor.planningRevision === intent.expectedPostPlanningRevision;
}

type ReviewTriageReadMode = "inspect" | "peek" | "mutation";

interface ParsedReviewTriageLog {
  entries: ReviewTriageEntryV2[];
  repairedTrailingTriage: boolean;
  recoveryRequired: boolean;
}

interface LoadedRun {
  state: LoopStateV2;
  events: LoopEventRecordV2[];
  recovered: boolean;
  repairedTrailingEvent: boolean;
  repairedTrailingTriage: boolean;
  triageRecoveryRequired: boolean;
}

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const WINDOWS_RESERVED_SEGMENT = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
const ACTIVE_PHASE_SET = new Set<string>(ACTIVE_PHASES_V2);

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function isAlreadyExists(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function validateSegment(value: string, label: string): string {
  if (
    !SAFE_SEGMENT.test(value) ||
    value === "." ||
    value === ".." ||
    value.endsWith(".") ||
    WINDOWS_RESERVED_SEGMENT.test(value)
  ) {
    throw new LoopStorePathError(`Unsafe ${label}: '${value}'`);
  }
  return value;
}

function assertContained(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
    return;
  }
  throw new LoopStorePathError(`Path escapes loop root: ${target}`);
}

function jsonBytes(value: unknown, pretty = true): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`, "utf8");
}

function parseJson<T>(bytes: Buffer, path: string): T {
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch (error) {
    throw new LoopStoreCorruptionError(`Malformed JSON in ${path}`, error);
  }
}

function stateIsActive(state: LoopStateV2): boolean {
  return ACTIVE_PHASE_SET.has(state.phase);
}

function pointerFor(state: LoopStateV2): CurrentRunPointerV2 {
  return {
    schemaVersion: 2,
    changeName: state.changeName,
    runId: state.runId,
    stateRevision: state.stateRevision,
    nonce: state.nonce,
    updatedAt: state.updatedAt,
  };
}

/** Resolve canonical paths without accepting path traversal in identifiers. */
export function loopRunPathsV2(
  projectRoot: string,
  changeName: string,
  runId?: string,
): LoopRunPathsV2 {
  validateSegment(changeName, "change name");
  if (runId !== undefined) validateSegment(runId, "run id");
  const root = resolve(projectRoot);
  const loopRoot = resolve(root, ".corgi", "loop");
  const changeRoot = resolve(loopRoot, changeName);
  const runs = resolve(changeRoot, "runs");
  assertContained(root, loopRoot);
  assertContained(loopRoot, changeRoot);
  const base: LoopRunPathsV2 = {
    projectRoot: root,
    loopRoot,
    changeRoot,
    lock: resolve(changeRoot, ".lock"),
    current: resolve(changeRoot, "current.json"),
    runs,
  };
  if (runId === undefined) return base;
  const runRoot = resolve(runs, runId);
  assertContained(runs, runRoot);
  return {
    ...base,
    runRoot,
    state: resolve(runRoot, "state.json"),
    events: resolve(runRoot, "events.jsonl"),
    reviewTriage: resolve(runRoot, "review-triage.jsonl"),
    attempts: resolve(runRoot, "attempts"),
    migrationMarker: resolve(runRoot, "migration-v1.json"),
  };
}

export class LoopStoreV2 {
  readonly projectRoot: string;
  readonly loopRoot: string;
  private readonly fs: LoopStoreFileSystem;
  private readonly faults?: LoopStoreFaultInjector;
  private readonly now: () => Date;
  private readonly lockTimeoutMs: number;
  private readonly lockPollMs: number;
  private readonly lockStaleMs: number;
  private readonly hostname: string;

  constructor(options: LoopStoreV2Options) {
    this.projectRoot = resolve(options.projectRoot);
    this.loopRoot = resolve(this.projectRoot, ".corgi", "loop");
    assertContained(this.projectRoot, this.loopRoot);
    this.fs = { ...defaultFileSystem, ...options.fs };
    this.faults = options.faults;
    this.now = options.now ?? (() => new Date());
    this.lockTimeoutMs = options.lockTimeoutMs ?? 0;
    this.lockPollMs = Math.max(1, options.lockPollMs ?? 10);
    this.lockStaleMs = Math.max(1_000, options.lockStaleMs ?? 5 * 60_000);
    this.hostname = hostname();
  }

  paths(changeName: string, runId?: string): LoopRunPathsV2 {
    return loopRunPathsV2(this.projectRoot, changeName, runId);
  }

  async initialize(input: InitializeLoopRunV2Input): Promise<LoopStateV2> {
    assertLoopStateV2(input.state);
    assertLoopEventV2(input.event);
    this.assertRecordBindings(input.event, input.state);
    const { changeName, runId } = input.state;
    this.paths(changeName, runId);

    return this.withChangeLock(changeName, true, async () => {
      const runs = await this.scanRuns(changeName);
      const pointer = await this.readCurrent(this.paths(changeName).current);
      const preferred = pointer
        ? runs.find((run) => run.state.runId === pointer.runId)
        : undefined;
      const pendingConvergence = preferred
        ? pendingConvergenceIntentV2(preferred.state)
        : undefined;
      if (pendingConvergence && !isBoundConvergenceSuccessorV2(
        preferred!.state,
        input.state,
        pendingConvergence,
      )) {
        throw new ConvergenceRecoveryRequiredError(changeName);
      }
      const foldedCollision = runs.find(
        (run) => run.state.runId !== runId &&
          run.state.runId.toLowerCase() === runId.toLowerCase(),
      );
      if (foldedCollision) {
        throw new LoopStorePathError(
          `Run id '${runId}' has a portable case-fold collision with '${foldedCollision.state.runId}'`,
        );
      }
      const active = runs.filter((run) => stateIsActive(run.state));
      const sameRun = runs.find((run) => run.state.runId === runId);
      if (sameRun) {
        if (
          isDeepStrictEqual(sameRun.state, input.state) &&
          sameRun.events.some((record) => isDeepStrictEqual(record.event, input.event))
        ) {
          await this.ensureRunFiles(input.state);
          await this.atomicWriteCurrent(input.state, changeName);
          return sameRun.state;
        }
        throw new LoopStoreConflictError(
          `Run '${runId}' already exists with different state or initialization event`,
        );
      }
      if (active.length > 1) {
        throw new MultipleActiveRunsError(changeName, active.map((run) => run.state.runId));
      }
      if (active.length === 1) {
        const existing = active[0]!;
        throw new LoopStoreConflictError(
          `Active run '${existing.state.runId}' already exists for '${changeName}'`,
        );
      }

      const paths = this.requireRunPaths(changeName, runId);
      const staging = this.initializationStagingPaths(paths, runId);
      await this.ensureDirectory(staging.runRoot);
      const record: LoopEventRecordV2 = {
        schemaVersion: 2,
        event: input.event,
        postState: input.state,
      };
      assertLoopEventRecordV2(record);
      let published = false;
      try {
        // Initialization is assembled event-first in a hidden staging directory.
        // scanRuns deliberately ignores hidden directories, so process death at
        // any point before the rename cannot publish a corrupt canonical run.
        await this.appendEventRecord(staging, record);
        await this.atomicWriteState(staging, input.state);
        await this.ensureEmptyFile(staging.reviewTriage);
        await this.syncDirectory(staging.runRoot);
        await this.fault("before_initialization_rename", input.state, paths.runRoot);
        await this.fs.rename(staging.runRoot, paths.runRoot);
        published = true;
        await this.syncDirectory(paths.runs);
        await this.fault("after_initialization_rename", input.state, paths.runRoot);
        await this.atomicWriteCurrent(input.state, changeName);
        return input.state;
      } catch (error) {
        if (published) {
          await this.cleanupFailedInitialization(paths, input.event);
        } else {
          await this.fs.rm(staging.runRoot, { recursive: true, force: true }).catch(() => undefined);
          await this.syncDirectory(paths.runs).catch(() => undefined);
        }
        throw error;
      }
    });
  }

  async inspect(
    changeName: string,
    options: { runId?: string; readOnly?: boolean } = {},
  ): Promise<LoopStoreInspectionV2> {
    if (options.readOnly) return this.peek(changeName, options);
    if (options.runId !== undefined) this.paths(changeName, options.runId);
    const base = this.paths(changeName);
    if (!(await this.pathExists(base.changeRoot))) {
      return {
        current: null,
        state: null,
        events: [],
        recovered: false,
        repairedTrailingEvent: false,
      };
    }
    return this.withChangeLock(changeName, false, async () => {
      const runs = await this.scanRuns(changeName, true, "inspect");
      const active = runs.filter((run) => stateIsActive(run.state));
      if (active.length > 1) {
        throw new MultipleActiveRunsError(changeName, active.map((run) => run.state.runId));
      }

      const pointer = await this.readCurrent(base.current);
      const selectedRunId = options.runId ?? active[0]?.state.runId ?? pointer?.runId;
      if (selectedRunId === undefined) {
        return {
          current: pointer,
          state: null,
          events: [],
          recovered: false,
          repairedTrailingEvent: false,
        };
      }
      validateSegment(selectedRunId, "run id");
      const selected = runs.find((run) => run.state.runId === selectedRunId);
      if (!selected) {
        throw new LoopStoreCorruptionError(
          `current.json references missing run '${selectedRunId}'`,
        );
      }
      const expectedPointer = pointerFor(selected.state);
      const pointerStale = !pointer || !isDeepStrictEqual(pointer, expectedPointer);
      if (pointerStale && (options.runId === undefined || stateIsActive(selected.state))) {
        await this.atomicWriteCurrent(selected.state, changeName);
      }
      return {
        current: pointerStale ? expectedPointer : pointer,
        state: selected.state,
        events: selected.events,
        recovered: selected.recovered || pointerStale,
        repairedTrailingEvent: selected.repairedTrailingEvent,
        repairedTrailingTriage: selected.repairedTrailingTriage,
      };
    });
  }

  /** Inspect without a lock and without repairing logs, snapshots, or pointers. */
  async peek(
    changeName: string,
    options: { runId?: string; allowIncompleteLegacyMigration?: boolean } = {},
  ): Promise<LoopStoreInspectionV2> {
    if (options.runId !== undefined) this.paths(changeName, options.runId);
    const base = this.paths(changeName);
    if (!(await this.pathExists(base.changeRoot))) {
      return {
        current: null,
        state: null,
        events: [],
        recovered: false,
        repairedTrailingEvent: false,
        recoveryRequired: false,
      };
    }
    await this.assertSafeExisting(base.changeRoot);
    const runs = await this.scanRuns(
      changeName,
      false,
      "peek",
      true,
      options.allowIncompleteLegacyMigration === true,
    );
    const active = runs.filter((run) => stateIsActive(run.state));
    if (active.length > 1) {
      throw new MultipleActiveRunsError(changeName, active.map((run) => run.state.runId));
    }
    const pointer = await this.readCurrent(base.current);
    const selectedRunId = options.runId ?? active[0]?.state.runId ?? pointer?.runId;
    if (selectedRunId === undefined) {
      return {
        current: pointer,
        state: null,
        events: [],
        recovered: false,
        repairedTrailingEvent: false,
        recoveryRequired: false,
      };
    }
    const selected = runs.find((run) => run.state.runId === selectedRunId);
    if (!selected) {
      throw new LoopStoreCorruptionError(
        `current.json references missing run '${selectedRunId}'`,
      );
    }
    const expectedPointer = pointerFor(selected.state);
    const pointerStale = !pointer || !isDeepStrictEqual(pointer, expectedPointer);
    return {
      current: pointer,
      state: selected.state,
      events: selected.events,
      recovered: false,
      repairedTrailingEvent: false,
      recoveryRequired: pointerStale || selected.triageRecoveryRequired,
    };
  }

  async transition(input: TransitionLoopRunV2Input): Promise<LoopStateV2> {
    this.paths(input.changeName, input.runId);
    assertLoopStateV2(input.nextState);
    assertLoopEventV2(input.event);
    this.assertRecordBindings(input.event, input.nextState);
    return this.withChangeLock(input.changeName, false, async () => {
      const current = await this.loadSelectedRun(input);
      const historical = current.events.find(
        (record) => record.event.seq === input.event.seq,
      );
      if (current.state.sessionId !== input.sessionId) {
        // An exact retry of the latest resume is allowed to present the
        // superseded session id: the first attempt durably changed it before
        // the caller received the response. Bind this exception to the
        // original CAS/source session and to the unchanged current snapshot.
        const source = historical?.event.type === "run_resumed"
          ? current.events.find((record) =>
              record.event.seq === historical.event.seq - 1 &&
              record.postState.stateRevision === input.expectedStateRevision &&
              record.postState.nonce === input.expectedNonce
            )?.postState
          : undefined;
        if (
          historical?.event.type === "run_resumed" &&
          input.expectedStateRevision === historical.event.expectedStateRevision &&
          input.expectedNonce === historical.event.expectedNonce &&
          source?.sessionId === input.sessionId &&
          isDeepStrictEqual(historical.event, input.event) &&
          isDeepStrictEqual(historical.postState, input.nextState) &&
          isDeepStrictEqual(historical.postState, current.state)
        ) {
          return historical.postState;
        }
        throw new LoopStoreSessionConflictError(input.sessionId, current.state.sessionId);
      }
      if (historical) {
        if (
          isDeepStrictEqual(historical.event, input.event) &&
          isDeepStrictEqual(historical.postState, input.nextState)
        ) {
          return historical.postState;
        }
        throw new LoopStoreConflictError(
          `Event sequence ${input.event.seq} already contains different content`,
        );
      }
      this.assertCas(current.state, input);
      this.assertTransition(current.state, input.event, input.nextState);
      const paths = this.requireRunPaths(input.changeName, input.runId);
      const record: LoopEventRecordV2 = {
        schemaVersion: 2,
        event: input.event,
        postState: input.nextState,
      };
      assertLoopEventRecordV2(record);
      await this.appendEventRecord(paths, record);
      await this.atomicWriteState(paths, input.nextState);
      await this.atomicWriteCurrent(input.nextState, input.changeName);
      return input.nextState;
    });
  }

  async writeAttemptBundle(
    input: WriteAttemptBundleV2Input,
  ): Promise<AttemptBundleWriteResultV2> {
    this.paths(input.changeName, input.runId);
    validateSegment(input.groupId, "group id");
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
      throw new LoopStorePathError(`Invalid attempt: ${input.attempt}`);
    }
    this.validateBundle(input);
    this.validateAttemptFiles(input.files);
    return this.withChangeLock(input.changeName, false, async () => {
      await this.loadForMutation(input);
      return this.writeAttemptBundleUnlocked(input);
    });
  }

  /**
   * Commit an attempt marker and its state events under one change lock.
   * Exact historical event records make retries idempotent even after a crash.
   */
  async submitAttemptTransaction(
    input: SubmitAttemptTransactionV2Input,
  ): Promise<SubmitAttemptTransactionV2Result> {
    this.paths(input.changeName, input.runId);
    validateSegment(input.groupId, "group id");
    if (!Number.isSafeInteger(input.attempt) || input.attempt < 1) {
      throw new LoopStorePathError(`Invalid attempt: ${input.attempt}`);
    }
    this.validateBundle(input);
    this.validateAttemptFiles(input.files);
    if (input.transitions.length === 0) {
      throw new LoopStoreConflictError("Attempt transaction requires at least one transition");
    }
    for (const transition of input.transitions) {
      assertLoopEventV2(transition.event);
      assertLoopStateV2(transition.nextState);
      this.assertRecordBindings(transition.event, transition.nextState);
    }
    for (const entry of input.triageEntries ?? []) {
      this.validateTriage({ ...input, entry });
      if (
        entry.groupId !== input.groupId ||
        entry.attempt !== input.attempt ||
        typeof input.bundle.bundleId !== "string" ||
        entry.bundleId !== input.bundle.bundleId
      ) {
        throw new LoopStoreConflictError(
          "Review triage must bind to the submitted group, attempt, and bundle",
        );
      }
    }
    this.validateTriageBatch(input.triageEntries ?? []);

    return this.withChangeLock(input.changeName, false, async () => {
      const selected = await this.loadSelectedRun(input);
      if (selected.state.sessionId !== input.sessionId) {
        throw new LoopStoreSessionConflictError(input.sessionId, selected.state.sessionId);
      }
      let committedPrefix = 0;
      for (const transition of input.transitions) {
        const existing = selected.events.find(
          (record) => record.event.seq === transition.event.seq,
        );
        if (!existing) break;
        if (
          !isDeepStrictEqual(existing.event, transition.event) ||
          !isDeepStrictEqual(existing.postState, transition.nextState)
        ) {
          throw new LoopStoreConflictError(
            `Event sequence ${transition.event.seq} already contains different content`,
          );
        }
        committedPrefix++;
      }

      if (committedPrefix === 0) {
        this.assertCas(selected.state, input);
      } else {
        const first = input.transitions[0]!.event;
        if (
          first.expectedStateRevision !== input.expectedStateRevision ||
          first.expectedNonce !== input.expectedNonce
        ) {
          throw new LoopStoreConflictError("Retry token does not bind to the historical event");
        }
      }

      const transactionPaths = this.requireRunPaths(input.changeName, input.runId);
      await this.assertTriageBatchCanAppend(
        transactionPaths,
        input.runId,
        input.triageEntries ?? [],
      );
      let bundle: AttemptBundleWriteResultV2;
      const paths = this.requireRunPaths(input.changeName, input.runId);
      const target = resolve(paths.attempts, input.groupId, String(input.attempt));
      if (committedPrefix > 0) {
        await this.assertExistingBundle(target, input);
        bundle = { path: target, idempotent: true };
      } else {
        bundle = await this.writeAttemptBundleUnlocked(input);
      }

      // Validate or durably publish the immutable attempt before appending any
      // triage or state events. This keeps an unsafe idempotent leaf from
      // causing a partial canonical transaction.
      for (const entry of input.triageEntries ?? []) {
        await this.appendReviewTriageUnlocked(
          transactionPaths,
          input,
          entry,
        );
      }

      if (committedPrefix === input.transitions.length) {
        return { state: selected.state, bundle, idempotent: true };
      }
      const expectedCursor = committedPrefix === 0
        ? selected.state
        : input.transitions[committedPrefix - 1]!.nextState;
      if (!isDeepStrictEqual(selected.state, expectedCursor)) {
        throw new LoopStoreConflictError(
          "Run advanced beyond a partially committed attempt transaction",
        );
      }

      let cursor = selected.state;
      for (const transition of input.transitions.slice(committedPrefix)) {
        this.assertTransition(cursor, transition.event, transition.nextState);
        const record: LoopEventRecordV2 = {
          schemaVersion: 2,
          event: transition.event,
          postState: transition.nextState,
        };
        assertLoopEventRecordV2(record);
        await this.appendEventRecord(paths, record);
        await this.atomicWriteState(paths, transition.nextState);
        cursor = transition.nextState;
      }
      await this.atomicWriteCurrent(cursor, input.changeName);
      return {
        state: cursor,
        bundle,
        idempotent: committedPrefix > 0 || bundle.idempotent,
      };
    });
  }

  private async writeAttemptBundleUnlocked(
    input: WriteAttemptBundleV2Input,
  ): Promise<AttemptBundleWriteResultV2> {
    const paths = this.requireRunPaths(input.changeName, input.runId);
    const attemptsRoot = paths.attempts;
    const groupRoot = resolve(attemptsRoot, input.groupId);
    const target = resolve(groupRoot, String(input.attempt));
    assertContained(attemptsRoot, target);
    await this.ensureDirectory(groupRoot);

    if (await this.pathExists(target)) {
      await this.assertSafeExisting(target);
      await this.assertExistingBundle(target, input);
      return { path: target, idempotent: true };
    }

    const temp = resolve(groupRoot, `.tmp-${input.attempt}-${process.pid}-${randomUUID()}`);
    assertContained(groupRoot, temp);
    await this.fault("before_bundle_artifacts", input, temp);
    await this.ensureDirectory(temp);
    try {
      for (const [relativePath, value] of Object.entries(input.files)) {
        const file = this.safeArtifactPath(temp, relativePath);
        await this.ensureDirectory(dirname(file));
        await this.writeDurableFile(file, this.artifactBytes(value));
      }
      await this.syncDirectoryTree(temp);
      await this.fault("after_bundle_artifacts_fsync", input, temp);
      await this.fault("before_bundle_marker", input, temp);
      await this.writeDurableFile(resolve(temp, "bundle.json"), jsonBytes(input.bundle));
      await this.fault("after_bundle_marker_fsync", input, temp);
      await this.syncDirectory(temp);
      await this.fault("before_bundle_rename", input, target);
      await this.fs.rename(temp, target);
      await this.fault("after_bundle_rename", input, target);
      await this.syncDirectory(groupRoot);
      return { path: target, idempotent: false };
    } catch (error) {
      await this.fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async appendReviewTriage(input: AppendReviewTriageV2Input): Promise<void> {
    this.paths(input.changeName, input.runId);
    this.validateTriage(input);
    await this.withChangeLock(input.changeName, false, async () => {
      await this.loadForMutation(input);
      const paths = this.requireRunPaths(input.changeName, input.runId);
      await this.appendReviewTriageUnlocked(paths, input, input.entry);
    });
  }

  private async appendReviewTriageUnlocked(
    paths: RequiredRunPaths,
    identity: Pick<LoopStoreCasV2, "changeName" | "runId">,
    entry: ReviewTriageEntryV2,
  ): Promise<void> {
    const existingEntries = (await this.readReviewTriageLog(paths, "mutation")).entries;
    const repeated = existingEntries.find(
      (candidate) =>
        candidate.runId === identity.runId &&
        candidate.groupId === entry.groupId &&
        candidate.attempt === entry.attempt &&
        candidate.bundleId === entry.bundleId &&
        candidate.findingFingerprint === entry.findingFingerprint,
    );
    if (repeated) {
      if (isDeepStrictEqual(repeated, entry)) return;
      throw new LoopStoreConflictError(
        "Review finding already has a different triage decision",
      );
    }
    await this.fault("before_triage_append", identity, paths.reviewTriage);
    const handle = await this.fs.open(
      paths.reviewTriage,
      fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY,
      0o600,
    );
    try {
      await handle.writeFile(jsonBytes(entry, false));
      await this.fault("after_triage_write", identity, paths.reviewTriage);
      await handle.sync();
      await this.fault("after_triage_fsync", identity, paths.reviewTriage);
    } finally {
      await handle.close();
    }
    await this.syncDirectory(paths.runRoot);
  }

  /** Install the immutable v1 archive and the writer-detection marker. */
  async installLegacyMigration(input: InstallLegacyMigrationV2Input): Promise<void> {
    this.paths(input.changeName, input.runId);
    if (
      input.marker.schemaVersion !== 2 ||
      input.marker.changeName !== input.changeName ||
      input.marker.runId !== input.runId ||
      !["claude", "opencode"].includes(input.marker.sourcePlatform)
    ) {
      throw new LoopStoreConflictError("Legacy migration marker identity is invalid");
    }
    await this.withChangeLock(input.changeName, false, async () => {
      // A crash may leave the immutable archive durable immediately before the
      // marker rename. Only this installer may inspect and finish that state;
      // every other canonical mutation fails closed on the missing marker.
      const selected = await this.loadSelectedRun(input, false);
      this.assertCas(selected.state, input);
      const paths = this.requireRunPaths(input.changeName, input.runId);
      const legacyTarget = resolve(paths.runRoot, "legacy");
      if (await this.pathExists(paths.migrationMarker)) {
        await this.assertNoLegacyWrites(input.changeName, input.runId);
        await this.assertSafeExisting(paths.migrationMarker);
        const existing = parseJson<LegacyMigrationMarkerV2>(
          await this.fs.readFile(paths.migrationMarker),
          paths.migrationMarker,
        );
        if (isDeepStrictEqual(existing, input.marker)) return;
        throw new LoopStoreConflictError("A different v1 migration is already installed");
      }
      const archiveAlreadyDurable = await this.pathExists(legacyTarget);
      if (archiveAlreadyDurable) {
        await this.assertSafeExisting(legacyTarget);
        await this.assertExistingArchive(legacyTarget, input.archiveFiles);
      }
      const temp = resolve(paths.runRoot, `.legacy.tmp-${process.pid}-${randomUUID()}`);
      if (!archiveAlreadyDurable) await this.ensureDirectory(temp);
      try {
        if (!archiveAlreadyDurable) {
          for (const [relativePath, value] of Object.entries(input.archiveFiles)) {
            const target = this.safeArtifactPath(temp, relativePath);
            await this.ensureDirectory(dirname(target));
            await this.writeDurableFile(target, this.artifactBytes(value));
          }
          await this.syncDirectoryTree(temp);
          await this.fs.rename(temp, legacyTarget);
          await this.syncDirectory(paths.runRoot);
        }
        // The marker is written last: its presence means migration is complete.
        const markerTemp = `${paths.migrationMarker}.tmp-${process.pid}-${randomUUID()}`;
        try {
          await this.writeDurableFile(markerTemp, jsonBytes(input.marker));
          await this.fs.rename(markerTemp, paths.migrationMarker);
          await this.syncDirectory(paths.runRoot);
        } catch (error) {
          await this.fs.rm(markerTemp, { recursive: true, force: true }).catch(() => undefined);
          throw error;
        }
      } catch (error) {
        await this.fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  private async withChangeLock<T>(
    changeName: string,
    create: boolean,
    callback: () => Promise<T>,
  ): Promise<T> {
    const paths = this.paths(changeName);
    if (create) {
      await this.ensureDirectory(paths.changeRoot);
      await this.ensureDirectory(paths.runs);
    } else {
      await this.assertSafeExisting(paths.changeRoot);
      if (!(await this.pathExists(paths.changeRoot))) {
        throw new LoopStoreConflictError(`No canonical loop exists for '${changeName}'`);
      }
    }

    const token = randomUUID();
    const deadline = Date.now() + this.lockTimeoutMs;
    let handle: FileHandle | undefined;
    while (handle === undefined) {
      try {
        handle = await this.fs.open(
          paths.lock,
          fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
          0o600,
        );
      } catch (error) {
        if (isAlreadyExists(error) && await this.tryReclaimStaleLock(paths.lock)) {
          continue;
        }
        if (!isAlreadyExists(error) || Date.now() >= deadline) {
          if (isAlreadyExists(error)) throw new LoopStoreLockedError(changeName);
          throw error;
        }
        await new Promise((settle) => setTimeout(settle, this.lockPollMs));
      }
    }

    try {
      await handle.writeFile(
        jsonBytes({
          token,
          pid: process.pid,
          hostname: this.hostname,
          acquiredAt: this.now().toISOString(),
        }),
      );
      await handle.sync();
      await this.fault("after_lock_acquired", { changeName }, paths.lock);
      return await callback();
    } finally {
      await handle.close().catch(() => undefined);
      try {
        const lock = parseJson<{ token?: string }>(await this.fs.readFile(paths.lock), paths.lock);
        if (lock.token === token) await this.fs.unlink(paths.lock);
      } catch (error) {
        if (!isMissing(error)) {
          // A replaced or malformed lock belongs to neither caller; fail closed by leaving it.
        }
      }
    }
  }

  private async scanRuns(
    changeName: string,
    recover = true,
    triageMode: ReviewTriageReadMode = recover ? "mutation" : "peek",
    verifyLegacy = true,
    allowIncompleteLegacyMigration = false,
  ): Promise<LoadedRun[]> {
    const base = this.paths(changeName);
    let entries: Dirent[];
    try {
      await this.assertSafeExisting(base.runs);
      const metadata = await this.fs.lstat(base.runs);
      if (!metadata.isDirectory()) {
        throw new LoopStoreCorruptionError(
          `Runs path must be a real directory: ${base.runs}`,
        );
      }
      entries = await this.fs.readdir(base.runs, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const visibleEntries = entries.filter((entry) => !entry.name.startsWith("."));
    const unsafe = visibleEntries.find((entry) => entry.isSymbolicLink() || !entry.isDirectory());
    if (unsafe) {
      throw new LoopStoreCorruptionError(
        `Run entry '${unsafe.name}' must be a real directory`,
      );
    }
    const runEntries = visibleEntries.sort((a, b) => compareCodeUnits(a.name, b.name));
    const portableNames = new Map<string, string>();
    for (const entry of runEntries) {
      validateSegment(entry.name, "run id");
      const folded = entry.name.toLowerCase();
      const previous = portableNames.get(folded);
      if (previous !== undefined) {
        throw new LoopStoreCorruptionError(
          `Run directories '${previous}' and '${entry.name}' have a portable case-fold collision`,
        );
      }
      portableNames.set(folded, entry.name);
    }
    const runs: LoadedRun[] = [];
    for (const entry of runEntries) {
      const paths = this.requireRunPaths(changeName, entry.name);
      await this.assertSafeExisting(paths.runRoot);
      if (verifyLegacy) {
        await this.assertNoLegacyWrites(
          changeName,
          entry.name,
          allowIncompleteLegacyMigration,
        );
      }
      runs.push(await this.loadAndRecoverRun(paths, recover, triageMode));
    }
    return runs;
  }

  private async loadForMutation(input: LoopStoreCasV2): Promise<LoadedRun> {
    const selected = await this.loadSelectedRun(input);
    this.assertCas(selected.state, input);
    return selected;
  }

  private async loadSelectedRun(
    input: Pick<LoopStoreCasV2, "changeName" | "runId">,
    verifyLegacy = true,
  ): Promise<LoadedRun> {
    const runs = await this.scanRuns(
      input.changeName,
      true,
      "mutation",
      verifyLegacy,
    );
    const active = runs.filter((run) => stateIsActive(run.state));
    if (active.length > 1) {
      throw new MultipleActiveRunsError(
        input.changeName,
        active.map((run) => run.state.runId),
      );
    }
    const selected = runs.find((run) => run.state.runId === input.runId);
    if (!selected) {
      throw new LoopStoreConflictError(`Run '${input.runId}' does not exist`);
    }
    if (active.length === 1 && active[0]!.state.runId !== input.runId) {
      throw new LoopStoreConflictError(
        `Run '${input.runId}' is not the active run for '${input.changeName}'`,
      );
    }
    return selected;
  }

  private assertCas(state: LoopStateV2, input: LoopStoreCasV2): void {
    if (input.sessionId !== state.sessionId) {
      throw new LoopStoreSessionConflictError(input.sessionId, state.sessionId);
    }
    if (
      input.expectedStateRevision !== state.stateRevision ||
      input.expectedNonce !== state.nonce
    ) {
      throw new LoopStoreConflictError(
        `Stale state token for '${state.runId}': expected revision ${input.expectedStateRevision} / nonce '${input.expectedNonce}', current revision ${state.stateRevision} / nonce '${state.nonce}'`,
      );
    }
  }

  private assertTransition(
    current: LoopStateV2,
    event: LoopEventV2,
    next: LoopStateV2,
  ): void {
    let authoritative: LoopStateV2;
    try {
      authoritative = reduceLoopEventV2(current, event).postState;
    } catch (error) {
      throw new LoopStoreConflictError(
        `Event is not valid for the current state: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!isDeepStrictEqual(authoritative, next)) {
      throw new LoopStoreConflictError("Provided post-state differs from reducer output");
    }
  }

  private assertRecordBindings(event: LoopEventV2, state: LoopStateV2): void {
    assertLoopEventRecordV2({ schemaVersion: 2, event, postState: state });
    if (event.type === "run_initialized" && !isDeepStrictEqual(event.initialState, state)) {
      throw new LoopStoreConflictError("Initial event must contain the complete initial state");
    }
    if (event.type === "run_initialized") {
      try {
        const reduced = reduceLoopEventV2(null, event);
        if (!isDeepStrictEqual(reduced.postState, state)) {
          throw new LoopStoreConflictError("Initial state differs from reducer output");
        }
      } catch (error) {
        if (error instanceof LoopStoreConflictError) throw error;
        throw new LoopStoreConflictError(
          `Invalid initialization event: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async loadAndRecoverRun(
    paths: RequiredRunPaths,
    recover = true,
    triageMode: ReviewTriageReadMode = recover ? "mutation" : "peek",
  ): Promise<LoadedRun> {
    // Triage is checked first so a canonical mutation cannot repair an event
    // snapshot (or write any other canonical data) while triage itself still
    // requires explicit recovery or is corrupt.
    const triage = await this.readReviewTriageLog(paths, triageMode);
    await this.assertSafeExisting(paths.events);
    await this.assertSafeExisting(paths.state);
    const parsed = await this.readEventLog(paths.events, recover);
    let state: LoopStateV2 | undefined;
    try {
      state = parseJson<LoopStateV2>(await this.fs.readFile(paths.state), paths.state);
      assertLoopStateV2(state);
    } catch (error) {
      if (!isMissing(error)) {
        if (error instanceof LoopStoreCorruptionError) throw error;
        throw new LoopStoreCorruptionError(`Invalid state snapshot: ${paths.state}`, error);
      }
    }

    if (parsed.records.length === 0) {
      throw new LoopStoreCorruptionError(
        state
          ? "State snapshot exists without its authoritative initialization event"
          : `Run has neither state nor events: ${paths.runRoot}`,
      );
    }

    this.assertEventChain(parsed.records);
    const latest = parsed.records.at(-1)!;
    let recovered = false;
    if (!state) {
      if (!recover) {
        throw new LoopStoreRecoveryRequiredError(
          `State snapshot is missing for run '${latest.postState.runId}'`,
        );
      }
      state = latest.postState;
      await this.atomicWriteState(paths, state);
      recovered = true;
    } else if (state.lastEventSeq > latest.event.seq) {
      throw new LoopStoreCorruptionError("State snapshot is ahead of the durable event log");
    } else if (state.lastEventSeq === latest.event.seq) {
      if (!isDeepStrictEqual(state, latest.postState)) {
        throw new LoopStoreCorruptionError("State snapshot disagrees with event post-state");
      }
    } else {
      if (!recover) {
        throw new LoopStoreRecoveryRequiredError(
          `State snapshot for '${state.runId}' is behind the event log`,
        );
      }
      const historical = parsed.records.find(
        (record) => record.event.seq === state!.lastEventSeq,
      );
      if (!historical || !isDeepStrictEqual(historical.postState, state)) {
        throw new LoopStoreCorruptionError("State snapshot is not in the durable event chain");
      }
      state = latest.postState;
      await this.atomicWriteState(paths, state);
      recovered = true;
    }
    return {
      state,
      events: parsed.records,
      recovered: recovered || triage.repairedTrailingTriage,
      repairedTrailingEvent: parsed.repairedTrailingEvent,
      repairedTrailingTriage: triage.repairedTrailingTriage,
      triageRecoveryRequired: triage.recoveryRequired,
    };
  }

  private assertEventChain(records: LoopEventRecordV2[]): void {
    let replayed: LoopStateV2 | null = null;
    for (const current of records) {
      try {
        const reduced = reduceLoopEventV2(replayed, current.event);
        if (!isDeepStrictEqual(reduced.postState, current.postState)) {
          throw new LoopStoreCorruptionError(
            `Event post-state differs from reducer output at seq ${current.event.seq}`,
          );
        }
        replayed = reduced.postState;
      } catch (error) {
        if (error instanceof LoopStoreCorruptionError) throw error;
        throw new LoopStoreCorruptionError(
          `Event replay failed at seq ${current.event.seq}`,
          error,
        );
      }
    }
  }

  private async readReviewTriageLog(
    paths: RequiredRunPaths,
    mode: ReviewTriageReadMode,
  ): Promise<ParsedReviewTriageLog> {
    const path = paths.reviewTriage;
    await this.assertSafeExisting(path);
    let bytes: Buffer;
    try {
      bytes = await this.fs.readFile(path);
    } catch (error) {
      if (isMissing(error)) {
        return {
          entries: [],
          repairedTrailingTriage: false,
          recoveryRequired: false,
        };
      }
      throw error;
    }
    if (bytes.length === 0) {
      return {
        entries: [],
        repairedTrailingTriage: false,
        recoveryRequired: false,
      };
    }

    const content = bytes.toString("utf8");
    const terminated = content.endsWith("\n");
    const lines = content.split("\n");
    if (terminated) lines.pop();
    const entries: ReviewTriageEntryV2[] = [];
    const identities = new Set<string>();
    let byteOffset = 0;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (line.length === 0) {
        throw new LoopStoreCorruptionError(
          `Empty review triage record in the middle of ${path}`,
        );
      }

      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch (error) {
        const isUnterminatedTail = index === lines.length - 1 && !terminated;
        if (!isUnterminatedTail) {
          throw new LoopStoreCorruptionError(
            `Corrupt review triage record ${index + 1} in ${path}`,
            error,
          );
        }
        if (mode === "mutation") {
          throw new LoopStoreRecoveryRequiredError(
            `Review triage log has a truncated final record: ${path}`,
          );
        }
        if (mode === "peek") {
          return {
            entries,
            repairedTrailingTriage: false,
            recoveryRequired: true,
          };
        }
        await this.fs.truncate(path, byteOffset);
        const handle = await this.fs.open(path, fsConstants.O_WRONLY);
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.syncDirectory(paths.runRoot);
        return {
          entries,
          repairedTrailingTriage: true,
          recoveryRequired: false,
        };
      }

      const entry = this.validateStoredTriageEntry(value, paths, index);
      const identity = [
        entry.runId,
        entry.groupId,
        String(entry.attempt),
        entry.bundleId,
        entry.findingFingerprint,
      ].join("\0");
      if (identities.has(identity)) {
        throw new LoopStoreCorruptionError(
          `Duplicate review triage decision at record ${index + 1} in ${path}`,
        );
      }
      identities.add(identity);
      entries.push(entry);
      byteOffset += lineBytes + 1;
    }

    if (!terminated) {
      if (mode === "mutation") {
        throw new LoopStoreRecoveryRequiredError(
          `Review triage log is missing its final record delimiter: ${path}`,
        );
      }
      if (mode === "peek") {
        return {
          entries,
          repairedTrailingTriage: false,
          recoveryRequired: true,
        };
      }
      const handle = await this.fs.open(
        path,
        fsConstants.O_APPEND | fsConstants.O_WRONLY,
      );
      try {
        await handle.writeFile(Buffer.from("\n"));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.syncDirectory(paths.runRoot);
      return {
        entries,
        repairedTrailingTriage: true,
        recoveryRequired: false,
      };
    }

    return {
      entries,
      repairedTrailingTriage: false,
      recoveryRequired: false,
    };
  }

  private validateStoredTriageEntry(
    value: unknown,
    paths: RequiredRunPaths,
    index: number,
  ): ReviewTriageEntryV2 {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new LoopStoreCorruptionError(
        `Invalid review triage record ${index + 1} in ${paths.reviewTriage}`,
      );
    }
    const entry = value as ReviewTriageEntryV2;
    try {
      this.validateTriage({
        changeName: "_stored",
        runId: paths.runRoot.split(sep).at(-1)!,
        sessionId: "_stored",
        expectedStateRevision: 0,
        expectedNonce: "_stored",
        entry,
      });
    } catch (error) {
      throw new LoopStoreCorruptionError(
        `Invalid review triage record ${index + 1} in ${paths.reviewTriage}`,
        error,
      );
    }
    return entry;
  }

  private async readEventLog(path: string, repair = true): Promise<ParsedEventLog> {
    let bytes: Buffer;
    try {
      bytes = await this.fs.readFile(path);
    } catch (error) {
      if (isMissing(error)) return { records: [], repairedTrailingEvent: false };
      throw error;
    }
    if (bytes.length === 0) return { records: [], repairedTrailingEvent: false };
    const content = bytes.toString("utf8");
    const terminated = content.endsWith("\n");
    const lines = content.split("\n");
    if (terminated) lines.pop();
    const records: LoopEventRecordV2[] = [];
    let byteOffset = 0;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]!;
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (line.length === 0) {
        throw new LoopStoreCorruptionError(`Empty event record in the middle of ${path}`);
      }
      try {
        const record = JSON.parse(line) as LoopEventRecordV2;
        assertLoopEventRecordV2(record);
        records.push(record);
      } catch (error) {
        const isTruncatedTail = index === lines.length - 1 && !terminated;
        if (!isTruncatedTail) {
          throw new LoopStoreCorruptionError(`Corrupt event record ${index + 1} in ${path}`, error);
        }
        if (!repair) {
          throw new LoopStoreRecoveryRequiredError(
            `Event log has a truncated final record: ${path}`,
          );
        }
        await this.fs.truncate(path, byteOffset);
        const handle = await this.fs.open(path, fsConstants.O_WRONLY);
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        await this.syncDirectory(dirname(path));
        return { records, repairedTrailingEvent: true };
      }
      byteOffset += lineBytes + 1;
    }
    if (!terminated) {
      if (!repair) {
        throw new LoopStoreRecoveryRequiredError(
          `Event log is missing its final record delimiter: ${path}`,
        );
      }
      const handle = await this.fs.open(path, fsConstants.O_APPEND | fsConstants.O_WRONLY);
      try {
        await handle.writeFile(Buffer.from("\n"));
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.syncDirectory(dirname(path));
      return { records, repairedTrailingEvent: true };
    }
    return { records, repairedTrailingEvent: false };
  }

  private async appendEventRecord(
    paths: RequiredRunPaths,
    record: LoopEventRecordV2,
  ): Promise<void> {
    await this.assertSafeExisting(paths.events);
    await this.fault("before_event_append", record.postState, paths.events);
    const handle = await this.fs.open(
      paths.events,
      fsConstants.O_APPEND | fsConstants.O_CREAT | fsConstants.O_WRONLY,
      0o600,
    );
    try {
      await handle.writeFile(jsonBytes(record, false));
      await this.fault("after_event_write", record.postState, paths.events);
      await handle.sync();
      await this.fault("after_event_fsync", record.postState, paths.events);
    } finally {
      await handle.close();
    }
    await this.syncDirectory(paths.runRoot);
  }

  private async atomicWriteState(paths: RequiredRunPaths, state: LoopStateV2): Promise<void> {
    await this.fault("before_state_temp_write", state, paths.state);
    const temp = `${paths.state}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await this.writeDurableFile(temp, jsonBytes(state));
      await this.fault("after_state_temp_fsync", state, temp);
      await this.fault("before_state_rename", state, paths.state);
      await this.fs.rename(temp, paths.state);
      await this.fault("after_state_rename", state, paths.state);
      await this.syncDirectory(paths.runRoot);
      await this.fault("after_state_directory_fsync", state, paths.runRoot);
    } catch (error) {
      await this.fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async atomicWriteCurrent(state: LoopStateV2, changeName: string): Promise<void> {
    const paths = this.paths(changeName);
    const temp = `${paths.current}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await this.writeDurableFile(temp, jsonBytes(pointerFor(state)));
      await this.fault("before_current_rename", state, paths.current);
      await this.fs.rename(temp, paths.current);
      await this.fault("after_current_rename", state, paths.current);
      await this.syncDirectory(paths.changeRoot);
    } catch (error) {
      await this.fs.rm(temp, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async readCurrent(path: string): Promise<CurrentRunPointerV2 | null> {
    await this.assertSafeExisting(path);
    let value: CurrentRunPointerV2;
    try {
      value = parseJson<CurrentRunPointerV2>(await this.fs.readFile(path), path);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    if (
      value.schemaVersion !== 2 ||
      typeof value.changeName !== "string" ||
      typeof value.runId !== "string" ||
      !Number.isSafeInteger(value.stateRevision) ||
      typeof value.nonce !== "string" ||
      typeof value.updatedAt !== "string"
    ) {
      throw new LoopStoreCorruptionError(`Invalid current pointer: ${path}`);
    }
    return value;
  }

  private async ensureRunFiles(state: LoopStateV2): Promise<void> {
    const paths = this.requireRunPaths(state.changeName, state.runId);
    await this.ensureEmptyFile(paths.reviewTriage);
  }

  private initializationStagingPaths(
    paths: RequiredRunPaths,
    runId: string,
  ): RequiredRunPaths {
    const runRoot = resolve(
      paths.runs,
      `.init-${runId}-${process.pid}-${randomUUID()}`,
    );
    assertContained(paths.runs, runRoot);
    return {
      ...paths,
      runRoot,
      state: resolve(runRoot, "state.json"),
      events: resolve(runRoot, "events.jsonl"),
      reviewTriage: resolve(runRoot, "review-triage.jsonl"),
      attempts: resolve(runRoot, "attempts"),
      migrationMarker: resolve(runRoot, "migration-v1.json"),
    };
  }

  private async cleanupFailedInitialization(
    paths: RequiredRunPaths,
    event: LoopEventV2,
  ): Promise<void> {
    if (await this.pathExists(paths.state)) return;
    let durableInitialization = false;
    try {
      const text = (await this.fs.readFile(paths.events)).toString("utf8").trim();
      if (text) {
        const first = JSON.parse(text.split("\n")[0]!) as LoopEventRecordV2;
        durableInitialization = isDeepStrictEqual(first.event, event);
      }
    } catch {
      durableInitialization = false;
    }
    if (!durableInitialization) {
      await this.fs.rm(paths.runRoot, { recursive: true, force: true });
      await this.syncDirectory(paths.runs);
    }
  }

  private async ensureEmptyFile(path: string): Promise<void> {
    if (await this.pathExists(path)) return;
    const handle = await this.fs.open(
      path,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
      0o600,
    );
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async ensureDirectory(path: string): Promise<void> {
    assertContained(this.projectRoot, path);
    await this.assertSafeExisting(dirname(path));
    await this.fs.mkdir(path, { recursive: true });
    await this.assertSafeExisting(path);
  }

  private async assertSafeExisting(path: string): Promise<void> {
    assertContained(this.projectRoot, path);
    const rel = relative(this.projectRoot, path);
    let cursor = this.projectRoot;
    for (const part of rel.split(sep).filter(Boolean)) {
      cursor = join(cursor, part);
      try {
        const stats = await this.fs.lstat(cursor);
        if (stats.isSymbolicLink()) {
          throw new LoopStorePathError(`Symbolic link is not allowed in loop storage: ${cursor}`);
        }
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
  }

  private async writeDurableFile(
    path: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY;
    const handle = await this.fs.open(path, flags, 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  private async syncDirectory(path: string): Promise<void> {
    let handle: FileHandle | undefined;
    try {
      handle = await this.fs.open(path, fsConstants.O_RDONLY);
      await handle.sync();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!["EINVAL", "ENOTSUP", "EISDIR", "EBADF", "EPERM"].includes(code ?? "")) {
        throw error;
      }
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }

  private async syncDirectoryTree(root: string): Promise<void> {
    const entries = await this.fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await this.syncDirectoryTree(resolve(root, entry.name));
      }
    }
    await this.syncDirectory(root);
  }

  private requireRunPaths(changeName: string, runId: string): RequiredRunPaths {
    return this.paths(changeName, runId) as RequiredRunPaths;
  }

  private safeArtifactPath(root: string, input: string): string {
    if (!input || input.includes("\0") || isAbsolute(input)) {
      throw new LoopStorePathError(`Unsafe attempt artifact path: '${input}'`);
    }
    const path = resolve(root, input);
    assertContained(root, path);
    return path;
  }

  private artifactBytes(value: string | Uint8Array | object): Buffer {
    if (typeof value === "string") return Buffer.from(value, "utf8");
    if (value instanceof Uint8Array) return Buffer.from(value);
    return jsonBytes(value);
  }

  private validateBundle(input: WriteAttemptBundleV2Input): void {
    const { bundle } = input;
    if (
      bundle.schemaVersion !== 2 ||
      bundle.runId !== input.runId ||
      bundle.groupId !== input.groupId ||
      bundle.attempt !== input.attempt
    ) {
      throw new LoopStoreConflictError("Attempt bundle identity does not match its path");
    }
  }

  private validateAttemptFiles(
    files: Record<string, string | Uint8Array | object>,
  ): void {
    const validationRoot = resolve(this.loopRoot, ".attempt-validation");
    const normalized = Object.keys(files).map((input) => {
      const segments = this.portableArtifactSegments(input);
      const path = this.safeArtifactPath(validationRoot, input);
      if (segments.at(-1)!.toLowerCase() === "bundle.json") {
        throw new LoopStorePathError("bundle.json is reserved as the completion marker");
      }
      return {
        path,
        folded: segments.map((segment) => segment.toLowerCase()).join("/"),
      };
    }).sort((a, b) => compareCodeUnits(a.folded, b.folded));
    for (let index = 1; index < normalized.length; index++) {
      const parent = normalized[index - 1]!;
      const child = normalized[index]!;
      if (
        child.folded === parent.folded ||
        child.folded.startsWith(`${parent.folded}/`)
      ) {
        throw new LoopStorePathError(
          `Attempt artifacts have a portable path collision: ${relative(validationRoot, parent.path)}`,
        );
      }
    }
  }

  private portableArtifactSegments(input: string): string[] {
    if (
      !input ||
      /^[A-Za-z]:/u.test(input) ||
      input.startsWith("/") ||
      input.startsWith("\\") ||
      input.includes("\\") ||
      /[\u0000-\u001f\u007f]/u.test(input)
    ) {
      throw new LoopStorePathError(`Attempt artifact path is not portable: '${input}'`);
    }
    const segments = input.split("/");
    for (const segment of segments) {
      const deviceStem = segment.split(".", 1)[0]!.toUpperCase();
      if (
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[<>:"|?*]/u.test(segment) ||
        /[. ]$/u.test(segment) ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(deviceStem)
      ) {
        throw new LoopStorePathError(`Attempt artifact path is not portable: '${input}'`);
      }
    }
    return segments;
  }

  private validateTriageBatch(entries: readonly ReviewTriageEntryV2[]): void {
    const seen = new Map<string, ReviewTriageEntryV2>();
    for (const entry of entries) {
      const key = [
        entry.runId,
        entry.groupId,
        String(entry.attempt),
        entry.bundleId,
        entry.findingFingerprint,
      ].join("\0");
      const previous = seen.get(key);
      if (previous && !isDeepStrictEqual(previous, entry)) {
        throw new LoopStoreConflictError(
          "Transaction contains conflicting triage for the same finding",
        );
      }
      seen.set(key, entry);
    }
  }

  private async assertTriageBatchCanAppend(
    paths: RequiredRunPaths,
    runId: string,
    entries: readonly ReviewTriageEntryV2[],
  ): Promise<void> {
    if (entries.length === 0) return;
    const existing = (await this.readReviewTriageLog(paths, "mutation")).entries;
    for (const entry of entries) {
      const previous = existing.find(
        (candidate) =>
          candidate.runId === runId &&
          candidate.groupId === entry.groupId &&
          candidate.attempt === entry.attempt &&
          candidate.bundleId === entry.bundleId &&
          candidate.findingFingerprint === entry.findingFingerprint,
      );
      if (previous && !isDeepStrictEqual(previous, entry)) {
        throw new LoopStoreConflictError(
          "Review finding already has a different triage decision",
        );
      }
    }
  }

  private async assertExistingBundle(
    target: string,
    input: WriteAttemptBundleV2Input,
  ): Promise<void> {
    const marker = resolve(target, "bundle.json");
    await this.assertSafeExisting(marker);
    if (!(await this.pathExists(marker))) {
      throw new LoopStoreCorruptionError(`Incomplete attempt directory has no bundle.json: ${target}`);
    }
    const existing = parseJson<AttemptBundleV2>(await this.fs.readFile(marker), marker);
    if (!isDeepStrictEqual(existing, input.bundle)) {
      throw new LoopStoreConflictError("Attempt bundle was already committed with different content");
    }
    for (const [relativePath, value] of Object.entries(input.files)) {
      const path = this.safeArtifactPath(target, relativePath);
      await this.assertSafeExisting(path);
      let actual: Buffer;
      try {
        actual = await this.fs.readFile(path);
      } catch (error) {
        throw new LoopStoreCorruptionError(`Committed attempt artifact is missing: ${path}`, error);
      }
      if (!actual.equals(this.artifactBytes(value))) {
        throw new LoopStoreConflictError(`Attempt artifact differs from committed content: ${path}`);
      }
    }
  }

  private async assertExistingArchive(
    target: string,
    expected: Record<string, string | Uint8Array | object>,
  ): Promise<void> {
    for (const [relativePath, value] of Object.entries(expected)) {
      const path = this.safeArtifactPath(target, relativePath);
      await this.assertSafeExisting(path);
      try {
        const actual = await this.fs.readFile(path);
        if (!actual.equals(this.artifactBytes(value))) {
          throw new LoopStoreCorruptionError(
            `Legacy archive differs from migration input: ${path}`,
          );
        }
      } catch (error) {
        if (error instanceof LoopStoreCorruptionError) throw error;
        throw new LoopStoreCorruptionError(`Incomplete legacy archive: ${path}`, error);
      }
    }
  }

  private validateTriage(input: AppendReviewTriageV2Input): void {
    const { entry } = input;
    const findingValidation = validateFindingTriageV2({
      schemaVersion: entry?.schemaVersion,
      findingFingerprint: entry?.findingFingerprint,
      disposition: entry?.action,
      actor: entry?.actor,
      reason: entry?.reason,
      occurredAt: entry?.occurredAt,
    });
    if (
      !findingValidation.valid ||
      entry.schemaVersion !== 2 ||
      entry.runId !== input.runId ||
      typeof entry.groupId !== "string" ||
      !entry.groupId.trim() ||
      !Number.isSafeInteger(entry.attempt) ||
      entry.attempt < 1 ||
      typeof entry.bundleId !== "string" ||
      !entry.bundleId.trim() ||
      typeof entry.findingFingerprint !== "string" ||
      !entry.findingFingerprint.trim() ||
      !["dismissed", "accepted-risk"].includes(entry.action) ||
      entry.actor?.kind !== "human" ||
      typeof entry.actor.id !== "string" ||
      !entry.actor.id.trim() ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim() ||
      typeof entry.occurredAt !== "string" ||
      !Number.isFinite(Date.parse(entry.occurredAt))
    ) {
      throw new LoopStoreConflictError(
        "Review triage requires a bound finding, human actor, reason, and timestamp",
      );
    }
  }

  private async assertNoLegacyWrites(
    changeName: string,
    runId: string,
    allowIncompleteLegacyMigration = false,
  ): Promise<void> {
    const paths = this.requireRunPaths(changeName, runId);
    const legacyRoot = resolve(paths.runRoot, "legacy");
    const entryExists = async (path: string): Promise<boolean> => {
      try {
        await this.fs.lstat(path);
        return true;
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    };
    const [markerExists, legacyExists] = await Promise.all([
      entryExists(paths.migrationMarker),
      entryExists(legacyRoot),
    ]);
    if (!markerExists && !legacyExists) return;
    if (!markerExists && legacyExists && allowIncompleteLegacyMigration) return;
    if (!markerExists || !legacyExists) {
      throw new LoopStoreCorruptionError(
        `Incomplete legacy migration provenance for run '${runId}'`,
      );
    }
    try {
      await this.assertSafeExisting(paths.migrationMarker);
      await this.assertSafeExisting(legacyRoot);
      const [markerStats, legacyStats] = await Promise.all([
        this.fs.lstat(paths.migrationMarker),
        this.fs.lstat(legacyRoot),
      ]);
      if (!markerStats.isFile() || !legacyStats.isDirectory()) {
        throw new Error("marker/archive type mismatch");
      }
    } catch (error) {
      throw new LoopStoreCorruptionError(
        `Unsafe legacy migration provenance for run '${runId}'`,
        error,
      );
    }
    const markerValue = parseJson<unknown>(
      await this.fs.readFile(paths.migrationMarker),
      paths.migrationMarker,
    );
    if (
      typeof markerValue !== "object" ||
      markerValue === null ||
      Array.isArray(markerValue)
    ) {
      throw new LoopStoreCorruptionError(`Invalid migration marker: ${paths.migrationMarker}`);
    }
    const marker = markerValue as LegacyMigrationMarkerV2;
    if (
      marker.schemaVersion !== 2 ||
      marker.changeName !== changeName ||
      marker.runId !== runId ||
      !["claude", "opencode"].includes(marker.sourcePlatform) ||
      typeof marker.migratedAt !== "string" ||
      !Number.isFinite(Date.parse(marker.migratedAt)) ||
      !Array.isArray(marker.sources) ||
      marker.sources.length === 0 ||
      !Array.isArray(marker.absentSources) ||
      !Array.isArray(marker.staleArtifacts)
    ) {
      throw new LoopStoreCorruptionError(`Invalid migration marker: ${paths.migrationMarker}`);
    }
    const sourceRoot = resolve(
      this.projectRoot,
      `.${marker.sourcePlatform}`,
      "corgi-loop",
      changeName,
    );
    const markerPath = (
      value: unknown,
      label: string,
      requireSourceRoot: boolean,
    ): string => {
      if (
        typeof value !== "string" ||
        !value ||
        isAbsolute(value) ||
        /^[A-Za-z]:/u.test(value) ||
        value.startsWith("\\") ||
        value.includes("\\") ||
        value.includes("\0")
      ) {
        throw new LoopStoreCorruptionError(`${label} is not a portable relative path`);
      }
      const segments = value.split("/");
      if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
        throw new LoopStoreCorruptionError(`${label} contains path traversal`);
      }
      const path = resolve(this.projectRoot, value);
      try {
        assertContained(this.projectRoot, path);
        if (requireSourceRoot) assertContained(sourceRoot, path);
      } catch (error) {
        throw new LoopStoreCorruptionError(`${label} escapes its legacy source root`, error);
      }
      return path;
    };
    const seenSources = new Set<string>();
    for (const source of marker.sources) {
      if (
        typeof source !== "object" ||
        source === null ||
        typeof source.path !== "string" ||
        typeof source.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(source.sha256) ||
        !Number.isSafeInteger(source.size) ||
        source.size < 0 ||
        typeof source.mtimeMs !== "number" ||
        !Number.isFinite(source.mtimeMs)
      ) {
        throw new LoopStoreCorruptionError(`Invalid migration source in ${paths.migrationMarker}`);
      }
      const sourcePath = markerPath(source.path, "migration source", true);
      const folded = source.path.toLowerCase();
      if (seenSources.has(folded)) {
        throw new LoopStoreCorruptionError("Migration marker contains duplicate source paths");
      }
      seenSources.add(folded);
      try {
        await this.assertSafeExisting(sourcePath);
        const linkStats = await this.fs.lstat(sourcePath);
        if (!linkStats.isFile()) throw new LegacyWriterDetectedError(sourcePath);
        const stats = await this.fs.stat(sourcePath);
        const bytes = await this.fs.readFile(sourcePath);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        if (
          stats.size !== source.size ||
          stats.mtimeMs !== source.mtimeMs ||
          sha256 !== source.sha256
        ) {
          throw new LegacyWriterDetectedError(sourcePath);
        }
      } catch (error) {
        if (error instanceof LegacyWriterDetectedError) throw error;
        throw new LegacyWriterDetectedError(sourcePath);
      }
    }
    const seenAbsent = new Set<string>();
    for (const relativeSource of marker.absentSources) {
      const sourcePath = markerPath(relativeSource, "absent migration source", true);
      const folded = relativeSource.toLowerCase();
      if (seenAbsent.has(folded) || seenSources.has(folded)) {
        throw new LoopStoreCorruptionError(
          "Migration marker contains duplicate or contradictory source paths",
        );
      }
      seenAbsent.add(folded);
      try {
        await this.assertSafeExisting(sourcePath);
      } catch {
        throw new LegacyWriterDetectedError(sourcePath);
      }
      if (await entryExists(sourcePath)) throw new LegacyWriterDetectedError(sourcePath);
    }
    const seenStale = new Set<string>();
    for (const staleArtifact of marker.staleArtifacts) {
      markerPath(staleArtifact, "stale legacy artifact", false);
      const folded = staleArtifact.toLowerCase();
      if (seenStale.has(folded)) {
        throw new LoopStoreCorruptionError("Migration marker contains duplicate stale artifacts");
      }
      seenStale.add(folded);
    }
  }

  private async pathExists(path: string): Promise<boolean> {
    try {
      await this.fs.access(path, fsConstants.F_OK);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  private async tryReclaimStaleLock(path: string): Promise<boolean> {
    let bytes: Buffer;
    let metadata: Stats;
    try {
      metadata = await this.fs.lstat(path);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new LoopStorePathError(`Unsafe loop lock entry: ${path}`);
      }
      bytes = await this.fs.readFile(path);
    } catch (error) {
      if (isMissing(error)) return true;
      throw error;
    }
    let lock: { token?: string; pid?: number; hostname?: string; acquiredAt?: string } = {};
    try {
      lock = JSON.parse(bytes.toString("utf8")) as typeof lock;
    } catch {
      // A malformed lock still observes the conservative expiry lease below.
    }
    const parsedTime = typeof lock.acquiredAt === "string"
      ? Date.parse(lock.acquiredAt)
      : Number.NaN;
    const acquiredAt = Number.isFinite(parsedTime) ? parsedTime : metadata.mtimeMs;
    const expired = Date.now() - acquiredAt >= this.lockStaleMs;
    let ownerDead = false;
    let ownerKnownLive = false;
    if (
      lock.hostname === this.hostname &&
      Number.isSafeInteger(lock.pid) &&
      lock.pid! > 0
    ) {
      if (lock.pid === process.pid) {
        ownerKnownLive = true;
      } else {
        try {
          process.kill(lock.pid!, 0);
          ownerKnownLive = true;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          ownerDead = code === "ESRCH";
          ownerKnownLive = code === "EPERM";
        }
      }
    }
    if (ownerKnownLive) return false;
    if (!ownerDead && !expired) return false;

    // Rename claims exactly one stale pathname; competing reclaimers see ENOENT.
    // The lock file is untrusted input. Never let its token influence a path:
    // a value containing separators could otherwise move and remove the lock
    // outside the change directory during stale-lock reclamation.
    const quarantine = `${path}.stale-${randomUUID()}`;
    try {
      await this.fs.rename(path, quarantine);
    } catch (error) {
      if (isMissing(error)) return true;
      throw error;
    }

    let claimedMetadata: Stats;
    let claimedBytes: Buffer;
    try {
      claimedMetadata = await this.fs.lstat(quarantine);
    } catch (error) {
      await this.restoreClaimedLock(quarantine, path);
      if (isMissing(error)) return false;
      throw error;
    }
    if (
      claimedMetadata.isSymbolicLink() ||
      !claimedMetadata.isFile()
    ) {
      await this.restoreClaimedLock(quarantine, path);
      return false;
    }
    try {
      claimedBytes = await this.fs.readFile(quarantine);
    } catch (error) {
      await this.restoreClaimedLock(quarantine, path);
      if (isMissing(error)) return false;
      throw error;
    }
    if (
      !sameFileIdentity(metadata, claimedMetadata) ||
      !bytes.equals(claimedBytes)
    ) {
      await this.restoreClaimedLock(quarantine, path);
      return false;
    }
    try {
      await this.fs.unlink(quarantine);
      await this.syncDirectory(dirname(path));
      return true;
    } catch {
      return false;
    }
  }

  private async restoreClaimedLock(quarantine: string, path: string): Promise<void> {
    try {
      // link() is O_EXCL-like and therefore cannot overwrite a third owner's
      // canonical lock. Once restored, removing the quarantine name preserves
      // the exact inode that was claimed by rename.
      await this.fs.link(quarantine, path);
      await this.fs.unlink(quarantine);
      await this.syncDirectory(dirname(path));
    } catch (error) {
      if (!isAlreadyExists(error)) {
        // Leave the locally named quarantine in place rather than deleting an
        // entry whose ownership was not proven.
      }
    }
  }

  private async fault(
    point: LoopStoreFaultPoint,
    context: { changeName: string; runId?: string },
    path?: string,
  ): Promise<void> {
    await this.faults?.(point, { ...context, path });
  }
}

type RequiredRunPaths = LoopRunPathsV2 & {
  runRoot: string;
  state: string;
  events: string;
  reviewTriage: string;
  attempts: string;
  migrationMarker: string;
};
