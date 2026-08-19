import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import * as yaml from "js-yaml";
import { loadConfigFromDir, type OpenSpecConfig } from "./config.js";
import { acquireWorkflowLock, releaseWorkflowLock } from "./workflow-intent.js";

export const RFC_CONTRACT = "rfc-v1" as const;
export const DEFAULT_FOUNDATION_RFC = "RFC-0001-project-foundation";
export const DEFAULT_RFC_ROOT = "rfcs";

export type RfcType = "foundation" | "feature" | "amendment";
export type RfcStatus = "draft" | "accepted" | "superseded";
export type RfcEvidenceRequirement = "automated" | "human" | "both";
export type RfcDeliveryStatus = "unbound" | "planned" | "superseded" | "archived";

export interface AcceptanceCriterion {
  id: string;
  statement: string;
  evidence: RfcEvidenceRequirement;
}

export interface RfcSlice {
  id: string;
  title: string;
  acceptanceCriteria: AcceptanceCriterion[];
}

export interface RfcAcceptance {
  approver: string;
  approvedAt: string;
  digest: string;
}

export interface RfcMetadata {
  schemaVersion: 1;
  id: string;
  type: RfcType;
  status: RfcStatus;
  author: string;
  createdAt: string;
  amends?: string;
  acceptance?: RfcAcceptance;
}

export interface RfcDeliveryBinding {
  change: string;
  issue?: {
    provider: "github" | "gitlab" | "none";
    id?: string;
    url?: string;
  };
  sourceDigest: string;
  plannedAt: string;
}

export interface RfcArchiveEvidence {
  archivedAt: string;
  commit: string;
  evidenceManifest: string;
}

export interface RfcDeliverySlice {
  status: RfcDeliveryStatus;
  binding?: RfcDeliveryBinding;
  archive?: RfcArchiveEvidence;
  supersededBy?: {
    rfcId: string;
    sliceId: string;
  };
}

export interface RfcDelivery {
  schemaVersion: 1;
  rfcId: string;
  revision: number;
  slices: Record<string, RfcDeliverySlice>;
}

export interface LoadedRfc {
  projectDir: string;
  directory: string;
  documentPath: string;
  metadataPath: string;
  deliveryPath: string;
  document: string;
  digest: string;
  metadata: RfcMetadata;
  slices: RfcSlice[];
}

export interface ResolvedRfcSlice {
  rfc: LoadedRfc;
  slice: RfcSlice;
  acceptedCommit: string;
  integrationBranch: string;
}

export interface RfcValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface RfcValidationResult {
  valid: boolean;
  issues: RfcValidationIssue[];
  rfc?: LoadedRfc;
}

export interface RfcStatusSnapshot {
  rfc: LoadedRfc;
  validation: RfcValidationResult;
  delivery: RfcDelivery;
}

export interface DeliveryCasResult {
  delivery: RfcDelivery;
  idempotent: boolean;
}

interface RfcProjectConfig {
  config: OpenSpecConfig;
  rfcRoot: string;
  foundation: string;
  integrationBranch: string;
}

export class RfcError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RfcError";
    this.code = code;
  }
}

const RFC_ID_RE = /^RFC-(\d{4})-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const SLICE_ID_RE = /^S-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const AC_ID_RE = /^AC-\d{3}$/;
const REQUIRED_SECTIONS = ["Goal", "Non-goals", "Boundary", "Slices", "Risks"] as const;

export function computeRfcDigest(document: string): string {
  return createHash("sha256")
    .update(document.replace(/\r\n/g, "\n"), "utf8")
    .digest("hex");
}

export function listRfcs(projectDir: string): string[] {
  const { rfcRoot } = loadRfcProjectConfig(projectDir);
  const root = resolve(projectDir, rfcRoot);
  if (!existsSync(root)) return [];
  assertDirectoryNotSymlink(root, "RFC_ROOT_SYMLINK");
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && RFC_ID_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  assertUniqueRfcNumbers(ids);
  return ids;
}

export function parseRfcDocument(document: string): RfcSlice[] {
  const sections = markdownSections(document);
  for (const required of REQUIRED_SECTIONS) {
    const body = sections.get(required.toLowerCase());
    if (body === undefined) {
      throw new RfcError("RFC_SECTION_MISSING", `rfc.md is missing required section '## ${required}'`);
    }
    if (body.trim().length === 0) {
      throw new RfcError("RFC_SECTION_EMPTY", `RFC section '## ${required}' must not be empty`);
    }
  }

  if (/\b(?:TODO|TBD|FIXME)\b/i.test(document)) {
    throw new RfcError("RFC_PLACEHOLDER", "rfc.md still contains TODO/TBD/FIXME placeholders");
  }

  const slicesBody = sections.get("slices")!;
  const sliceHeading = /^###\s+(S-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)(?:\s*:\s*(.+))?\s*$/gm;
  const matches = Array.from(slicesBody.matchAll(sliceHeading));
  if (matches.length === 0) {
    throw new RfcError("RFC_SLICE_MISSING", "RFC Slices section must contain at least one '### S-01-semantic-slug' heading");
  }

  const seenSlices = new Set<string>();
  const seenCriteria = new Set<string>();
  const slices: RfcSlice[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]!;
    const id = match[1]!;
    if (!SLICE_ID_RE.test(id) || seenSlices.has(id)) {
      throw new RfcError("RFC_SLICE_INVALID", `RFC Slice id '${id}' is invalid or duplicated`);
    }
    seenSlices.add(id);
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? slicesBody.length;
    const body = slicesBody.slice(start, end);
    const criteria: AcceptanceCriterion[] = [];
    const criterionLine = /^-\s+(AC-\d{3})\s+\[evidence:\s*(automated|human|both)\]\s*:\s*(.+)\s*$/gm;
    for (const criterion of body.matchAll(criterionLine)) {
      const criterionId = criterion[1]!;
      if (!AC_ID_RE.test(criterionId) || seenCriteria.has(criterionId)) {
        throw new RfcError("RFC_AC_DUPLICATE", `Acceptance criterion '${criterionId}' is invalid or assigned more than once`);
      }
      seenCriteria.add(criterionId);
      criteria.push({
        id: criterionId,
        evidence: criterion[2] as RfcEvidenceRequirement,
        statement: criterion[3]!.trim(),
      });
    }
    if (criteria.length === 0) {
      throw new RfcError("RFC_AC_MISSING", `RFC Slice '${id}' must contain at least one acceptance criterion`);
    }
    slices.push({ id, title: match[2]?.trim() || id, acceptanceCriteria: criteria });
  }
  return slices;
}

export function loadRfc(projectDir: string, rfcId: string): LoadedRfc {
  assertRfcId(rfcId);
  const project = resolve(projectDir);
  const { rfcRoot } = loadRfcProjectConfig(project);
  const directory = resolve(project, rfcRoot, rfcId);
  assertPathWithin(resolve(project, rfcRoot), directory);
  assertRfcNumberUnique(project, rfcRoot, rfcId);
  if (!existsSync(directory)) {
    throw new RfcError("RFC_NOT_FOUND", `RFC '${rfcId}' was not found`);
  }
  assertDirectoryNotSymlink(directory, "RFC_DIRECTORY_SYMLINK");

  const documentPath = resolve(directory, "rfc.md");
  const metadataPath = resolve(directory, "rfc.yaml");
  const deliveryPath = resolve(directory, "delivery.yaml");
  assertRegularFile(documentPath, "RFC_DOCUMENT_MISSING");
  assertRegularFile(metadataPath, "RFC_METADATA_MISSING");
  assertRegularFile(deliveryPath, "RFC_DELIVERY_MISSING");

  const document = readFileSync(documentPath, "utf8");
  const metadata = parseMetadata(readFileSync(metadataPath, "utf8"), rfcId);
  const digest = computeRfcDigest(document);
  if (metadata.status === "accepted" || metadata.status === "superseded") {
    if (!metadata.acceptance || metadata.acceptance.digest !== digest) {
      throw new RfcError(
        "RFC_ACCEPTED_DRIFT",
        `Accepted RFC '${rfcId}' no longer matches its recorded digest; create an amendment instead`
      );
    }
  }

  return {
    projectDir: project,
    directory,
    documentPath,
    metadataPath,
    deliveryPath,
    document,
    digest,
    metadata,
    slices: parseRfcDocument(document),
  };
}

export function validateRfc(projectDir: string, rfcId: string): RfcValidationResult {
  try {
    const rfc = loadRfc(projectDir, rfcId);
    const delivery = loadRfcDelivery(projectDir, rfcId);
    const knownSlices = new Set(rfc.slices.map((slice) => slice.id));
    const unknown = Object.entries(delivery.slices)
      .filter(([sliceId, state]) => !knownSlices.has(sliceId) && state.status !== "unbound")
      .map(([sliceId]) => sliceId);
    if (unknown.length > 0) {
      return {
        valid: false,
        rfc,
        issues: unknown.map((sliceId) => ({
          code: "RFC_DELIVERY_UNKNOWN_SLICE",
          path: rfc.deliveryPath,
          message: `delivery.yaml references unknown Slice '${sliceId}'`,
        })),
      };
    }
    return { valid: true, issues: [], rfc };
  } catch (error) {
    return {
      valid: false,
      issues: [{
        code: error instanceof RfcError ? error.code : "RFC_INVALID",
        path: rfcId,
        message: error instanceof Error ? error.message : String(error),
      }],
    };
  }
}

/** Read draft governance state without requiring the normative document to be complete. */
export function loadRfcStatus(projectDir: string, rfcId: string): RfcStatusSnapshot {
  const rfc = loadRfcDraftUnchecked(projectDir, rfcId);
  return {
    rfc,
    validation: validateRfc(projectDir, rfcId),
    delivery: loadRfcDelivery(projectDir, rfcId),
  };
}

export function createRfcDraft(input: {
  projectDir: string;
  slug: string;
  author?: string;
  amends?: string;
  forcedId?: string;
  now?: Date;
}): LoadedRfc {
  const slug = normalizeSlug(input.slug);
  const config = loadRfcProjectConfig(input.projectDir);
  ensureRfcStandard(input.projectDir);
  const type: RfcType = input.amends ? "amendment" : "feature";
  if (input.amends) {
    assertRfcId(input.amends);
  }
  const id = input.forcedId ?? allocateNextRfcId(input.projectDir, slug);
  assertRfcId(id);
  assertRfcNumberUnique(input.projectDir, config.rfcRoot, id);
  const directory = resolve(input.projectDir, config.rfcRoot, id);
  if (existsSync(directory)) {
    throw new RfcError("RFC_EXISTS", `RFC '${id}' already exists`);
  }
  mkdirSync(directory, { recursive: false });
  try {
    // Close the allocation race: two processes may choose the same numeric
    // prefix with different slugs before either directory exists.
    assertRfcNumberUnique(input.projectDir, config.rfcRoot, id);
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  const now = (input.now ?? new Date()).toISOString();
  const metadata: RfcMetadata = {
    schemaVersion: 1,
    id,
    type,
    status: "draft",
    author: input.author?.trim() || resolveGitAuthor(input.projectDir),
    createdAt: now,
    ...(input.amends ? { amends: input.amends } : {}),
  };
  const sliceId = `S-01-${slug}`;
  writeFileSync(resolve(directory, "rfc.md"), renderRfcTemplate(id, slug, sliceId));
  writeYamlAtomic(resolve(directory, "rfc.yaml"), metadata);
  writeYamlAtomic(resolve(directory, "delivery.yaml"), {
    schemaVersion: 1,
    rfcId: id,
    revision: 0,
    slices: { [sliceId]: { status: "unbound" } },
  } satisfies RfcDelivery);

  // A newly scaffolded RFC deliberately contains placeholders and therefore
  // cannot be loaded as valid until its human author completes it.
  return loadRfcDraftUnchecked(input.projectDir, id);
}

export function createGovernanceRfcDraft(input: {
  projectDir: string;
  slug: string;
  author?: string;
  amends?: string;
}): { rfc: LoadedRfc; worktree: string; branch: string } {
  const projectDir = resolve(input.projectDir);
  const config = loadRfcProjectConfig(projectDir);
  const slug = normalizeSlug(input.slug);
  const id = allocateNextRfcId(projectDir, slug);
  const isolationRoot = loadConfigFromDir(projectDir).isolation?.root ?? ".worktrees";
  const worktree = resolve(projectDir, isolationRoot, `rfc-${id}`);
  const branch = `rfc/${id}`;
  if (existsSync(worktree)) {
    throw new RfcError("RFC_WORKTREE_EXISTS", `Governance worktree already exists: ${worktree}`);
  }
  runGit(projectDir, ["worktree", "add", "-b", branch, worktree, config.integrationBranch]);
  try {
    const rfc = createRfcDraft({ ...input, projectDir: worktree, forcedId: id });
    return { rfc, worktree, branch };
  } catch (error) {
    runGit(projectDir, ["worktree", "remove", "--force", worktree], true);
    runGit(projectDir, ["branch", "-D", branch], true);
    throw error;
  }
}

export function ensureFoundationRfc(input: {
  projectDir: string;
  author?: string;
  now?: Date;
}): LoadedRfc {
  const config = loadRfcProjectConfig(input.projectDir);
  assertRfcNumberUnique(input.projectDir, config.rfcRoot, config.foundation);
  const directory = resolve(input.projectDir, config.rfcRoot, config.foundation);
  if (existsSync(directory)) return loadRfcDraftUnchecked(input.projectDir, config.foundation);
  ensureRfcStandard(input.projectDir);
  mkdirSync(directory, { recursive: true });
  const now = (input.now ?? new Date()).toISOString();
  const metadata: RfcMetadata = {
    schemaVersion: 1,
    id: config.foundation,
    type: "foundation",
    status: "draft",
    author: input.author?.trim() || resolveGitAuthor(input.projectDir),
    createdAt: now,
  };
  const sliceId = "S-01-project-foundation";
  writeFileSync(
    resolve(directory, "rfc.md"),
    renderRfcTemplate(config.foundation, "project-foundation", sliceId)
  );
  writeYamlAtomic(resolve(directory, "rfc.yaml"), metadata);
  writeYamlAtomic(resolve(directory, "delivery.yaml"), {
    schemaVersion: 1,
    rfcId: config.foundation,
    revision: 0,
    slices: { [sliceId]: { status: "unbound" } },
  } satisfies RfcDelivery);
  return loadRfcDraftUnchecked(input.projectDir, config.foundation);
}

export function acceptRfc(input: {
  projectDir: string;
  rfcId: string;
  approver: string;
  humanConfirmed: boolean;
  now?: Date;
}): LoadedRfc {
  if (!input.humanConfirmed) {
    throw new RfcError("RFC_HUMAN_APPROVAL_REQUIRED", "RFC acceptance requires an interactive human confirmation");
  }
  const approver = input.approver.trim();
  if (!approver) {
    throw new RfcError("RFC_APPROVER_REQUIRED", "RFC acceptance requires a non-empty human approver identity");
  }
  return withRfcDeliveryLock(input.projectDir, input.rfcId, () => {
    let targetLock: ReturnType<typeof acquireWorkflowLock> | undefined;
    try {
      const validation = validateRfc(input.projectDir, input.rfcId);
      if (!validation.valid || !validation.rfc) {
        throw new RfcError("RFC_INVALID", validation.issues.map((issue) => issue.message).join("; "));
      }
      const rfc = validation.rfc;
      if (rfc.metadata.status !== "draft") {
        throw new RfcError("RFC_NOT_DRAFT", `RFC '${input.rfcId}' is already ${rfc.metadata.status}`);
      }

      let target: LoadedRfc | undefined;
      let targetDelivery: RfcDelivery | undefined;
      let nextTargetDelivery: RfcDelivery | undefined;
      if (rfc.metadata.type === "amendment" && rfc.metadata.amends) {
        targetLock = acquireWorkflowLock(input.projectDir, `rfc-delivery:${rfc.metadata.amends}`);
        target = loadRfc(input.projectDir, rfc.metadata.amends);
        if (target.metadata.status !== "accepted") {
          throw new RfcError(
            "RFC_AMENDMENT_TARGET_UNACCEPTED",
            `Amendment target '${target.metadata.id}' is not the current accepted RFC`,
          );
        }
        const existingAmendments = findDirectAcceptedAmendments(input.projectDir, target.metadata.id);
        if (existingAmendments.length > 0) {
          throw new RfcError(
            "RFC_AMENDMENT_TARGET_SUPERSEDED",
            `RFC '${target.metadata.id}' already has effective Amendment '${existingAmendments[0]!.metadata.id}'; amend that RFC instead`,
          );
        }
        targetDelivery = loadRfcDelivery(input.projectDir, target.metadata.id);
        const amendmentSlices = new Set(rfc.slices.map((slice) => slice.id));
        const omitted = Object.entries(targetDelivery.slices)
          .filter(([sliceId, slice]) => slice.status !== "archived" && !amendmentSlices.has(sliceId))
          .map(([sliceId]) => sliceId);
        if (omitted.length > 0) {
          throw new RfcError(
            "RFC_AMENDMENT_SLICE_OMITTED",
            `Amendment must retain every undelivered target Slice: ${omitted.join(", ")}`,
          );
        }
        let targetChanged = false;
        const targetSlices = Object.fromEntries(Object.entries(targetDelivery.slices).map(([sliceId, slice]) => {
          if (slice.status !== "unbound") return [sliceId, slice];
          targetChanged = true;
          return [sliceId, {
            status: "superseded" as const,
            supersededBy: { rfcId: rfc.metadata.id, sliceId },
          }];
        }));
        nextTargetDelivery = targetChanged
          ? { ...targetDelivery, revision: targetDelivery.revision + 1, slices: targetSlices }
          : targetDelivery;
      }

      const delivery = loadRfcDelivery(input.projectDir, input.rfcId);
      const nextSlices: Record<string, RfcDeliverySlice> = {};
      for (const slice of rfc.slices) {
        nextSlices[slice.id] = delivery.slices[slice.id] ?? { status: "unbound" };
      }
      const metadata: RfcMetadata = {
        ...rfc.metadata,
        status: "accepted",
        acceptance: {
          approver,
          approvedAt: (input.now ?? new Date()).toISOString(),
          digest: rfc.digest,
        },
      };
      const nextDelivery: RfcDelivery = {
        ...delivery,
        revision: delivery.revision + 1,
        slices: nextSlices,
      };
      const previousMetadata = readFileSync(rfc.metadataPath);
      const previousDelivery = readFileSync(rfc.deliveryPath);
      const previousTargetDelivery = target ? readFileSync(target.deliveryPath) : undefined;
      try {
        writeYamlAtomic(rfc.metadataPath, metadata);
        writeYamlAtomic(rfc.deliveryPath, nextDelivery);
        if (target && nextTargetDelivery && nextTargetDelivery !== targetDelivery) {
          writeYamlAtomic(target.deliveryPath, nextTargetDelivery);
        }
        const accepted = loadRfc(input.projectDir, input.rfcId);
        const finalValidation = validateRfc(input.projectDir, input.rfcId);
        if (!finalValidation.valid) {
          throw new RfcError(
            "RFC_ACCEPT_TRANSACTION_INVALID",
            finalValidation.issues.map((issue) => issue.message).join("; "),
          );
        }
        return accepted;
      } catch (error) {
        try {
          restoreBytesAtomic(rfc.metadataPath, previousMetadata);
          restoreBytesAtomic(rfc.deliveryPath, previousDelivery);
          if (target && previousTargetDelivery) restoreBytesAtomic(target.deliveryPath, previousTargetDelivery);
        } catch (rollbackError) {
          throw new RfcError(
            "RFC_ACCEPT_ROLLBACK_FAILED",
            `RFC acceptance failed and could not be rolled back: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
          );
        }
        throw error;
      }
    } finally {
      if (targetLock) releaseWorkflowLock(targetLock);
    }
  });
}

export function renumberDraftRfc(projectDir: string, rfcId: string): LoadedRfc {
  const rfc = loadRfcDraftUnchecked(projectDir, rfcId);
  if (rfc.metadata.status !== "draft") {
    throw new RfcError("RFC_RENUMBER_ACCEPTED", "Only draft RFCs may be renumbered");
  }
  const slug = RFC_ID_RE.exec(rfcId)?.[2];
  if (!slug) throw new RfcError("RFC_ID_INVALID", `Invalid RFC id '${rfcId}'`);
  const nextId = allocateNextRfcId(projectDir, slug);
  const nextDirectory = resolve(dirname(rfc.directory), nextId);
  renameSync(rfc.directory, nextDirectory);
  try {
    assertRfcNumberUnique(projectDir, loadRfcProjectConfig(projectDir).rfcRoot, nextId);
  } catch (error) {
    renameSync(nextDirectory, rfc.directory);
    throw error;
  }
  const metadata = { ...rfc.metadata, id: nextId };
  writeYamlAtomic(resolve(nextDirectory, "rfc.yaml"), metadata);
  const delivery = parseDelivery(readFileSync(resolve(nextDirectory, "delivery.yaml"), "utf8"), nextId, false);
  writeYamlAtomic(resolve(nextDirectory, "delivery.yaml"), { ...delivery, rfcId: nextId });
  const documentPath = resolve(nextDirectory, "rfc.md");
  writeFileSync(documentPath, readFileSync(documentPath, "utf8").replaceAll(rfcId, nextId));
  return loadRfcDraftUnchecked(projectDir, nextId);
}

export function assertFoundationAccepted(projectDir: string, head = "HEAD"): LoadedRfc {
  const config = loadRfcProjectConfig(projectDir);
  return resolveEffectiveAcceptedRfc(projectDir, config.foundation, head).rfc;
}

export function resolveAcceptedRfcSlice(input: {
  projectDir: string;
  rfcId: string;
  sliceId: string;
  head?: string;
}): ResolvedRfcSlice {
  return resolveAcceptedRfcSliceInternal(input, false);
}

export function resolveAcceptedRfcSliceForAmendmentAdoption(input: {
  projectDir: string;
  rfcId: string;
  sliceId: string;
  head?: string;
}): ResolvedRfcSlice {
  return resolveAcceptedRfcSliceInternal(input, true);
}

function resolveAcceptedRfcSliceInternal(input: {
  projectDir: string;
  rfcId: string;
  sliceId: string;
  head?: string;
}, allowPlannedAncestor: boolean): ResolvedRfcSlice {
  const config = loadRfcProjectConfig(input.projectDir);
  if (input.rfcId !== config.foundation) {
    resolveEffectiveAcceptedRfc(input.projectDir, config.foundation, input.head ?? "HEAD");
  }
  const effective = resolveEffectiveAcceptedRfc(input.projectDir, input.rfcId, input.head ?? "HEAD");
  const slice = effective.rfc.slices.find((candidate) => candidate.id === input.sliceId);
  if (!slice) {
    throw new RfcError("RFC_SLICE_NOT_FOUND", `Effective RFC '${effective.rfc.metadata.id}' has no Slice '${input.sliceId}'`);
  }
  if (!allowPlannedAncestor) {
    assertNoPlannedAmendmentAncestor(input.projectDir, effective.rfc, input.sliceId);
  }
  return { ...effective, slice };
}

export function loadRfcDelivery(projectDir: string, rfcId: string): RfcDelivery {
  const rfc = loadRfcDraftUnchecked(projectDir, rfcId);
  return parseDelivery(readFileSync(rfc.deliveryPath, "utf8"), rfcId, true);
}

export function bindRfcSliceCas(input: {
  projectDir: string;
  rfcId: string;
  sliceId: string;
  expectedRevision: number;
  binding: RfcDeliveryBinding;
}): DeliveryCasResult {
  return withRfcDeliveryLock(input.projectDir, input.rfcId, () => {
    const rfc = loadRfc(input.projectDir, input.rfcId);
    if (rfc.metadata.status !== "accepted") {
      throw new RfcError("RFC_NOT_ACCEPTED", `RFC '${input.rfcId}' is ${rfc.metadata.status}, not accepted`);
    }
    assertNoPlannedAmendmentAncestor(input.projectDir, rfc, input.sliceId);
    if (!rfc.slices.some((slice) => slice.id === input.sliceId)) {
      throw new RfcError("RFC_SLICE_NOT_FOUND", `RFC '${input.rfcId}' has no Slice '${input.sliceId}'`);
    }
    const delivery = loadRfcDelivery(input.projectDir, input.rfcId);
    const existing = delivery.slices[input.sliceId] ?? { status: "unbound" as const };
    if (existing.status !== "unbound") {
      if (existing.status === "planned" && sameBinding(existing.binding, input.binding)) {
        return { delivery, idempotent: true };
      }
      throw new RfcError("RFC_SLICE_BOUND", `RFC Slice '${input.sliceId}' is already ${existing.status}`);
    }
    assertDeliveryRevision(delivery, input.expectedRevision);
    const next: RfcDelivery = {
      ...delivery,
      revision: delivery.revision + 1,
      slices: {
        ...delivery.slices,
        [input.sliceId]: { status: "planned", binding: input.binding },
      },
    };
    writeYamlAtomic(rfc.deliveryPath, next);
    return { delivery: next, idempotent: false };
  });
}

export function adoptRfcAmendmentSliceCas(input: {
  projectDir: string;
  fromRfcId: string;
  toRfcId: string;
  sliceId: string;
  expectedFromRevision: number;
  expectedToRevision: number;
  binding: RfcDeliveryBinding;
}): { from: RfcDelivery; to: RfcDelivery; idempotent: boolean } {
  return withRfcDeliveryLocks(input.projectDir, [input.fromRfcId, input.toRfcId], () => {
    const fromRfc = loadRfc(input.projectDir, input.fromRfcId);
    const toRfc = loadRfc(input.projectDir, input.toRfcId);
    if (toRfc.metadata.type !== "amendment" || toRfc.metadata.amends !== fromRfc.metadata.id) {
      throw new RfcError(
        "RFC_AMENDMENT_TARGET_MISMATCH",
        `RFC '${toRfc.metadata.id}' is not a direct Amendment of '${fromRfc.metadata.id}'`,
      );
    }
    if (toRfc.metadata.status !== "accepted") {
      throw new RfcError("RFC_NOT_ACCEPTED", `Amendment RFC '${toRfc.metadata.id}' is not accepted`);
    }
    if (
      !fromRfc.slices.some((slice) => slice.id === input.sliceId)
      || !toRfc.slices.some((slice) => slice.id === input.sliceId)
    ) {
      throw new RfcError("RFC_SLICE_NOT_FOUND", `Amendment adoption requires retained Slice '${input.sliceId}'`);
    }
    const from = loadRfcDelivery(input.projectDir, fromRfc.metadata.id);
    const to = loadRfcDelivery(input.projectDir, toRfc.metadata.id);
    const fromSlice = from.slices[input.sliceId];
    const toSlice = to.slices[input.sliceId] ?? { status: "unbound" as const };
    const supersededBy = { rfcId: toRfc.metadata.id, sliceId: input.sliceId };
    if (
      fromSlice?.status === "superseded"
      && fromSlice.supersededBy?.rfcId === supersededBy.rfcId
      && fromSlice.supersededBy.sliceId === supersededBy.sliceId
      && toSlice.status === "planned"
      && sameBinding(toSlice.binding, input.binding)
    ) {
      return { from, to, idempotent: true };
    }
    assertDeliveryRevision(from, input.expectedFromRevision);
    assertDeliveryRevision(to, input.expectedToRevision);
    if (fromSlice?.status !== "planned" || !fromSlice.binding || fromSlice.binding.change !== input.binding.change) {
      throw new RfcError(
        "RFC_AMENDMENT_ADOPTION_REQUIRED",
        `Original Slice '${fromRfc.metadata.id}/${input.sliceId}' is not planned by Change '${input.binding.change}'`,
      );
    }
    if (toSlice.status !== "unbound") {
      throw new RfcError("RFC_SLICE_BOUND", `Amendment Slice '${toRfc.metadata.id}/${input.sliceId}' is already ${toSlice.status}`);
    }
    const nextFrom: RfcDelivery = {
      ...from,
      revision: from.revision + 1,
      slices: {
        ...from.slices,
        [input.sliceId]: { ...fromSlice, status: "superseded", supersededBy },
      },
    };
    const nextTo: RfcDelivery = {
      ...to,
      revision: to.revision + 1,
      slices: {
        ...to.slices,
        [input.sliceId]: { status: "planned", binding: input.binding },
      },
    };
    const previousFrom = readFileSync(fromRfc.deliveryPath);
    const previousTo = readFileSync(toRfc.deliveryPath);
    try {
      writeYamlAtomic(fromRfc.deliveryPath, nextFrom);
      writeYamlAtomic(toRfc.deliveryPath, nextTo);
      return { from: nextFrom, to: nextTo, idempotent: false };
    } catch (error) {
      try {
        restoreBytesAtomic(fromRfc.deliveryPath, previousFrom);
        restoreBytesAtomic(toRfc.deliveryPath, previousTo);
      } catch (rollbackError) {
        throw new RfcError(
          "RFC_AMENDMENT_ADOPTION_ROLLBACK_FAILED",
          `Amendment delivery adoption failed and rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
      throw error;
    }
  });
}

export function archiveRfcSliceCas(input: {
  projectDir: string;
  rfcId: string;
  sliceId: string;
  expectedRevision: number;
  evidence: RfcArchiveEvidence;
}): DeliveryCasResult {
  return withRfcDeliveryLock(input.projectDir, input.rfcId, () => {
    const rfc = loadRfc(input.projectDir, input.rfcId);
    const delivery = loadRfcDelivery(input.projectDir, input.rfcId);
    const existing = delivery.slices[input.sliceId];
    if (!existing?.binding) {
      throw new RfcError("RFC_SLICE_UNBOUND", `RFC Slice '${input.sliceId}' is not bound to a Change`);
    }
    if (existing.status === "archived") {
      if (JSON.stringify(existing.archive) === JSON.stringify(input.evidence)) {
        return { delivery, idempotent: true };
      }
      throw new RfcError("RFC_SLICE_ARCHIVE_CONFLICT", `RFC Slice '${input.sliceId}' has different archive evidence`);
    }
    if (existing.status !== "planned") {
      throw new RfcError("RFC_SLICE_NOT_PLANNED", `RFC Slice '${input.sliceId}' is ${existing.status}, not planned`);
    }
    assertDeliveryRevision(delivery, input.expectedRevision);
    const next: RfcDelivery = {
      ...delivery,
      revision: delivery.revision + 1,
      slices: {
        ...delivery.slices,
        [input.sliceId]: { ...existing, status: "archived", archive: input.evidence },
      },
    };
    writeYamlAtomic(rfc.deliveryPath, next);
    return { delivery: next, idempotent: false };
  });
}

export function ensureRfcStandard(projectDir: string): string {
  const config = loadRfcProjectConfig(projectDir);
  const root = resolve(projectDir, config.rfcRoot);
  mkdirSync(root, { recursive: true });
  const standardPath = resolve(root, "README.md");
  if (!existsSync(standardPath)) {
    writeFileSync(standardPath, RFC_STANDARD);
  }
  return standardPath;
}

function resolveEffectiveAcceptedRfc(
  projectDir: string,
  rfcId: string,
  head: string,
): Omit<ResolvedRfcSlice, "slice"> {
  const config = loadRfcProjectConfig(projectDir);
  const rfc = resolveLatestAcceptedRfc(projectDir, rfcId);
  if (rfc.metadata.status !== "accepted") {
    throw new RfcError("RFC_NOT_ACCEPTED", `RFC '${rfc.metadata.id}' is ${rfc.metadata.status}, not accepted`);
  }
  const integrationCommit = runGit(projectDir, ["rev-parse", "--verify", config.integrationBranch]);
  const relativeDocument = gitRelativePath(projectDir, rfc.documentPath);
  const relativeMetadata = gitRelativePath(projectDir, rfc.metadataPath);
  const acceptedCommit = runGit(projectDir, [
    "log",
    "-n",
    "1",
    "--format=%H",
    integrationCommit,
    "--",
    relativeDocument,
    relativeMetadata,
  ]);
  if (!acceptedCommit || !gitIsAncestor(projectDir, acceptedCommit, head)) {
    throw new RfcError(
      "RFC_ACCEPTED_COMMIT_MISSING",
      `Accepted RFC '${rfcId}' is not merged into '${config.integrationBranch}' and reachable from '${head}'`,
    );
  }
  const branchDocument = runGitRaw(projectDir, ["show", `${acceptedCommit}:${relativeDocument}`]);
  const branchMetadata = parseMetadata(
    runGitRaw(projectDir, ["show", `${acceptedCommit}:${relativeMetadata}`]),
    rfc.metadata.id,
  );
  const branchDigest = computeRfcDigest(branchDocument);
  if (
    branchMetadata.status !== "accepted" ||
    branchMetadata.type !== rfc.metadata.type ||
    branchMetadata.author !== rfc.metadata.author ||
    branchMetadata.amends !== rfc.metadata.amends ||
    !sameAcceptance(branchMetadata.acceptance, rfc.metadata.acceptance) ||
    branchMetadata.acceptance?.digest !== branchDigest ||
    branchDigest !== rfc.digest
  ) {
    throw new RfcError(
      "RFC_NOT_EFFECTIVE",
      `Accepted RFC '${rfcId}' is not present unchanged on integration branch '${config.integrationBranch}'`
    );
  }
  return { rfc, acceptedCommit, integrationBranch: config.integrationBranch };
}

function resolveLatestAcceptedRfc(projectDir: string, rfcId: string): LoadedRfc {
  const seen = new Set<string>();
  let current = loadRfc(projectDir, rfcId);
  while (true) {
    if (seen.has(current.metadata.id)) {
      throw new RfcError("RFC_AMENDMENT_CYCLE", `RFC Amendment lineage contains a cycle at '${current.metadata.id}'`);
    }
    seen.add(current.metadata.id);
    const amendments = findDirectAcceptedAmendments(projectDir, current.metadata.id);
    if (amendments.length > 1) {
      throw new RfcError(
        "RFC_AMENDMENT_AMBIGUOUS",
        `RFC '${current.metadata.id}' has multiple accepted direct Amendments: ${amendments.map((item) => item.metadata.id).join(", ")}`,
      );
    }
    if (amendments.length === 0) return current;
    current = amendments[0]!;
  }
}

function findDirectAcceptedAmendments(projectDir: string, targetRfcId: string): LoadedRfc[] {
  return listRfcs(projectDir).flatMap((candidateId) => {
    if (candidateId === targetRfcId) return [];
    const candidate = loadRfcDraftUnchecked(projectDir, candidateId);
    if (
      candidate.metadata.type !== "amendment"
      || candidate.metadata.amends !== targetRfcId
      || (candidate.metadata.status !== "accepted" && candidate.metadata.status !== "superseded")
    ) return [];
    return [loadRfc(projectDir, candidateId)];
  });
}

function assertNoPlannedAmendmentAncestor(projectDir: string, rfc: LoadedRfc, sliceId: string): void {
  let current = rfc;
  const seen = new Set<string>();
  while (current.metadata.type === "amendment" && current.metadata.amends) {
    if (seen.has(current.metadata.id)) {
      throw new RfcError("RFC_AMENDMENT_CYCLE", `RFC Amendment lineage contains a cycle at '${current.metadata.id}'`);
    }
    seen.add(current.metadata.id);
    const target = loadRfc(projectDir, current.metadata.amends);
    const targetSlice = loadRfcDelivery(projectDir, target.metadata.id).slices[sliceId];
    if (targetSlice?.status === "planned") {
      throw new RfcError(
        "RFC_AMENDMENT_ADOPTION_REQUIRED",
        `Slice '${target.metadata.id}/${sliceId}' is already planned; its existing Change must adopt '${rfc.metadata.id}'`,
      );
    }
    current = target;
  }
}

function sameAcceptance(left: RfcAcceptance | undefined, right: RfcAcceptance | undefined): boolean {
  return left?.approver === right?.approver
    && left?.approvedAt === right?.approvedAt
    && left?.digest === right?.digest;
}

function markdownSections(markdown: string): Map<string, string> {
  const headings = Array.from(markdown.matchAll(/^##\s+(.+?)\s*$/gm));
  const sections = new Map<string, string>();
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    const name = heading[1]!.trim().toLowerCase();
    if (sections.has(name)) {
      throw new RfcError("RFC_SECTION_DUPLICATE", `RFC section '## ${heading[1]}' is duplicated`);
    }
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    sections.set(name, markdown.slice(start, end));
  }
  return sections;
}

function parseMetadata(content: string, expectedId: string): RfcMetadata {
  let raw: unknown;
  try {
    raw = yaml.load(content);
  } catch (error) {
    throw new RfcError("RFC_METADATA_INVALID", `Invalid rfc.yaml: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isMapping(raw)) throw new RfcError("RFC_METADATA_INVALID", "rfc.yaml must be a mapping");
  if (raw.schemaVersion !== 1) throw new RfcError("RFC_METADATA_VERSION", "rfc.yaml schemaVersion must be 1");
  if (raw.id !== expectedId) throw new RfcError("RFC_METADATA_ID", `rfc.yaml id must be '${expectedId}'`);
  if (!isRfcType(raw.type)) throw new RfcError("RFC_METADATA_TYPE", "rfc.yaml type must be foundation, feature, or amendment");
  if (!isRfcStatus(raw.status)) throw new RfcError("RFC_METADATA_STATUS", "rfc.yaml status must be draft, accepted, or superseded");
  if (typeof raw.author !== "string" || !raw.author.trim()) throw new RfcError("RFC_METADATA_AUTHOR", "rfc.yaml author is required");
  if (!isIsoDate(raw.createdAt)) throw new RfcError("RFC_METADATA_DATE", "rfc.yaml createdAt must be an ISO timestamp");
  if (raw.type === "foundation" && expectedId !== DEFAULT_FOUNDATION_RFC) {
    throw new RfcError("RFC_FOUNDATION_ID", `Foundation RFC must be '${DEFAULT_FOUNDATION_RFC}'`);
  }
  if (raw.type === "amendment" && (typeof raw.amends !== "string" || !RFC_ID_RE.test(raw.amends))) {
    throw new RfcError("RFC_AMENDMENT_TARGET", "Amendment RFC must identify a valid 'amends' RFC id");
  }
  let acceptance: RfcAcceptance | undefined;
  if (raw.acceptance !== undefined) {
    if (!isMapping(raw.acceptance)) throw new RfcError("RFC_ACCEPTANCE_INVALID", "rfc.yaml acceptance must be a mapping");
    if (typeof raw.acceptance.approver !== "string" || !raw.acceptance.approver.trim()) {
      throw new RfcError("RFC_ACCEPTANCE_APPROVER", "rfc.yaml acceptance.approver is required");
    }
    if (!isIsoDate(raw.acceptance.approvedAt)) throw new RfcError("RFC_ACCEPTANCE_DATE", "rfc.yaml acceptance.approvedAt must be an ISO timestamp");
    if (typeof raw.acceptance.digest !== "string" || !/^[a-f0-9]{64}$/.test(raw.acceptance.digest)) {
      throw new RfcError("RFC_ACCEPTANCE_DIGEST", "rfc.yaml acceptance.digest must be a SHA-256 digest");
    }
    acceptance = {
      approver: raw.acceptance.approver.trim(),
      approvedAt: raw.acceptance.approvedAt,
      digest: raw.acceptance.digest,
    };
  }
  if ((raw.status === "accepted" || raw.status === "superseded") && !acceptance) {
    throw new RfcError("RFC_ACCEPTANCE_MISSING", `RFC status '${raw.status}' requires acceptance metadata`);
  }
  if (raw.status === "draft" && acceptance) {
    throw new RfcError("RFC_DRAFT_ACCEPTANCE", "Draft RFC must not contain acceptance metadata");
  }
  return {
    schemaVersion: 1,
    id: expectedId,
    type: raw.type,
    status: raw.status,
    author: raw.author.trim(),
    createdAt: raw.createdAt,
    ...(typeof raw.amends === "string" ? { amends: raw.amends } : {}),
    ...(acceptance ? { acceptance } : {}),
  };
}

function parseDelivery(content: string, expectedId: string, enforceId: boolean): RfcDelivery {
  let raw: unknown;
  try {
    raw = yaml.load(content);
  } catch (error) {
    throw new RfcError("RFC_DELIVERY_INVALID", `Invalid delivery.yaml: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isMapping(raw) || raw.schemaVersion !== 1 || typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision) || raw.revision < 0) {
    throw new RfcError("RFC_DELIVERY_INVALID", "delivery.yaml requires schemaVersion 1 and a non-negative integer revision");
  }
  if (typeof raw.rfcId !== "string" || (enforceId && raw.rfcId !== expectedId)) {
    throw new RfcError("RFC_DELIVERY_ID", `delivery.yaml rfcId must be '${expectedId}'`);
  }
  if (!isMapping(raw.slices)) throw new RfcError("RFC_DELIVERY_SLICES", "delivery.yaml slices must be a mapping");
  const slices: Record<string, RfcDeliverySlice> = {};
  for (const [sliceId, value] of Object.entries(raw.slices)) {
    if (!SLICE_ID_RE.test(sliceId) || !isMapping(value) || !["unbound", "planned", "superseded", "archived"].includes(String(value.status))) {
      throw new RfcError("RFC_DELIVERY_SLICE_INVALID", `Invalid delivery entry '${sliceId}'`);
    }
    const status = value.status as RfcDeliveryStatus;
    const binding = parseBinding(value.binding, status);
    const archive = parseArchiveEvidence(value.archive, status);
    const supersededBy = parseSupersededBy(value.supersededBy, status);
    slices[sliceId] = {
      status,
      ...(binding ? { binding } : {}),
      ...(archive ? { archive } : {}),
      ...(supersededBy ? { supersededBy } : {}),
    };
  }
  return { schemaVersion: 1, rfcId: raw.rfcId, revision: raw.revision, slices };
}

function parseBinding(value: unknown, status: RfcDeliveryStatus): RfcDeliveryBinding | undefined {
  if (status === "unbound") {
    if (value !== undefined) throw new RfcError("RFC_DELIVERY_BINDING", "Unbound Slice must not contain a binding");
    return undefined;
  }
  if (status === "superseded" && value === undefined) return undefined;
  if (!isMapping(value) || typeof value.change !== "string" || typeof value.sourceDigest !== "string" || !isIsoDate(value.plannedAt)) {
    throw new RfcError("RFC_DELIVERY_BINDING", `${status} Slice requires a valid binding`);
  }
  let issue: RfcDeliveryBinding["issue"];
  if (value.issue !== undefined) {
    if (!isMapping(value.issue) || !["github", "gitlab", "none"].includes(String(value.issue.provider))) {
      throw new RfcError("RFC_DELIVERY_ISSUE", "Delivery binding issue is invalid");
    }
    issue = {
      provider: value.issue.provider as "github" | "gitlab" | "none",
      ...(typeof value.issue.id === "string" ? { id: value.issue.id } : {}),
      ...(typeof value.issue.url === "string" ? { url: value.issue.url } : {}),
    };
  }
  return { change: value.change, sourceDigest: value.sourceDigest, plannedAt: value.plannedAt, ...(issue ? { issue } : {}) };
}

function parseSupersededBy(
  value: unknown,
  status: RfcDeliveryStatus,
): RfcDeliverySlice["supersededBy"] | undefined {
  if (status !== "superseded") {
    if (value !== undefined) {
      throw new RfcError("RFC_DELIVERY_SUPERSEDED", "Only superseded Slice may contain supersededBy");
    }
    return undefined;
  }
  if (
    !isMapping(value)
    || typeof value.rfcId !== "string"
    || !RFC_ID_RE.test(value.rfcId)
    || typeof value.sliceId !== "string"
    || !SLICE_ID_RE.test(value.sliceId)
  ) {
    throw new RfcError("RFC_DELIVERY_SUPERSEDED", "Superseded Slice requires a valid supersededBy binding");
  }
  return { rfcId: value.rfcId, sliceId: value.sliceId };
}

function parseArchiveEvidence(value: unknown, status: RfcDeliveryStatus): RfcArchiveEvidence | undefined {
  if (status !== "archived") {
    if (value !== undefined) throw new RfcError("RFC_DELIVERY_ARCHIVE", "Only archived Slice may contain archive evidence");
    return undefined;
  }
  if (!isMapping(value) || !isIsoDate(value.archivedAt) || typeof value.commit !== "string" || typeof value.evidenceManifest !== "string") {
    throw new RfcError("RFC_DELIVERY_ARCHIVE", "Archived Slice requires valid archive evidence");
  }
  return { archivedAt: value.archivedAt, commit: value.commit, evidenceManifest: value.evidenceManifest };
}

function withRfcDeliveryLock<T>(projectDir: string, rfcId: string, action: () => T): T {
  const lock = acquireWorkflowLock(projectDir, `rfc-delivery:${rfcId}`);
  try {
    return action();
  } finally {
    releaseWorkflowLock(lock);
  }
}

function withRfcDeliveryLocks<T>(projectDir: string, rfcIds: string[], action: () => T): T {
  const ids = [...new Set(rfcIds)].sort();
  const locks: Array<ReturnType<typeof acquireWorkflowLock>> = [];
  try {
    for (const rfcId of ids) {
      locks.push(acquireWorkflowLock(projectDir, `rfc-delivery:${rfcId}`));
    }
    return action();
  } finally {
    for (const lock of locks.reverse()) releaseWorkflowLock(lock);
  }
}

function loadRfcDraftUnchecked(projectDir: string, rfcId: string): LoadedRfc {
  assertRfcId(rfcId);
  const project = resolve(projectDir);
  const config = loadRfcProjectConfig(project);
  assertRfcNumberUnique(project, config.rfcRoot, rfcId);
  const directory = resolve(project, config.rfcRoot, rfcId);
  const documentPath = resolve(directory, "rfc.md");
  const metadataPath = resolve(directory, "rfc.yaml");
  const deliveryPath = resolve(directory, "delivery.yaml");
  assertRegularFile(documentPath, "RFC_DOCUMENT_MISSING");
  assertRegularFile(metadataPath, "RFC_METADATA_MISSING");
  assertRegularFile(deliveryPath, "RFC_DELIVERY_MISSING");
  const document = readFileSync(documentPath, "utf8");
  return {
    projectDir: project,
    directory,
    documentPath,
    metadataPath,
    deliveryPath,
    document,
    digest: computeRfcDigest(document),
    metadata: parseMetadata(readFileSync(metadataPath, "utf8"), rfcId),
    slices: tryParseDraftSlices(document),
  };
}

function tryParseDraftSlices(document: string): RfcSlice[] {
  try {
    return parseRfcDocument(document);
  } catch {
    const ids = Array.from(document.matchAll(/^###\s+(S-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*)/gm)).map((match) => match[1]!);
    return ids.map((id) => ({ id, title: id, acceptanceCriteria: [] }));
  }
}

function loadRfcProjectConfig(projectDir: string): RfcProjectConfig {
  const config = loadConfigFromDir(projectDir);
  if (config.corgi?.contract !== RFC_CONTRACT) {
    throw new RfcError("RFC_CONTRACT_REQUIRED", "Project is not on the Corgi RFC v1 contract; run 'corgispec bootstrap --migrate-v4'");
  }
  return {
    config,
    rfcRoot: config.corgi.rfcRoot!,
    foundation: config.corgi.foundation!,
    integrationBranch: config.corgi.governance!.integrationBranch,
  };
}

function allocateNextRfcId(projectDir: string, slug: string): string {
  const numbers = listRfcs(projectDir)
    .map((id) => Number(RFC_ID_RE.exec(id)?.[1] ?? 0));
  const next = Math.max(0, ...numbers) + 1;
  if (next > 9999) throw new RfcError("RFC_ID_EXHAUSTED", "RFC numeric id space is exhausted");
  return `RFC-${String(next).padStart(4, "0")}-${slug}`;
}

function assertRfcNumberUnique(projectDir: string, rfcRoot: string, rfcId: string): void {
  const number = RFC_ID_RE.exec(rfcId)?.[1];
  if (!number) return;
  const root = resolve(projectDir, rfcRoot);
  if (!existsSync(root)) return;
  assertDirectoryNotSymlink(root, "RFC_ROOT_SYMLINK");
  const conflict = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== rfcId)
    .map((entry) => ({ id: entry.name, match: RFC_ID_RE.exec(entry.name) }))
    .find((entry) => entry.match?.[1] === number);
  if (conflict) {
    throw new RfcError(
      "RFC_NUMBER_CONFLICT",
      `RFC numeric prefix '${number}' is shared by '${rfcId}' and '${conflict.id}'`,
    );
  }
}

function assertUniqueRfcNumbers(ids: string[]): void {
  const seen = new Map<string, string>();
  for (const id of ids) {
    const number = RFC_ID_RE.exec(id)?.[1];
    if (!number) continue;
    const existing = seen.get(number);
    if (existing) {
      throw new RfcError(
        "RFC_NUMBER_CONFLICT",
        `RFC numeric prefix '${number}' is shared by '${existing}' and '${id}'`,
      );
    }
    seen.set(number, id);
  }
}

function normalizeSlug(slug: string): string {
  const value = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new RfcError("RFC_SLUG_INVALID", "RFC slug must use lowercase semantic kebab-case");
  }
  return value;
}

function assertRfcId(id: string): void {
  if (!RFC_ID_RE.test(id)) throw new RfcError("RFC_ID_INVALID", `Invalid RFC id '${id}'`);
}

function assertDeliveryRevision(delivery: RfcDelivery, expectedRevision: number): void {
  if (delivery.revision !== expectedRevision) {
    throw new RfcError(
      "RFC_DELIVERY_CAS",
      `delivery.yaml revision changed: expected ${expectedRevision}, found ${delivery.revision}`
    );
  }
}

function sameBinding(left: RfcDeliveryBinding | undefined, right: RfcDeliveryBinding): boolean {
  return left !== undefined
    && left.change === right.change
    && left.sourceDigest === right.sourceDigest
    && left.issue?.provider === right.issue?.provider
    && left.issue?.id === right.issue?.id
    && left.issue?.url === right.issue?.url;
}

function writeYamlAtomic(path: string, value: unknown): void {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, yaml.dump(value, { noRefs: true, lineWidth: 100, sortKeys: false }), { flag: "wx" });
  try {
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function restoreBytesAtomic(path: string, value: Uint8Array): void {
  const temporary = `${path}.restore-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, value, { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function renderRfcTemplate(id: string, slug: string, sliceId: string): string {
  return `# ${id}: ${slug}\n\n## Goal\n\nTODO: State the user-visible outcome.\n\n## Non-goals\n\nTODO: State what this RFC deliberately excludes.\n\n## Boundary\n\nTODO: Define the public, data, security, and compatibility boundaries.\n\n## Slices\n\n### ${sliceId}: First delivery slice\n\n- AC-001 [evidence: both]: TODO: Define an observable acceptance criterion.\n\n## Risks\n\nTODO: Record material risks and mitigations.\n`;
}

function resolveGitAuthor(projectDir: string): string {
  const configured = runGit(projectDir, ["config", "user.email"], true);
  return configured || process.env["USER"] || process.env["USERNAME"] || "unknown-author";
}

function gitRelativePath(projectDir: string, path: string): string {
  const top = runGit(projectDir, ["rev-parse", "--show-toplevel"]);
  const result = relative(top, path).replace(/\\/g, "/");
  if (result.startsWith("../") || result === "..") {
    throw new RfcError("RFC_PATH_OUTSIDE_REPO", `RFC path is outside git repository: ${path}`);
  }
  return result;
}

function gitIsAncestor(projectDir: string, ancestor: string, descendant: string): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: projectDir,
    encoding: "utf8",
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new RfcError("RFC_GIT_FAILED", result.stderr.trim() || "git merge-base failed");
}

function runGit(projectDir: string, args: string[], allowFailure = false): string {
  const result = spawnSync("git", args, { cwd: projectDir, encoding: "utf8" });
  if (result.status !== 0) {
    if (allowFailure) return "";
    throw new RfcError("RFC_GIT_FAILED", result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function runGitRaw(projectDir: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: projectDir, encoding: "utf8" });
  if (result.status !== 0) {
    throw new RfcError("RFC_GIT_FAILED", result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function assertRegularFile(path: string, code: string): void {
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    throw new RfcError(code, `Required RFC file is missing or unsafe: ${path}`);
  }
}

function assertDirectoryNotSymlink(path: string, code: string): void {
  if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) {
    throw new RfcError(code, `RFC directory is unsafe: ${path}`);
  }
}

function assertPathWithin(root: string, candidate: string): void {
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || rel.startsWith("/") || rel === "") {
    if (rel !== "") throw new RfcError("RFC_PATH_ESCAPE", `RFC path escapes configured root: ${candidate}`);
  }
}

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRfcType(value: unknown): value is RfcType {
  return value === "foundation" || value === "feature" || value === "amendment";
}

function isRfcStatus(value: unknown): value is RfcStatus {
  return value === "draft" || value === "accepted" || value === "superseded";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
}

const RFC_STANDARD = `# Corgi RFC Standard\n\nRFCs are human-authored governance records. Feature, contract, boundary, data, security, compatibility, and migration changes require an accepted RFC.\n\n## Lifecycle\n\n1. Create a draft in a governance worktree.\n2. Complete Goal, Non-goals, Boundary, Slices, acceptance criteria, evidence requirements, and Risks.\n3. Validate and explicitly accept it as a human reviewer.\n4. Commit and merge the accepted RFC into the configured integration branch.\n5. Use one unbound Slice to create one Change and one tracker Issue.\n\nAccepted normative content is immutable. Use a new amendment RFC for semantic changes.\n\n## IDs\n\n- RFC: \`RFC-0001-semantic-slug\`\n- Slice: \`S-01-semantic-slug\`\n- Acceptance criterion: \`AC-001\`\n- Criterion format: \`- AC-001 [evidence: automated|human|both]: observable outcome\`\n`;
