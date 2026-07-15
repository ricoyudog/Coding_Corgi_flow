import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, type Stats } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";

const SAFE_CHANGE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const WINDOWS_RESERVED_SEGMENT = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_MS = 25;
const DEFAULT_STALE_MS = 30_000;

interface ConvergenceLockRecordV2 {
  schemaVersion: 2;
  token: string;
  pid: number;
  hostname: string;
  acquiredAt: string;
}

interface OwnedConvergenceLockV2 {
  path: string;
  token: string;
  identity: FileIdentity;
  handle: FileHandle;
}

interface FileIdentity {
  dev: number;
  ino: number;
}

export interface ConvergenceLockV2Options {
  projectRoot: string;
  changeName: string;
  /** Maximum wall-clock time spent waiting for another owner. */
  timeoutMs?: number;
  /** Delay between O_EXCL acquisition attempts. */
  pollMs?: number;
  /** Lease age after which an unknown or foreign owner may be reclaimed. */
  staleMs?: number;
  /** Clock used for persisted lease timestamps and stale-age decisions. */
  now?: () => Date;
}

export interface ConvergenceTargetLockV2Options {
  /** Authoritative OpenSpec change root whose planning bytes may be mutated. */
  targetRoot: string;
  timeoutMs?: number;
  pollMs?: number;
  staleMs?: number;
  now?: () => Date;
}

export class ConvergenceLockV2Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConvergenceLockPathError extends ConvergenceLockV2Error {
  constructor(message: string) {
    super("CONVERGENCE_LOCK_PATH_UNSAFE", message);
  }
}

export class ConvergenceLockTimeoutError extends ConvergenceLockV2Error {
  constructor(changeName: string) {
    super(
      "CONVERGENCE_LOCK_TIMEOUT",
      `Timed out waiting for the convergence lock for change '${changeName}'`,
    );
  }
}

/**
 * Run one convergence mutation while holding a project-local, per-change lock.
 *
 * The lock is deliberately separate from LoopStoreV2's short transaction lock:
 * convergence spans planning and loop-store writes and therefore needs a wider
 * critical section. The callback receives no lock token, so persisted content
 * can never influence a release or quarantine pathname.
 */
export async function withConvergenceLockV2<T>(
  options: ConvergenceLockV2Options,
  callback: () => T | Promise<T>,
): Promise<T> {
  const timeoutMs = finiteNonNegative(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
  const pollMs = finiteNonNegative(options.pollMs ?? DEFAULT_POLL_MS, "pollMs");
  const staleMs = finiteNonNegative(options.staleMs ?? DEFAULT_STALE_MS, "staleMs");
  const now = options.now ?? (() => new Date());
  const lockPath = await prepareLockPath(options.projectRoot, options.changeName);
  const deadline = Date.now() + timeoutMs;
  let owned: OwnedConvergenceLockV2 | undefined;

  while (owned === undefined) {
    try {
      owned = await acquire(lockPath, now);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (await reclaimIfStale(lockPath, staleMs, now)) continue;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ConvergenceLockTimeoutError(options.changeName);
      await delay(Math.min(Math.max(1, pollMs), remaining));
    }
  }

  try {
    return await callback();
  } finally {
    await owned.handle.close().catch(() => undefined);
    await releaseOwnedLock(owned);
  }
}

/**
 * Serialize convergence mutations by canonical OpenSpec target across projects.
 * The lock lives in a per-user temporary namespace so external Store contents
 * are never polluted by Corgi lock files.
 */
export async function withConvergenceTargetLockV2<T>(
  options: ConvergenceTargetLockV2Options,
  callback: () => T | Promise<T>,
): Promise<T> {
  const { targetRoot, ...timing } = options;
  const projectRoot = await prepareTargetLockNamespace();
  const changeName = await convergenceTargetIdentityV2(targetRoot);
  return await withConvergenceLockV2({ projectRoot, changeName, ...timing }, callback);
}

/** Stable identity shared by symlink aliases of the same authoritative root. */
export async function convergenceTargetIdentityV2(targetRoot: string): Promise<string> {
  if (typeof targetRoot !== "string" || targetRoot.length === 0 || targetRoot.includes("\0")) {
    throw new ConvergenceLockPathError("targetRoot must be a non-empty filesystem path");
  }
  const lexicalRoot = resolve(targetRoot);
  const canonicalRoot = await realpath(lexicalRoot).catch(() => {
    throw new ConvergenceLockPathError(
      `Authoritative convergence target is unavailable: ${lexicalRoot}`,
    );
  });
  const stats = await safeLstat(canonicalRoot, "authoritative convergence target");
  if (!stats.isDirectory()) {
    throw new ConvergenceLockPathError(`Authoritative convergence target is not a directory: ${canonicalRoot}`);
  }
  const digest = createHash("sha256").update(canonicalRoot, "utf8").digest("hex");
  return `target-${digest}`;
}

async function prepareTargetLockNamespace(): Promise<string> {
  const getuid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  const uid = getuid?.call(process);
  const suffix = uid === undefined ? "user" : String(uid);
  const lexicalRoot = resolve(tmpdir(), `corgispec-convergence-target-locks-${suffix}`);
  try {
    await mkdir(lexicalRoot, { mode: 0o700 });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
  const stats = await safeLstat(lexicalRoot, "convergence target lock namespace");
  if (stats.isSymbolicLink() || !stats.isDirectory() || (uid !== undefined && stats.uid !== uid)) {
    throw new ConvergenceLockPathError(`Unsafe convergence target lock namespace: ${lexicalRoot}`);
  }
  return await realpath(lexicalRoot);
}

async function acquire(
  path: string,
  now: () => Date,
): Promise<OwnedConvergenceLockV2> {
  const token = randomUUID();
  const acquiredAt = checkedNow(now);
  const handle = await open(
    path,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    0o600,
  );
  const identity = identityOf(await handle.stat());
  try {
    const record: ConvergenceLockRecordV2 = {
      schemaVersion: 2,
      token,
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: acquiredAt.toISOString(),
    };
    await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
    // The callback must never observe an acquired lock whose owner record has
    // not reached the filesystem.
    await handle.sync();
    return { path, token, identity, handle };
  } catch (error) {
    await handle.close().catch(() => undefined);
    await removeFailedAcquisition(path, token, identity);
    throw error;
  }
}

async function prepareLockPath(projectRoot: string, changeName: string): Promise<string> {
  validateChangeName(changeName);
  if (typeof projectRoot !== "string" || projectRoot.length === 0 || projectRoot.includes("\0")) {
    throw new ConvergenceLockPathError("projectRoot must be a non-empty filesystem path");
  }

  const root = resolve(projectRoot);
  const rootStats = await safeLstat(root, "project root");
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new ConvergenceLockPathError(`Project root is not a safe directory: ${root}`);
  }
  const realRoot = await realpath(root);
  let lexicalParent = root;
  let expectedRealParent = realRoot;
  for (const segment of [".corgi", "loop", changeName]) {
    lexicalParent = resolve(lexicalParent, segment);
    expectedRealParent = resolve(expectedRealParent, segment);
    assertContained(root, lexicalParent);
    try {
      await mkdir(lexicalParent, { mode: 0o700 });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const stats = await safeLstat(lexicalParent, "convergence lock directory");
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new ConvergenceLockPathError(`Unsafe convergence lock directory: ${lexicalParent}`);
    }
    const actualRealParent = await realpath(lexicalParent);
    if (actualRealParent !== expectedRealParent) {
      throw new ConvergenceLockPathError(
        `Convergence lock directory resolves through a symlink: ${lexicalParent}`,
      );
    }
  }

  const path = resolve(lexicalParent, ".converge.lock");
  assertContained(lexicalParent, path);
  return path;
}

function validateChangeName(value: string): void {
  if (
    typeof value !== "string" ||
    !SAFE_CHANGE_SEGMENT.test(value) ||
    value === "." ||
    value === ".." ||
    value.endsWith(".") ||
    value.endsWith(" ") ||
    WINDOWS_RESERVED_SEGMENT.test(value) ||
    isAbsolute(value) ||
    value.includes("/") ||
    value.includes("\\")
  ) {
    throw new ConvergenceLockPathError(`Unsafe change name: '${value}'`);
  }
}

async function reclaimIfStale(
  path: string,
  staleMs: number,
  now: () => Date,
): Promise<boolean> {
  let stats: Stats;
  let bytes: Buffer;
  try {
    stats = await lstat(path);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new ConvergenceLockPathError(`Unsafe convergence lock entry: ${path}`);
    }
    bytes = await readFile(path);
  } catch (error) {
    if (isMissing(error)) return true;
    throw error;
  }

  const record = parseRecord(bytes);
  const nowMs = checkedNow(now).getTime();
  const recordedMs = record === undefined ? Number.NaN : Date.parse(record.acquiredAt);
  // Requiring both the record and the inode mtime to be old prevents an
  // attacker from forcing immediate reclamation with a forged ancient date.
  const leaseMs = Number.isFinite(recordedMs)
    ? Math.max(recordedMs, stats.mtimeMs)
    : stats.mtimeMs;
  const expired = nowMs - leaseMs >= staleMs;
  const ownership = localOwnerStatus(record);
  if (ownership === "live") return false;
  if (ownership !== "dead" && !expired) return false;

  const quarantine = `${path}.stale-${randomUUID()}`;
  try {
    await rename(path, quarantine);
  } catch (error) {
    if (isMissing(error)) return true;
    throw error;
  }

  const quarantinedStats = await lstat(quarantine);
  const quarantinedBytes = await readFile(quarantine);
  if (
    quarantinedStats.isSymbolicLink() ||
    !quarantinedStats.isFile() ||
    !sameIdentity(stats, quarantinedStats) ||
    !bytes.equals(quarantinedBytes)
  ) {
    await restoreClaimedEntry(quarantine, path);
    throw new ConvergenceLockPathError("Convergence lock changed during stale reclamation");
  }
  await unlink(quarantine);
  return true;
}

function localOwnerStatus(
  record: ConvergenceLockRecordV2 | undefined,
): "live" | "dead" | "unknown" {
  if (
    record === undefined ||
    record.hostname !== hostname() ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0
  ) {
    return "unknown";
  }
  if (record.pid === process.pid) return "live";
  try {
    process.kill(record.pid, 0);
    return "live";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    // EPERM proves the process exists; unknown errors must also fail closed.
    return "live";
  }
}

async function releaseOwnedLock(owned: OwnedConvergenceLockV2): Promise<void> {
  let stats: Stats;
  let bytes: Buffer;
  try {
    stats = await lstat(owned.path);
    if (stats.isSymbolicLink() || !stats.isFile()) return;
    bytes = await readFile(owned.path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  const record = parseRecord(bytes);
  if (record?.token !== owned.token || !sameIdentity(owned.identity, stats)) return;

  const quarantine = `${owned.path}.release-${randomUUID()}`;
  try {
    await rename(owned.path, quarantine);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  const quarantinedStats = await lstat(quarantine);
  const quarantinedRecord = parseRecord(await readFile(quarantine));
  if (
    quarantinedStats.isSymbolicLink() ||
    !quarantinedStats.isFile() ||
    quarantinedRecord?.token !== owned.token ||
    !sameIdentity(owned.identity, quarantinedStats)
  ) {
    await restoreClaimedEntry(quarantine, owned.path);
    return;
  }
  await unlink(quarantine);
}

async function removeFailedAcquisition(
  path: string,
  token: string,
  identity: FileIdentity,
): Promise<void> {
  let initialStats: Stats;
  try {
    initialStats = await lstat(path);
    if (
      initialStats.isSymbolicLink() ||
      !initialStats.isFile() ||
      !sameIdentity(identity, initialStats)
    ) return;
    const record = parseRecord(await readFile(path));
    if (record?.token !== token) return;
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }

  // Never unlink the canonical pathname after a separate lstat/read check: it
  // may have been replaced in between. Atomically claim one local pathname,
  // then prove both its inode and token before deleting it.
  const quarantine = `${path}.failed-${randomUUID()}`;
  try {
    await rename(path, quarantine);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  const quarantinedStats = await lstat(quarantine);
  const quarantinedRecord = parseRecord(await readFile(quarantine));
  if (
    quarantinedStats.isSymbolicLink() ||
    !quarantinedStats.isFile() ||
    quarantinedRecord?.token !== token ||
    !sameIdentity(identity, quarantinedStats)
  ) {
    await restoreClaimedEntry(quarantine, path);
    return;
  }
  await unlink(quarantine);
}

async function restoreClaimedEntry(quarantine: string, path: string): Promise<void> {
  try {
    // link() is O_EXCL-like: it never overwrites a new owner's lock. Once the
    // hard link exists, removing the quarantine name preserves the entry.
    await link(quarantine, path);
    await unlink(quarantine);
  } catch (error) {
    if (!isAlreadyExists(error)) {
      // Leave the locally named quarantine in place rather than deleting data
      // whose ownership could not be proven.
    }
  }
}

function parseRecord(bytes: Buffer): ConvergenceLockRecordV2 | undefined {
  try {
    const value = JSON.parse(bytes.toString("utf8")) as Partial<ConvergenceLockRecordV2>;
    if (
      value.schemaVersion !== 2 ||
      typeof value.token !== "string" ||
      value.token.length === 0 ||
      !Number.isSafeInteger(value.pid) ||
      value.pid! <= 0 ||
      typeof value.hostname !== "string" ||
      typeof value.acquiredAt !== "string" ||
      !Number.isFinite(Date.parse(value.acquiredAt))
    ) {
      return undefined;
    }
    return value as ConvergenceLockRecordV2;
  } catch {
    return undefined;
  }
}

async function safeLstat(path: string, label: string): Promise<Stats> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissing(error)) {
      throw new ConvergenceLockPathError(`Missing ${label}: ${path}`);
    }
    throw error;
  }
}

function identityOf(stats: Stats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function sameIdentity(left: FileIdentity | Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertContained(root: string, target: string): void {
  const value = relative(root, target);
  if (value === "" || (!value.startsWith(`..${sep}`) && value !== ".." && !isAbsolute(value))) {
    return;
  }
  throw new ConvergenceLockPathError(`Convergence lock path escapes project root: ${target}`);
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite non-negative number`);
  }
  return value;
}

function checkedNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RangeError("now() must return a valid Date");
  }
  return value;
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return errorCode(error) === "EEXIST";
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((settle) => setTimeout(settle, milliseconds));
}
