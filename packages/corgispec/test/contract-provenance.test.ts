import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeDeliveryBindingDigest,
  createInitialTraceability,
  digestValue,
  loadChangeContract,
  writeChangeSource,
  writeChangeTraceability,
  type MaintenanceSource,
  type RfcSliceSource,
} from "../src/lib/change-contract.js";
import {
  validateContractProvenance,
  validateMaintenanceContractReferences,
} from "../src/lib/contract-provenance.js";
import { classifyMaintenance } from "../src/lib/maintenance.js";
import {
  acceptRfc,
  bindRfcSliceCas,
  createRfcDraft,
  ensureFoundationRfc,
  loadRfcDelivery,
  resolveAcceptedRfcSlice,
} from "../src/lib/rfc.js";
import {
  featureIssueMarker,
  maintenanceIssueMarker,
  repositoryIdentity,
} from "../src/lib/tracker.js";

describe("exact Change source provenance", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-provenance-"));
    mkdirSync(resolve(root, "openspec/changes"), { recursive: true });
    writeFileSync(resolve(root, "openspec/config.yaml"), [
      "schema: custom",
      "corgi:",
      "  contract: rfc-v1",
      "  tracking:",
      "    provider: none",
      "  rfcRoot: rfcs",
      "  foundation: RFC-0001-project-foundation",
      "  governance:",
      "    integrationBranch: main",
      "",
    ].join("\n"));
    git(["init", "-b", "main"]);
    git(["config", "user.email", "human@example.test"]);
    git(["config", "user.name", "Human Reviewer"]);
    ensureFoundationRfc({ projectDir: root });
    complete("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir: root,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("recomputes the accepted RFC, AC set, delivery binding, Issue, and marker", () => {
    const draft = createRfcDraft({ projectDir: root, slug: "export" });
    complete(draft.metadata.id, "S-01-export");
    acceptRfc({
      projectDir: root,
      rfcId: draft.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    git(["add", "."]);
    git(["commit", "-m", "accept RFCs"]);
    const effective = resolveAcceptedRfcSlice({
      projectDir: root,
      rfcId: draft.metadata.id,
      sliceId: "S-01-export",
    });
    const deliveryRef = `${effective.rfc.metadata.id}/${effective.slice.id}`;
    const marker = featureIssueMarker({
      repository: repositoryIdentity(root),
      deliveryRef,
      rfcDigest: effective.rfc.digest,
    });
    const source: RfcSliceSource = {
      schemaVersion: 1,
      kind: "rfc-slice",
      deliveryRef,
      rfc: {
        id: effective.rfc.metadata.id,
        path: relative(root, effective.rfc.directory).replace(/\\/gu, "/"),
        acceptedCommit: effective.acceptedCommit,
        digest: `sha256:${effective.rfc.digest}`,
      },
      slice: { id: effective.slice.id, digest: digestValue(effective.slice) },
      acceptance: effective.slice.acceptanceCriteria.map(({ id, evidence }) => ({ id, evidence })),
      deliveryBindingDigest: computeDeliveryBindingDigest({
        rfcId: effective.rfc.metadata.id,
        sliceId: effective.slice.id,
        change: "export-data",
        issue: { provider: "none" },
      }),
      tracker: { provider: "none", idempotencyKey: marker.key },
    };
    const changeRoot = resolve(root, "openspec/changes/export-data");
    const sourceDigest = writeChangeSource(changeRoot, source);
    writeChangeTraceability(changeRoot, createInitialTraceability(source, sourceDigest));
    const delivery = loadRfcDelivery(root, effective.rfc.metadata.id);
    bindRfcSliceCas({
      projectDir: root,
      rfcId: effective.rfc.metadata.id,
      sliceId: effective.slice.id,
      expectedRevision: delivery.revision,
      binding: {
        change: "export-data",
        issue: { provider: "none" },
        sourceDigest,
        plannedAt: "2026-08-14T00:00:00.000Z",
      },
    });
    const contract = loadChangeContract(changeRoot, { required: true })!;
    expect(validateContractProvenance(root, "export-data", contract)).toEqual([]);

    const pathDrift = structuredClone(contract);
    if (pathDrift.source.kind !== "rfc-slice") throw new Error("expected RFC source");
    pathDrift.source.rfc.path = "rfcs/RFC-9999-wrong";
    expect(validateContractProvenance(root, "export-data", pathDrift)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "RFC_PATH_DRIFT" })]),
    );

    const acDrift = structuredClone(contract);
    acDrift.source.acceptance[0]!.evidence = "automated";
    expect(validateContractProvenance(root, "export-data", acDrift)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "RFC_ACCEPTANCE_DRIFT" })]),
    );

    const markerDrift = structuredClone(contract);
    markerDrift.source.tracker.idempotencyKey = "wrong-marker";
    expect(validateContractProvenance(root, "export-data", markerDrift)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "TRACKER_MARKER_DRIFT" })]),
    );

    const issueDrift = structuredClone(contract);
    issueDrift.source.tracker.issue = { id: "99", url: "https://example.test/issues/99" };
    expect(validateContractProvenance(root, "export-data", issueDrift)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "RFC_DELIVERY_ISSUE_DRIFT" })]),
    );

    const bindingDrift = structuredClone(contract);
    if (bindingDrift.source.kind !== "rfc-slice") throw new Error("expected RFC source");
    bindingDrift.source.deliveryBindingDigest = `sha256:${"f".repeat(64)}`;
    expect(validateContractProvenance(root, "export-data", bindingDrift)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "RFC_DELIVERY_BINDING_DIGEST_DRIFT" })]),
    );
  });

  it("re-runs the closed maintenance classifier and canonical marker", () => {
    git(["add", "."]);
    git(["commit", "-m", "accept foundation"]);
    const description = "test coverage assertion";
    const classification = classifyMaintenance(description, []);
    const marker = maintenanceIssueMarker({
      repository: repositoryIdentity(root),
      changeName: "coverage-only",
      description,
    });
    const source: MaintenanceSource = {
      schemaVersion: 1,
      kind: "maintenance",
      deliveryRef: "maintenance/coverage-only",
      maintenance: {
        category: classification.category,
        description,
        reason: classification.reason,
        boundary: classification.boundary,
        contractRefs: [],
      },
      acceptance: classification.acceptance,
      tracker: { provider: "none", idempotencyKey: marker.key },
    };
    const changeRoot = resolve(root, "openspec/changes/coverage-only");
    const sourceDigest = writeChangeSource(changeRoot, source);
    writeChangeTraceability(changeRoot, createInitialTraceability(source, sourceDigest));
    const contract = loadChangeContract(changeRoot, { required: true })!;
    expect(validateContractProvenance(root, "coverage-only", contract)).toEqual([]);

    const drift = structuredClone(contract);
    if (drift.source.kind !== "maintenance") throw new Error("expected maintenance source");
    drift.source.maintenance.category = "docs-only";
    expect(validateContractProvenance(root, "coverage-only", drift)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "MAINTENANCE_CLASSIFICATION_DRIFT" })]),
    );

    const publicChange = structuredClone(contract);
    if (publicChange.source.kind !== "maintenance") throw new Error("expected maintenance source");
    publicChange.source.maintenance.description = "add public API";
    expect(validateContractProvenance(root, "coverage-only", publicChange)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "RFC_REQUIRED" })]),
    );
  });

  it("resolves contract-bug references to an effective RFC AC or canonical spec file", () => {
    git(["add", "."]);
    git(["commit", "-m", "accept foundation"]);
    expect(validateMaintenanceContractReferences(root, [
      "RFC-0001-project-foundation/AC-001",
    ])).toEqual([]);
    expect(validateMaintenanceContractReferences(root, ["nonsense"])).toEqual([
      expect.objectContaining({ code: "MAINTENANCE_CONTRACT_REFERENCE_INVALID" }),
    ]);
    mkdirSync(resolve(root, "openspec/specs/core"), { recursive: true });
    writeFileSync(resolve(root, "openspec/specs/core/contract.md"), "# Core\n\n## Existing behavior\n");
    expect(validateMaintenanceContractReferences(root, [
      "spec:openspec/specs/core/contract.md#Existing behavior",
    ])).toEqual([]);
    expect(validateMaintenanceContractReferences(root, [
      "spec:openspec/specs/core/missing.md",
    ])).toEqual([expect.objectContaining({ code: "MAINTENANCE_CONTRACT_REFERENCE_INVALID" })]);
  });

  function complete(rfcId: string, sliceId: string): void {
    writeFileSync(resolve(root, "rfcs", rfcId, "rfc.md"), [
      `# ${rfcId}`,
      "",
      "## Goal",
      "Deliver the accepted outcome.",
      "",
      "## Non-goals",
      "No unrelated work.",
      "",
      "## Boundary",
      "Only the selected Slice.",
      "",
      "## Slices",
      `### ${sliceId}: First delivery`,
      "- AC-001 [evidence: both]: The outcome is observable.",
      "",
      "## Risks",
      "Compatibility.",
      "",
    ].join("\n"));
  }

  function git(args: string[]): string {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  }
});
