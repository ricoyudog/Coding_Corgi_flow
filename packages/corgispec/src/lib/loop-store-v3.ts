import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { ACTIVE_PHASES_V2 } from "./run-contract-v2.js";
import {
  ACTIVE_PHASES_V3,
  assertRunStateV3,
  isArtifactHashV3,
  reduceRunEventV3,
  type ArtifactHashV3,
  type RunEventRecordV3,
  type RunEventV3,
  type RunStateV3,
} from "./run-contract-v3.js";

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const WINDOWS_RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;

export interface RunPathsV3 {
  projectRoot: string;
  loopRoot: string;
  changeRoot: string;
  runsRoot: string;
  current: string;
  lock: string;
  runRoot?: string;
  state?: string;
  events?: string;
  evidence?: string;
  groups?: string;
}

export interface CurrentRunPointerV3 {
  schemaVersion: 3;
  changeName: string;
  runId: string;
  stateRevision: number;
  nonce: string;
  phase: RunStateV3["phase"];
  updatedAt: string;
}

export interface RunInspectionV3 {
  current: CurrentRunPointerV3 | null;
  state: RunStateV3 | null;
  events: RunEventRecordV3[];
  recovered: boolean;
}

export interface RunCasV3 {
  changeName: string;
  runId: string;
  sessionId: string;
  expectedStateRevision: number;
  expectedNonce: string;
}

export interface EvidenceFileV3 {
  path: string;
  content: string | Uint8Array | object;
}

export interface EvidenceManifestV3 {
  schemaVersion: 3;
  changeName: string;
  runId: string;
  finalRevision: string;
  planningRevision: ArtifactHashV3;
  sourceDigest: ArtifactHashV3;
  traceabilityDigest: ArtifactHashV3;
  files: Array<{ path: string; digest: ArtifactHashV3 }>;
}

export interface CapturedEvidenceReferenceV3 {
  reference: string;
  sourcePath: string;
  digest: ArtifactHashV3;
  blobPath: string;
}

export interface ReadEvidenceReferenceV3 extends CapturedEvidenceReferenceV3 {
  content: Uint8Array;
}

export class LoopStoreV3Error extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LoopStoreV3Error";
  }
}

function validateSegment(value: string, label: string): void {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === ".." || value.endsWith(".") || WINDOWS_RESERVED.test(value)) {
    throw new LoopStoreV3Error("LOOP_PATH_UNSAFE", `Unsafe ${label}: '${value}'`);
  }
}

function assertContained(root: string, target: string): void {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return;
  throw new LoopStoreV3Error("LOOP_PATH_UNSAFE", `Path escapes loop root: ${target}`);
}

export function loopRunPathsV3(projectRoot: string, changeName: string, runId?: string): RunPathsV3 {
  validateSegment(changeName, "change name");
  if (runId !== undefined) validateSegment(runId, "run id");
  const root = resolve(projectRoot);
  const loopRoot = resolve(root, ".corgi", "loop");
  const changeRoot = resolve(loopRoot, changeName);
  const runsRoot = resolve(changeRoot, "runs");
  assertContained(root, loopRoot);
  assertContained(loopRoot, changeRoot);
  const base: RunPathsV3 = {
    projectRoot: root,
    loopRoot,
    changeRoot,
    runsRoot,
    current: resolve(changeRoot, "current.json"),
    lock: resolve(changeRoot, ".lock-v3"),
  };
  if (runId === undefined) return base;
  const runRoot = resolve(runsRoot, runId);
  assertContained(runsRoot, runRoot);
  return {
    ...base,
    runRoot,
    state: resolve(runRoot, "state.json"),
    events: resolve(runRoot, "events.jsonl"),
    evidence: resolve(runRoot, "evidence"),
    groups: resolve(runRoot, "groups"),
  };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWrite(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function assertSafeExisting(path: string): void {
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new LoopStoreV3Error("LOOP_PATH_UNSAFE", `Symbolic links are not allowed in Run Contract storage: ${path}`);
  }
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function readJson(path: string): unknown {
  assertSafeExisting(path);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new LoopStoreV3Error(
      "LOOP_CORRUPTION",
      `Malformed JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function eventRecords(path: string): RunEventRecordV3[] {
  assertSafeExisting(path);
  const content = readFileSync(path, "utf8");
  if (!content.trim()) throw new LoopStoreV3Error("LOOP_CORRUPTION", `Empty event log: ${path}`);
  return content.trimEnd().split("\n").map((line, index) => {
    try {
      const value = JSON.parse(line) as RunEventRecordV3;
      if (value.schemaVersion !== 3 || !value.event || !value.postState) throw new Error("invalid record shape");
      return value;
    } catch (error) {
      throw new LoopStoreV3Error(
        "LOOP_CORRUPTION",
        `Malformed event record ${index + 1} in ${path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

function pointer(state: RunStateV3): CurrentRunPointerV3 {
  return {
    schemaVersion: 3,
    changeName: state.changeName,
    runId: state.runId,
    stateRevision: state.stateRevision,
    nonce: state.nonce,
    phase: state.phase,
    updatedAt: state.updatedAt,
  };
}

function isV3Active(state: RunStateV3): boolean {
  return (ACTIVE_PHASES_V3 as readonly string[]).includes(state.phase);
}

function isV2Active(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as { schemaVersion?: unknown; phase?: unknown };
  return state.schemaVersion === 2
    && typeof state.phase === "string"
    && (ACTIVE_PHASES_V2 as readonly string[]).includes(state.phase);
}

function digest(value: string | Uint8Array): ArtifactHashV3 {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function evidenceBytes(value: EvidenceFileV3["content"]): Uint8Array | string {
  if (typeof value === "string" || value instanceof Uint8Array) return value;
  return json(value);
}

export class LoopStoreV3 {
  readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
  }

  paths(changeName: string, runId?: string): RunPathsV3 {
    return loopRunPathsV3(this.projectRoot, changeName, runId);
  }

  initialize(state: RunStateV3, event: RunEventV3): RunStateV3 {
    assertRunStateV3(state);
    const record = reduceRunEventV3(null, event);
    if (!isDeepStrictEqual(record.postState, state)) {
      throw new LoopStoreV3Error("LOOP_INITIALIZATION_MISMATCH", "initial event does not produce the requested state");
    }
    return this.withLock(state.changeName, () => {
      const runs = this.scanRuns(state.changeName, true);
      const v3Runs = runs.filter((candidate): candidate is {
        state: RunStateV3;
        events: RunEventRecordV3[];
      } => candidate.state.schemaVersion === 3);
      const same = v3Runs.find((candidate) => candidate.state.runId === state.runId);
      if (same) {
        if (isDeepStrictEqual(same.state, state) && isDeepStrictEqual(same.events[0], record)) {
          atomicWrite(this.paths(state.changeName).current, json(pointer(state)));
          return same.state;
        }
        throw new LoopStoreV3Error("LOOP_RUN_CONFLICT", `Run '${state.runId}' already exists with different content`);
      }
      const activeV2 = runs.find((candidate) => isV2Active(candidate.state));
      if (activeV2) {
        throw new LoopStoreV3Error(
          "ACTIVE_V2_RUN_UNSUPPORTED",
          `Active Run Contract v2 '${String((activeV2.state as { runId?: unknown }).runId ?? "unknown")}' must finish or be withdrawn before v4`,
        );
      }
      const activeV3 = v3Runs.filter((candidate) => isV3Active(candidate.state));
      if (activeV3.length > 0) {
        throw new LoopStoreV3Error("LOOP_ACTIVE_RUN_EXISTS", `Active run '${activeV3[0]!.state.runId}' already exists`);
      }

      const paths = this.requiredPaths(state.changeName, state.runId);
      mkdirSync(paths.runsRoot, { recursive: true });
      assertSafeExisting(paths.runsRoot);
      const staging = resolve(paths.runsRoot, `.init-${state.runId}-${randomUUID()}`);
      try {
        mkdirSync(staging, { recursive: false });
        writeFileSync(resolve(staging, "events.jsonl"), `${JSON.stringify(record)}\n`, { flag: "wx" });
        writeFileSync(resolve(staging, "state.json"), json(state), { flag: "wx" });
        renameSync(staging, paths.runRoot);
        atomicWrite(paths.current, json(pointer(state)));
        return state;
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
    });
  }

  inspect(changeName: string, runId?: string): RunInspectionV3 {
    return this.withLock(changeName, () => this.inspectUnlocked(changeName, runId));
  }

  transition(cas: RunCasV3, event: RunEventV3): RunStateV3 {
    return this.withLock(cas.changeName, () => {
      const inspection = this.inspectUnlocked(cas.changeName, cas.runId);
      const state = inspection.state;
      if (!state) throw new LoopStoreV3Error("LOOP_RUN_NOT_FOUND", `Run '${cas.runId}' was not found`);
      if (state.sessionId !== cas.sessionId) throw new LoopStoreV3Error("LOOP_SESSION_CONFLICT", "sessionId does not match current run");
      const historical = inspection.events.find((record) => record.event.seq === event.seq);
      if (historical) {
        if (isDeepStrictEqual(historical.event, event)) return historical.postState;
        throw new LoopStoreV3Error("LOOP_EVENT_CONFLICT", `Event sequence ${event.seq} already has different content`);
      }
      if (state.stateRevision !== cas.expectedStateRevision || state.nonce !== cas.expectedNonce) {
        throw new LoopStoreV3Error("LOOP_CAS_CONFLICT", "Run Contract token is stale");
      }
      const record = reduceRunEventV3(state, event);
      const paths = this.requiredPaths(cas.changeName, cas.runId);
      appendFileSync(paths.events, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
      atomicWrite(paths.state, json(record.postState));
      atomicWrite(paths.current, json(pointer(record.postState)));
      return record.postState;
    });
  }

  writeGroupEvidence(cas: RunCasV3, groupId: string, evidence: object): {
    path: string;
    evidenceHash: ArtifactHashV3;
    idempotent: boolean;
  } {
    validateSegment(groupId, "group id");
    return this.withLock(cas.changeName, () => {
      const inspection = this.inspectUnlocked(cas.changeName, cas.runId);
      const state = inspection.state;
      if (!state) throw new LoopStoreV3Error("LOOP_RUN_NOT_FOUND", `Run '${cas.runId}' was not found`);
      if (state.sessionId !== cas.sessionId) throw new LoopStoreV3Error("LOOP_SESSION_CONFLICT", "sessionId does not match current run");
      if (state.stateRevision !== cas.expectedStateRevision || state.nonce !== cas.expectedNonce) {
        throw new LoopStoreV3Error("LOOP_CAS_CONFLICT", "Run Contract token is stale");
      }
      if (state.phase !== "applying" || state.currentGroupId !== groupId) {
        throw new LoopStoreV3Error("LOOP_GROUP_NOT_CURRENT", `Task Group '${groupId}' is not current`);
      }
      const paths = this.requiredPaths(cas.changeName, cas.runId);
      const path = resolve(paths.groups, groupId, "evidence.json");
      assertContained(paths.groups, path);
      const content = json(evidence);
      const evidenceHash = digest(content);
      if (existsSync(path)) {
        if (readFileSync(path, "utf8") !== content) {
          throw new LoopStoreV3Error("LOOP_GROUP_EVIDENCE_CONFLICT", `Task Group '${groupId}' evidence already differs`);
        }
        return { path, evidenceHash, idempotent: true };
      }
      atomicWrite(path, content);
      return { path, evidenceHash, idempotent: false };
    });
  }

  readGroupEvidence(changeName: string, runId: string, groupId: string): {
    evidence: Record<string, unknown>;
    evidenceHash: ArtifactHashV3;
    path: string;
  } {
    validateSegment(groupId, "group id");
    const paths = this.requiredPaths(changeName, runId);
    const path = resolve(paths.groups, groupId, "evidence.json");
    assertContained(paths.groups, path);
    if (!existsSync(path)) throw new LoopStoreV3Error("LOOP_GROUP_EVIDENCE_MISSING", `Task Group '${groupId}' evidence is missing`);
    const content = readFileSync(path, "utf8");
    const evidence = readJson(path);
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
      throw new LoopStoreV3Error("LOOP_GROUP_EVIDENCE_INVALID", `Task Group '${groupId}' evidence is invalid`);
    }
    return { evidence: evidence as Record<string, unknown>, evidenceHash: digest(content), path };
  }

  captureEvidenceReferences(
    cas: RunCasV3,
    scope: string,
    inputs: Array<{ sourcePath: string; content: Uint8Array }>,
  ): CapturedEvidenceReferenceV3[] {
    validateSegment(scope, "evidence reference scope");
    return this.withLock(cas.changeName, () => {
      const inspection = this.inspectUnlocked(cas.changeName, cas.runId);
      const state = inspection.state;
      if (!state) throw new LoopStoreV3Error("LOOP_RUN_NOT_FOUND", `Run '${cas.runId}' was not found`);
      if (state.sessionId !== cas.sessionId) throw new LoopStoreV3Error("LOOP_SESSION_CONFLICT", "sessionId does not match current run");
      if (state.stateRevision !== cas.expectedStateRevision || state.nonce !== cas.expectedNonce) {
        throw new LoopStoreV3Error("LOOP_CAS_CONFLICT", "Run Contract token is stale");
      }
      if (!isV3Active(state)) {
        throw new LoopStoreV3Error("LOOP_PHASE_INVALID", "evidence references require an active Run Contract");
      }

      const paths = this.requiredPaths(cas.changeName, cas.runId);
      const referencesRoot = resolve(paths.runRoot, "references");
      const blobsRoot = resolve(referencesRoot, "blobs");
      const scopesRoot = resolve(referencesRoot, "scopes");
      const seen = new Set<string>();
      const captured = inputs.map((input) => {
        const sourcePath = input.sourcePath.replace(/\\/gu, "/").replace(/^\.\//u, "");
        if (
          !sourcePath
          || sourcePath.startsWith("/")
          || sourcePath.split("/").some((part) => !part || part === "." || part === "..")
          || seen.has(sourcePath)
        ) {
          throw new LoopStoreV3Error("LOOP_EVIDENCE_REFERENCE_INVALID", `Invalid or duplicate evidence source '${input.sourcePath}'`);
        }
        seen.add(sourcePath);
        const referenceDigest = digest(input.content);
        const hex = referenceDigest.slice("sha256:".length);
        return {
          reference: `file:${encodeURIComponent(sourcePath)}#${referenceDigest}`,
          sourcePath,
          digest: referenceDigest,
          blobPath: `blobs/${hex}`,
          content: input.content,
        };
      }).sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));

      for (const entry of captured) {
        const blob = resolve(referencesRoot, entry.blobPath);
        assertContained(referencesRoot, blob);
        if (existsSync(blob)) {
          if (digest(readFileSync(blob)) !== entry.digest) {
            throw new LoopStoreV3Error("LOOP_EVIDENCE_REFERENCE_CONFLICT", `Evidence blob '${entry.digest}' is corrupted`);
          }
        } else {
          mkdirSync(blobsRoot, { recursive: true });
          atomicWrite(blob, entry.content);
        }
      }

      const manifest = captured.map(({ content: _content, ...entry }) => entry);
      const scopePath = resolve(scopesRoot, `${scope}.json`);
      assertContained(scopesRoot, scopePath);
      const serialized = json({ schemaVersion: 3, scope, references: manifest });
      if (existsSync(scopePath)) {
        if (readFileSync(scopePath, "utf8") !== serialized) {
          throw new LoopStoreV3Error(
            "LOOP_EVIDENCE_REFERENCE_CONFLICT",
            `Evidence reference scope '${scope}' already differs`,
          );
        }
      } else {
        atomicWrite(scopePath, serialized);
      }
      return manifest;
    });
  }

  readEvidenceReferences(changeName: string, runId: string, scope: string): ReadEvidenceReferenceV3[] {
    validateSegment(scope, "evidence reference scope");
    const paths = this.requiredPaths(changeName, runId);
    const referencesRoot = resolve(paths.runRoot, "references");
    const scopePath = resolve(referencesRoot, "scopes", `${scope}.json`);
    assertContained(referencesRoot, scopePath);
    if (!existsSync(scopePath)) {
      throw new LoopStoreV3Error(
        "LOOP_EVIDENCE_REFERENCE_MISSING",
        `Evidence reference scope '${scope}' is missing`,
      );
    }
    const value = readJson(scopePath) as {
      schemaVersion?: unknown;
      scope?: unknown;
      references?: unknown;
    };
    if (value.schemaVersion !== 3 || value.scope !== scope || !Array.isArray(value.references)) {
      throw new LoopStoreV3Error("LOOP_EVIDENCE_REFERENCE_INVALID", `Evidence reference scope '${scope}' is invalid`);
    }
    return value.references.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new LoopStoreV3Error("LOOP_EVIDENCE_REFERENCE_INVALID", `Evidence reference scope '${scope}' is invalid`);
      }
      const entry = candidate as Partial<CapturedEvidenceReferenceV3>;
      if (
        typeof entry.reference !== "string"
        || typeof entry.sourcePath !== "string"
        || !isArtifactHashV3(entry.digest)
        || typeof entry.blobPath !== "string"
        || entry.reference !== `file:${encodeURIComponent(entry.sourcePath)}#${entry.digest}`
      ) {
        throw new LoopStoreV3Error("LOOP_EVIDENCE_REFERENCE_INVALID", `Evidence reference scope '${scope}' is invalid`);
      }
      const blob = resolve(referencesRoot, entry.blobPath);
      assertContained(referencesRoot, blob);
      if (!existsSync(blob)) {
        throw new LoopStoreV3Error("LOOP_EVIDENCE_REFERENCE_MISSING", `Evidence blob '${entry.digest}' is missing`);
      }
      const content = readFileSync(blob);
      if (digest(content) !== entry.digest) {
        throw new LoopStoreV3Error("LOOP_EVIDENCE_REFERENCE_CONFLICT", `Evidence blob '${entry.digest}' is corrupted`);
      }
      return {
        reference: entry.reference,
        sourcePath: entry.sourcePath,
        digest: entry.digest,
        blobPath: entry.blobPath,
        content,
      };
    });
  }

  materializeEvidence(cas: RunCasV3, files: EvidenceFileV3[]): {
    manifest: EvidenceManifestV3;
    manifestHash: ArtifactHashV3;
    idempotent: boolean;
  } {
    return this.withLock(cas.changeName, () => {
      const inspection = this.inspectUnlocked(cas.changeName, cas.runId);
      const state = inspection.state;
      if (!state) throw new LoopStoreV3Error("LOOP_RUN_NOT_FOUND", `Run '${cas.runId}' was not found`);
      if (state.sessionId !== cas.sessionId) throw new LoopStoreV3Error("LOOP_SESSION_CONFLICT", "sessionId does not match current run");
      if (state.stateRevision !== cas.expectedStateRevision || state.nonce !== cas.expectedNonce) {
        throw new LoopStoreV3Error("LOOP_CAS_CONFLICT", "Run Contract token is stale");
      }
      if (state.phase !== "archiving" || !state.archive || !state.finalRevision) {
        throw new LoopStoreV3Error("LOOP_ARCHIVE_NOT_STARTED", "archive evidence requires an active archive intent");
      }
      const seen = new Set<string>();
      const normalized = files.map((file) => {
        const portable = file.path.replace(/\\/gu, "/").replace(/^\.\//u, "");
        if (!portable || portable.startsWith("/") || portable.split("/").some((part) => !part || part === "." || part === "..")) {
          throw new LoopStoreV3Error("LOOP_PATH_UNSAFE", `Unsafe evidence path: '${file.path}'`);
        }
        if (seen.has(portable)) throw new LoopStoreV3Error("LOOP_EVIDENCE_DUPLICATE", `Duplicate evidence path: '${portable}'`);
        seen.add(portable);
        const content = evidenceBytes(file.content);
        return { path: portable, content, digest: digest(content) };
      }).sort((left, right) => left.path.localeCompare(right.path));
      const manifest: EvidenceManifestV3 = {
        schemaVersion: 3,
        changeName: state.changeName,
        runId: state.runId,
        finalRevision: state.finalRevision,
        planningRevision: state.planningRevision,
        sourceDigest: state.contract.sourceDigest,
        traceabilityDigest: state.contract.traceabilityDigest,
        files: normalized.map(({ path, digest: fileDigest }) => ({ path, digest: fileDigest })),
      };
      const manifestHash = digest(json(manifest));
      const paths = this.requiredPaths(cas.changeName, cas.runId);
      const evidenceRoot = paths.evidence;
      if (existsSync(resolve(evidenceRoot, "manifest.json"))) {
        const existing = readJson(resolve(evidenceRoot, "manifest.json"));
        if (!isDeepStrictEqual(existing, manifest)) {
          throw new LoopStoreV3Error("LOOP_EVIDENCE_CONFLICT", "archive evidence already exists with different content");
        }
        for (const file of normalized) {
          const existingPath = resolve(evidenceRoot, file.path);
          assertContained(evidenceRoot, existingPath);
          if (!existsSync(existingPath) || digest(readFileSync(existingPath)) !== file.digest) {
            throw new LoopStoreV3Error(
              "LOOP_EVIDENCE_CONFLICT",
              `archive evidence file '${file.path}' no longer matches its manifest`,
            );
          }
        }
        return { manifest, manifestHash, idempotent: true };
      }
      const staging = resolve(paths.runRoot, `.evidence-${randomUUID()}`);
      try {
        mkdirSync(staging, { recursive: false });
        for (const file of normalized) {
          const target = resolve(staging, file.path);
          assertContained(staging, target);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, file.content, { flag: "wx" });
        }
        writeFileSync(resolve(staging, "manifest.json"), json(manifest), { flag: "wx" });
        renameSync(staging, evidenceRoot);
      } finally {
        rmSync(staging, { recursive: true, force: true });
      }
      return { manifest, manifestHash, idempotent: false };
    });
  }

  private inspectUnlocked(changeName: string, runId?: string): RunInspectionV3 {
    const base = this.paths(changeName);
    if (!existsSync(base.changeRoot)) return { current: null, state: null, events: [], recovered: false };
    assertSafeExisting(base.changeRoot);
    const runs = this.scanRuns(changeName, false).filter((candidate): candidate is { state: RunStateV3; events: RunEventRecordV3[] } => candidate.state.schemaVersion === 3);
    let current: CurrentRunPointerV3 | null = null;
    if (existsSync(base.current)) {
      const value = readJson(base.current);
      if (value && typeof value === "object" && (value as { schemaVersion?: unknown }).schemaVersion === 3) {
        current = value as CurrentRunPointerV3;
      }
    }
    const active = runs.filter((candidate) => isV3Active(candidate.state));
    if (active.length > 1) throw new LoopStoreV3Error("LOOP_MULTIPLE_ACTIVE", "multiple active Run Contract v3 runs exist");
    const selectedId = runId ?? active[0]?.state.runId ?? current?.runId;
    if (!selectedId) return { current, state: null, events: [], recovered: false };
    const selected = runs.find((candidate) => candidate.state.runId === selectedId);
    if (!selected) throw new LoopStoreV3Error("LOOP_POINTER_INVALID", `Run '${selectedId}' is missing`);
    const replayed = this.replayRecords(selected.events);
    const recovered = !isDeepStrictEqual(replayed, selected.state);
    if (recovered) atomicWrite(this.requiredPaths(changeName, selectedId).state, json(replayed));
    const expectedPointer = pointer(replayed);
    if (!isDeepStrictEqual(current, expectedPointer)) {
      atomicWrite(base.current, json(expectedPointer));
      current = expectedPointer;
    }
    return { current, state: replayed, events: selected.events, recovered };
  }

  private replayRecords(records: RunEventRecordV3[]): RunStateV3 {
    let state: RunStateV3 | null = null;
    for (const [index, record] of records.entries()) {
      const reduced = reduceRunEventV3(state, record.event);
      if (!isDeepStrictEqual(reduced.postState, record.postState)) {
        throw new LoopStoreV3Error("LOOP_CORRUPTION", `Event ${index} postState does not match reducer output`);
      }
      state = reduced.postState;
    }
    if (!state) throw new LoopStoreV3Error("LOOP_CORRUPTION", "Run has no initialization event");
    return state;
  }

  private scanRuns(changeName: string, includeLegacy: boolean): Array<{
    state: RunStateV3 | Record<string, unknown>;
    events: RunEventRecordV3[];
  }> {
    const base = this.paths(changeName);
    if (!existsSync(base.runsRoot)) return [];
    assertSafeExisting(base.runsRoot);
    return readdirSync(base.runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => {
        validateSegment(entry.name, "run id");
        const paths = this.requiredPaths(changeName, entry.name);
        assertSafeExisting(paths.runRoot);
        assertSafeExisting(paths.state);
        const raw = readJson(paths.state);
        if (isV2Active(raw) || (raw && typeof raw === "object" && (raw as { schemaVersion?: unknown }).schemaVersion === 2)) {
          return { state: raw as Record<string, unknown>, events: [] };
        }
        if (!raw || typeof raw !== "object" || (raw as { schemaVersion?: unknown }).schemaVersion !== 3) {
          throw new LoopStoreV3Error("LOOP_SCHEMA_UNSUPPORTED", `Unsupported Run Contract schema in ${paths.state}`);
        }
        assertRunStateV3(raw);
        return { state: raw, events: eventRecords(paths.events) };
      });
  }

  private requiredPaths(changeName: string, runId: string): Required<RunPathsV3> {
    return this.paths(changeName, runId) as Required<RunPathsV3>;
  }

  private withLock<T>(changeName: string, action: () => T): T {
    const paths = this.paths(changeName);
    mkdirSync(paths.changeRoot, { recursive: true });
    assertSafeExisting(paths.changeRoot);
    let descriptor: number | undefined;
    try {
      try {
        descriptor = openSync(paths.lock, "wx", 0o600);
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
        let holderAlive = true;
        try {
          const holder = readJson(paths.lock) as { pid?: unknown };
          holderAlive = processIsAlive(Number(holder.pid));
        } catch {
          holderAlive = true;
        }
        if (holderAlive) throw error;
        rmSync(paths.lock, { force: true });
        descriptor = openSync(paths.lock, "wx", 0o600);
      }
      writeFileSync(descriptor, json({ pid: process.pid, createdAt: new Date().toISOString() }));
    } catch (error) {
      if (descriptor !== undefined) closeSync(descriptor);
      if (descriptor !== undefined) rmSync(paths.lock, { force: true });
      throw new LoopStoreV3Error(
        "LOOP_LOCKED",
        `Change '${changeName}' is locked${error instanceof Error ? `: ${error.message}` : ""}`,
      );
    }
    try {
      return action();
    } finally {
      closeSync(descriptor);
      rmSync(paths.lock, { force: true });
    }
  }
}

export function evidenceManifestHashV3(manifest: EvidenceManifestV3): ArtifactHashV3 {
  const value = digest(json(manifest));
  if (!isArtifactHashV3(value)) throw new LoopStoreV3Error("LOOP_EVIDENCE_INVALID", "manifest hash is invalid");
  return value;
}
