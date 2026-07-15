import { createHash } from "node:crypto";

import type {
  ArtifactHashV2,
  LoopOwnerKindV2,
  RunContractValidationResultV2,
} from "./run-contract-v2.js";

export type EvidenceStatusV2 = "pass" | "fail";
export type EvidenceVerdictV2 = "PASS" | "FAIL";

/** Every observation is tied to the exact plan, task group, bundle, and tree. */
export interface EvidenceBindingV2 {
  runId: string;
  groupId: string;
  attempt: number;
  bundleId: string;
  planningRevision: ArtifactHashV2;
  taskGroupFingerprint: ArtifactHashV2;
  baselineGitRevision: string;
  observedGitRevision: string;
  workspaceFingerprint: ArtifactHashV2;
}

interface EvidenceEntryBaseV2 {
  id: string;
  kind: string;
  status: EvidenceStatusV2;
  binding: EvidenceBindingV2;
}

export interface CliEvidenceEntryV2 extends EvidenceEntryBaseV2 {
  provenance: "cli";
  command: string;
  cwd: string;
  exitCode: number;
}

export interface LlmEvidenceEntryV2 extends EvidenceEntryBaseV2 {
  provenance: "llm";
  description: string;
  command?: never;
  cwd?: never;
  exitCode?: never;
}

export type EvidenceEntryV2 = CliEvidenceEntryV2 | LlmEvidenceEntryV2;

export interface EvidenceBundleV2 {
  schemaVersion: 2;
  binding: EvidenceBindingV2;
  verdict: EvidenceVerdictV2;
  evidence: EvidenceEntryV2[];
  evidenceHash: ArtifactHashV2;
  bundleHash: ArtifactHashV2;
}

export const REVIEW_SEVERITIES_V2 = [
  "critical",
  "important",
  "suggestion",
  "nit",
  "fyi",
] as const;
export type ReviewSeverityV2 = (typeof REVIEW_SEVERITIES_V2)[number];

export interface ReviewFindingInputV2 {
  severity: ReviewSeverityV2;
  check: string;
  requirement?: string;
  file?: string;
  line?: number;
  description: string;
}

export interface ReviewFindingV2 extends ReviewFindingInputV2 {
  fingerprint: ArtifactHashV2;
}

export type FindingDispositionV2 = "open" | "dismissed" | "accepted-risk";

export interface FindingTriageV2 {
  schemaVersion: 2;
  findingFingerprint: ArtifactHashV2;
  disposition: FindingDispositionV2;
  actor: { id: string; kind: LoopOwnerKindV2 };
  reason: string | null;
  occurredAt: string;
}

export class EvidenceValidationErrorV2 extends Error {
  readonly errors: string[];

  constructor(label: string, errors: string[]) {
    super(`${label}: ${errors.join("; ")}`);
    this.name = "EvidenceValidationErrorV2";
    this.errors = errors;
  }
}

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const OWNER_KIND_SET = new Set<string>(["human", "agent", "automation"]);
const SEVERITY_SET = new Set<string>(REVIEW_SEVERITIES_V2);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hash(value: unknown): value is ArtifactHashV2 {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function integer(value: unknown, minimum = 0): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum;
}

function result(errors: string[]): RunContractValidationResultV2 {
  return { valid: errors.length === 0, errors };
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new TypeError(`value is not canonical JSON: ${String(value)}`);
}

/** Hash JSON with sorted object keys, independent of insertion order. */
export function hashCanonicalArtifactV2(value: unknown): ArtifactHashV2 {
  return `sha256:${createHash("sha256").update(canonical(value), "utf8").digest("hex")}`;
}

/** Hash exact artifact bytes (including whitespace and line endings). */
export function hashArtifactBytesV2(value: string | Uint8Array): ArtifactHashV2 {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function checkBinding(value: unknown, path: string, errors: string[]): value is EvidenceBindingV2 {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  for (const field of ["runId", "groupId", "bundleId", "baselineGitRevision", "observedGitRevision"] as const) {
    if (!nonEmpty(value[field])) errors.push(`${path}.${field} must be non-empty`);
  }
  if (!integer(value["attempt"], 1)) errors.push(`${path}.attempt must be positive`);
  for (const field of ["planningRevision", "taskGroupFingerprint", "workspaceFingerprint"] as const) {
    if (!hash(value[field])) errors.push(`${path}.${field} must be sha256`);
  }
  return true;
}

function bindingsEqual(left: EvidenceBindingV2, right: EvidenceBindingV2): boolean {
  return canonical(left) === canonical(right);
}

export function validateEvidenceEntryV2(
  value: unknown,
  expectedBinding?: EvidenceBindingV2,
): RunContractValidationResultV2 {
  if (!isRecord(value)) return result(["evidence entry must be an object"]);
  const errors: string[] = [];
  if (!nonEmpty(value["id"])) errors.push("evidence.id must be non-empty");
  if (!nonEmpty(value["kind"])) errors.push("evidence.kind must be non-empty");
  if (!["pass", "fail"].includes(String(value["status"]))) errors.push("evidence.status is invalid");
  const validBinding = checkBinding(value["binding"], "evidence.binding", errors);
  if (validBinding && expectedBinding && !bindingsEqual(value["binding"] as EvidenceBindingV2, expectedBinding)) {
    errors.push("evidence binding does not match its bundle");
  }
  if (value["provenance"] === "cli") {
    if (!nonEmpty(value["command"])) errors.push("CLI evidence requires command");
    if (!nonEmpty(value["cwd"])) errors.push("CLI evidence requires cwd");
    if (!integer(value["exitCode"])) errors.push("CLI evidence requires a non-negative integer exitCode");
    if (integer(value["exitCode"]) && value["status"] === "pass" && value["exitCode"] !== 0) {
      errors.push("CLI pass requires exitCode 0");
    }
    if (integer(value["exitCode"]) && value["status"] === "fail" && value["exitCode"] === 0) {
      errors.push("CLI fail requires a non-zero exitCode");
    }
  } else if (value["provenance"] === "llm") {
    if (!nonEmpty(value["description"])) errors.push("LLM evidence requires description");
    for (const field of ["command", "cwd", "exitCode"] as const) {
      if (field in value) errors.push(`LLM evidence must not contain ${field}`);
    }
  } else {
    errors.push("evidence.provenance must be cli or llm");
  }
  return result(errors);
}

export function assertEvidenceEntryV2(
  value: unknown,
  expectedBinding?: EvidenceBindingV2,
): asserts value is EvidenceEntryV2 {
  const validation = validateEvidenceEntryV2(value, expectedBinding);
  if (!validation.valid) throw new EvidenceValidationErrorV2("invalid EvidenceEntryV2", validation.errors);
}

function evidencePayload(bundle: Pick<EvidenceBundleV2, "binding" | "evidence">): unknown {
  return { binding: bundle.binding, evidence: bundle.evidence };
}

function bundlePayload(bundle: Pick<EvidenceBundleV2, "binding" | "verdict" | "evidenceHash">): unknown {
  return {
    schemaVersion: 2,
    binding: bundle.binding,
    verdict: bundle.verdict,
    evidenceHash: bundle.evidenceHash,
  };
}

export function validateEvidenceBundleV2(value: unknown): RunContractValidationResultV2 {
  if (!isRecord(value)) return result(["evidence bundle must be an object"]);
  const errors: string[] = [];
  if (value["schemaVersion"] !== 2) errors.push("bundle.schemaVersion must equal 2");
  const validBinding = checkBinding(value["binding"], "bundle.binding", errors);
  if (!["PASS", "FAIL"].includes(String(value["verdict"]))) errors.push("bundle.verdict is invalid");
  const evidence = value["evidence"];
  if (!Array.isArray(evidence) || evidence.length === 0) {
    errors.push("bundle.evidence must be non-empty");
  } else {
    for (const [index, entry] of evidence.entries()) {
      const entryResult = validateEvidenceEntryV2(
        entry,
        validBinding ? value["binding"] as EvidenceBindingV2 : undefined,
      );
      errors.push(...entryResult.errors.map((error) => `evidence[${index}].${error}`));
    }
    const passCli = evidence.some((entry) => isRecord(entry)
      && entry["provenance"] === "cli" && entry["status"] === "pass" && entry["exitCode"] === 0);
    const anyFail = evidence.some((entry) => isRecord(entry) && entry["status"] === "fail");
    if (value["verdict"] === "PASS" && !passCli) errors.push("PASS requires at least one CLI pass");
    if (value["verdict"] === "PASS" && anyFail) errors.push("PASS cannot contain failed evidence");
    if (value["verdict"] === "FAIL" && !anyFail) errors.push("FAIL requires at least one failed evidence entry");
  }
  if (!hash(value["evidenceHash"])) {
    errors.push("bundle.evidenceHash must be sha256");
  } else if (validBinding && Array.isArray(evidence)) {
    const expected = hashCanonicalArtifactV2(evidencePayload({
      binding: value["binding"] as EvidenceBindingV2,
      evidence: evidence as EvidenceEntryV2[],
    }));
    if (value["evidenceHash"] !== expected) errors.push("bundle.evidenceHash does not match content");
  }
  if (!hash(value["bundleHash"])) {
    errors.push("bundle.bundleHash must be sha256");
  } else if (validBinding && hash(value["evidenceHash"]) && ["PASS", "FAIL"].includes(String(value["verdict"]))) {
    const expected = hashCanonicalArtifactV2(bundlePayload({
      binding: value["binding"] as EvidenceBindingV2,
      verdict: value["verdict"] as EvidenceVerdictV2,
      evidenceHash: value["evidenceHash"],
    }));
    if (value["bundleHash"] !== expected) errors.push("bundle.bundleHash does not match content");
  }
  return result(errors);
}

export function assertEvidenceBundleV2(value: unknown): asserts value is EvidenceBundleV2 {
  const validation = validateEvidenceBundleV2(value);
  if (!validation.valid) throw new EvidenceValidationErrorV2("invalid EvidenceBundleV2", validation.errors);
}

export function createEvidenceBundleV2(input: {
  binding: EvidenceBindingV2;
  verdict: EvidenceVerdictV2;
  evidence: readonly EvidenceEntryV2[];
}): EvidenceBundleV2 {
  const partial = {
    schemaVersion: 2 as const,
    binding: structuredClone(input.binding),
    verdict: input.verdict,
    evidence: structuredClone(input.evidence) as EvidenceEntryV2[],
  };
  const evidenceHash = hashCanonicalArtifactV2(evidencePayload(partial));
  const bundle: EvidenceBundleV2 = {
    ...partial,
    evidenceHash,
    bundleHash: hashCanonicalArtifactV2(bundlePayload({ ...partial, evidenceHash })),
  };
  assertEvidenceBundleV2(bundle);
  return bundle;
}

export function isEvidenceBundleFreshV2(
  bundle: EvidenceBundleV2,
  expectedBinding: EvidenceBindingV2,
): boolean {
  return validateEvidenceBundleV2(bundle).valid && bindingsEqual(bundle.binding, expectedBinding);
}

function normalizeText(value: string | undefined): string | null {
  return value === undefined ? null : value.trim().replace(/\s+/g, " ");
}

function findingFingerprintPayload(input: ReviewFindingInputV2): unknown {
  return {
    severity: input.severity,
    check: normalizeText(input.check),
    requirement: normalizeText(input.requirement),
    file: input.file === undefined ? null : input.file.trim().replace(/\\/g, "/"),
    line: input.line ?? null,
    description: normalizeText(input.description),
  };
}

export function fingerprintReviewFindingV2(input: ReviewFindingInputV2): ArtifactHashV2 {
  return hashCanonicalArtifactV2(findingFingerprintPayload(input));
}

export function createReviewFindingV2(input: ReviewFindingInputV2): ReviewFindingV2 {
  const finding = { ...structuredClone(input), fingerprint: fingerprintReviewFindingV2(input) };
  const validation = validateReviewFindingV2(finding);
  if (!validation.valid) throw new EvidenceValidationErrorV2("invalid ReviewFindingV2", validation.errors);
  return finding;
}

export function validateReviewFindingV2(value: unknown): RunContractValidationResultV2 {
  if (!isRecord(value)) return result(["finding must be an object"]);
  const errors: string[] = [];
  if (typeof value["severity"] !== "string" || !SEVERITY_SET.has(value["severity"])) errors.push("finding.severity is invalid");
  if (!nonEmpty(value["check"])) errors.push("finding.check must be non-empty");
  if (!nonEmpty(value["description"])) errors.push("finding.description must be non-empty");
  for (const field of ["requirement", "file"] as const) {
    if (value[field] !== undefined && !nonEmpty(value[field])) errors.push(`finding.${field} must be non-empty when present`);
  }
  if (value["line"] !== undefined && !integer(value["line"], 1)) errors.push("finding.line must be positive when present");
  if (!hash(value["fingerprint"])) {
    errors.push("finding.fingerprint must be sha256");
  } else if (typeof value["severity"] === "string" && SEVERITY_SET.has(value["severity"])
    && nonEmpty(value["check"]) && nonEmpty(value["description"])
    && (value["requirement"] === undefined || nonEmpty(value["requirement"]))
    && (value["file"] === undefined || nonEmpty(value["file"]))
    && (value["line"] === undefined || integer(value["line"], 1))) {
    const expected = fingerprintReviewFindingV2(value as unknown as ReviewFindingInputV2);
    if (value["fingerprint"] !== expected) errors.push("finding.fingerprint does not match content");
  }
  return result(errors);
}

export function hashReviewFindingsV2(findings: readonly ReviewFindingV2[]): ArtifactHashV2 {
  for (const finding of findings) {
    const validation = validateReviewFindingV2(finding);
    if (!validation.valid) throw new EvidenceValidationErrorV2("invalid review findings", validation.errors);
  }
  return hashCanonicalArtifactV2(findings);
}

export function validateFindingTriageV2(
  value: unknown,
  finding?: ReviewFindingV2,
): RunContractValidationResultV2 {
  if (!isRecord(value)) return result(["finding triage must be an object"]);
  const errors: string[] = [];
  if (value["schemaVersion"] !== 2) errors.push("triage.schemaVersion must equal 2");
  if (!hash(value["findingFingerprint"])) errors.push("triage.findingFingerprint must be sha256");
  if (finding && value["findingFingerprint"] !== finding.fingerprint) errors.push("triage finding fingerprint mismatch");
  if (!["open", "dismissed", "accepted-risk"].includes(String(value["disposition"]))) errors.push("triage.disposition is invalid");
  const actor = value["actor"];
  if (!isRecord(actor) || !nonEmpty(actor["id"]) || typeof actor["kind"] !== "string" || !OWNER_KIND_SET.has(actor["kind"])) {
    errors.push("triage.actor is invalid");
  }
  const resolved = value["disposition"] === "dismissed" || value["disposition"] === "accepted-risk";
  if (resolved && (!isRecord(actor) || actor["kind"] !== "human")) errors.push("only a human may dismiss or accept risk");
  if (resolved && !nonEmpty(value["reason"])) errors.push("dismissed or accepted-risk requires a reason");
  if (!resolved && value["reason"] !== null) errors.push("open triage must use a null reason");
  if (typeof value["occurredAt"] !== "string" || !Number.isFinite(Date.parse(value["occurredAt"]))) {
    errors.push("triage.occurredAt must be ISO time");
  }
  return result(errors);
}

export function createFindingTriageV2(input: Omit<FindingTriageV2, "schemaVersion">): FindingTriageV2 {
  const triage: FindingTriageV2 = { schemaVersion: 2, ...structuredClone(input) };
  const validation = validateFindingTriageV2(triage);
  if (!validation.valid) throw new EvidenceValidationErrorV2("invalid FindingTriageV2", validation.errors);
  return triage;
}
