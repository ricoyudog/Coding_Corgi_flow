import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import * as yaml from "js-yaml";
import type { TrackingProvider } from "./config.js";
import type { OpenSpecArtifactPath } from "./openspec-adapter.js";
import type { ParsedTaskGroup } from "./task-groups.js";

export const CHANGE_CONTRACT_SCHEMA_VERSION = 1 as const;
export const SOURCE_RELATIVE_PATH = "corgi/source.yaml";
export const TRACEABILITY_RELATIVE_PATH = "corgi/traceability.yaml";

export type EvidenceRequirement = "automated" | "human" | "both";
export type MaintenanceCategory =
  | "docs-only"
  | "test-only"
  | "internal-refactor"
  | "dependency-maintenance"
  | "contract-bug";

export interface ContractAcceptance {
  id: string;
  evidence: EvidenceRequirement;
}

export interface TrackerBinding {
  provider: TrackingProvider;
  idempotencyKey: string;
  issue?: {
    id: string;
    url: string;
  };
}

export interface RfcSliceSource {
  schemaVersion: typeof CHANGE_CONTRACT_SCHEMA_VERSION;
  kind: "rfc-slice";
  deliveryRef: string;
  rfc: {
    id: string;
    path: string;
    acceptedCommit: string;
    digest: string;
  };
  slice: {
    id: string;
    digest: string;
  };
  acceptance: ContractAcceptance[];
  deliveryBindingDigest: string;
  tracker: TrackerBinding;
}

export interface MaintenanceSource {
  schemaVersion: typeof CHANGE_CONTRACT_SCHEMA_VERSION;
  kind: "maintenance";
  deliveryRef: string;
  maintenance: {
    category: MaintenanceCategory;
    description: string;
    reason: string;
    boundary: string;
    contractRefs: string[];
  };
  acceptance: ContractAcceptance[];
  tracker: TrackerBinding;
}

export type ChangeSource = RfcSliceSource | MaintenanceSource;

export interface TraceabilityPlanningRef {
  path: string;
  anchor?: string;
}

export interface TraceabilityEntry {
  id: string;
  evidence: EvidenceRequirement;
  planningRefs: TraceabilityPlanningRef[];
  taskGroups: string[];
}

export interface ChangeTraceability {
  schemaVersion: typeof CHANGE_CONTRACT_SCHEMA_VERSION;
  sourceDigest: string;
  acceptance: TraceabilityEntry[];
}

export interface LoadedChangeContract {
  sourcePath: string;
  traceabilityPath: string;
  source: ChangeSource;
  traceability: ChangeTraceability;
  sourceDigest: string;
  traceabilityDigest: string;
}

export interface ContractSummary {
  /** Version of this stable public contract summary, not the enclosing command. */
  schemaVersion: typeof CHANGE_CONTRACT_SCHEMA_VERSION;
  /** Paths are repository-relative, normalized to POSIX separators. */
  pathConvention: "project-relative-posix";
  kind: ChangeSource["kind"];
  deliveryRef: string;
  rfcId: string | null;
  rfcDigest: string | null;
  acceptedCommit: string | null;
  sliceId: string | null;
  acceptanceIds: string[];
  sourcePath: string;
  sourceDigest: string;
  traceabilityPath: string;
  traceabilityDigest: string;
  tracker: {
    provider: TrackingProvider;
    idempotencyKey: string;
    issue: { id: string; url: string } | null;
  };
}

export class ChangeContractError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly paths: string[] = [],
  ) {
    super(message);
    this.name = "ChangeContractError";
  }
}

export function changeContractPaths(changeRoot: string): {
  sourcePath: string;
  traceabilityPath: string;
} {
  return {
    sourcePath: resolve(changeRoot, SOURCE_RELATIVE_PATH),
    traceabilityPath: resolve(changeRoot, TRACEABILITY_RELATIVE_PATH),
  };
}

export function loadChangeContract(
  changeRoot: string,
  options: { required?: boolean } = {},
): LoadedChangeContract | null {
  const paths = changeContractPaths(changeRoot);
  const hasSource = existsSync(paths.sourcePath);
  const hasTraceability = existsSync(paths.traceabilityPath);
  if (!hasSource && !hasTraceability && !options.required) return null;
  if (!hasSource || !hasTraceability) {
    throw new ChangeContractError(
      "Change contract requires both corgi/source.yaml and corgi/traceability.yaml",
      "CHANGE_CONTRACT_INCOMPLETE",
      [paths.sourcePath, paths.traceabilityPath],
    );
  }

  const sourceBytes = readFileSync(paths.sourcePath);
  const traceabilityBytes = readFileSync(paths.traceabilityPath);
  const source = parseSource(sourceBytes.toString("utf8"), paths.sourcePath);
  const traceability = parseTraceability(
    traceabilityBytes.toString("utf8"),
    paths.traceabilityPath,
  );
  const sourceDigest = digestBytes(sourceBytes);
  if (traceability.sourceDigest !== sourceDigest) {
    throw new ChangeContractError(
      "traceability.yaml sourceDigest does not match source.yaml",
      "SOURCE_DIGEST_MISMATCH",
      [paths.sourcePath, paths.traceabilityPath],
    );
  }
  return {
    ...paths,
    source,
    traceability,
    sourceDigest,
    traceabilityDigest: digestBytes(traceabilityBytes),
  };
}

/**
 * Public contract summaries deliberately use repository-relative paths. This
 * makes status, ready, and lifecycle output comparable across worktrees.
 */
export function summarizeChangeContract(
  contract: LoadedChangeContract,
  projectRoot: string,
): ContractSummary {
  const rfc = contract.source.kind === "rfc-slice" ? contract.source.rfc : null;
  const slice = contract.source.kind === "rfc-slice" ? contract.source.slice : null;
  return {
    schemaVersion: CHANGE_CONTRACT_SCHEMA_VERSION,
    pathConvention: "project-relative-posix",
    kind: contract.source.kind,
    deliveryRef: contract.source.deliveryRef,
    rfcId: rfc?.id ?? null,
    rfcDigest: rfc?.digest ?? null,
    acceptedCommit: rfc?.acceptedCommit ?? null,
    sliceId: slice?.id ?? null,
    acceptanceIds: contract.source.acceptance.map((item) => item.id).sort(),
    sourcePath: projectRelativePath(projectRoot, contract.sourcePath),
    sourceDigest: contract.sourceDigest,
    traceabilityPath: projectRelativePath(projectRoot, contract.traceabilityPath),
    traceabilityDigest: contract.traceabilityDigest,
    tracker: summarizeTrackerBinding(contract.source.tracker),
  };
}

export function summarizeTrackerBinding(tracker: TrackerBinding): ContractSummary["tracker"] {
  return {
    provider: tracker.provider,
    idempotencyKey: tracker.idempotencyKey,
    issue: tracker.issue ? { ...tracker.issue } : null,
  };
}

export function writeChangeSource(changeRoot: string, source: ChangeSource): string {
  validateSource(source, SOURCE_RELATIVE_PATH);
  const { sourcePath } = changeContractPaths(changeRoot);
  atomicWriteYaml(sourcePath, source);
  return digestBytes(readFileSync(sourcePath));
}

export function writeChangeTraceability(
  changeRoot: string,
  traceability: ChangeTraceability,
): string {
  validateTraceabilityShape(traceability, TRACEABILITY_RELATIVE_PATH);
  const { traceabilityPath } = changeContractPaths(changeRoot);
  atomicWriteYaml(traceabilityPath, traceability);
  return digestBytes(readFileSync(traceabilityPath));
}

export function validateChangeTraceability(
  contract: LoadedChangeContract,
  changeRoot: string,
  artifactPaths: Record<string, OpenSpecArtifactPath>,
  taskGroups: ParsedTaskGroup[],
): ChangeContractError[] {
  const failures: ChangeContractError[] = [];
  const expected = new Map(
    contract.source.acceptance.map((entry) => [entry.id, entry.evidence]),
  );
  const seen = new Set<string>();
  const artifactFiles = new Map(
    Object.values(artifactPaths)
      .flatMap((artifact) => artifact.existingOutputPaths)
      .map((filePath) => [portableRelative(changeRoot, filePath), filePath] as const),
  );
  const groupIds = new Set(taskGroups.map((group) => String(group.number)));

  for (const entry of contract.traceability.acceptance) {
    if (seen.has(entry.id)) {
      failures.push(new ChangeContractError(
        `Acceptance '${entry.id}' appears more than once in traceability.yaml`,
        "TRACEABILITY_DUPLICATE_ACCEPTANCE",
        [contract.traceabilityPath],
      ));
      continue;
    }
    seen.add(entry.id);
    const requiredEvidence = expected.get(entry.id);
    if (!requiredEvidence) {
      failures.push(new ChangeContractError(
        `Traceability references unknown acceptance '${entry.id}'`,
        "TRACEABILITY_UNKNOWN_ACCEPTANCE",
        [contract.traceabilityPath],
      ));
    } else if (requiredEvidence !== entry.evidence) {
      failures.push(new ChangeContractError(
        `Evidence requirement for '${entry.id}' must be '${requiredEvidence}'`,
        "TRACEABILITY_EVIDENCE_MISMATCH",
        [contract.traceabilityPath],
      ));
    }
    if (entry.planningRefs.length === 0) {
      failures.push(new ChangeContractError(
        `Acceptance '${entry.id}' has no planning artifact reference`,
        "TRACEABILITY_MISSING_PLANNING_REF",
        [contract.traceabilityPath],
      ));
    }
    if (entry.taskGroups.length === 0) {
      failures.push(new ChangeContractError(
        `Acceptance '${entry.id}' has no Task Group assignment`,
        "TRACEABILITY_MISSING_TASK_GROUP",
        [contract.traceabilityPath],
      ));
    }
    const seenPlanningRefs = new Set<string>();
    for (const planningRef of entry.planningRefs) {
      const normalized = planningRef.path.replace(/\\/g, "/").replace(/^\.\//, "");
      const refKey = `${normalized}#${planningRef.anchor?.trim() ?? ""}`;
      if (seenPlanningRefs.has(refKey)) {
        failures.push(new ChangeContractError(
          `Planning reference '${refKey}' for '${entry.id}' is duplicated`,
          "TRACEABILITY_DUPLICATE_PLANNING_REF",
          [contract.traceabilityPath],
        ));
        continue;
      }
      seenPlanningRefs.add(refKey);
      const artifactPath = artifactFiles.get(normalized);
      if (!artifactPath) {
        failures.push(new ChangeContractError(
          `Planning reference '${planningRef.path}' for '${entry.id}' is not an OpenSpec artifact`,
          "TRACEABILITY_UNKNOWN_PLANNING_REF",
          [contract.traceabilityPath],
        ));
      } else if (
        planningRef.anchor
        && !planningArtifactHasAnchor(readFileSync(artifactPath, "utf8"), planningRef.anchor)
      ) {
        failures.push(new ChangeContractError(
          `Planning anchor '${planningRef.anchor}' for '${entry.id}' does not exist in '${planningRef.path}'`,
          "TRACEABILITY_UNKNOWN_PLANNING_ANCHOR",
          [contract.traceabilityPath, artifactPath],
        ));
      }
    }
    const seenTaskGroups = new Set<string>();
    for (const groupId of entry.taskGroups) {
      if (seenTaskGroups.has(groupId)) {
        failures.push(new ChangeContractError(
          `Task Group '${groupId}' for '${entry.id}' is duplicated`,
          "TRACEABILITY_DUPLICATE_TASK_GROUP",
          [contract.traceabilityPath],
        ));
        continue;
      }
      seenTaskGroups.add(groupId);
      if (!groupIds.has(groupId)) {
        failures.push(new ChangeContractError(
          `Task Group '${groupId}' for '${entry.id}' does not exist`,
          "TRACEABILITY_UNKNOWN_TASK_GROUP",
          [contract.traceabilityPath],
        ));
      }
    }
  }
  for (const id of expected.keys()) {
    if (!seen.has(id)) {
      failures.push(new ChangeContractError(
        `Acceptance '${id}' is missing from traceability.yaml`,
        "TRACEABILITY_MISSING_ACCEPTANCE",
        [contract.traceabilityPath],
      ));
    }
  }
  return failures;
}

export function createInitialTraceability(
  source: ChangeSource,
  sourceDigest: string,
): ChangeTraceability {
  return {
    schemaVersion: CHANGE_CONTRACT_SCHEMA_VERSION,
    sourceDigest,
    acceptance: source.acceptance.map((entry) => ({
      id: entry.id,
      evidence: entry.evidence,
      planningRefs: [],
      taskGroups: [],
    })),
  };
}

export function digestValue(value: unknown): string {
  return digestBytes(Buffer.from(stableStringify(value), "utf8"));
}

/** Digest the immutable identity of one RFC Slice delivery binding. */
export function computeDeliveryBindingDigest(input: {
  rfcId: string;
  sliceId: string;
  change: string;
  issue: {
    provider: TrackingProvider;
    id?: string;
    url?: string;
  };
}): string {
  return digestValue({
    schemaVersion: 1,
    rfcId: input.rfcId,
    sliceId: input.sliceId,
    change: input.change,
    issue: {
      provider: input.issue.provider,
      ...(input.issue.id ? { id: input.issue.id } : {}),
      ...(input.issue.url ? { url: input.issue.url } : {}),
    },
  });
}

export function digestBytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseSource(content: string, path: string): ChangeSource {
  const value = parseYaml(content, path);
  validateSource(value, path);
  return value;
}

function parseTraceability(content: string, path: string): ChangeTraceability {
  const value = parseYaml(content, path);
  validateTraceabilityShape(value, path);
  return value;
}

function parseYaml(content: string, path: string): unknown {
  try {
    return yaml.load(content);
  } catch (error) {
    throw new ChangeContractError(
      `Failed to parse '${path}': ${error instanceof Error ? error.message : String(error)}`,
      "CHANGE_CONTRACT_INVALID_YAML",
      [path],
    );
  }
}

function validateSource(value: unknown, path: string): asserts value is ChangeSource {
  const source = requireMapping(value, path);
  requireSchemaVersion(source, path);
  if (source.kind !== "rfc-slice" && source.kind !== "maintenance") {
    throw invalid(path, "kind must be 'rfc-slice' or 'maintenance'");
  }
  requireString(source.deliveryRef, `${path}.deliveryRef`);
  requireAcceptance(source.acceptance, `${path}.acceptance`);
  validateTracker(source.tracker, `${path}.tracker`);
  if (source.kind === "rfc-slice") {
    const rfc = requireMapping(source.rfc, `${path}.rfc`);
    requireString(rfc.id, `${path}.rfc.id`);
    if (!/^RFC-\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(rfc.id))) {
      throw invalid(`${path}.rfc.id`, "must be a semantic RFC id");
    }
    const rfcPath = requireString(rfc.path, `${path}.rfc.path`);
    if (rfcPath.startsWith("/") || /(?:^|\/)\.\.(?:\/|$)/.test(rfcPath.replace(/\\/g, "/"))) {
      throw invalid(`${path}.rfc.path`, "must be a repository-relative path");
    }
    const acceptedCommit = requireString(rfc.acceptedCommit, `${path}.rfc.acceptedCommit`);
    if (!/^[a-f0-9]{40,64}$/.test(acceptedCommit)) {
      throw invalid(`${path}.rfc.acceptedCommit`, "must be a Git object id");
    }
    requireHash(rfc.digest, `${path}.rfc.digest`);
    const slice = requireMapping(source.slice, `${path}.slice`);
    requireString(slice.id, `${path}.slice.id`);
    if (!/^S-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slice.id))) {
      throw invalid(`${path}.slice.id`, "must be a semantic Slice id");
    }
    requireHash(slice.digest, `${path}.slice.digest`);
    requireHash(source.deliveryBindingDigest, `${path}.deliveryBindingDigest`);
  } else {
    const maintenance = requireMapping(source.maintenance, `${path}.maintenance`);
    const categories: MaintenanceCategory[] = [
      "docs-only",
      "test-only",
      "internal-refactor",
      "dependency-maintenance",
      "contract-bug",
    ];
    if (!categories.includes(maintenance.category as MaintenanceCategory)) {
      throw invalid(`${path}.maintenance.category`, "unsupported maintenance category");
    }
    requireString(maintenance.description, `${path}.maintenance.description`);
    requireString(maintenance.reason, `${path}.maintenance.reason`);
    requireString(maintenance.boundary, `${path}.maintenance.boundary`);
    requireStrings(maintenance.contractRefs, `${path}.maintenance.contractRefs`);
    if (maintenance.category === "contract-bug" && maintenance.contractRefs.length === 0) {
      throw invalid(`${path}.maintenance.contractRefs`, "contract-bug requires a contract reference");
    }
  }
}

function validateTraceabilityShape(
  value: unknown,
  path: string,
): asserts value is ChangeTraceability {
  const traceability = requireMapping(value, path);
  requireSchemaVersion(traceability, path);
  requireHash(traceability.sourceDigest, `${path}.sourceDigest`);
  if (!Array.isArray(traceability.acceptance)) {
    throw invalid(`${path}.acceptance`, "must be an array");
  }
  for (const [index, raw] of traceability.acceptance.entries()) {
    const entry = requireMapping(raw, `${path}.acceptance[${index}]`);
    requireString(entry.id, `${path}.acceptance[${index}].id`);
    requireEvidence(entry.evidence, `${path}.acceptance[${index}].evidence`);
    requireStrings(entry.taskGroups, `${path}.acceptance[${index}].taskGroups`);
    if (!Array.isArray(entry.planningRefs)) {
      throw invalid(`${path}.acceptance[${index}].planningRefs`, "must be an array");
    }
    for (const [refIndex, rawRef] of entry.planningRefs.entries()) {
      const ref = requireMapping(rawRef, `${path}.acceptance[${index}].planningRefs[${refIndex}]`);
      requireString(ref.path, `${path}.acceptance[${index}].planningRefs[${refIndex}].path`);
      if (ref.anchor !== undefined) {
        requireString(ref.anchor, `${path}.acceptance[${index}].planningRefs[${refIndex}].anchor`);
      }
    }
  }
}

function requireAcceptance(value: unknown, path: string): asserts value is ContractAcceptance[] {
  if (!Array.isArray(value) || value.length === 0) throw invalid(path, "must be a non-empty array");
  const ids = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const entry = requireMapping(raw, `${path}[${index}]`);
    const id = requireString(entry.id, `${path}[${index}].id`);
    if (!/^(?:AC|MC)-\d{3}$/.test(id)) {
      throw invalid(`${path}[${index}].id`, "must be AC-### or MC-###");
    }
    if (ids.has(id)) throw invalid(`${path}[${index}].id`, `duplicate id '${id}'`);
    ids.add(id);
    requireEvidence(entry.evidence, `${path}[${index}].evidence`);
  }
}

function validateTracker(value: unknown, path: string): asserts value is TrackerBinding {
  const tracker = requireMapping(value, path);
  if (!(["github", "gitlab", "none"] as unknown[]).includes(tracker.provider)) {
    throw invalid(`${path}.provider`, "must be github, gitlab, or none");
  }
  requireString(tracker.idempotencyKey, `${path}.idempotencyKey`);
  if (tracker.issue !== undefined) {
    const issue = requireMapping(tracker.issue, `${path}.issue`);
    requireString(issue.id, `${path}.issue.id`);
    requireString(issue.url, `${path}.issue.url`);
  }
  if (tracker.provider !== "none" && tracker.issue === undefined) {
    throw invalid(`${path}.issue`, "is required for a tracked change");
  }
}

function requireSchemaVersion(value: Record<string, unknown>, path: string): void {
  if (value.schemaVersion !== CHANGE_CONTRACT_SCHEMA_VERSION) {
    throw invalid(`${path}.schemaVersion`, `must be ${CHANGE_CONTRACT_SCHEMA_VERSION}`);
  }
}

function requireMapping(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(path, "must be a mapping");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(path, "must be a non-empty string");
  }
  return value.trim();
}

function requireStrings(value: unknown, path: string, nonEmpty = false): asserts value is string[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    throw invalid(path, nonEmpty ? "must be a non-empty string array" : "must be a string array");
  }
  for (const [index, item] of value.entries()) requireString(item, `${path}[${index}]`);
}

function requireEvidence(value: unknown, path: string): asserts value is EvidenceRequirement {
  if (value !== "automated" && value !== "human" && value !== "both") {
    throw invalid(path, "must be automated, human, or both");
  }
}

function requireHash(value: unknown, path: string): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw invalid(path, "must be a sha256 digest");
  }
}

function invalid(path: string, message: string): ChangeContractError {
  return new ChangeContractError(`${path} ${message}`, "CHANGE_CONTRACT_INVALID", [path]);
}

function atomicWriteYaml(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporary, yaml.dump(value, { noRefs: true, lineWidth: 100 }), {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function portableRelative(root: string, filePath: string): string {
  return relative(root, filePath).replace(/\\/g, "/");
}

function projectRelativePath(projectRoot: string, path: string): string {
  return relative(resolve(projectRoot), resolve(path)).replace(/\\/g, "/");
}

function planningArtifactHasAnchor(content: string, anchor: string): boolean {
  const normalized = anchor.trim().replace(/^#+/u, "").toLowerCase();
  if (!normalized) return false;
  if (new RegExp(`\\{#${escapeRegExp(normalized)}\\}|id=["']${escapeRegExp(normalized)}["']`, "iu").test(content)) {
    return true;
  }
  return Array.from(content.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gmu)).some((match) => {
    const heading = match[1]!.trim().toLowerCase();
    const slug = heading
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
      .trim()
      .replace(/\s+/gu, "-");
    return heading === normalized || slug === normalized;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left === right ? 0 : left < right ? -1 : 1)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
