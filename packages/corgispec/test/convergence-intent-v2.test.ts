import { describe, expect, it } from "vitest";

import {
  assertConvergenceIntentV2,
  assertExactConvergenceIntentV2,
  computeConvergenceConfirmationTokenV2,
  convergenceIntentsExactlyEqualV2,
  createConvergenceIntentV2,
  deriveConvergenceSuccessorIdentityV2,
  hashConvergenceIntentV2,
  hashConvergenceJsonV2,
  hashConvergenceOriginalGroupFingerprintsV2,
  hashConvergenceTaskArtifactPathV2,
  hashConvergenceTaskBytesV2,
  hashConvergenceTaskGroupDraftV2,
  parseConvergenceIntentV2,
  parseExactConvergenceIntentV2,
  serializeConvergenceIntentV2,
  stableConvergenceJsonV2,
  validateConvergenceIntentV2,
  type ConvergenceIntentV2,
} from "../src/lib/convergence-intent-v2.js";
import {
  evaluateConvergenceV2,
  type ConvergenceResultV2,
} from "../src/lib/converge-v2.js";
import { parseTaskGroupsDocument } from "../src/lib/task-groups.js";

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const STARTED_AT = "2026-07-15T12:34:56.789Z";
const PRE_TASKS = "# Tasks\n\n## 1. Existing\n\n- [x] 1.1 Keep behavior\n";

describe("ConvergenceIntentV2", () => {
  it("constructs a deterministic, round-trippable persistent intent", () => {
    const first = fixture();
    const second = fixture();

    expect(first).toEqual(second);
    expect(validateConvergenceIntentV2(first)).toEqual({ valid: true, errors: [] });
    expect(hashConvergenceIntentV2(first)).toMatch(HASH_PATTERN);
    expect(hashConvergenceIntentV2(first)).toBe(hashConvergenceIntentV2(second));

    const serialized = serializeConvergenceIntentV2(first);
    expect(serialized.endsWith("\n")).toBe(false);
    expect(parseConvergenceIntentV2(serialized)).toEqual(first);
    expect(parseExactConvergenceIntentV2(serialized, first)).toEqual(first);
    expect(convergenceIntentsExactlyEqualV2(first, second)).toBe(true);
    expect(computeConvergenceConfirmationTokenV2(first.evaluation)).toBe(first.confirmationToken);
  });

  it("hashes exact bytes and stable JSON without locale-sensitive ordering", () => {
    expect(stableConvergenceJsonV2({ ä: 3, z: 2, Z: 1 })).toBe('{"Z":1,"z":2,"ä":3}');
    expect(hashConvergenceJsonV2("test", { b: 2, a: 1 })).toBe(
      hashConvergenceJsonV2("test", { a: 1, b: 2 }),
    );
    expect(hashConvergenceOriginalGroupFingerprintsV2({
      "2": sha("group-2"),
      "1": sha("group-1"),
    })).toBe(hashConvergenceOriginalGroupFingerprintsV2({
      "1": sha("group-1"),
      "2": sha("group-2"),
    }));
    expect(hashConvergenceTaskBytesV2("a\n")).not.toBe(hashConvergenceTaskBytesV2("a\r\n"));
    expect(hashConvergenceTaskBytesV2(new TextEncoder().encode("a\n"))).toBe(
      hashConvergenceTaskBytesV2("a\n"),
    );
    expect(hashConvergenceTaskArtifactPathV2("/a/tasks.md")).not.toBe(
      hashConvergenceTaskArtifactPathV2("/b/tasks.md"),
    );
    expect(() => stableConvergenceJsonV2({ bad: undefined })).toThrow(/undefined/u);
    expect(() => stableConvergenceJsonV2(Number.NaN)).toThrow(/finite/u);
    expect(() => stableConvergenceJsonV2(Symbol("bad"))).toThrow(/persistent/u);
    expect(() => hashConvergenceJsonV2("", {})).toThrow(/domain/u);
    expect(() => hashConvergenceTaskArtifactPathV2("bad\npath")).toThrow(/path/u);
    expect(() => computeConvergenceConfirmationTokenV2({
      ...fixture().evaluation,
      taskGroupDraft: undefined,
    })).toThrow(/draft/u);
  });

  it("derives a stable safe successor identity from all seed bindings", () => {
    const seed = {
      changeName: "example",
      sourceRunId: "run-source",
      sourceStateRevision: 8,
      sourceNonce: "nonce-source",
      confirmationToken: sha("confirmation"),
      startedAt: STARTED_AT,
    } as const;
    const first = deriveConvergenceSuccessorIdentityV2(seed);
    const second = deriveConvergenceSuccessorIdentityV2({ ...seed });

    expect(first).toEqual(second);
    expect(first).toMatchObject({ startedAt: STARTED_AT });
    expect(first.runId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
    expect(first.nonce).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u);
    expect(deriveConvergenceSuccessorIdentityV2({
      ...seed,
      sourceStateRevision: seed.sourceStateRevision + 1,
    })).not.toEqual(first);
    expect(() => deriveConvergenceSuccessorIdentityV2({
      ...seed,
      sourceRunId: "../escape",
    })).toThrow(/seed bindings/u);
  });

  it("rejects every missing top-level field and every unknown nested field", () => {
    const intent = fixture();
    for (const field of Object.keys(intent)) {
      const partial = clone(intent) as unknown as Record<string, unknown>;
      delete partial[field];
      const result = validateConvergenceIntentV2(partial);
      expect(result.valid, `missing ${field}`).toBe(false);
      expect(result.errors.join("\n"), `missing ${field}`).toContain(`intent.${field} is required`);
    }

    const unknowns: Array<[string, (value: Record<string, unknown>) => void]> = [
      ["intent", (value) => { value["unexpected"] = true; }],
      ["evaluation", (value) => { asRecord(value["evaluation"])["unexpected"] = true; }],
      ["evidence", (value) => {
        asRecord(asArray(asRecord(value["evaluation"])["evidence"])[0])["unexpected"] = true;
      }],
      ["gap", (value) => {
        asRecord(asArray(asRecord(value["evaluation"])["gaps"])[0])["unexpected"] = true;
      }],
      ["draft", (value) => {
        asRecord(asRecord(value["evaluation"])["taskGroupDraft"])["unexpected"] = true;
      }],
      ["draft task", (value) => {
        const draft = asRecord(asRecord(value["evaluation"])["taskGroupDraft"]);
        asRecord(asArray(draft["tasks"])[0])["unexpected"] = true;
      }],
    ];
    for (const [label, mutate] of unknowns) {
      const value = clone(intent) as unknown as Record<string, unknown>;
      mutate(value);
      const result = validateConvergenceIntentV2(value);
      expect(result.valid, label).toBe(false);
      expect(result.errors.join("\n"), label).toMatch(/unknown/u);
    }
  });

  it("fails exact comparison when any durable binding is replaced", () => {
    const intent = fixture();
    const alternateHash = sha("alternate");
    const tamperers: Array<[keyof ConvergenceIntentV2, (value: ConvergenceIntentV2) => void]> = [
      ["schemaVersion", (value) => { (value as { schemaVersion: number }).schemaVersion = 3; }],
      ["kind", (value) => { (value as { kind: string }).kind = "other"; }],
      ["changeName", (value) => { value.changeName = "alternate"; }],
      ["sourceRunId", (value) => { value.sourceRunId = "run-alternate"; }],
      ["sourceSessionId", (value) => { value.sourceSessionId = "session-alternate"; }],
      ["sourceStateRevision", (value) => { value.sourceStateRevision += 1; }],
      ["sourceNonce", (value) => { value.sourceNonce = "nonce-alternate"; }],
      ["confirmationToken", (value) => { value.confirmationToken = alternateHash; }],
      ["prePlanningRevision", (value) => { value.prePlanningRevision = alternateHash; }],
      ["expectedPostPlanningRevision", (value) => {
        value.expectedPostPlanningRevision = alternateHash;
      }],
      ["preGitRevision", (value) => { value.preGitRevision = "git-alternate"; }],
      ["preWorkspaceFingerprint", (value) => { value.preWorkspaceFingerprint = alternateHash; }],
      ["originalGroupFingerprintsHash", (value) => { value.originalGroupFingerprintsHash = alternateHash; }],
      ["preTaskBytesHash", (value) => { value.preTaskBytesHash = alternateHash; }],
      ["postTaskBytesHash", (value) => { value.postTaskBytesHash = alternateHash; }],
      ["draftHash", (value) => { value.draftHash = alternateHash; }],
      ["taskArtifactId", (value) => { value.taskArtifactId = "alternate-tasks"; }],
      ["taskArtifactPathHash", (value) => { value.taskArtifactPathHash = alternateHash; }],
      ["successorRunId", (value) => { value.successorRunId = "run-alternate"; }],
      ["successorNonce", (value) => { value.successorNonce = "nonce-alternate"; }],
      ["successorStartedAt", (value) => { value.successorStartedAt = "2026-07-15T12:34:57.789Z"; }],
      ["reusableEvidenceGroups", (value) => { value.reusableEvidenceGroups = []; }],
      ["evaluation", (value) => { value.evaluation.evidence[0]!.summary = "Changed summary"; }],
    ];

    expect(tamperers.map(([field]) => field).sort()).toEqual(Object.keys(intent).sort());
    for (const [field, tamper] of tamperers) {
      const changed = clone(intent);
      tamper(changed);
      expect(
        () => assertExactConvergenceIntentV2(changed, intent),
        `tampered ${field}`,
      ).toThrow();
      if (validateConvergenceIntentV2(changed).valid) {
        expect(convergenceIntentsExactlyEqualV2(changed, intent), `tampered ${field}`).toBe(false);
      } else {
        expect(
          convergenceIntentsExactlyEqualV2.bind(undefined, changed, intent),
          `tampered ${field}`,
        ).toThrow();
      }
    }
  });

  it("rejects malformed or partially bound original evaluations", () => {
    const mutations: Array<[string, (value: Record<string, unknown>) => void]> = [
      ["wrong status", (value) => { evaluation(value)["status"] = "converged"; }],
      ["missing token", (value) => { delete evaluation(value)["confirmationToken"]; }],
      ["wrong token", (value) => { evaluation(value)["confirmationToken"] = sha("wrong"); }],
      ["missing draft", (value) => { delete evaluation(value)["taskGroupDraft"]; }],
      ["wrong draft hash", (value) => { value["draftHash"] = sha("wrong-draft"); }],
      ["stale evidence planning", (value) => {
        asRecord(asArray(evaluation(value)["evidence"])[0])["planningRevision"] = sha("stale");
      }],
      ["missing evidence field", (value) => {
        delete asRecord(asArray(evaluation(value)["evidence"])[0])["summary"];
      }],
      ["empty gaps", (value) => { evaluation(value)["gaps"] = []; }],
      ["partial gap", (value) => {
        delete asRecord(asArray(evaluation(value)["gaps"])[0])["summary"];
      }],
      ["unbound draft task", (value) => {
        const draft = asRecord(evaluation(value)["taskGroupDraft"]);
        asRecord(asArray(draft["tasks"])[0])["gapId"] = "other-gap";
      }],
      ["bad group fingerprint", (value) => {
        asRecord(evaluation(value)["originalGroupFingerprints"])["1"] = "sha256:short";
      }],
      ["post-apply flag", (value) => { evaluation(value)["applied"] = false; }],
      ["partial successor", (value) => {
        evaluation(value)["successor"] = { supersedesRunId: "run-source" };
      }],
      ["reason on needs_work", (value) => {
        evaluation(value)["reason"] = { code: "wrong", message: "wrong" };
      }],
    ];

    for (const [label, mutate] of mutations) {
      const value = clone(fixture()) as unknown as Record<string, unknown>;
      mutate(value);
      const result = validateConvergenceIntentV2(value);
      expect(result.valid, label).toBe(false);
      expect(result.errors.length, label).toBeGreaterThan(0);
      expect(() => assertConvergenceIntentV2(value), label).toThrow();
    }
  });

  it("covers every strict nested validation branch fail-closed", () => {
    const mutations: Array<[string, (value: Record<string, unknown>) => void]> = [
      ["evaluation scalar", (value) => { value["evaluation"] = null; }],
      ["evaluation schema", (value) => { evaluation(value)["schemaVersion"] = 3; }],
      ["evaluation planning hash", (value) => { evaluation(value)["planningRevision"] = "bad"; }],
      ["evaluation git", (value) => { evaluation(value)["gitRevision"] = ""; }],
      ["evaluation workspace hash", (value) => { evaluation(value)["workspaceFingerprint"] = "bad"; }],
      ["evaluation token format", (value) => { evaluation(value)["confirmationToken"] = "bad"; }],
      ["evidence empty", (value) => { evaluation(value)["evidence"] = []; }],
      ["evidence scalar", (value) => { evaluation(value)["evidence"] = [null]; }],
      ["evidence id", (value) => { evidence(value)["id"] = ""; }],
      ["evidence planning", (value) => { evidence(value)["planningRevision"] = "bad"; }],
      ["evidence git", (value) => { evidence(value)["observedGitRevision"] = ""; }],
      ["evidence workspace", (value) => { evidence(value)["workspaceFingerprint"] = "bad"; }],
      ["evidence status", (value) => { evidence(value)["status"] = "unknown"; }],
      ["evidence summary", (value) => { evidence(value)["summary"] = ""; }],
      ["evidence duplicate", (value) => {
        const entries = asArray(evaluation(value)["evidence"]);
        entries.push(clone(entries[0]));
      }],
      ["gap scalar", (value) => { evaluation(value)["gaps"] = [null]; }],
      ["gap id", (value) => { gap(value)["id"] = "bad/path"; }],
      ["gap summary", (value) => { gap(value)["summary"] = "bad\nsummary"; }],
      ["gap suggested empty", (value) => { gap(value)["suggestedTasks"] = []; }],
      ["gap suggested multiline", (value) => { gap(value)["suggestedTasks"] = ["bad\ntask"]; }],
      ["draft scalar", (value) => { evaluation(value)["taskGroupDraft"] = null; }],
      ["draft number", (value) => { draft(value)["number"] = 0; }],
      ["draft title", (value) => { draft(value)["title"] = ""; }],
      ["draft markdown", (value) => { draft(value)["markdown"] = ""; }],
      ["draft tasks empty", (value) => { draft(value)["tasks"] = []; }],
      ["draft task scalar", (value) => { draft(value)["tasks"] = [null]; }],
      ["draft task id", (value) => { draftTask(value)["id"] = "bad/path"; }],
      ["draft task description", (value) => { draftTask(value)["description"] = "bad\ndescription"; }],
      ["draft task duplicate", (value) => {
        const tasks = asArray(draft(value)["tasks"]);
        tasks.push(clone(tasks[0]));
      }],
      ["fingerprints scalar", (value) => { evaluation(value)["originalGroupFingerprints"] = null; }],
      ["fingerprint key", (value) => {
        asRecord(evaluation(value)["originalGroupFingerprints"])["group"] = sha("group");
      }],
      ["fingerprint hash exception", (value) => {
        asRecord(evaluation(value)["originalGroupFingerprints"])["1"] = Symbol("bad");
      }],
      ["draft hash exception", (value) => { draft(value)["title"] = Symbol("bad"); }],
      ["token hash exception", (value) => { evidence(value)["summary"] = Symbol("bad"); }],
      ["reuse scalar", (value) => { value["reusableEvidenceGroups"] = null; }],
      ["reuse unsafe", (value) => { value["reusableEvidenceGroups"] = ["../bad"]; }],
      ["reuse unknown", (value) => { value["reusableEvidenceGroups"] = ["3"]; }],
    ];

    for (const [label, mutate] of mutations) {
      const value = clone(fixture()) as unknown as Record<string, unknown>;
      mutate(value);
      const result = validateConvergenceIntentV2(value);
      expect(result.valid, label).toBe(false);
      expect(result.errors.length, label).toBeGreaterThan(0);
    }

    const baseline = fixture();
    const invalidEvaluation = clone(baseline.evaluation);
    invalidEvaluation.status = "converged";
    expect(() => recreate(baseline, invalidEvaluation)).toThrow(/needs_work/u);
  });

  it("rejects unsafe identifiers, non-canonical timestamps, and non-prefix reuse", () => {
    const invalid: Array<(value: ConvergenceIntentV2) => void> = [
      (value) => { value.changeName = "../escape"; value.evaluation.changeName = "../escape"; },
      (value) => { value.sourceRunId = "CON"; },
      (value) => { value.sourceSessionId = "session\u0000bad"; },
      (value) => { value.taskArtifactId = ""; },
      (value) => { value.successorRunId = value.sourceRunId; },
      (value) => { value.successorNonce = ""; },
      (value) => { value.successorStartedAt = "2026-07-15T12:34:56Z"; },
      (value) => { value.reusableEvidenceGroups = ["1", "1"]; },
    ];
    for (const mutate of invalid) {
      const value = clone(fixture());
      mutate(value);
      expect(validateConvergenceIntentV2(value).valid).toBe(false);
    }

    const twoGroups = fixture({ secondOriginalGroup: true });
    twoGroups.reusableEvidenceGroups = ["2"];
    expect(validateConvergenceIntentV2(twoGroups).errors).toContain(
      "intent.reusableEvidenceGroups must be an ordered prefix",
    );
  });

  it("accepts the full dry-run text surface used by converge assessments", () => {
    const value = fixture({ evidenceSummary: "First line\nSecond line", gapDetails: "" });

    expect(validateConvergenceIntentV2(value)).toEqual({ valid: true, errors: [] });

    const multilineDetails = fixture({ gapDetails: "Context\nMore context" });
    expect(validateConvergenceIntentV2(multilineDetails)).toEqual({ valid: true, errors: [] });

    value.evaluation.gaps[0]!.details = "Context\nMore context";
    expect(validateConvergenceIntentV2(value)).toEqual({ valid: true, errors: [] });

    value.evaluation.gaps[0]!.details = "bad\u0000detail";
    expect(validateConvergenceIntentV2(value).valid).toBe(false);

    const evaluationWithUndefined = clone(fixture().evaluation);
    evaluationWithUndefined.gaps[0]!.details = undefined;
    const baseline = fixture();
    const normalized = createConvergenceIntentV2({
      changeName: baseline.changeName,
      sourceRunId: baseline.sourceRunId,
      sourceSessionId: baseline.sourceSessionId,
      sourceStateRevision: baseline.sourceStateRevision,
      sourceNonce: baseline.sourceNonce,
      expectedPostPlanningRevision: baseline.expectedPostPlanningRevision,
      preTaskBytes: PRE_TASKS,
      postTaskBytes: `${PRE_TASKS}\n${evaluationWithUndefined.taskGroupDraft!.markdown}`,
      taskArtifactId: baseline.taskArtifactId,
      taskArtifactPath: "/workspace/openspec/changes/example/work/items.md",
      successor: {
        runId: baseline.successorRunId,
        nonce: baseline.successorNonce,
        startedAt: baseline.successorStartedAt,
      },
      reusableEvidenceGroups: baseline.reusableEvidenceGroups,
      evaluation: evaluationWithUndefined,
    });
    expect(Object.prototype.hasOwnProperty.call(normalized.evaluation.gaps[0], "details")).toBe(false);
  });

  it("fails closed on malformed JSON", () => {
    expect(() => parseConvergenceIntentV2("{not json")).toThrow(/JSON/u);
    expect(() => parseConvergenceIntentV2("null")).toThrow(/intent must be an object/u);
    expect(() => parseExactConvergenceIntentV2(
      serializeConvergenceIntentV2(fixture()),
      fixture({ sourceStateRevision: 9 }),
    )).toThrow(/exactly match/u);
  });
});

function fixture(options: {
  sourceStateRevision?: number;
  secondOriginalGroup?: boolean;
  evidenceSummary?: string;
  gapDetails?: string;
} = {}): ConvergenceIntentV2 {
  const planningRevision = sha("planning");
  const workspaceFingerprint = sha("workspace");
  const taskText = options.secondOriginalGroup
    ? `${PRE_TASKS}\n## 2. Second\n\n- [x] 2.1 Keep second behavior\n`
    : PRE_TASKS;
  const groups = parseTaskGroupsDocument(taskText).groups;
  const evaluation = evaluateConvergenceV2({
    changeName: "example",
    planning: {
      valid: true,
      ready: true,
      planningRevision,
      changeRoot: "/workspace/openspec/changes/example",
      taskArtifactId: "work-items",
      taskArtifactPath: "/workspace/openspec/changes/example/work/items.md",
      taskGroups: groups,
      issues: [],
    },
    git: { revision: "git-revision", workspaceFingerprint },
    evidence: [{
      id: "evidence-1",
      planningRevision,
      observedGitRevision: "git-revision",
      workspaceFingerprint,
      status: "fail",
      summary: options.evidenceSummary ?? "API behavior is incomplete",
    }],
    gaps: [{
      id: "gap-api",
      summary: "Complete API behavior",
      ...(options.gapDetails !== undefined ? { details: options.gapDetails } : {}),
      suggestedTasks: ["Implement missing API branch", "Add regression coverage"],
    }],
  });
  if (evaluation.status !== "needs_work" || !evaluation.taskGroupDraft || !evaluation.confirmationToken) {
    throw new Error("fixture evaluation did not need work");
  }
  const stateRevision = options.sourceStateRevision ?? 8;
  const successor = deriveConvergenceSuccessorIdentityV2({
    changeName: "example",
    sourceRunId: "run-source",
    sourceStateRevision: stateRevision,
    sourceNonce: "nonce-source",
    confirmationToken: evaluation.confirmationToken,
    startedAt: STARTED_AT,
  });
  const postTasks = `${taskText}\n${evaluation.taskGroupDraft.markdown}`;
  return createConvergenceIntentV2({
    changeName: "example",
    sourceRunId: "run-source",
    sourceSessionId: "session-source",
    sourceStateRevision: stateRevision,
    sourceNonce: "nonce-source",
    expectedPostPlanningRevision: sha("planning-post"),
    preTaskBytes: taskText,
    postTaskBytes: postTasks,
    taskArtifactId: "work-items",
    taskArtifactPath: "/workspace/openspec/changes/example/work/items.md",
    successor,
    reusableEvidenceGroups: ["1"],
    evaluation,
  });
}

function sha(value: string): `sha256:${string}` {
  return hashConvergenceJsonV2("test-fixture", value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected record");
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("expected array");
  return value;
}

function evaluation(value: Record<string, unknown>): Record<string, unknown> {
  return asRecord(value["evaluation"]);
}

function evidence(value: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asArray(evaluation(value)["evidence"])[0]);
}

function gap(value: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asArray(evaluation(value)["gaps"])[0]);
}

function draft(value: Record<string, unknown>): Record<string, unknown> {
  return asRecord(evaluation(value)["taskGroupDraft"]);
}

function draftTask(value: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asArray(draft(value)["tasks"])[0]);
}

function recreate(
  baseline: ConvergenceIntentV2,
  evaluationResult: ConvergenceResultV2,
): ConvergenceIntentV2 {
  return createConvergenceIntentV2({
    changeName: baseline.changeName,
    sourceRunId: baseline.sourceRunId,
    sourceSessionId: baseline.sourceSessionId,
    sourceStateRevision: baseline.sourceStateRevision,
    sourceNonce: baseline.sourceNonce,
    expectedPostPlanningRevision: baseline.expectedPostPlanningRevision,
    preTaskBytes: PRE_TASKS,
    postTaskBytes: PRE_TASKS,
    taskArtifactId: baseline.taskArtifactId,
    taskArtifactPath: "/workspace/openspec/changes/example/work/items.md",
    successor: {
      runId: baseline.successorRunId,
      nonce: baseline.successorNonce,
      startedAt: baseline.successorStartedAt,
    },
    reusableEvidenceGroups: baseline.reusableEvidenceGroups,
    evaluation: evaluationResult,
  });
}
