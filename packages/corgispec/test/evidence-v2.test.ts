import { describe, expect, it } from "vitest";

import type { ArtifactHashV2 } from "../src/lib/run-contract-v2.js";
import {
  EvidenceValidationErrorV2,
  assertEvidenceBundleV2,
  assertEvidenceEntryV2,
  createEvidenceBundleV2,
  createFindingTriageV2,
  createReviewFindingV2,
  fingerprintReviewFindingV2,
  hashArtifactBytesV2,
  hashCanonicalArtifactV2,
  hashReviewFindingsV2,
  isEvidenceBundleFreshV2,
  validateEvidenceBundleV2,
  validateEvidenceEntryV2,
  validateFindingTriageV2,
  validateReviewFindingV2,
} from "../src/lib/evidence-v2.js";
import type {
  CliEvidenceEntryV2,
  EvidenceBindingV2,
  EvidenceBundleV2,
  EvidenceEntryV2,
  FindingTriageV2,
  LlmEvidenceEntryV2,
  ReviewFindingV2,
} from "../src/lib/evidence-v2.js";

const hash = (char: string): ArtifactHashV2 => `sha256:${char.repeat(64)}` as ArtifactHashV2;

function binding(): EvidenceBindingV2 {
  return {
    runId: "run-a",
    groupId: "group-1",
    attempt: 1,
    bundleId: "bundle-1",
    planningRevision: hash("1"),
    taskGroupFingerprint: hash("2"),
    baselineGitRevision: "baseline",
    observedGitRevision: "observed",
    workspaceFingerprint: hash("3"),
  };
}

function cli(status: "pass" | "fail" = "pass"): CliEvidenceEntryV2 {
  return {
    id: `cli-${status}`,
    kind: "test",
    provenance: "cli",
    status,
    binding: binding(),
    command: "npm test",
    cwd: "/workspace",
    exitCode: status === "pass" ? 0 : 1,
  };
}

function llm(status: "pass" | "fail" = "pass"): LlmEvidenceEntryV2 {
  return {
    id: `llm-${status}`,
    kind: "design-review",
    provenance: "llm",
    status,
    binding: binding(),
    description: status === "pass" ? "Design matches requirements" : "Requirement is missing",
  };
}

function passBundle(entries: EvidenceEntryV2[] = [cli(), llm()]): EvidenceBundleV2 {
  return createEvidenceBundleV2({ binding: binding(), verdict: "PASS", evidence: entries });
}

describe("Evidence v2 hashes", () => {
  it("canonicalizes JSON key ordering while preserving array ordering", () => {
    expect(hashCanonicalArtifactV2({ b: 2, a: { d: 4, c: 3 }, omitted: undefined }))
      .toBe(hashCanonicalArtifactV2({ a: { c: 3, d: 4 }, b: 2 }));
    expect(hashCanonicalArtifactV2([1, 2])).not.toBe(hashCanonicalArtifactV2([2, 1]));
    expect(hashCanonicalArtifactV2(null)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hashCanonicalArtifactV2(true)).not.toBe(hashCanonicalArtifactV2(false));
    expect(() => hashCanonicalArtifactV2(undefined)).toThrow(TypeError);
  });

  it("hashes exact string and byte artifacts", () => {
    expect(hashArtifactBytesV2("abc")).toBe(hashArtifactBytesV2(new TextEncoder().encode("abc")));
    expect(hashArtifactBytesV2("abc\n")).not.toBe(hashArtifactBytesV2("abc\r\n"));
  });
});

describe("CLI and LLM evidence", () => {
  it("requires command/cwd/exitCode for CLI and description without fake exit code for LLM", () => {
    expect(validateEvidenceEntryV2(cli())).toEqual({ valid: true, errors: [] });
    expect(validateEvidenceEntryV2(cli("fail"))).toEqual({ valid: true, errors: [] });
    expect(validateEvidenceEntryV2(llm())).toEqual({ valid: true, errors: [] });
    expect(() => assertEvidenceEntryV2(cli())).not.toThrow();

    const bad = (entry: EvidenceEntryV2, change: (draft: any) => void): unknown => {
      const draft = structuredClone(entry);
      change(draft);
      return draft;
    };
    const cases: Array<[string, unknown]> = [
      ["object", null],
      ["id", bad(cli(), (x) => { x.id = ""; })],
      ["kind", bad(cli(), (x) => { x.kind = ""; })],
      ["status", bad(cli(), (x) => { x.status = "warning"; })],
      ["binding object", bad(cli(), (x) => { x.binding = null; })],
      ["binding run", bad(cli(), (x) => { x.binding.runId = ""; })],
      ["binding group", bad(cli(), (x) => { x.binding.groupId = ""; })],
      ["binding bundle", bad(cli(), (x) => { x.binding.bundleId = ""; })],
      ["binding baseline", bad(cli(), (x) => { x.binding.baselineGitRevision = ""; })],
      ["binding observed", bad(cli(), (x) => { x.binding.observedGitRevision = ""; })],
      ["binding attempt", bad(cli(), (x) => { x.binding.attempt = 0; })],
      ["binding plan", bad(cli(), (x) => { x.binding.planningRevision = "x"; })],
      ["binding group hash", bad(cli(), (x) => { x.binding.taskGroupFingerprint = "x"; })],
      ["binding workspace", bad(cli(), (x) => { x.binding.workspaceFingerprint = "x"; })],
      ["command", bad(cli(), (x) => { x.command = ""; })],
      ["cwd", bad(cli(), (x) => { x.cwd = ""; })],
      ["exit missing", bad(cli(), (x) => { delete x.exitCode; })],
      ["exit negative", bad(cli(), (x) => { x.exitCode = -1; })],
      ["pass nonzero", bad(cli(), (x) => { x.exitCode = 1; })],
      ["fail zero", bad(cli("fail"), (x) => { x.exitCode = 0; })],
      ["llm description", bad(llm(), (x) => { x.description = ""; })],
      ["llm command", bad(llm(), (x) => { x.command = "pretend"; })],
      ["llm cwd", bad(llm(), (x) => { x.cwd = "/tmp"; })],
      ["llm exit", bad(llm(), (x) => { x.exitCode = 0; })],
      ["provenance", bad(cli(), (x) => { x.provenance = "manual"; })],
    ];
    for (const [label, value] of cases) expect(validateEvidenceEntryV2(value).valid, label).toBe(false);
    expect(() => assertEvidenceEntryV2(cases[1]![1])).toThrow(EvidenceValidationErrorV2);
  });

  it("rejects an entry bound to any other run/group/attempt/bundle/revision", () => {
    const expected = binding();
    const fields = Object.keys(expected) as Array<keyof EvidenceBindingV2>;
    for (const field of fields) {
      const entry = cli();
      (entry.binding as any)[field] = field === "attempt" ? 2 : field.includes("Revision") || field.includes("Fingerprint")
        ? (field === "baselineGitRevision" || field === "observedGitRevision" ? "other" : hash("9"))
        : "other";
      expect(validateEvidenceEntryV2(entry, expected).valid, field).toBe(false);
    }
  });
});

describe("EvidenceBundleV2", () => {
  it("accepts PASS only with a CLI pass and no failure", () => {
    const bundle = passBundle();
    expect(validateEvidenceBundleV2(bundle)).toEqual({ valid: true, errors: [] });
    expect(() => assertEvidenceBundleV2(bundle)).not.toThrow();
    expect(bundle.evidenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(bundle.bundleHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    expect(() => createEvidenceBundleV2({ binding: binding(), verdict: "PASS", evidence: [llm()] }))
      .toThrow(EvidenceValidationErrorV2);
    expect(() => createEvidenceBundleV2({ binding: binding(), verdict: "PASS", evidence: [cli(), llm("fail")] }))
      .toThrow(EvidenceValidationErrorV2);
  });

  it("accepts FAIL exactly when some bound evidence fails", () => {
    const failed = createEvidenceBundleV2({ binding: binding(), verdict: "FAIL", evidence: [cli("fail"), llm()] });
    expect(validateEvidenceBundleV2(failed).valid).toBe(true);
    expect(() => createEvidenceBundleV2({ binding: binding(), verdict: "FAIL", evidence: [cli(), llm()] }))
      .toThrow(EvidenceValidationErrorV2);
  });

  it("detects malformed bundles, identity drift, and all content tampering", () => {
    const source = passBundle();
    const bad = (change: (draft: any) => void): unknown => {
      const draft = structuredClone(source);
      change(draft);
      return draft;
    };
    const cases: Array<[string, unknown]> = [
      ["object", 1],
      ["schema", bad((x) => { x.schemaVersion = 3; })],
      ["binding", bad((x) => { x.binding = null; })],
      ["verdict", bad((x) => { x.verdict = "WARN"; })],
      ["evidence array", bad((x) => { x.evidence = null; })],
      ["evidence empty", bad((x) => { x.evidence = []; })],
      ["entry", bad((x) => { x.evidence[0].command = ""; })],
      ["entry binding", bad((x) => { x.evidence[0].binding.runId = "other"; })],
      ["hash type", bad((x) => { x.evidenceHash = "x"; })],
      ["evidence tamper", bad((x) => { x.evidence[1].description = "changed"; })],
      ["bundle hash type", bad((x) => { x.bundleHash = "x"; })],
      ["bundle tamper", bad((x) => { x.verdict = "FAIL"; })],
    ];
    for (const [label, value] of cases) expect(validateEvidenceBundleV2(value).valid, label).toBe(false);
    expect(() => assertEvidenceBundleV2({})).toThrow(EvidenceValidationErrorV2);
  });

  it("reports freshness only for the exact validated binding", () => {
    const bundle = passBundle();
    expect(isEvidenceBundleFreshV2(bundle, binding())).toBe(true);
    const changed = binding();
    changed.observedGitRevision = "new-head";
    expect(isEvidenceBundleFreshV2(bundle, changed)).toBe(false);
    const corrupted = structuredClone(bundle);
    corrupted.bundleHash = hash("9");
    expect(isEvidenceBundleFreshV2(corrupted, binding())).toBe(false);
  });
});

describe("stable review finding fingerprints and human triage", () => {
  function finding(): ReviewFindingV2 {
    return createReviewFindingV2({
      severity: "important",
      check: " Spec   Coverage ",
      requirement: " REQ-2 ",
      file: "src\\feature.ts",
      line: 12,
      description: " Missing   failure scenario ",
    });
  }

  it("normalizes whitespace and path separators into a stable fingerprint", () => {
    const first = finding();
    const equivalent = fingerprintReviewFindingV2({
      severity: "important",
      check: "Spec Coverage",
      requirement: "REQ-2",
      file: "src/feature.ts",
      line: 12,
      description: "Missing failure scenario",
    });
    expect(first.fingerprint).toBe(equivalent);
    expect(validateReviewFindingV2(first)).toEqual({ valid: true, errors: [] });
    expect(fingerprintReviewFindingV2({ ...first, severity: "critical" })).not.toBe(first.fingerprint);
    expect(hashReviewFindingsV2([first])).toMatch(/^sha256:/);
  });

  it("rejects malformed and tampered findings", () => {
    const source = finding();
    const bad = (change: (draft: any) => void): unknown => {
      const draft = structuredClone(source);
      change(draft);
      return draft;
    };
    const cases: Array<[string, unknown]> = [
      ["object", null],
      ["severity", bad((x) => { x.severity = "blocker"; })],
      ["check", bad((x) => { x.check = ""; })],
      ["description", bad((x) => { x.description = ""; })],
      ["requirement", bad((x) => { x.requirement = ""; })],
      ["file", bad((x) => { x.file = 1; })],
      ["line", bad((x) => { x.line = 0; })],
      ["fingerprint", bad((x) => { x.fingerprint = "x"; })],
      ["tamper", bad((x) => { x.description = "different"; })],
    ];
    for (const [label, value] of cases) expect(validateReviewFindingV2(value).valid, label).toBe(false);
    expect(() => createReviewFindingV2({ severity: "important", check: "", description: "x" }))
      .toThrow(EvidenceValidationErrorV2);
    expect(() => hashReviewFindingsV2([cases[1]![1] as ReviewFindingV2])).toThrow(EvidenceValidationErrorV2);
  });

  it("allows only a human with a reason to dismiss or accept risk", () => {
    const item = finding();
    const open = createFindingTriageV2({
      findingFingerprint: item.fingerprint,
      disposition: "open",
      actor: { id: "review-bot", kind: "automation" },
      reason: null,
      occurredAt: "2026-02-01T00:00:00.000Z",
    });
    const dismissed = createFindingTriageV2({
      findingFingerprint: item.fingerprint,
      disposition: "dismissed",
      actor: { id: "alice", kind: "human" },
      reason: "Not applicable to this platform",
      occurredAt: "2026-02-01T00:00:01.000Z",
    });
    const risk = createFindingTriageV2({
      ...dismissed,
      disposition: "accepted-risk",
      reason: "Accepted for the release candidate",
    });
    expect(validateFindingTriageV2(open, item).valid).toBe(true);
    expect(validateFindingTriageV2(dismissed, item).valid).toBe(true);
    expect(validateFindingTriageV2(risk, item).valid).toBe(true);
  });

  it("rejects invalid triage schema, identity, actor, disposition, reason, and time", () => {
    const item = finding();
    const source: FindingTriageV2 = {
      schemaVersion: 2,
      findingFingerprint: item.fingerprint,
      disposition: "dismissed",
      actor: { id: "alice", kind: "human" },
      reason: "Duplicate",
      occurredAt: "2026-02-01T00:00:00.000Z",
    };
    const bad = (change: (draft: any) => void): unknown => {
      const draft = structuredClone(source);
      change(draft);
      return draft;
    };
    const cases: Array<[string, unknown]> = [
      ["object", []],
      ["schema", bad((x) => { x.schemaVersion = 1; })],
      ["fingerprint", bad((x) => { x.findingFingerprint = "x"; })],
      ["finding mismatch", bad((x) => { x.findingFingerprint = hash("9"); })],
      ["disposition", bad((x) => { x.disposition = "ignored"; })],
      ["actor object", bad((x) => { x.actor = null; })],
      ["actor id", bad((x) => { x.actor.id = ""; })],
      ["actor kind", bad((x) => { x.actor.kind = "robot"; })],
      ["nonhuman dismiss", bad((x) => { x.actor.kind = "agent"; })],
      ["missing reason", bad((x) => { x.reason = ""; })],
      ["open reason", bad((x) => { x.disposition = "open"; })],
      ["time", bad((x) => { x.occurredAt = "today"; })],
    ];
    for (const [label, value] of cases) expect(validateFindingTriageV2(value, item).valid, label).toBe(false);
    expect(() => createFindingTriageV2({ ...(cases[8]![1] as FindingTriageV2), schemaVersion: undefined as never }))
      .toThrow(EvidenceValidationErrorV2);
  });
});
