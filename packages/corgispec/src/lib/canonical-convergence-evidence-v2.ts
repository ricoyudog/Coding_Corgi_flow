import {
  lstat as nodeLstat,
  readFile as nodeReadFile,
  readdir as nodeReaddir,
  realpath as nodeRealpath,
} from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";

import type {
  ConvergenceEvidenceV2,
  ImplementationGapV2,
} from "./converge-v2.js";
import {
  hashCanonicalArtifactV2,
  hashArtifactBytesV2,
  hashReviewFindingsV2,
  validateEvidenceBundleV2,
  validateFindingTriageV2,
  validateReviewFindingV2,
  type EvidenceBundleV2,
  type FindingTriageV2,
  type ReviewFindingV2,
} from "./evidence-v2.js";
import type {
  LoopStoreInspectionV2,
  ReviewTriageEntryV2,
} from "./loop-store-v2.js";
import { reduceLoopEventV2 } from "./loop-reducer-v2.js";
import {
  validateLoopEventRecordV2,
  validateLoopStateV2,
  isPortableRunSegmentV2,
  type ArtifactHashV2,
  type BundleSubmittedEventV2,
  type EvaluationCompletedEventV2,
  type GroupCommitAcknowledgedEventV2,
  type LoopGroupStateV2,
  type LoopStateV2,
} from "./run-contract-v2.js";

export type CanonicalConvergenceEvidenceErrorCodeV2 =
  | "canonical_recovery_required"
  | "canonical_state_invalid"
  | "canonical_event_chain_invalid"
  | "canonical_attempt_missing"
  | "canonical_attempt_corrupt"
  | "canonical_evidence_invalid"
  | "canonical_review_invalid"
  | "canonical_triage_invalid"
  | "canonical_binding_mismatch"
  | "canonical_hash_mismatch"
  | "canonical_event_mismatch"
  | "canonical_done_incomplete"
  | "canonical_finalization_invalid"
  | "canonical_git_mismatch";

export class CanonicalConvergenceEvidenceErrorV2 extends Error {
  constructor(
    public readonly code: CanonicalConvergenceEvidenceErrorCodeV2,
    message: string,
    public readonly details: Record<string, unknown> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CanonicalConvergenceEvidenceErrorV2";
  }
}

export interface CanonicalConvergenceGitV2 {
  revision: string;
  workspaceFingerprint: string;
}

export interface AssertCanonicalFinalizationEvidenceV2Input
  extends DeriveCanonicalConvergenceEvidenceV2Input {}

export interface CanonicalSuccessorSourceV2 {
  inspection: LoopStoreInspectionV2;
  attemptsRoot: string;
  reviewTriagePath?: string;
  reader?: CanonicalEvidenceReaderV2;
  trustedLegacyGroupIds?: readonly string[];
  successorSource?: CanonicalSuccessorSourceV2;
}

export interface CanonicalFinalizationEvidenceV2 {
  runId: string;
  planningRevision: ArtifactHashV2;
  completedGroupIds: string[];
  canonicalGroupIds: string[];
  trustedLegacyGroupIds: string[];
  reusedSuccessorGroupIds: string[];
  finalGitRevision: string;
  workspaceFingerprint: string;
  verifiedAttempts: VerifiedCanonicalAttemptV2[];
  verifiedSuccessorAttempts: VerifiedCanonicalAttemptV2[];
}

export interface CanonicalEvidenceReaderV2 {
  readFile(path: string): Promise<Uint8Array>;
  listDirectory(path: string): Promise<CanonicalEvidenceDirectoryEntryV2[]>;
  lstat(path: string): Promise<CanonicalEvidenceDirectoryEntryV2["kind"]>;
  realpath(path: string): Promise<string>;
}

export interface CanonicalEvidenceDirectoryEntryV2 {
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
}

export interface DeriveCanonicalConvergenceEvidenceV2Input {
  inspection: LoopStoreInspectionV2;
  attemptsRoot: string;
  /** Canonical run-level JSONL file; omit only when the store has no triage. */
  reviewTriagePath?: string;
  currentGit: CanonicalConvergenceGitV2;
  reader?: CanonicalEvidenceReaderV2;
  /** Accepted only after an external read-only migration archive verifier. */
  trustedLegacyGroupIds?: readonly string[];
  /** Fully materialized, recursively verified superseded-run provenance. */
  successorSource?: CanonicalSuccessorSourceV2;
  maxProvenanceDepth?: number;
}

export interface VerifiedCanonicalAttemptV2 {
  groupId: string;
  attempt: number;
  bundleId: string;
  result: EvaluationCompletedEventV2["result"];
  evidence: EvidenceBundleV2;
  findings: ReviewFindingV2[];
  triage: FindingTriageV2[];
  marker: CanonicalAttemptMarkerV2;
  bundleEvent: BundleSubmittedEventV2;
  evaluationEvent: EvaluationCompletedEventV2;
}

export interface CanonicalConvergenceAssessmentV2 {
  evidence: ConvergenceEvidenceV2[];
  gaps: ImplementationGapV2[];
  verifiedAttempts: VerifiedCanonicalAttemptV2[];
  reusableEvidenceGroupIds: string[];
}

interface CanonicalAttemptMarkerV2 {
  schemaVersion: 2;
  runId: string;
  groupId: string;
  attempt: number;
  bundleId: string;
  bundleHash: ArtifactHashV2;
  artifactHash: ArtifactHashV2;
  artifactManifest: Record<string, ArtifactHashV2>;
  evidenceHash: ArtifactHashV2;
  reviewHash: ArtifactHashV2;
  observedGitRevision: string;
  workspaceFingerprint: ArtifactHashV2;
}

interface CanonicalReviewFileV2 {
  findings: ReviewFindingV2[];
  triage: FindingTriageV2[];
}

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function fail(
  code: CanonicalConvergenceEvidenceErrorCodeV2,
  message: string,
  details: Record<string, unknown> = {},
  cause?: unknown,
): never {
  throw new CanonicalConvergenceEvidenceErrorV2(
    code,
    message,
    details,
    cause === undefined ? undefined : { cause },
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hash(value: unknown): value is ArtifactHashV2 {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function missing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT");
}

async function requiredBytes(
  reader: CanonicalEvidenceReaderV2,
  path: string,
  label: string,
): Promise<Uint8Array> {
  try {
    return await reader.readFile(path);
  } catch (error) {
    if (missing(error)) {
      fail("canonical_attempt_missing", `Canonical ${label} is missing`, { path });
    }
    fail("canonical_attempt_corrupt", `Cannot read canonical ${label}`, { path }, error);
  }
}

async function requiredJson(
  reader: CanonicalEvidenceReaderV2,
  path: string,
  label: string,
): Promise<unknown> {
  const bytes = await requiredBytes(reader, path, label);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
  } catch (error) {
    fail("canonical_attempt_corrupt", `Canonical ${label} is not valid JSON`, { path }, error);
  }
}

function marker(value: unknown, path: string): CanonicalAttemptMarkerV2 {
  if (!record(value)) fail("canonical_attempt_corrupt", "bundle.json must be an object", { path });
  if (
    value["schemaVersion"] !== 2 ||
    !nonEmpty(value["runId"]) ||
    !nonEmpty(value["groupId"]) ||
    !positiveInteger(value["attempt"]) ||
    !nonEmpty(value["bundleId"]) ||
    !hash(value["bundleHash"]) ||
    !hash(value["artifactHash"]) ||
    !hash(value["evidenceHash"]) ||
    !hash(value["reviewHash"]) ||
    !nonEmpty(value["observedGitRevision"]) ||
    !hash(value["workspaceFingerprint"])
  ) {
    fail("canonical_attempt_corrupt", "bundle.json has an invalid v2 marker", { path });
  }
  return value as unknown as CanonicalAttemptMarkerV2;
}

function review(value: unknown, path: string): CanonicalReviewFileV2 {
  if (!record(value) || !Array.isArray(value["findings"]) || !Array.isArray(value["triage"])) {
    fail("canonical_review_invalid", "review.json must contain findings[] and triage[]", { path });
  }
  for (const [index, finding] of value["findings"].entries()) {
    const validation = validateReviewFindingV2(finding);
    if (!validation.valid) {
      fail(
        "canonical_review_invalid",
        `review.json finding ${index} is invalid`,
        { path, errors: validation.errors },
      );
    }
  }
  const fingerprints = new Set((value["findings"] as ReviewFindingV2[]).map((finding) => finding.fingerprint));
  const triaged = new Set<string>();
  for (const [index, triage] of value["triage"].entries()) {
    const validation = validateFindingTriageV2(triage);
    if (!validation.valid || (triage as FindingTriageV2).disposition === "open") {
      fail("canonical_review_invalid", `review.json triage ${index} is invalid`, {
        path,
        errors: validation.errors,
      });
    }
    const fingerprint = (triage as FindingTriageV2).findingFingerprint;
    if (!fingerprints.has(fingerprint) || triaged.has(fingerprint)) {
      fail("canonical_review_invalid", `review.json triage ${index} is not uniquely bound to a finding`, { path });
    }
    triaged.add(fingerprint);
  }
  return value as unknown as CanonicalReviewFileV2;
}

interface CanonicalPathAnchorV2 {
  lexicalRoot: string;
  physicalRoot: string;
}

function relativeWithinCanonicalRootV2(
  anchor: CanonicalPathAnchorV2,
  path: string,
  label: string,
  code: CanonicalConvergenceEvidenceErrorCodeV2,
): string {
  const rel = relative(anchor.lexicalRoot, resolve(path));
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
    return rel;
  }
  fail(code, `Canonical ${label} escapes the canonical run root`, {
    path,
    runRoot: anchor.lexicalRoot,
  });
}

async function canonicalPathAnchorV2(
  reader: CanonicalEvidenceReaderV2,
  runRoot: string,
  code: CanonicalConvergenceEvidenceErrorCodeV2,
): Promise<CanonicalPathAnchorV2> {
  if (typeof reader.lstat !== "function" || typeof reader.realpath !== "function") {
    fail(code, "Canonical reader cannot verify canonical run root symlink ancestry", {
      path: runRoot,
    });
  }
  try {
    const lexicalRoot = resolve(runRoot);
    const kind = await reader.lstat(lexicalRoot);
    if (kind !== "directory") {
      fail(code, "Canonical run root must be a non-symlink directory", {
        path: lexicalRoot,
        kind,
      });
    }
    return {
      lexicalRoot,
      physicalRoot: resolve(await reader.realpath(lexicalRoot)),
    };
  } catch (error) {
    if (error instanceof CanonicalConvergenceEvidenceErrorV2) throw error;
    fail(code, "Cannot verify canonical run root", { path: runRoot }, error);
  }
}

async function assertCanonicalPathV2(
  reader: CanonicalEvidenceReaderV2,
  anchor: CanonicalPathAnchorV2,
  path: string,
  expectedKind: "file" | "directory",
  label: string,
  code: CanonicalConvergenceEvidenceErrorCodeV2,
): Promise<void> {
  if (typeof reader.lstat !== "function" || typeof reader.realpath !== "function") {
    fail(code, `Canonical reader cannot verify ${label} symlink ancestry`, { path });
  }
  const canonicalPath = resolve(path);
  const rel = relativeWithinCanonicalRootV2(anchor, canonicalPath, label, code);
  try {
    const kind = await reader.lstat(canonicalPath);
    if (kind !== expectedKind) {
      fail(code, `Canonical ${label} must be a non-symlink ${expectedKind}`, {
        path: canonicalPath,
        kind,
      });
    }
    const actual = resolve(await reader.realpath(canonicalPath));
    const expected = resolve(anchor.physicalRoot, rel);
    if (actual !== expected) {
      fail(code, `Canonical ${label} resolves outside its anchored path`, {
        path: canonicalPath,
        actual,
        expected,
      });
    }
  } catch (error) {
    if (error instanceof CanonicalConvergenceEvidenceErrorV2) throw error;
    fail(code, `Cannot verify canonical ${label}`, { path: canonicalPath }, error);
  }
}

function assertContainedAttemptPath(root: string, target: string, label: string): void {
  const rel = relative(root, target);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return;
  fail("canonical_attempt_corrupt", `${label} escapes attemptsRoot`, { root, target });
}

async function triageEntries(
  reader: CanonicalEvidenceReaderV2,
  path: string | undefined,
  runId: string,
  anchor: CanonicalPathAnchorV2,
): Promise<Array<{ stored: ReviewTriageEntryV2; canonical: FindingTriageV2 }>> {
  if (path === undefined) return [];
  const canonicalPath = resolve(path);
  const expectedPath = resolve(anchor.lexicalRoot, "review-triage.jsonl");
  if (canonicalPath !== expectedPath) {
    fail("canonical_triage_invalid", "Review triage log is not the canonical run-level path", {
      path: canonicalPath,
      expected: expectedPath,
    });
  }
  await assertCanonicalPathV2(
    reader,
    anchor,
    canonicalPath,
    "file",
    "review triage log",
    "canonical_triage_invalid",
  );
  const bytes = await requiredBytes(reader, canonicalPath, "review triage log");
  const text = Buffer.from(bytes).toString("utf8");
  if (!text.trim()) return [];
  const result: Array<{ stored: ReviewTriageEntryV2; canonical: FindingTriageV2 }> = [];
  const identities = new Set<string>();
  for (const [index, line] of text.trimEnd().split(/\r?\n/u).entries()) {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      fail("canonical_triage_invalid", `Review triage line ${index + 1} is malformed`, { path }, error);
    }
    if (
      !record(value) ||
      value["schemaVersion"] !== 2 ||
      value["runId"] !== runId ||
      !nonEmpty(value["groupId"]) ||
      !positiveInteger(value["attempt"]) ||
      !nonEmpty(value["bundleId"]) ||
      !hash(value["findingFingerprint"]) ||
      !["dismissed", "accepted-risk"].includes(String(value["action"])) ||
      !record(value["actor"]) ||
      value["actor"]["kind"] !== "human" ||
      !nonEmpty(value["actor"]["id"]) ||
      !nonEmpty(value["reason"]) ||
      !nonEmpty(value["occurredAt"])
    ) {
      fail("canonical_triage_invalid", `Review triage line ${index + 1} is invalid`, { path });
    }
    const stored = value as unknown as ReviewTriageEntryV2;
    const canonical: FindingTriageV2 = {
      schemaVersion: 2,
      findingFingerprint: stored.findingFingerprint as ArtifactHashV2,
      disposition: stored.action,
      actor: stored.actor,
      reason: stored.reason,
      occurredAt: stored.occurredAt,
    };
    const validation = validateFindingTriageV2(canonical);
    if (!validation.valid) {
      fail("canonical_triage_invalid", `Review triage line ${index + 1} is invalid`, {
        path,
        errors: validation.errors,
      });
    }
    const identity = triageIdentity(stored);
    if (identities.has(identity)) {
      fail("canonical_triage_invalid", "Review triage contains a duplicate decision", {
        path,
        findingFingerprint: canonical.findingFingerprint,
      });
    }
    identities.add(identity);
    result.push({ stored, canonical });
  }
  return result;
}

function triageIdentity(entry: Pick<ReviewTriageEntryV2,
  "groupId" | "attempt" | "bundleId" | "findingFingerprint"
>): string {
  return `${entry.groupId}:${entry.attempt}:${entry.bundleId}:${entry.findingFingerprint}`;
}

function validateInspection(inspection: LoopStoreInspectionV2): LoopStateV2 | null {
  if (inspection.recoveryRequired) {
    fail("canonical_recovery_required", "Canonical state requires recovery before evidence can be read");
  }
  if (!inspection.state) {
    if (inspection.events.length > 0) {
      fail("canonical_event_chain_invalid", "Canonical events exist without a state snapshot");
    }
    return null;
  }
  const stateValidation = validateLoopStateV2(inspection.state);
  if (!stateValidation.valid) {
    fail("canonical_state_invalid", "Canonical LoopStateV2 is invalid", {
      errors: stateValidation.errors,
    });
  }
  if (inspection.events.length === 0) {
    fail("canonical_event_chain_invalid", "Canonical state has no initialization event");
  }
  let replayed: LoopStateV2 | null = null;
  for (const [index, eventRecord] of inspection.events.entries()) {
    const validation = validateLoopEventRecordV2(eventRecord);
    if (!validation.valid || eventRecord.event.seq !== index) {
      fail("canonical_event_chain_invalid", `Canonical event ${index} is invalid`, {
        errors: validation.errors,
      });
    }
    try {
      const reduced = reduceLoopEventV2(replayed, eventRecord.event);
      if (!isDeepStrictEqual(reduced.postState, eventRecord.postState)) {
        fail("canonical_event_chain_invalid", `Canonical event ${index} post-state does not replay`);
      }
      replayed = reduced.postState;
    } catch (error) {
      if (error instanceof CanonicalConvergenceEvidenceErrorV2) throw error;
      fail("canonical_event_chain_invalid", `Canonical event ${index} cannot be replayed`, {}, error);
    }
  }
  const latest = inspection.events.at(-1)!.postState;
  if (!isDeepStrictEqual(latest, inspection.state)) {
    fail("canonical_event_chain_invalid", "Canonical state is not the latest durable event post-state");
  }
  return inspection.state;
}

function assertBinding(
  evidence: EvidenceBundleV2,
  markerValue: CanonicalAttemptMarkerV2,
  bundleEvent: BundleSubmittedEventV2,
  state: LoopStateV2,
): void {
  const binding = evidence.binding;
  const group = state.groups[bundleEvent.groupId];
  if (
    !group ||
    binding.runId !== state.runId ||
    binding.groupId !== bundleEvent.groupId ||
    binding.attempt !== bundleEvent.attempt ||
    binding.bundleId !== bundleEvent.bundleId ||
    binding.planningRevision !== state.planningRevision ||
    binding.taskGroupFingerprint !== group.taskGroupFingerprint ||
    binding.baselineGitRevision !== state.git.baselineRevision ||
    binding.observedGitRevision !== bundleEvent.observedGitRevision ||
    binding.workspaceFingerprint !== bundleEvent.workspaceFingerprint ||
    markerValue.runId !== binding.runId ||
    markerValue.groupId !== binding.groupId ||
    markerValue.attempt !== binding.attempt ||
    markerValue.bundleId !== binding.bundleId ||
    markerValue.observedGitRevision !== binding.observedGitRevision ||
    markerValue.workspaceFingerprint !== binding.workspaceFingerprint
  ) {
    fail("canonical_binding_mismatch", "Canonical evidence binding is stale or mismatched", {
      groupId: bundleEvent.groupId,
      attempt: bundleEvent.attempt,
    });
  }
}

function validateAttemptTriage(
  reviewValue: CanonicalReviewFileV2,
  entries: Array<{ stored: ReviewTriageEntryV2; canonical: FindingTriageV2 }>,
  identity: { runId: string; groupId: string; attempt: number; bundleId: string },
  used: Set<string>,
): FindingTriageV2[] {
  for (const inline of reviewValue.triage) {
    const match = entries.find(({ stored, canonical }) =>
      stored.runId === identity.runId &&
      stored.groupId === identity.groupId &&
      stored.attempt === identity.attempt &&
      stored.bundleId === identity.bundleId &&
      canonical.findingFingerprint === inline.findingFingerprint &&
      canonical.disposition === inline.disposition
    );
    if (!match || !isDeepStrictEqual(match.canonical, inline)) {
      fail("canonical_triage_invalid", "Inline review triage has no exact bound run-level entry", identity);
    }
    used.add(triageIdentity(match.stored));
  }
  return reviewValue.triage;
}

function safeManifestPath(value: string): boolean {
  return value.startsWith("artifacts/") &&
    !value.includes("\\") &&
    !value.includes("\0") &&
    value === posix.normalize(value) &&
    !value.endsWith("/") &&
    !value.split("/").includes("..");
}

async function scanAttemptDirectory(
  reader: CanonicalEvidenceReaderV2,
  root: string,
): Promise<{ files: string[]; directories: string[] }> {
  const files: string[] = [];
  const directories: string[] = [];
  async function visit(directory: string): Promise<void> {
    let entries: CanonicalEvidenceDirectoryEntryV2[];
    try {
      entries = await reader.listDirectory(directory);
    } catch (error) {
      if (missing(error)) fail("canonical_attempt_missing", "Canonical attempt directory is missing", { path: directory });
      fail("canonical_attempt_corrupt", "Cannot enumerate canonical attempt directory", { path: directory }, error);
    }
    for (const entry of entries) {
      if (!entry.name || entry.name.includes("/") || entry.name.includes("\\") || entry.name === "." || entry.name === "..") {
        fail("canonical_attempt_corrupt", "Canonical attempt contains an unsafe directory entry", { path: directory });
      }
      const absolute = resolve(directory, entry.name);
      const portable = relative(root, absolute).split(sep).join("/");
      if (!portable || portable.startsWith("../") || posix.normalize(portable) !== portable) {
        fail("canonical_attempt_corrupt", "Canonical attempt entry escapes its root", { path: absolute });
      }
      if (entry.kind === "symlink" || entry.kind === "other") {
        fail("canonical_attempt_corrupt", "Canonical attempt may contain only regular files and directories", { path: absolute });
      }
      if (entry.kind === "directory") {
        directories.push(portable);
        await visit(absolute);
      } else {
        files.push(portable);
      }
    }
  }
  await visit(root);
  return { files: files.sort(), directories: directories.sort() };
}

async function validateArtifactManifest(
  reader: CanonicalEvidenceReaderV2,
  directory: string,
  markerValue: CanonicalAttemptMarkerV2,
): Promise<void> {
  if (!record(markerValue.artifactManifest)) {
    fail("canonical_attempt_corrupt", "bundle.json artifactManifest must be an object", { path: directory });
  }
  const manifestEntries = Object.entries(markerValue.artifactManifest);
  if (manifestEntries.length === 0) {
    fail("canonical_attempt_corrupt", "bundle.json artifactManifest must not be empty", { path: directory });
  }
  const normalized = new Set<string>();
  for (const [path, digest] of manifestEntries) {
    const portableIdentity = posix.normalize(path).toLocaleLowerCase("en-US");
    if (!safeManifestPath(path) || !hash(digest) || normalized.has(portableIdentity)) {
      fail("canonical_attempt_corrupt", "bundle.json contains an unsafe or duplicate artifact manifest path", {
        path,
      });
    }
    normalized.add(portableIdentity);
  }
  const scan = await scanAttemptDirectory(reader, directory);
  const expectedFiles = [
    "bundle.json",
    "evidence.json",
    "review.json",
    ...manifestEntries.map(([path]) => path),
  ].sort();
  if (!isDeepStrictEqual(scan.files, expectedFiles)) {
    fail("canonical_hash_mismatch", "Canonical attempt has missing or unlisted extra files", {
      expectedFiles,
      actualFiles: scan.files,
    });
  }
  const expectedDirectories = new Set<string>();
  for (const [path] of manifestEntries) {
    let parent = posix.dirname(path);
    while (parent !== ".") {
      expectedDirectories.add(parent);
      parent = posix.dirname(parent);
    }
  }
  if (!isDeepStrictEqual(scan.directories, [...expectedDirectories].sort())) {
    fail("canonical_hash_mismatch", "Canonical attempt has unlisted extra directories", {
      expectedDirectories: [...expectedDirectories].sort(),
      actualDirectories: scan.directories,
    });
  }
  for (const [path, digest] of manifestEntries) {
    const bytes = await requiredBytes(reader, resolve(directory, ...path.split("/")), "manifest artifact");
    if (hashArtifactBytesV2(bytes) !== digest) {
      fail("canonical_hash_mismatch", "Canonical artifact bytes do not match artifactManifest", { path });
    }
  }
  if (hashCanonicalArtifactV2(markerValue.artifactManifest) !== markerValue.artifactHash) {
    fail("canonical_hash_mismatch", "artifactHash does not match artifactManifest", { path: directory });
  }
}

function expectedEvaluation(
  evidence: EvidenceBundleV2,
  findings: ReviewFindingV2[],
  triage: FindingTriageV2[],
): Pick<EvaluationCompletedEventV2, "result" | "reviewClean"> {
  const resolved = new Set(triage.map((entry) => entry.findingFingerprint));
  const open = findings.filter((finding) => !resolved.has(finding.fingerprint));
  if (evidence.verdict === "FAIL") {
    return { result: "verification_failed", reviewClean: open.length === 0 };
  }
  return open.length > 0
    ? { result: "review_failed", reviewClean: false }
    : { result: "pass", reviewClean: true };
}

async function verifyAttempt(
  reader: CanonicalEvidenceReaderV2,
  anchor: CanonicalPathAnchorV2,
  attemptsRoot: string,
  state: LoopStateV2,
  bundleEvent: BundleSubmittedEventV2,
  evaluationEvent: EvaluationCompletedEventV2,
  allTriage: Array<{ stored: ReviewTriageEntryV2; canonical: FindingTriageV2 }>,
  usedTriage: Set<string>,
): Promise<VerifiedCanonicalAttemptV2> {
  if (!isPortableRunSegmentV2(bundleEvent.groupId)) {
    fail("canonical_attempt_corrupt", "Attempt groupId is not a portable safe segment", {
      groupId: bundleEvent.groupId,
    });
  }
  const root = resolve(attemptsRoot);
  const groupDirectory = resolve(root, bundleEvent.groupId);
  const directory = resolve(groupDirectory, String(bundleEvent.attempt));
  assertContainedAttemptPath(root, groupDirectory, "Task Group directory");
  assertContainedAttemptPath(root, directory, "attempt directory");
  await assertCanonicalPathV2(
    reader,
    anchor,
    root,
    "directory",
    "attemptsRoot",
    "canonical_attempt_corrupt",
  );
  await assertCanonicalPathV2(
    reader,
    anchor,
    groupDirectory,
    "directory",
    "Task Group attempt directory",
    "canonical_attempt_corrupt",
  );
  await assertCanonicalPathV2(
    reader,
    anchor,
    directory,
    "directory",
    "attempt directory",
    "canonical_attempt_corrupt",
  );
  const markerPath = resolve(directory, "bundle.json");
  const evidencePath = resolve(directory, "evidence.json");
  const reviewPath = resolve(directory, "review.json");
  const markerValue = marker(await requiredJson(reader, markerPath, "bundle marker"), markerPath);
  const evidenceValue = await requiredJson(reader, evidencePath, "evidence artifact");
  const evidenceValidation = validateEvidenceBundleV2(evidenceValue);
  if (!evidenceValidation.valid) {
    fail("canonical_evidence_invalid", "evidence.json failed v2 validation", {
      path: evidencePath,
      errors: evidenceValidation.errors,
    });
  }
  const evidence = evidenceValue as EvidenceBundleV2;
  const reviewValue = review(await requiredJson(reader, reviewPath, "review artifact"), reviewPath);
  const triage = validateAttemptTriage(reviewValue, allTriage, {
    runId: state.runId,
    groupId: bundleEvent.groupId,
    attempt: bundleEvent.attempt,
    bundleId: bundleEvent.bundleId,
  }, usedTriage);
  assertBinding(evidence, markerValue, bundleEvent, state);
  await validateArtifactManifest(reader, directory, markerValue);

  const reviewHash = hashCanonicalArtifactV2({
    findingsHash: hashReviewFindingsV2(reviewValue.findings),
    triage,
  });
  const fullBundleHash = hashCanonicalArtifactV2({
    schemaVersion: 2,
    binding: evidence.binding,
    evidenceBundleHash: evidence.bundleHash,
    evidenceHash: evidence.evidenceHash,
    reviewHash,
    artifactHash: markerValue.artifactHash,
  });
  if (
    markerValue.evidenceHash !== evidence.evidenceHash ||
    markerValue.reviewHash !== reviewHash ||
    markerValue.bundleHash !== fullBundleHash ||
    markerValue.bundleHash !== bundleEvent.bundleHash ||
    markerValue.artifactHash !== bundleEvent.artifactHash ||
    evaluationEvent.evidenceHash !== evidence.evidenceHash ||
    evaluationEvent.reviewHash !== reviewHash
  ) {
    fail("canonical_hash_mismatch", "Canonical attempt hashes do not match durable events", {
      groupId: bundleEvent.groupId,
      attempt: bundleEvent.attempt,
    });
  }
  const expected = expectedEvaluation(evidence, reviewValue.findings, triage);
  if (
    evaluationEvent.groupId !== bundleEvent.groupId ||
    evaluationEvent.attempt !== bundleEvent.attempt ||
    evaluationEvent.seq !== bundleEvent.seq + 1 ||
    evaluationEvent.result !== expected.result ||
    evaluationEvent.reviewClean !== expected.reviewClean
  ) {
    fail("canonical_event_mismatch", "Evaluation event does not match canonical evidence and review", {
      groupId: bundleEvent.groupId,
      attempt: bundleEvent.attempt,
    });
  }
  return {
    groupId: bundleEvent.groupId,
    attempt: bundleEvent.attempt,
    bundleId: bundleEvent.bundleId,
    result: evaluationEvent.result,
    evidence,
    findings: reviewValue.findings,
    triage,
    marker: markerValue,
    bundleEvent,
    evaluationEvent,
  };
}

function commitEventFor(
  inspection: LoopStoreInspectionV2,
  attempt: VerifiedCanonicalAttemptV2,
): GroupCommitAcknowledgedEventV2 | undefined {
  return inspection.events
    .map((entry) => entry.event)
    .find((event): event is GroupCommitAcknowledgedEventV2 =>
      event.type === "group_commit_acknowledged" &&
      event.groupId === attempt.groupId &&
      event.attempt === attempt.attempt &&
      event.seq > attempt.evaluationEvent.seq
    );
}

function assertCompletedGroup(
  group: LoopGroupStateV2,
  attempt: VerifiedCanonicalAttemptV2,
  commit: GroupCommitAcknowledgedEventV2 | undefined,
): GroupCommitAcknowledgedEventV2 {
  if (
    attempt.result !== "pass" ||
    group.status !== "completed" ||
    group.bundle.status !== "approved" ||
    group.attempt !== attempt.attempt ||
    group.bundle.bundleId !== attempt.bundleId ||
    group.bundle.bundleHash !== attempt.marker.bundleHash ||
    group.bundle.artifactHash !== attempt.marker.artifactHash ||
    group.bundle.evidenceHash !== attempt.marker.evidenceHash ||
    group.bundle.reviewHash !== attempt.marker.reviewHash ||
    group.bundle.observedGitRevision !== attempt.marker.observedGitRevision ||
    group.bundle.workspaceFingerprint !== attempt.marker.workspaceFingerprint ||
    group.commit.status !== "acknowledged" ||
    group.commit.workspaceFingerprint !== attempt.marker.workspaceFingerprint ||
    !commit ||
    commit.commitRevision !== group.commit.revision ||
    commit.commitTree !== group.commit.tree ||
    commit.workspaceFingerprint !== group.commit.workspaceFingerprint ||
    commit.pushStatus !== group.push.status ||
    commit.remoteRevision !== group.push.remoteRevision
  ) {
    fail("canonical_done_incomplete", `Completed Task Group '${group.id}' lacks a valid approved attempt and commit`, {
      groupId: group.id,
    });
  }
  return commit;
}

interface ReusablePrefixProofV2 {
  groupIds: string[];
  canonicalGroupIds: string[];
  trustedLegacyGroupIds: string[];
  successorGroupIds: string[];
  canonicalCommits: GroupCommitAcknowledgedEventV2[];
}

function doneAssessment(
  inspection: LoopStoreInspectionV2,
  state: LoopStateV2,
  attempts: VerifiedCanonicalAttemptV2[],
  currentGit: CanonicalConvergenceGitV2,
  reusable: ReusablePrefixProofV2,
): CanonicalConvergenceAssessmentV2 {
  const groups = Object.values(state.groups).sort((left, right) => left.ordinal - right.ordinal);
  if (
    groups.length === 0 ||
    groups.some((group) => group.status !== "completed") ||
    reusable.groupIds.length !== groups.length
  ) {
    fail("canonical_done_incomplete", "Done run has a completed group without verified provenance");
  }
  const commits = reusable.canonicalCommits;
  if (commits.some((commit, index) =>
    commit.commitRevision === state.git.baselineRevision ||
    (index > 0 && (
      commit.commitRevision === commits[index - 1]!.commitRevision ||
      commit.seq <= commits[index - 1]!.seq
    ))
  )) {
    fail("canonical_done_incomplete", "Done run commit chain does not advance once per Task Group");
  }
  const finalRevision = state.git.finalRevision;
  const finalEvent = inspection.events.map((entry) => entry.event).reverse().find(
    (event) => event.type === "run_finalized",
  );
  const lastCommit = commits.at(-1);
  const expectedFinalRevision = lastCommit?.commitRevision ?? state.git.baselineRevision;
  const expectedWorkspaceFingerprint = lastCommit?.workspaceFingerprint ?? state.git.workspaceFingerprint;
  if (
    !finalRevision ||
    !finalEvent ||
    finalEvent.type !== "run_finalized" ||
    (lastCommit !== undefined && finalEvent.seq <= lastCommit.seq) ||
    finalEvent.finalGitRevision !== finalRevision ||
    finalRevision !== expectedFinalRevision ||
    finalEvent.workspaceFingerprint !== expectedWorkspaceFingerprint ||
    state.git.workspaceFingerprint !== finalEvent.workspaceFingerprint ||
    currentGit.revision !== finalRevision ||
    currentGit.workspaceFingerprint !== finalEvent.workspaceFingerprint
  ) {
    fail("canonical_git_mismatch", "Done run is not bound to the current final Git revision and workspace", {
      expectedRevision: finalRevision,
      actualRevision: currentGit.revision,
    });
  }
  return {
    evidence: [{
      id: `run:${state.runId}:final`,
      planningRevision: state.planningRevision,
      observedGitRevision: finalRevision,
      workspaceFingerprint: currentGit.workspaceFingerprint,
      status: "pass",
      summary: `${groups.length} Task Group(s) have canonical approved attempts and commits`,
    }],
    gaps: [],
    verifiedAttempts: attempts,
    reusableEvidenceGroupIds: reusable.groupIds,
  };
}

function hasFinalizedHistory(
  inspection: LoopStoreInspectionV2,
  state: LoopStateV2,
): boolean {
  const groups = Object.values(state.groups);
  return state.phase === "invalidated"
    && state.git.finalRevision !== null
    && groups.length > 0
    && groups.every((group) => group.status === "completed")
    && inspection.events.some((record) => record.event.type === "run_finalized");
}

/**
 * Derive convergence evidence exclusively from durable attempt artifacts and
 * events. blockedReason is intentionally never used as evidence.
 */
export async function deriveCanonicalConvergenceEvidenceV2(
  input: DeriveCanonicalConvergenceEvidenceV2Input,
): Promise<CanonicalConvergenceAssessmentV2> {
  return await deriveCanonicalConvergenceEvidenceInternal(input, {
    runIds: [],
    maxDepth: input.maxProvenanceDepth ?? 16,
  });
}

interface CanonicalProvenanceTraceV2 {
  runIds: string[];
  maxDepth: number;
}

async function deriveCanonicalConvergenceEvidenceInternal(
  input: DeriveCanonicalConvergenceEvidenceV2Input,
  trace: CanonicalProvenanceTraceV2,
): Promise<CanonicalConvergenceAssessmentV2> {
  const state = validateInspection(input.inspection);
  if (!state) return { evidence: [], gaps: [], verifiedAttempts: [], reusableEvidenceGroupIds: [] };
  if (trace.runIds.includes(state.runId)) {
    fail("canonical_finalization_invalid", "Canonical provenance contains a run cycle", {
      runIds: [...trace.runIds, state.runId],
    });
  }
  if (trace.runIds.length >= trace.maxDepth) {
    fail("canonical_finalization_invalid", "Canonical provenance exceeds its maximum depth", {
      maxDepth: trace.maxDepth,
      runIds: [...trace.runIds, state.runId],
    });
  }
  const nextTrace: CanonicalProvenanceTraceV2 = {
    runIds: [...trace.runIds, state.runId],
    maxDepth: trace.maxDepth,
  };
  const reader = input.reader ?? {
    readFile: nodeReadFile,
    realpath: nodeRealpath,
    async lstat(path: string): Promise<CanonicalEvidenceDirectoryEntryV2["kind"]> {
      const entry = await nodeLstat(path);
      return entry.isSymbolicLink()
        ? "symlink"
        : entry.isFile()
          ? "file"
          : entry.isDirectory() ? "directory" : "other";
    },
    async listDirectory(path: string): Promise<CanonicalEvidenceDirectoryEntryV2[]> {
      return (await nodeReaddir(path, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        kind: entry.isSymbolicLink()
          ? "symlink"
          : entry.isFile()
            ? "file"
            : entry.isDirectory() ? "directory" : "other",
      }));
    },
  };
  const anchor = await canonicalPathAnchorV2(
    reader,
    dirname(resolve(input.attemptsRoot)),
    "canonical_attempt_corrupt",
  );
  const allTriage = await triageEntries(
    reader,
    input.reviewTriagePath,
    state.runId,
    anchor,
  );
  const bundleEvents = input.inspection.events
    .map((entry) => entry.event)
    .filter((event): event is BundleSubmittedEventV2 => event.type === "bundle_submitted");
  const evaluationEvents = input.inspection.events
    .map((entry) => entry.event)
    .filter((event): event is EvaluationCompletedEventV2 => event.type === "evaluation_completed");
  if (bundleEvents.length === 0) {
    if (evaluationEvents.length > 0) {
      fail("canonical_event_mismatch", "Evaluation event exists without a submitted bundle");
    }
    if (allTriage.length > 0) {
      fail("canonical_triage_invalid", "Review triage exists without a canonical attempt");
    }
  }

  const attempts: VerifiedCanonicalAttemptV2[] = [];
  const usedTriage = new Set<string>();
  for (const bundleEvent of bundleEvents) {
    const evaluationEvent = evaluationEvents.find((candidate) =>
      candidate.groupId === bundleEvent.groupId &&
      candidate.attempt === bundleEvent.attempt &&
      candidate.seq === bundleEvent.seq + 1
    );
    if (!evaluationEvent) {
      fail("canonical_event_mismatch", "Submitted bundle has no durable evaluation event", {
        groupId: bundleEvent.groupId,
        attempt: bundleEvent.attempt,
      });
    }
    attempts.push(await verifyAttempt(
      reader,
      anchor,
      input.attemptsRoot,
      state,
      bundleEvent,
      evaluationEvent,
      allTriage,
      usedTriage,
    ));
  }
  if (evaluationEvents.length !== attempts.length) {
    fail("canonical_event_mismatch", "Canonical evaluation event count differs from submitted attempts");
  }
  const orphan = allTriage.find((entry) => !usedTriage.has(triageIdentity(entry.stored)));
  if (orphan) {
    fail("canonical_triage_invalid", "Review triage fingerprint is absent from every canonical review", {
      findingFingerprint: orphan.canonical.findingFingerprint,
    });
  }
  const reusable = await verifyReusablePrefixV2(input, state, attempts, nextTrace);
  if (state.phase === "done" || hasFinalizedHistory(input.inspection, state)) {
    return doneAssessment(input.inspection, state, attempts, input.currentGit, reusable);
  }

  const evidence: ConvergenceEvidenceV2[] = [];
  const gaps: ImplementationGapV2[] = [];
  const latestByGroup = new Map<string, VerifiedCanonicalAttemptV2>();
  for (const attempt of attempts) {
    const current = latestByGroup.get(attempt.groupId);
    if (!current || attempt.evaluationEvent.seq > current.evaluationEvent.seq) {
      latestByGroup.set(attempt.groupId, attempt);
    }
  }
  for (const attempt of latestByGroup.values()) {
    const group = state.groups[attempt.groupId]!;
    const completed = group.status === "completed" && attempt.result === "pass"
      && group.bundle.bundleId === attempt.bundleId;
    const failed = attempt.result !== "pass";
    if (!completed && !failed) continue;
    evidence.push({
      id: `run:${state.runId}:group:${attempt.groupId}:attempt:${attempt.attempt}`,
      planningRevision: attempt.evidence.binding.planningRevision,
      observedGitRevision: attempt.evidence.binding.observedGitRevision,
      workspaceFingerprint: attempt.evidence.binding.workspaceFingerprint,
      status: failed ? "fail" : "pass",
      summary: failed
        ? attempt.evaluationEvent.reason?.message ?? `Attempt ${attempt.attempt} failed`
        : `Task Group ${attempt.groupId} has an approved canonical attempt`,
    });
    if (failed) {
      gaps.push({
        id: `run-${state.runId}-group-${attempt.groupId}-attempt-${attempt.attempt}`,
        summary: attempt.evaluationEvent.reason?.message ?? `Repair Task Group ${attempt.groupId}`,
        details: `Canonical evaluation result: ${attempt.result}`,
      });
    }
  }
  return {
    evidence,
    gaps,
    verifiedAttempts: attempts,
    reusableEvidenceGroupIds: reusable.groupIds,
  };
}

async function verifyReusablePrefixV2(
  input: DeriveCanonicalConvergenceEvidenceV2Input,
  state: LoopStateV2,
  attempts: VerifiedCanonicalAttemptV2[],
  trace: CanonicalProvenanceTraceV2,
): Promise<ReusablePrefixProofV2> {
  const trustedLegacyIds = [...(input.trustedLegacyGroupIds ?? [])];
  const trustedLegacy = new Set(trustedLegacyIds);
  if (trustedLegacy.size !== trustedLegacyIds.length) {
    fail("canonical_finalization_invalid", "trustedLegacyGroupIds contains duplicates");
  }
  for (const groupId of trustedLegacy) {
    const group = state.groups[groupId];
    if (!group || !group.bundle.bundleId?.startsWith("legacy-v1-")) {
      fail("canonical_finalization_invalid", `Trusted legacy group '${groupId}' is invalid`);
    }
  }
  const successor = input.successorSource
    ? await verifySuccessorSource(input.successorSource, trace)
    : undefined;
  if (successor && state.supersedesRunId !== successor.state.runId) {
    fail("canonical_finalization_invalid", "Successor provenance does not match supersedesRunId", {
      supersedesRunId: state.supersedesRunId,
      sourceRunId: successor.state.runId,
    });
  }

  const proof: ReusablePrefixProofV2 = {
    groupIds: [],
    canonicalGroupIds: [],
    trustedLegacyGroupIds: [],
    successorGroupIds: [],
    canonicalCommits: [],
  };
  const groups = Object.values(state.groups).sort((left, right) => left.ordinal - right.ordinal);
  for (const group of groups) {
    if (group.status !== "completed") break;
    const local = attempts.filter((attempt) =>
      attempt.groupId === group.id && attempt.bundleId === group.bundle.bundleId
    );
    if (local.length > 1) {
      fail("canonical_done_incomplete", `Group '${group.id}' has ambiguous local attempts`);
    }
    if (local.length === 1) {
      const commit = assertCompletedGroup(group, local[0]!, commitEventFor(input.inspection, local[0]!));
      proof.groupIds.push(group.id);
      proof.canonicalGroupIds.push(group.id);
      proof.canonicalCommits.push(commit);
      continue;
    }

    const legacyBundle = group.bundle.bundleId?.startsWith("legacy-v1-") === true;
    if (legacyBundle && trustedLegacy.has(group.id)) {
      if (
        group.bundle.status !== "approved" ||
        group.commit.status !== "acknowledged" ||
        !group.commit.revision ||
        !group.commit.workspaceFingerprint
      ) {
        fail("canonical_done_incomplete", `Trusted legacy group '${group.id}' is incomplete`);
      }
      proof.groupIds.push(group.id);
      proof.trustedLegacyGroupIds.push(group.id);
      continue;
    }

    if (successor) {
      const sourceGroup = successor.state.groups[group.id];
      const provenBySource = successor.assessment.reusableEvidenceGroupIds.includes(group.id);
      if (sourceGroup && (!provenBySource || !matchesReusableSuccessorGroup(group, sourceGroup))) {
        fail("canonical_finalization_invalid", `Successor provenance for group '${group.id}' changed`);
      }
      if (sourceGroup && provenBySource) {
        proof.groupIds.push(group.id);
        proof.successorGroupIds.push(group.id);
        continue;
      }
    }
    if (legacyBundle) break;
    break;
  }
  return proof;
}

async function verifySuccessorSource(
  source: CanonicalSuccessorSourceV2,
  trace: CanonicalProvenanceTraceV2,
): Promise<{
  state: LoopStateV2;
  assessment: CanonicalConvergenceAssessmentV2;
}> {
  const terminal = validateInspection(source.inspection);
  if (!terminal || !["done", "invalidated"].includes(terminal.phase)) {
    fail(
      "canonical_finalization_invalid",
      "A reused successor prefix must come from a done or invalidated canonical run",
      { phase: terminal?.phase ?? null },
    );
  }
  let finalIndex = -1;
  for (let index = source.inspection.events.length - 1; index >= 0; index--) {
    if (source.inspection.events[index]!.event.type === "run_finalized") {
      finalIndex = index;
      break;
    }
  }
  if (finalIndex < 0) {
    if (terminal.phase !== "invalidated") {
      fail(
        "canonical_finalization_invalid",
        "A non-invalidated successor source has no durable run_finalized event",
        { runId: terminal.runId, phase: terminal.phase },
      );
    }
    const assessment = await deriveCanonicalConvergenceEvidenceInternal({
      inspection: source.inspection,
      attemptsRoot: source.attemptsRoot,
      reviewTriagePath: source.reviewTriagePath,
      reader: source.reader,
      trustedLegacyGroupIds: source.trustedLegacyGroupIds,
      successorSource: source.successorSource,
      maxProvenanceDepth: trace.maxDepth,
      // A partial invalidated source is verified group-by-group below. Its
      // current workspace is intentionally not promoted to final evidence.
      currentGit: {
        revision: terminal.git.finalRevision ?? terminal.git.baselineRevision,
        workspaceFingerprint: terminal.git.workspaceFingerprint,
      },
    }, trace);
    return { state: terminal, assessment };
  }
  const finalRecord = source.inspection.events[finalIndex]!;
  if (
    finalRecord.postState.phase !== "done" ||
    finalRecord.postState.runId !== terminal.runId ||
    !finalRecord.postState.git.finalRevision
  ) {
    fail(
      "canonical_finalization_invalid",
      "The successor source run_finalized record has an invalid post-state",
      { runId: terminal.runId },
    );
  }
  const finalInspection: LoopStoreInspectionV2 = {
    ...source.inspection,
    state: structuredClone(finalRecord.postState),
    events: structuredClone(source.inspection.events.slice(0, finalIndex + 1)),
    recoveryRequired: false,
  };
  const assessment = await deriveCanonicalConvergenceEvidenceInternal({
    inspection: finalInspection,
    attemptsRoot: source.attemptsRoot,
    reviewTriagePath: source.reviewTriagePath,
    reader: source.reader,
    trustedLegacyGroupIds: source.trustedLegacyGroupIds,
    successorSource: source.successorSource,
    maxProvenanceDepth: trace.maxDepth,
    currentGit: {
      revision: finalRecord.postState.git.finalRevision,
      workspaceFingerprint: finalRecord.postState.git.workspaceFingerprint,
    },
  }, trace);
  return { state: finalRecord.postState, assessment };
}

function matchesReusableSuccessorGroup(
  current: LoopGroupStateV2,
  source: LoopGroupStateV2 | undefined,
): source is LoopGroupStateV2 {
  return source !== undefined &&
    current.id === source.id &&
    current.ordinal === source.ordinal &&
    current.status === "completed" &&
    source.status === "completed" &&
    current.taskGroupFingerprint === source.taskGroupFingerprint &&
    current.attempt === source.attempt &&
    isDeepStrictEqual(current.bundle, source.bundle) &&
    isDeepStrictEqual(current.commit, source.commit) &&
    isDeepStrictEqual(current.push, source.push);
}

/**
 * Fail-closed precondition for appending run_finalized. This deliberately does
 * not accept a proposed final revision: the revision and workspace are derived
 * from the last durable commit acknowledgement and compared with current Git.
 *
 * A caller may exempt migrated v1 groups from canonical attempt/event checks
 * only after validating their migration marker and archive, then naming those
 * groups explicitly in trustedLegacyGroupIds.
 */
export async function assertCanonicalFinalizationEvidenceV2(
  input: AssertCanonicalFinalizationEvidenceV2Input,
): Promise<CanonicalFinalizationEvidenceV2> {
  const state = validateInspection(input.inspection);
  if (!state || state.phase !== "awaiting_finalize") {
    fail(
      "canonical_finalization_invalid",
      "Canonical finalization evidence requires an awaiting_finalize run",
      { phase: state?.phase ?? null },
    );
  }

  const groups = Object.values(state.groups).sort((left, right) => left.ordinal - right.ordinal);
  if (groups.length === 0 || groups.some((group) => group.status !== "completed")) {
    fail(
      "canonical_finalization_invalid",
      "Finalization requires every Task Group to be completed",
    );
  }

  const trustedLegacyIds = [...(input.trustedLegacyGroupIds ?? [])];
  const trustedLegacy = new Set(trustedLegacyIds);
  if (trustedLegacy.size !== trustedLegacyIds.length) {
    fail(
      "canonical_finalization_invalid",
      "trustedLegacyGroupIds must not contain duplicates",
    );
  }
  for (const groupId of trustedLegacy) {
    const group = state.groups[groupId];
    if (!group || !group.bundle.bundleId?.startsWith("legacy-v1-")) {
      fail(
        "canonical_finalization_invalid",
        `Trusted legacy Task Group '${groupId}' is absent or lacks a legacy-v1 bundle`,
        { groupId },
      );
    }
  }

  const assessment = await deriveCanonicalConvergenceEvidenceV2(input);
  const successorSource = input.successorSource
    ? await verifySuccessorSource(input.successorSource, {
        runIds: [state.runId],
        maxDepth: input.maxProvenanceDepth ?? 16,
      })
    : undefined;
  if (
    successorSource &&
    state.supersedesRunId !== successorSource.state.runId
  ) {
    fail(
      "canonical_finalization_invalid",
      "Successor source run does not match supersedesRunId",
      {
        supersedesRunId: state.supersedesRunId,
        sourceRunId: successorSource.state.runId,
      },
    );
  }
  const canonicalGroupIds: string[] = [];
  const acceptedLegacyGroupIds: string[] = [];
  const reusedSuccessorGroupIds: string[] = [];
  const seenRevisions = new Set<string>([state.git.baselineRevision]);
  let previousCanonicalCommitSeq = 0;
  let sawCanonicalGroup = false;
  let finalBinding = {
    revision: state.git.baselineRevision,
    workspaceFingerprint: state.git.workspaceFingerprint,
  };

  for (const group of groups) {
    const legacyBundle = group.bundle.bundleId?.startsWith("legacy-v1-") === true;
    const trusted = trustedLegacy.has(group.id);
    if (trusted) {
      if (!legacyBundle || sawCanonicalGroup) {
        fail(
          "canonical_finalization_invalid",
          `Legacy Task Group '${group.id}' is untrusted or is not a completed migration prefix`,
          { groupId: group.id },
        );
      }
      if (assessment.verifiedAttempts.some((attempt) => attempt.groupId === group.id)) {
        fail(
          "canonical_finalization_invalid",
          `Trusted legacy Task Group '${group.id}' unexpectedly has canonical attempt events`,
          { groupId: group.id },
        );
      }
      if (
        group.bundle.status !== "approved" ||
        group.commit.status !== "acknowledged" ||
        !group.commit.revision ||
        !group.commit.workspaceFingerprint
      ) {
        fail(
          "canonical_finalization_invalid",
          `Trusted legacy Task Group '${group.id}' lacks its migrated approved bundle or commit`,
          { groupId: group.id },
        );
      }
      acceptedLegacyGroupIds.push(group.id);
      finalBinding = {
        revision: group.commit.revision,
        workspaceFingerprint: group.commit.workspaceFingerprint,
      };
      continue;
    }

    const candidates = assessment.verifiedAttempts.filter((attempt) =>
      attempt.groupId === group.id && attempt.bundleId === group.bundle.bundleId
    );
    if (candidates.length === 0 && successorSource) {
      const sourceGroup = successorSource.state.groups[group.id];
      const sourceProven = successorSource.assessment.reusableEvidenceGroupIds.includes(group.id);
      if (
        sawCanonicalGroup ||
        !matchesReusableSuccessorGroup(group, sourceGroup) ||
        !sourceProven
      ) {
        fail(
          "canonical_finalization_invalid",
          `Reused successor Task Group '${group.id}' is changed, non-prefix, or lacks verified source evidence`,
          { groupId: group.id, sourceProven },
        );
      }
      reusedSuccessorGroupIds.push(group.id);
      continue;
    }
    if (legacyBundle) {
      fail(
        "canonical_finalization_invalid",
        `Legacy Task Group '${group.id}' is untrusted or is not a completed migration prefix`,
        { groupId: group.id },
      );
    }
    sawCanonicalGroup = true;
    if (candidates.length !== 1) {
      fail(
        "canonical_finalization_invalid",
        `Completed Task Group '${group.id}' must have exactly one bound canonical attempt`,
        { groupId: group.id, matchingAttempts: candidates.length },
      );
    }
    const attempt = candidates[0]!;
    const commit = assertCompletedGroup(
      group,
      attempt,
      commitEventFor(input.inspection, attempt),
    );
    if (
      commit.seq <= previousCanonicalCommitSeq ||
      seenRevisions.has(commit.commitRevision)
    ) {
      fail(
        "canonical_finalization_invalid",
        "Canonical group commits must advance in Task Group order",
        { groupId: group.id, commitRevision: commit.commitRevision },
      );
    }
    previousCanonicalCommitSeq = commit.seq;
    seenRevisions.add(commit.commitRevision);
    canonicalGroupIds.push(group.id);
    finalBinding = {
      revision: commit.commitRevision,
      workspaceFingerprint: commit.workspaceFingerprint,
    };
  }

  if (
    input.currentGit.revision !== finalBinding.revision ||
    input.currentGit.workspaceFingerprint !== finalBinding.workspaceFingerprint
  ) {
    fail(
      "canonical_git_mismatch",
      "Current Git does not match the last verified Task Group commit",
      {
        expectedRevision: finalBinding.revision,
        actualRevision: input.currentGit.revision,
        expectedWorkspaceFingerprint: finalBinding.workspaceFingerprint,
        actualWorkspaceFingerprint: input.currentGit.workspaceFingerprint,
      },
    );
  }

  return {
    runId: state.runId,
    planningRevision: state.planningRevision,
    completedGroupIds: groups.map((group) => group.id),
    canonicalGroupIds,
    trustedLegacyGroupIds: acceptedLegacyGroupIds,
    finalGitRevision: finalBinding.revision,
    workspaceFingerprint: finalBinding.workspaceFingerprint,
    verifiedAttempts: assessment.verifiedAttempts,
    reusedSuccessorGroupIds,
    verifiedSuccessorAttempts: successorSource?.assessment.verifiedAttempts ?? [],
  };
}
