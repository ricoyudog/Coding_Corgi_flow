import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInitialTraceability,
  loadChangeContract,
  validateChangeTraceability,
  writeChangeSource,
  writeChangeTraceability,
  type RfcSliceSource,
} from "../src/lib/change-contract.js";

const HASH = `sha256:${"a".repeat(64)}`;

describe("provider-neutral change contract", () => {
  let root = "";

  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function source(): RfcSliceSource {
    return {
      schemaVersion: 1,
      kind: "rfc-slice",
      deliveryRef: "RFC-0002-export/S-01-csv",
      rfc: {
        id: "RFC-0002-export",
        path: "rfcs/RFC-0002-export",
        acceptedCommit: "1".repeat(40),
        digest: HASH,
      },
      slice: { id: "S-01-csv", digest: HASH },
      acceptance: [{ id: "AC-001", evidence: "both" }],
      deliveryBindingDigest: HASH,
      tracker: { provider: "none", idempotencyKey: "delivery-key" },
    };
  }

  it("binds traceability to the exact source bytes", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-contract-"));
    const value = source();
    const sourceDigest = writeChangeSource(root, value);
    writeChangeTraceability(root, createInitialTraceability(value, sourceDigest));

    expect(loadChangeContract(root, { required: true })).toMatchObject({
      sourceDigest,
      source: { deliveryRef: value.deliveryRef },
    });

    writeFileSync(
      resolve(root, "corgi/source.yaml"),
      `${readFileSync(resolve(root, "corgi/source.yaml"), "utf8")}# drift\n`,
    );
    expect(() => loadChangeContract(root, { required: true })).toThrowError(
      expect.objectContaining({ code: "SOURCE_DIGEST_MISMATCH" }),
    );
  });

  it("requires every acceptance criterion to map to artifacts and Task Groups", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-contract-"));
    mkdirSync(resolve(root, "specs"), { recursive: true });
    writeFileSync(resolve(root, "specs/export.md"), "# Export\n\n## CSV\n");
    const value = source();
    const sourceDigest = writeChangeSource(root, value);
    writeChangeTraceability(root, {
      schemaVersion: 1,
      sourceDigest,
      acceptance: [{
        id: "AC-001",
        evidence: "both",
        planningRefs: [{ path: "specs/export.md", anchor: "csv" }],
        taskGroups: ["1"],
      }],
    });
    const contract = loadChangeContract(root, { required: true })!;
    const failures = validateChangeTraceability(
      contract,
      root,
      {
        specs: {
          outputPath: "specs/*.md",
          resolvedOutputPath: resolve(root, "specs/*.md"),
          existingOutputPaths: [resolve(root, "specs/export.md")],
        },
      },
      [{
        number: 1,
        name: "Export",
        tasks: [],
        totalTasks: 1,
        completedTasks: 0,
        status: "pending",
        line: 1,
      }],
    );
    expect(failures).toEqual([]);
  });

  it("rejects duplicate traceability targets and missing planning anchors", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-contract-"));
    mkdirSync(resolve(root, "specs"), { recursive: true });
    writeFileSync(resolve(root, "specs/export.md"), "# Export\n");
    const value = source();
    const sourceDigest = writeChangeSource(root, value);
    writeChangeTraceability(root, {
      schemaVersion: 1,
      sourceDigest,
      acceptance: [{
        id: "AC-001",
        evidence: "both",
        planningRefs: [
          { path: "specs/export.md", anchor: "missing" },
          { path: "specs/export.md", anchor: "missing" },
        ],
        taskGroups: ["1", "1"],
      }],
    });
    const contract = loadChangeContract(root, { required: true })!;
    const failures = validateChangeTraceability(
      contract,
      root,
      {
        specs: {
          outputPath: "specs/*.md",
          resolvedOutputPath: resolve(root, "specs/*.md"),
          existingOutputPaths: [resolve(root, "specs/export.md")],
        },
      },
      [{
        number: 1,
        name: "Export",
        tasks: [],
        totalTasks: 1,
        completedTasks: 0,
        status: "pending",
        line: 1,
      }],
    );
    expect(failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "TRACEABILITY_UNKNOWN_PLANNING_ANCHOR" }),
      expect.objectContaining({ code: "TRACEABILITY_DUPLICATE_PLANNING_REF" }),
      expect.objectContaining({ code: "TRACEABILITY_DUPLICATE_TASK_GROUP" }),
    ]));
  });

  it("keeps incomplete draft traceability readable but not ready", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-contract-"));
    const value = source();
    const sourceDigest = writeChangeSource(root, value);
    writeChangeTraceability(root, createInitialTraceability(value, sourceDigest));
    const contract = loadChangeContract(root, { required: true })!;
    expect(validateChangeTraceability(contract, root, {}, [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TRACEABILITY_MISSING_PLANNING_REF" }),
        expect.objectContaining({ code: "TRACEABILITY_MISSING_TASK_GROUP" }),
      ]),
    );
  });

  it("rejects malformed source and traceability shapes before writing either sidecar", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-contract-invalid-"));
    const invalidSources: unknown[] = [
      { ...source(), kind: "unknown" },
      { ...source(), acceptance: [] },
      { ...source(), acceptance: [{ id: "AC-001", evidence: "both" }, { id: "AC-001", evidence: "human" }] },
      { ...source(), tracker: { provider: "github", idempotencyKey: "delivery-key" } },
      { ...source(), rfc: { ...source().rfc, id: "not-an-rfc" } },
      { ...source(), rfc: { ...source().rfc, path: "../outside" } },
      { ...source(), rfc: { ...source().rfc, acceptedCommit: "short" } },
      { ...source(), slice: { ...source().slice, id: "not-a-slice" } },
      {
        schemaVersion: 1,
        kind: "maintenance",
        deliveryRef: "maintenance/contract-bug",
        maintenance: {
          category: "contract-bug",
          description: "Fix an existing contract bug.",
          reason: "Existing behavior is contradicted.",
          boundary: "No new public surface.",
          contractRefs: [],
        },
        acceptance: [{ id: "MC-001", evidence: "automated" }],
        tracker: { provider: "none", idempotencyKey: "maintenance-key" },
      },
    ];
    for (const value of invalidSources) {
      expect(() => writeChangeSource(root, value as RfcSliceSource))
        .toThrowError(expect.objectContaining({ code: "CHANGE_CONTRACT_INVALID" }));
    }

    const sourceDigest = writeChangeSource(root, source());
    const invalidTraceability: unknown[] = [
      { schemaVersion: 2, sourceDigest, acceptance: [] },
      { schemaVersion: 1, sourceDigest: "not-a-hash", acceptance: [] },
      { schemaVersion: 1, sourceDigest, acceptance: "not-an-array" },
      {
        schemaVersion: 1,
        sourceDigest,
        acceptance: [{ id: "AC-001", evidence: "unknown", planningRefs: [], taskGroups: [] }],
      },
      {
        schemaVersion: 1,
        sourceDigest,
        acceptance: [{ id: "AC-001", evidence: "both", planningRefs: [{ path: "spec.md", anchor: 42 }], taskGroups: ["1"] }],
      },
    ];
    for (const value of invalidTraceability) {
      expect(() => writeChangeTraceability(root, value as ReturnType<typeof createInitialTraceability>))
        .toThrowError(expect.objectContaining({ code: "CHANGE_CONTRACT_INVALID" }));
    }
  });

  it("reports every semantic traceability drift without ignoring the remaining acceptance set", () => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-contract-semantic-"));
    mkdirSync(resolve(root, "specs"), { recursive: true });
    writeFileSync(resolve(root, "specs/plan.md"), "# Plan {#explicit-id}\n");
    const value = source();
    value.acceptance = [
      { id: "AC-001", evidence: "both" },
      { id: "AC-002", evidence: "automated" },
    ];
    const sourceDigest = writeChangeSource(root, value);
    writeChangeTraceability(root, {
      schemaVersion: 1,
      sourceDigest,
      acceptance: [
        {
          id: "AC-001",
          evidence: "human",
          planningRefs: [
            { path: "specs/plan.md", anchor: "explicit-id" },
            { path: "specs/plan.md", anchor: "missing" },
            { path: "missing.md" },
            { path: "missing.md" },
          ],
          taskGroups: ["1", "1", "99"],
        },
        {
          id: "AC-001",
          evidence: "both",
          planningRefs: [],
          taskGroups: [],
        },
        {
          id: "AC-999",
          evidence: "automated",
          planningRefs: [],
          taskGroups: [],
        },
      ],
    });
    const contract = loadChangeContract(root, { required: true })!;
    const failures = validateChangeTraceability(
      contract,
      root,
      {
        specs: {
          outputPath: "specs/*.md",
          resolvedOutputPath: resolve(root, "specs/*.md"),
          existingOutputPaths: [resolve(root, "specs/plan.md")],
        },
      },
      [{
        number: 1,
        name: "Plan",
        tasks: [],
        totalTasks: 1,
        completedTasks: 0,
        status: "pending",
        line: 1,
      }],
    );
    expect(failures.map((failure) => failure.code)).toEqual(expect.arrayContaining([
      "TRACEABILITY_EVIDENCE_MISMATCH",
      "TRACEABILITY_UNKNOWN_PLANNING_ANCHOR",
      "TRACEABILITY_UNKNOWN_PLANNING_REF",
      "TRACEABILITY_DUPLICATE_PLANNING_REF",
      "TRACEABILITY_DUPLICATE_TASK_GROUP",
      "TRACEABILITY_UNKNOWN_TASK_GROUP",
      "TRACEABILITY_DUPLICATE_ACCEPTANCE",
      "TRACEABILITY_UNKNOWN_ACCEPTANCE",
      "TRACEABILITY_MISSING_ACCEPTANCE",
    ]));
  });
});
