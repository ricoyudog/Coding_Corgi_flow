import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
  stat,
} from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import {
  LoopStoreV2,
  loopRunPathsV2,
  type LegacyMigrationMarkerV2,
  type LegacyMigrationSourceV2,
  type LoopStoreFileSystem,
} from "./loop-store-v2.js";
import {
  assertLoopStateV2,
  type ArtifactHashV2,
  type LoopEventActorV2,
  type LoopGroupStateV2,
  type LoopLimitsV2,
  type LoopOwnerV2,
  type LoopPolicyV2,
  type LoopRunModeV2,
  type LoopStateV2,
  type RunInitializedEventV2,
} from "./run-contract-v2.js";

export interface LegacyTaskGroupV2 {
  id: string;
  ordinal: number;
  taskGroupFingerprint?: ArtifactHashV2;
}

export interface MigrateLegacyLoopV2Options {
  projectRoot: string;
  changeName: string;
  planningRevision: ArtifactHashV2;
  baselineGitRevision: string;
  workspaceFingerprint: ArtifactHashV2;
  baselineGitTree?: string;
  taskGroups?: LegacyTaskGroupV2[];
  runId?: string;
  sessionId?: string;
  owner?: LoopOwnerV2;
  mode?: LoopRunModeV2;
  policy?: Partial<LoopPolicyV2>;
  limits?: Partial<LoopLimitsV2>;
  now?: () => Date;
  fs?: Partial<LoopStoreFileSystem>;
}

export interface LegacyMigrationResultV2 {
  status: "none" | "already-canonical" | "migrated";
  state: LoopStateV2 | null;
  sourcePath: string | null;
  staleArtifacts: string[];
}

export class LegacyMigrationV2Error extends Error {
  constructor(
    public readonly code:
      | "LEGACY_CORRUPT"
      | "LEGACY_FUTURE_SCHEMA"
      | "LEGACY_MULTIPLE_ACTIVE"
      | "LEGACY_AMBIGUOUS"
      | "LEGACY_INCOMPATIBLE",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LegacyMigrationV2Error";
  }
}

export interface VerifiedLegacyMigrationArchiveV2 {
  marker: LegacyMigrationMarkerV2;
  /** v1 group ordinals represented as stable decimal strings. */
  trustedLegacyGroupIds: string[];
}

export class LegacyMigrationArchiveV2Error extends Error {
  readonly code = "LEGACY_MIGRATION_ARCHIVE_UNTRUSTED" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LegacyMigrationArchiveV2Error";
  }
}

interface LegacyStateRecord {
  path: string;
  platform: "claude" | "opencode";
  bytes: Buffer;
  value: Record<string, unknown>;
}

interface LegacyDiscovery {
  runs: LegacyStateRecord[];
  corrupt: string[];
  future: string[];
}

interface LegacyArchive {
  files: Record<string, Uint8Array | object>;
  marker: LegacyMigrationMarkerV2;
}

const RAW_SHA256 = /^[a-f0-9]{64}$/u;

function archiveError(message: string, cause?: unknown): never {
  throw new LegacyMigrationArchiveV2Error(
    message,
    cause === undefined ? undefined : { cause },
  );
}

function portableRelativeMarkerPath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value ||
    isAbsolute(value) ||
    /^[A-Za-z]:/u.test(value) ||
    value.startsWith("\\") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    archiveError(`${label} must be a safe relative path`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    archiveError(`${label} contains path traversal`);
  }
  return value;
}

async function regularFileWithoutSymlink(
  projectRoot: string,
  path: string,
  label: string,
): Promise<void> {
  await assertNoSymlink(projectRoot, path);
  let metadata;
  try {
    metadata = await lstat(path);
  } catch (error) {
    archiveError(`${label} is missing: ${path}`, error);
  }
  if (!metadata.isFile()) archiveError(`${label} must be a regular file: ${path}`);
}

function validateMarkerSource(
  value: unknown,
  index: number,
): LegacyMigrationSourceV2 {
  if (!record(value)) archiveError(`marker.sources[${index}] must be an object`);
  const path = portableRelativeMarkerPath(value["path"], `marker.sources[${index}].path`);
  if (
    typeof value["sha256"] !== "string" ||
    !RAW_SHA256.test(value["sha256"]) ||
    !finiteInteger(value["size"], 0) ||
    typeof value["mtimeMs"] !== "number" ||
    !Number.isFinite(value["mtimeMs"])
  ) {
    archiveError(`marker.sources[${index}] has an invalid fingerprint`);
  }
  return {
    path,
    sha256: value["sha256"],
    size: value["size"],
    mtimeMs: value["mtimeMs"],
  };
}

async function verifySourceFingerprint(
  projectRoot: string,
  source: LegacyMigrationSourceV2,
): Promise<Buffer> {
  const path = resolve(projectRoot, source.path);
  safeRelative(projectRoot, path);
  await regularFileWithoutSymlink(projectRoot, path, "legacy source");
  const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
  if (
    metadata.size !== source.size ||
    metadata.mtimeMs !== source.mtimeMs ||
    rawHash(bytes) !== source.sha256
  ) {
    archiveError(`Legacy source changed after migration: ${path}`);
  }
  return bytes;
}

async function verifyArchivedCopy(
  projectRoot: string,
  path: string,
  source: LegacyMigrationSourceV2,
  sourceBytes: Buffer,
): Promise<Buffer> {
  await regularFileWithoutSymlink(projectRoot, path, "legacy archive file");
  const bytes = await readFile(path);
  if (
    bytes.length !== source.size ||
    rawHash(bytes) !== source.sha256 ||
    !bytes.equals(sourceBytes)
  ) {
    archiveError(`Legacy archive bytes do not match source: ${path}`);
  }
  return bytes;
}

async function listArchiveFilesNoSymlinks(
  projectRoot: string,
  archiveRoot: string,
): Promise<string[]> {
  await assertNoSymlink(projectRoot, archiveRoot);
  let rootMetadata;
  try {
    rootMetadata = await lstat(archiveRoot);
  } catch (error) {
    archiveError(`Legacy archive directory is missing: ${archiveRoot}`, error);
  }
  if (!rootMetadata.isDirectory()) archiveError("Legacy archive root must be a directory");
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      safeRelative(archiveRoot, path);
      if (entry.isSymbolicLink()) archiveError(`Legacy archive contains a symlink: ${path}`);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.push(relative(archiveRoot, path).split(sep).join("/"));
      } else {
        archiveError(`Legacy archive contains a non-regular entry: ${path}`);
      }
    }
  }
  await visit(archiveRoot);
  return files.sort();
}

function completedLegacyGroupIds(value: unknown): string[] {
  if (!record(value)) archiveError("Archived legacy state must be an object");
  if (value["schemaVersion"] !== undefined && value["schemaVersion"] !== 1) {
    archiveError("Archived legacy state has an unsupported schemaVersion");
  }
  const totalGroups = value["totalGroups"] === undefined
    ? undefined
    : finiteInteger(value["totalGroups"], 1) ? value["totalGroups"] : archiveError(
        "Archived legacy totalGroups must be a positive integer",
      );
  const completed = new Set<number>();
  if (value["completedGroups"] !== undefined) {
    if (!Array.isArray(value["completedGroups"])) {
      archiveError("Archived legacy completedGroups must be an array");
    }
    for (const group of value["completedGroups"]) {
      if (!finiteInteger(group, 1) || (totalGroups !== undefined && group > totalGroups)) {
        archiveError("Archived legacy completedGroups contains an invalid group id");
      }
      completed.add(group);
    }
  }
  if (value["groupStatuses"] !== undefined) {
    if (!record(value["groupStatuses"])) {
      archiveError("Archived legacy groupStatuses must be an object");
    }
    for (const [id, status] of Object.entries(value["groupStatuses"])) {
      if (status !== "completed") continue;
      const group = Number(id);
      if (!finiteInteger(group, 1) || String(group) !== id ||
        (totalGroups !== undefined && group > totalGroups)) {
        archiveError("Archived legacy groupStatuses contains an invalid completed group id");
      }
      completed.add(group);
    }
  }
  return [...completed].sort((a, b) => a - b).map(String);
}

const defaultPolicy: LoopPolicyV2 = {
  requireCleanReview: true,
  requireCliPass: true,
  requireCleanWorktreeForCommit: true,
  requirePush: false,
};

function hashBytes(value: string | Uint8Array): ArtifactHashV2 {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function rawHash(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInteger(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function isoOr(value: unknown, fallback: string): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function safeRelative(root: string, path: string): string {
  const result = relative(root, path);
  if (
    result === "" ||
    result === ".." ||
    result.startsWith(`..${sep}`) ||
    isAbsolute(result)
  ) {
    throw new LegacyMigrationV2Error(
      "LEGACY_INCOMPATIBLE",
      `Legacy path escapes project root: ${path}`,
    );
  }
  const segments = result.split(sep);
  if (segments.some((segment) => segment.includes("\\"))) {
    throw new LegacyMigrationV2Error(
      "LEGACY_INCOMPATIBLE",
      `Legacy path cannot be represented portably: ${path}`,
    );
  }
  return segments.join("/");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function assertNoSymlink(root: string, path: string): Promise<void> {
  const rel = safeRelative(root, path);
  let cursor = root;
  for (const part of rel.split("/")) {
    cursor = resolve(cursor, part);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) {
        throw new LegacyMigrationV2Error(
          "LEGACY_INCOMPATIBLE",
          `Legacy state may not traverse a symbolic link: ${cursor}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

async function discoverLegacy(
  projectRoot: string,
  changeName: string,
): Promise<LegacyDiscovery> {
  const result: LegacyDiscovery = { runs: [], corrupt: [], future: [] };
  for (const platform of ["claude", "opencode"] as const) {
    const path = resolve(projectRoot, `.${platform}`, "corgi-loop", changeName, "state.json");
    if (!(await exists(path))) continue;
    await assertNoSymlink(projectRoot, path);
    let bytes: Buffer;
    let value: unknown;
    try {
      bytes = await readFile(path);
      value = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch {
      result.corrupt.push(path);
      continue;
    }
    if (!record(value)) {
      result.corrupt.push(path);
      continue;
    }
    if (value["schemaVersion"] !== undefined && value["schemaVersion"] !== 1) {
      result.future.push(path);
      continue;
    }
    if (value["changeName"] !== changeName || typeof value["active"] !== "boolean") {
      result.corrupt.push(path);
      continue;
    }
    result.runs.push({ path, platform, bytes, value });
  }
  return result;
}

function completedOrdinals(legacy: Record<string, unknown>, total: number): Set<number> {
  const result = new Set<number>();
  if (Array.isArray(legacy["completedGroups"])) {
    for (const value of legacy["completedGroups"]) {
      if (finiteInteger(value, 1) && value <= total) result.add(value);
    }
  }
  if (record(legacy["groupStatuses"])) {
    for (const [key, value] of Object.entries(legacy["groupStatuses"])) {
      const ordinal = Number(key);
      if (value === "completed" && finiteInteger(ordinal, 1) && ordinal <= total) {
        result.add(ordinal);
      }
    }
  }
  return result;
}

function pushedLegacyGroup(legacy: Record<string, unknown>, ordinal: number): boolean {
  if (!record(legacy["pushStatus"])) return false;
  return ["pushed", "completed", "success"].includes(
    String((legacy["pushStatus"] as Record<string, unknown>)[String(ordinal)]),
  );
}

function normalizeTaskGroups(
  options: MigrateLegacyLoopV2Options,
  legacy: Record<string, unknown>,
): LegacyTaskGroupV2[] {
  const legacyTotal = finiteInteger(legacy["totalGroups"], 1)
    ? legacy["totalGroups"]
    : undefined;
  const groups = options.taskGroups
    ? [...options.taskGroups]
    : Array.from({ length: legacyTotal ?? 0 }, (_, index) => ({
        id: `TG-${index + 1}`,
        ordinal: index + 1,
      }));
  if (groups.length === 0) {
    throw new LegacyMigrationV2Error(
      "LEGACY_INCOMPATIBLE",
      "Legacy migration requires at least one task group",
    );
  }
  groups.sort((a, b) => a.ordinal - b.ordinal);
  if (
    groups.some((group, index) => !group.id || group.ordinal !== index + 1) ||
    new Set(groups.map((group) => group.id)).size !== groups.length
  ) {
    throw new LegacyMigrationV2Error(
      "LEGACY_INCOMPATIBLE",
      "Task group ids and contiguous ordinals must be unique",
    );
  }
  if (legacyTotal !== undefined && legacyTotal !== groups.length) {
    throw new LegacyMigrationV2Error(
      "LEGACY_INCOMPATIBLE",
      `Legacy totalGroups (${legacyTotal}) differs from planning groups (${groups.length})`,
    );
  }
  return groups;
}

function pendingBundle(): LoopGroupStateV2["bundle"] {
  return {
    status: "none",
    bundleId: null,
    bundleHash: null,
    artifactHash: null,
    evidenceHash: null,
    reviewHash: null,
    observedGitRevision: null,
    workspaceFingerprint: null,
  };
}

function buildMigratedState(
  options: MigrateLegacyLoopV2Options,
  legacy: LegacyStateRecord,
  runId: string,
  migratedAt: string,
): LoopStateV2 {
  const taskGroups = normalizeTaskGroups(options, legacy.value);
  const completed = completedOrdinals(legacy.value, taskGroups.length);
  const policy: LoopPolicyV2 = { ...defaultPolicy, ...options.policy };
  policy.requireCleanReview = true;
  policy.requireCliPass = true;
  if (policy.requirePush) {
    for (const ordinal of completed) {
      if (!pushedLegacyGroup(legacy.value, ordinal)) {
        throw new LegacyMigrationV2Error(
          "LEGACY_INCOMPATIBLE",
          `Completed legacy group ${ordinal} has no pushed revision required by policy`,
        );
      }
    }
  }

  const oldCurrent = finiteInteger(legacy.value["currentGroup"], 1)
    ? Math.min(legacy.value["currentGroup"], taskGroups.length)
    : 1;
  const firstIncomplete = [
    ...taskGroups.filter((group) => group.ordinal >= oldCurrent),
    ...taskGroups.filter((group) => group.ordinal < oldCurrent),
  ].find((group) => !completed.has(group.ordinal));
  const oldRetry = finiteInteger(legacy.value["retryCount"], 0)
    ? legacy.value["retryCount"]
    : 0;
  const currentAttempt = firstIncomplete ? Math.max(1, oldRetry + 1) : 0;
  const legacyActive = legacy.value["active"] === true;
  const baselineTree = options.baselineGitTree ?? options.baselineGitRevision;
  const groups: Record<string, LoopGroupStateV2> = {};

  for (const taskGroup of taskGroups) {
    const isCompleted = completed.has(taskGroup.ordinal);
    const isCurrent = firstIncomplete?.id === taskGroup.id;
    const migrationHash = hashBytes(
      `${legacy.platform}:${legacy.path}:${taskGroup.id}:${taskGroup.ordinal}`,
    );
    const fingerprint = taskGroup.taskGroupFingerprint ?? hashBytes(
      `${options.changeName}:${taskGroup.id}:${taskGroup.ordinal}`,
    );
    groups[taskGroup.id] = {
      id: taskGroup.id,
      ordinal: taskGroup.ordinal,
      status: isCompleted
        ? "completed"
        : isCurrent
          ? legacyActive ? "in_progress" : "invalidated"
          : "pending",
      taskGroupFingerprint: fingerprint,
      attempt: isCompleted ? 1 : isCurrent ? currentAttempt : 0,
      bundle: isCompleted
        ? {
            status: "approved",
            bundleId: `legacy-v1-${taskGroup.ordinal}`,
            bundleHash: migrationHash,
            artifactHash: migrationHash,
            evidenceHash: migrationHash,
            reviewHash: migrationHash,
            observedGitRevision: options.baselineGitRevision,
            workspaceFingerprint: options.workspaceFingerprint,
          }
        : pendingBundle(),
      push: policy.requirePush && isCompleted
        ? { status: "pushed", remoteRevision: options.baselineGitRevision }
        : { status: "not_required", remoteRevision: null },
      commit: isCompleted
        ? {
            status: "acknowledged",
            revision: options.baselineGitRevision,
            tree: baselineTree,
            workspaceFingerprint: options.workspaceFingerprint,
          }
        : {
            status: "pending",
            revision: null,
            tree: null,
            workspaceFingerprint: null,
          },
      completedAt: isCompleted ? migratedAt : null,
    };
  }

  const legacyMaxRetries = finiteInteger(legacy.value["maxRetries"], 0)
    ? legacy.value["maxRetries"] + 1
    : 1;
  const limits: LoopLimitsV2 = {
    maxGroups: Math.max(options.limits?.maxGroups ?? taskGroups.length, taskGroups.length),
    maxAttemptsPerGroup: Math.max(
      options.limits?.maxAttemptsPerGroup ?? legacyMaxRetries,
      currentAttempt,
      1,
    ),
    maxEvents: options.limits?.maxEvents ?? 10_000,
  };
  const sessionId = options.sessionId ?? (
    typeof legacy.value["sessionId"] === "string" && legacy.value["sessionId"].trim()
      ? legacy.value["sessionId"]
      : `session-${runId}`
  );
  const mode = options.mode ?? (
    legacy.value["selfDriven"] === true ? "self-driven" : "hook-driven"
  );
  const state: LoopStateV2 = {
    schemaVersion: 2,
    changeName: options.changeName,
    runId,
    supersedesRunId: null,
    owner: options.owner ?? { id: `legacy-${legacy.platform}`, kind: "automation" },
    sessionId,
    mode,
    stateRevision: 0,
    nonce: `nonce-${runId}`,
    lastEventSeq: 0,
    phase: legacyActive
      ? firstIncomplete ? "awaiting_group_result" : "awaiting_finalize"
      : "invalidated",
    currentGroupId: firstIncomplete?.id ?? null,
    currentAttempt,
    policy,
    limits,
    blockedReason: legacyActive
      ? null
      : {
          code: "manual",
          message: "Migrated inactive v1 run",
          details: { sourcePlatform: legacy.platform },
        },
    planningRevision: options.planningRevision,
    git: {
      baselineRevision: options.baselineGitRevision,
      finalRevision: null,
      workspaceFingerprint: options.workspaceFingerprint,
    },
    groups,
    startedAt: isoOr(legacy.value["startedAt"], migratedAt),
    updatedAt: migratedAt,
    completedAt: legacyActive ? null : migratedAt,
  };
  assertLoopStateV2(state);
  return state;
}

async function sourceFingerprint(projectRoot: string, path: string) {
  const [bytes, metadata] = await Promise.all([readFile(path), stat(path)]);
  return {
    path: safeRelative(projectRoot, path),
    sha256: rawHash(bytes),
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
  };
}

async function buildArchive(
  options: MigrateLegacyLoopV2Options,
  legacy: LegacyStateRecord,
  state: LoopStateV2,
): Promise<LegacyArchive> {
  const projectRoot = resolve(options.projectRoot);
  const legacyRoot = resolve(legacy.path, "..");
  const ordinal = state.currentGroupId
    ? state.groups[state.currentGroupId]!.ordinal
    : finiteInteger(legacy.value["currentGroup"], 1)
      ? legacy.value["currentGroup"]
      : 1;
  const artifactCandidates = [
    resolve(legacyRoot, "groups", String(ordinal), "verify.json"),
    resolve(legacyRoot, "groups", String(ordinal), "review.json"),
  ];
  const files: Record<string, Uint8Array | object> = {
    [`${legacy.platform}/state.json`]: legacy.bytes,
  };
  const sources = [await sourceFingerprint(projectRoot, legacy.path)];
  const absentSources: string[] = [];
  const staleArtifacts: string[] = [];
  for (const source of artifactCandidates) {
    await assertNoSymlink(projectRoot, source);
    const destination = `${legacy.platform}/current-group/${source.endsWith("verify.json") ? "verify.json" : "review.json"}`;
    if (await exists(source)) {
      const bytes = await readFile(source);
      files[destination] = bytes;
      sources.push(await sourceFingerprint(projectRoot, source));
      staleArtifacts.push(`legacy/${destination}`);
    } else {
      absentSources.push(safeRelative(projectRoot, source));
    }
  }
  files[`${legacy.platform}/stale-artifacts.json`] = {
    schemaVersion: 2,
    reason: "v1 evidence is stale after migration and must be rerun",
    artifacts: staleArtifacts,
  };
  return {
    files,
    marker: {
      schemaVersion: 2,
      changeName: options.changeName,
      runId: state.runId,
      sourcePlatform: legacy.platform,
      migratedAt: state.updatedAt,
      sources,
      absentSources,
      staleArtifacts,
    },
  };
}

/**
 * Migrate the one unambiguous v1 run when no canonical v2 run exists.
 * Corrupt, future, and ambiguous legacy state always fail closed.
 */
export async function migrateLegacyLoopV2(
  options: MigrateLegacyLoopV2Options,
): Promise<LegacyMigrationResultV2> {
  const projectRoot = resolve(options.projectRoot);
  const store = new LoopStoreV2({
    projectRoot,
    fs: options.fs,
    now: options.now,
  });
  // A marker-rename crash deliberately leaves legacy/ durable first. This
  // read-only probe may observe that one recoverable installer state, while
  // every ordinary inspect/mutation remains fail-closed until install resumes.
  const canonical = await store.peek(options.changeName, {
    allowIncompleteLegacyMigration: true,
  });
  const discovery = await discoverLegacy(projectRoot, options.changeName);
  if (discovery.corrupt.length > 0) {
    throw new LegacyMigrationV2Error(
      "LEGACY_CORRUPT",
      `Corrupt legacy loop state: ${discovery.corrupt.join(", ")}`,
    );
  }
  if (discovery.future.length > 0) {
    throw new LegacyMigrationV2Error(
      "LEGACY_FUTURE_SCHEMA",
      `Unsupported future legacy schema: ${discovery.future.join(", ")}`,
    );
  }
  const active = discovery.runs.filter((run) => run.value["active"] === true);
  if (active.length > 1) {
    throw new LegacyMigrationV2Error(
      "LEGACY_MULTIPLE_ACTIVE",
      `Multiple active v1 runs found: ${active.map((run) => run.path).join(", ")}`,
    );
  }
  if (discovery.runs.length > 1) {
    throw new LegacyMigrationV2Error(
      "LEGACY_AMBIGUOUS",
      `Multiple v1 run files found: ${discovery.runs.map((run) => run.path).join(", ")}`,
    );
  }
  if (discovery.runs.length === 0) {
    if (canonical.state) {
      return {
        status: "already-canonical",
        state: canonical.state,
        sourcePath: null,
        staleArtifacts: [],
      };
    }
    return { status: "none", state: null, sourcePath: null, staleArtifacts: [] };
  }

  const legacy = discovery.runs[0]!;
  const deterministicSuffix = rawHash(legacy.bytes).slice(0, 24);
  const runId = options.runId ?? `migrated-${deterministicSuffix}`;
  if (canonical.state) {
    if (canonical.state.runId !== runId) {
      if (canonical.state.runId.startsWith("migrated-")) {
        throw new LegacyMigrationV2Error(
          "LEGACY_INCOMPATIBLE",
          "Legacy source changed while migration was incomplete",
        );
      }
      return {
        status: "already-canonical",
        state: canonical.state,
        sourcePath: null,
        staleArtifacts: [],
      };
    }
    const paths = store.paths(options.changeName, runId);
    if (await exists(paths.migrationMarker!)) {
      return {
        status: "already-canonical",
        state: canonical.state,
        sourcePath: legacy.path,
        staleArtifacts: [],
      };
    }
    const archive = await buildArchive(options, legacy, canonical.state);
    await store.installLegacyMigration({
      changeName: canonical.state.changeName,
      runId: canonical.state.runId,
      sessionId: canonical.state.sessionId,
      expectedStateRevision: canonical.state.stateRevision,
      expectedNonce: canonical.state.nonce,
      archiveFiles: archive.files,
      marker: archive.marker,
    });
    return {
      status: "migrated",
      state: canonical.state,
      sourcePath: legacy.path,
      staleArtifacts: archive.marker.staleArtifacts,
    };
  }

  const migratedAt = isoOr(
    legacy.value["updatedAt"],
    (options.now ?? (() => new Date()))().toISOString(),
  );
  const state = buildMigratedState(options, legacy, runId, migratedAt);
  const actor: LoopEventActorV2 = {
    id: options.owner?.id ?? `legacy-${legacy.platform}`,
    kind: options.owner?.kind ?? "automation",
  };
  const event: RunInitializedEventV2 = {
    schemaVersion: 2,
    type: "run_initialized",
    runId,
    seq: 0,
    expectedStateRevision: -1,
    expectedNonce: null,
    nextNonce: state.nonce,
    occurredAt: state.updatedAt,
    actor,
    initialState: state,
  };
  const archive = await buildArchive(options, legacy, state);
  await store.initialize({ state, event });
  await store.installLegacyMigration({
    changeName: state.changeName,
    runId: state.runId,
    sessionId: state.sessionId,
    expectedStateRevision: state.stateRevision,
    expectedNonce: state.nonce,
    archiveFiles: archive.files,
    marker: archive.marker,
  });
  return {
    status: "migrated",
    state,
    sourcePath: legacy.path,
    staleArtifacts: archive.marker.staleArtifacts,
  };
}

export interface VerifyLegacyMigrationArchiveV2Options {
  projectRoot: string;
  changeName: string;
  runId: string;
}

/**
 * Read-only trust gate for evidence imported from a v1 migration archive.
 * It never repairs, locks, or writes any path.
 */
export async function verifyLegacyMigrationArchiveV2(
  options: VerifyLegacyMigrationArchiveV2Options,
): Promise<VerifiedLegacyMigrationArchiveV2> {
  try {
    const projectRoot = resolve(options.projectRoot);
    const paths = loopRunPathsV2(projectRoot, options.changeName, options.runId);
    const runRoot = paths.runRoot!;
    const markerPath = paths.migrationMarker!;
    await regularFileWithoutSymlink(projectRoot, markerPath, "migration marker");

    let markerValue: unknown;
    try {
      markerValue = JSON.parse((await readFile(markerPath)).toString("utf8")) as unknown;
    } catch (error) {
      archiveError(`Migration marker is malformed: ${markerPath}`, error);
    }
    if (!record(markerValue)) archiveError("Migration marker must be an object");
    if (
      markerValue["schemaVersion"] !== 2 ||
      markerValue["changeName"] !== options.changeName ||
      markerValue["runId"] !== options.runId ||
      !["claude", "opencode"].includes(String(markerValue["sourcePlatform"])) ||
      typeof markerValue["migratedAt"] !== "string" ||
      !Number.isFinite(Date.parse(markerValue["migratedAt"] as string))
    ) {
      archiveError("Migration marker identity or schema is invalid");
    }
    if (!Array.isArray(markerValue["sources"]) || markerValue["sources"].length === 0) {
      archiveError("Migration marker sources must be a non-empty array");
    }
    if (!Array.isArray(markerValue["absentSources"]) ||
      !Array.isArray(markerValue["staleArtifacts"])) {
      archiveError("Migration marker absentSources/staleArtifacts must be arrays");
    }

    const sourcePlatform = markerValue["sourcePlatform"] as "claude" | "opencode";
    const sources = markerValue["sources"].map(validateMarkerSource);
    const absentSources = markerValue["absentSources"].map((value, index) =>
      portableRelativeMarkerPath(value, `marker.absentSources[${index}]`));
    const staleArtifacts = markerValue["staleArtifacts"].map((value, index) =>
      portableRelativeMarkerPath(value, `marker.staleArtifacts[${index}]`));
    for (const [label, values] of [
      ["sources", sources.map((source) => source.path)],
      ["absentSources", absentSources],
      ["staleArtifacts", staleArtifacts],
    ] as const) {
      const folded = values.map((value) => value.toLowerCase());
      if (new Set(folded).size !== folded.length) {
        archiveError(`Migration marker ${label} contains duplicate paths`);
      }
    }
    const sourceSet = new Set(sources.map((source) => source.path.toLowerCase()));
    if (absentSources.some((path) => sourceSet.has(path.toLowerCase()))) {
      archiveError("Migration marker lists a source as both present and absent");
    }

    const legacySourceRoot = resolve(
      projectRoot,
      `.${sourcePlatform}`,
      "corgi-loop",
      options.changeName,
    );
    const expectedStateSource = resolve(legacySourceRoot, "state.json");
    const stateSources = sources.filter(
      (source) => resolve(projectRoot, source.path) === expectedStateSource,
    );
    if (stateSources.length !== 1) {
      archiveError("Migration marker must contain exactly one platform state source");
    }
    const artifactSources = new Map<"verify.json" | "review.json", LegacyMigrationSourceV2>();
    for (const source of sources) {
      const sourcePath = resolve(projectRoot, source.path);
      safeRelative(projectRoot, sourcePath);
      if (source === stateSources[0]) continue;
      safeRelative(legacySourceRoot, sourcePath);
      const name = basename(sourcePath);
      if (name !== "verify.json" && name !== "review.json") {
        archiveError(`Unexpected legacy source in migration marker: ${source.path}`);
      }
      if (artifactSources.has(name)) {
        archiveError(`Duplicate legacy ${name} source in migration marker`);
      }
      artifactSources.set(name, source);
    }

    const absentByName = new Map<"verify.json" | "review.json", string>();
    for (const absent of absentSources) {
      const sourcePath = resolve(projectRoot, absent);
      safeRelative(projectRoot, sourcePath);
      safeRelative(legacySourceRoot, sourcePath);
      const name = basename(sourcePath);
      if (name !== "verify.json" && name !== "review.json") {
        archiveError(`Unexpected absent legacy source: ${absent}`);
      }
      if (absentByName.has(name)) archiveError(`Duplicate absent ${name} source`);
      absentByName.set(name, absent);
      await assertNoSymlink(projectRoot, sourcePath);
      if (await exists(sourcePath)) archiveError(`Absent legacy source now exists: ${sourcePath}`);
    }
    for (const name of ["verify.json", "review.json"] as const) {
      const count = Number(artifactSources.has(name)) + Number(absentByName.has(name));
      if (count !== 1) {
        archiveError(`Migration marker must classify exactly one ${name} source`);
      }
    }

    const expectedStale = [...artifactSources.keys()]
      .map((name) => `legacy/${sourcePlatform}/current-group/${name}`)
      .sort();
    if (JSON.stringify([...staleArtifacts].sort()) !== JSON.stringify(expectedStale)) {
      archiveError("Migration marker staleArtifacts do not match archived source artifacts");
    }

    const archiveRoot = resolve(runRoot, "legacy");
    safeRelative(runRoot, archiveRoot);
    const expectedArchiveFiles = [
      `${sourcePlatform}/state.json`,
      `${sourcePlatform}/stale-artifacts.json`,
      ...expectedStale.map((path) => path.slice("legacy/".length)),
    ].sort();
    const archiveFiles = await listArchiveFilesNoSymlinks(projectRoot, archiveRoot);
    if (JSON.stringify(archiveFiles) !== JSON.stringify(expectedArchiveFiles)) {
      archiveError("Legacy archive contains missing or unexpected files");
    }

    const originalStateBytes = await verifySourceFingerprint(projectRoot, stateSources[0]!);
    const archivedStatePath = resolve(archiveRoot, sourcePlatform, "state.json");
    const archivedStateBytes = await verifyArchivedCopy(
      projectRoot,
      archivedStatePath,
      stateSources[0]!,
      originalStateBytes,
    );
    for (const [name, source] of artifactSources) {
      const sourceBytes = await verifySourceFingerprint(projectRoot, source);
      await verifyArchivedCopy(
        projectRoot,
        resolve(archiveRoot, sourcePlatform, "current-group", name),
        source,
        sourceBytes,
      );
    }

    const staleManifestPath = resolve(archiveRoot, sourcePlatform, "stale-artifacts.json");
    await regularFileWithoutSymlink(projectRoot, staleManifestPath, "stale artifact manifest");
    let staleManifest: unknown;
    try {
      staleManifest = JSON.parse((await readFile(staleManifestPath)).toString("utf8")) as unknown;
    } catch (error) {
      archiveError("Stale artifact manifest is malformed", error);
    }
    if (
      !record(staleManifest) ||
      Object.keys(staleManifest).sort().join(",") !== "artifacts,reason,schemaVersion" ||
      staleManifest["schemaVersion"] !== 2 ||
      staleManifest["reason"] !== "v1 evidence is stale after migration and must be rerun" ||
      !Array.isArray(staleManifest["artifacts"]) ||
      JSON.stringify(staleManifest["artifacts"]) !== JSON.stringify(staleArtifacts)
    ) {
      archiveError("Stale artifact manifest does not match the migration marker");
    }

    const archivedState = JSON.parse(archivedStateBytes.toString("utf8")) as unknown;
    if (
      !record(archivedState) ||
      archivedState["changeName"] !== options.changeName ||
      typeof archivedState["active"] !== "boolean"
    ) {
      archiveError("Archived legacy state identity is invalid");
    }
    const marker: LegacyMigrationMarkerV2 = {
      schemaVersion: 2,
      changeName: options.changeName,
      runId: options.runId,
      sourcePlatform,
      migratedAt: markerValue["migratedAt"] as string,
      sources,
      absentSources,
      staleArtifacts,
    };
    return {
      marker,
      trustedLegacyGroupIds: completedLegacyGroupIds(archivedState),
    };
  } catch (error) {
    if (error instanceof LegacyMigrationArchiveV2Error) throw error;
    throw new LegacyMigrationArchiveV2Error(
      `Legacy migration archive verification failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
