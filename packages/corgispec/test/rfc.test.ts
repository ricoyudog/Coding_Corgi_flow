import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptRfc,
  adoptRfcAmendmentSliceCas,
  archiveRfcSliceCas,
  assertFoundationAccepted,
  bindRfcSliceCas,
  computeRfcDigest,
  createGovernanceRfcDraft,
  createRfcDraft,
  ensureFoundationRfc,
  loadRfc,
  listRfcs,
  loadRfcStatus,
  loadRfcDelivery,
  parseRfcDocument,
  renumberDraftRfc,
  resolveAcceptedRfcSlice,
  validateRfc,
  RfcError,
} from "../src/lib/rfc.js";

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(resolve(tmpdir(), "corgispec-rfc-"));
  mkdirSync(resolve(projectDir, "openspec"), { recursive: true });
  writeFileSync(
    resolve(projectDir, "openspec/config.yaml"),
    [
      "schema: custom-flow",
      "corgi:",
      "  tracking:",
      "    provider: none",
      "  contract: rfc-v1",
      "  rfcRoot: rfcs",
      "  foundation: RFC-0001-project-foundation",
      "  governance:",
      "    integrationBranch: main",
      "",
    ].join("\n"),
  );
  git(["init", "-b", "main"]);
  git(["config", "user.email", "human@example.test"]);
  git(["config", "user.name", "Human Reviewer"]);
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("RFC document contract", () => {
  it("parses Slice ownership and evidence requirements", () => {
    const slices = parseRfcDocument(validDocument("RFC-0002-export", "S-01-export"));
    expect(slices).toEqual([
      {
        id: "S-01-export",
        title: "First delivery",
        acceptanceCriteria: [
          { id: "AC-001", evidence: "both", statement: "Export is observable." },
        ],
      },
    ]);
  });

  it("rejects duplicate AC ownership and placeholders", () => {
    expect(() => parseRfcDocument(validDocument("RFC-0002-export", "S-01-export")
      .replace("## Risks", "### S-02-audit\n\n- AC-001 [evidence: human]: Duplicate.\n\n## Risks")))
      .toThrow(/assigned more than once/);
    expect(() => parseRfcDocument(validDocument("RFC-0002-export", "S-01-export") + "\nTODO"))
      .toThrow(/placeholders/);
  });

  it("rejects incomplete and ambiguous normative sections while preserving an untitled Slice id", () => {
    const document = validDocument("RFC-0002-export", "S-01-export");
    expect(computeRfcDigest(document.replace(/\n/g, "\r\n"))).toBe(computeRfcDigest(document));
    expect(() => parseRfcDocument(document.replace("## Goal", "## Outcome")))
      .toThrowError(expect.objectContaining({ code: "RFC_SECTION_MISSING" }));
    expect(() => parseRfcDocument(document.replace("Deliver an observable user outcome.", "")))
      .toThrowError(expect.objectContaining({ code: "RFC_SECTION_EMPTY" }));
    expect(() => parseRfcDocument(document.replace("## Risks", "## Goal\n\nA second goal.\n\n## Risks")))
      .toThrowError(expect.objectContaining({ code: "RFC_SECTION_DUPLICATE" }));
    expect(() => parseRfcDocument(document.replace("### S-01-export: First delivery", "No Slice heading")))
      .toThrowError(expect.objectContaining({ code: "RFC_SLICE_MISSING" }));
    expect(() => parseRfcDocument(document.replace("- AC-001 [evidence: both]: Export is observable.", "A criterion without an id.")))
      .toThrowError(expect.objectContaining({ code: "RFC_AC_MISSING" }));
    expect(() => parseRfcDocument(document.replace(
      "## Risks",
      "### S-01-export: Duplicate\n\n- AC-002 [evidence: automated]: Duplicate Slice.\n\n## Risks",
    ))).toThrowError(expect.objectContaining({ code: "RFC_SLICE_INVALID" }));
    expect(parseRfcDocument(document.replace("S-01-export: First delivery", "S-01-export"))[0])
      .toMatchObject({ id: "S-01-export", title: "S-01-export" });
  });
});

describe("RFC lifecycle", () => {
  it("routes superseded contracts through one Amendment lineage and adopts a planned Slice atomically", () => {
    ensureFoundationRfc({ projectDir });
    completeRfc("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
    const feature = createRfcDraft({ projectDir, slug: "export" });
    completeRfc(feature.metadata.id, "S-01-export");
    acceptRfc({
      projectDir,
      rfcId: feature.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    git(["add", "."]);
    git(["commit", "-m", "accept original RFC"]);
    const original = resolveAcceptedRfcSlice({
      projectDir,
      rfcId: feature.metadata.id,
      sliceId: "S-01-export",
    });
    const originalBinding = {
      change: "export-data",
      issue: { provider: "none" as const },
      sourceDigest: `sha256:${original.rfc.digest}`,
      plannedAt: "2026-08-14T00:00:00.000Z",
    };
    const originalDelivery = loadRfcDelivery(projectDir, feature.metadata.id);
    bindRfcSliceCas({
      projectDir,
      rfcId: feature.metadata.id,
      sliceId: "S-01-export",
      expectedRevision: originalDelivery.revision,
      binding: originalBinding,
    });

    const amendment = createRfcDraft({
      projectDir,
      slug: "amend-export",
      amends: feature.metadata.id,
    });
    completeRfc(amendment.metadata.id, "S-01-export");
    acceptRfc({
      projectDir,
      rfcId: amendment.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    git(["add", "."]);
    git(["commit", "-m", "accept Amendment RFC"]);

    for (const rfcId of [feature.metadata.id, amendment.metadata.id]) {
      expect(() => resolveAcceptedRfcSlice({ projectDir, rfcId, sliceId: "S-01-export" }))
        .toThrowError(expect.objectContaining({ code: "RFC_AMENDMENT_ADOPTION_REQUIRED" }));
    }
    const amendmentBinding = {
      ...originalBinding,
      sourceDigest: `sha256:${loadRfc(projectDir, amendment.metadata.id).digest}`,
    };
    const result = adoptRfcAmendmentSliceCas({
      projectDir,
      fromRfcId: feature.metadata.id,
      toRfcId: amendment.metadata.id,
      sliceId: "S-01-export",
      expectedFromRevision: loadRfcDelivery(projectDir, feature.metadata.id).revision,
      expectedToRevision: loadRfcDelivery(projectDir, amendment.metadata.id).revision,
      binding: amendmentBinding,
    });
    expect(result.idempotent).toBe(false);
    expect(result.from.slices["S-01-export"]).toMatchObject({
      status: "superseded",
      binding: { change: "export-data" },
      supersededBy: { rfcId: amendment.metadata.id, sliceId: "S-01-export" },
    });
    expect(result.to.slices["S-01-export"]).toMatchObject({
      status: "planned",
      binding: { change: "export-data", sourceDigest: amendmentBinding.sourceDigest },
    });
    expect(resolveAcceptedRfcSlice({
      projectDir,
      rfcId: feature.metadata.id,
      sliceId: "S-01-export",
    }).rfc.metadata.id).toBe(amendment.metadata.id);
    expect(adoptRfcAmendmentSliceCas({
      projectDir,
      fromRfcId: feature.metadata.id,
      toRfcId: amendment.metadata.id,
      sliceId: "S-01-export",
      expectedFromRevision: originalDelivery.revision,
      expectedToRevision: 0,
      binding: amendmentBinding,
    }).idempotent).toBe(true);
  });

  it("scaffolds invalid human drafts and accepts only completed RFCs", () => {
    ensureFoundationRfc({ projectDir });
    expect(validateRfc(projectDir, "RFC-0001-project-foundation")).toMatchObject({ valid: false });
    expect(loadRfcStatus(projectDir, "RFC-0001-project-foundation")).toMatchObject({
      rfc: { metadata: { status: "draft" }, slices: [{ id: "S-01-project-foundation" }] },
      validation: { valid: false, issues: [{ code: "RFC_PLACEHOLDER" }] },
      delivery: { revision: 0 },
    });
    expect(() => acceptRfc({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: false,
    })).toThrowError(expect.objectContaining({ code: "RFC_HUMAN_APPROVAL_REQUIRED" }));

    completeRfc("RFC-0001-project-foundation", "S-01-project-foundation");
    const accepted = acceptRfc({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
      now: new Date("2026-08-14T00:00:00.000Z"),
    });
    expect(accepted.metadata.status).toBe("accepted");
    expect(accepted.metadata.acceptance?.digest).toBe(accepted.digest);
    expect(loadRfcDelivery(projectDir, accepted.metadata.id).revision).toBe(1);
  });

  it("enforces accepted immutability", () => {
    ensureFoundationRfc({ projectDir });
    completeRfc("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
    writeFileSync(
      resolve(projectDir, "rfcs/RFC-0001-project-foundation/rfc.md"),
      validDocument("RFC-0001-project-foundation", "S-01-project-foundation") + "\nchanged\n",
    );
    expect(() => loadRfc(projectDir, "RFC-0001-project-foundation"))
      .toThrowError(expect.objectContaining({ code: "RFC_ACCEPTED_DRIFT" }));
  });

  it("rolls back rfc.yaml and delivery.yaml byte-for-byte when acceptance cannot commit both", () => {
    ensureFoundationRfc({ projectDir });
    completeRfc("RFC-0001-project-foundation", "S-01-project-foundation");
    const metadataPath = resolve(projectDir, "rfcs/RFC-0001-project-foundation/rfc.yaml");
    const deliveryPath = resolve(projectDir, "rfcs/RFC-0001-project-foundation/delivery.yaml");
    const beforeMetadata = readFileSync(metadataPath);
    const beforeDelivery = readFileSync(deliveryPath);
    const timestamp = 1_723_593_600_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(timestamp);
    const collision = `${deliveryPath}.tmp-${process.pid}-${timestamp}`;
    writeFileSync(collision, "force the second atomic write to fail\n");
    try {
      expect(() => acceptRfc({
        projectDir,
        rfcId: "RFC-0001-project-foundation",
        approver: "human@example.test",
        humanConfirmed: true,
      })).toThrow();
      expect(readFileSync(metadataPath)).toEqual(beforeMetadata);
      expect(readFileSync(deliveryPath)).toEqual(beforeDelivery);
      expect(loadRfc(projectDir, "RFC-0001-project-foundation").metadata.status).toBe("draft");
    } finally {
      clock.mockRestore();
      rmSync(collision, { force: true });
    }
  });

  it("rejects duplicate numeric prefixes across semantic RFC slugs", () => {
    ensureFoundationRfc({ projectDir });
    mkdirSync(resolve(projectDir, "rfcs/RFC-0002-a"));
    mkdirSync(resolve(projectDir, "rfcs/RFC-0002-b"));
    expect(() => listRfcs(projectDir)).toThrowError(
      expect.objectContaining({ code: "RFC_NUMBER_CONFLICT" }),
    );
  });

  it("renumbers only drafts and updates sidecars", () => {
    ensureFoundationRfc({ projectDir });
    const feature = createRfcDraft({ projectDir, slug: "export" });
    const renamed = renumberDraftRfc(projectDir, feature.metadata.id);
    expect(renamed.metadata.id).toBe("RFC-0003-export");
    expect(loadRfcDelivery(projectDir, renamed.metadata.id).rfcId).toBe("RFC-0003-export");

    completeRfc("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
    expect(() => renumberDraftRfc(projectDir, "RFC-0001-project-foundation"))
      .toThrowError(expect.objectContaining({ code: "RFC_RENUMBER_ACCEPTED" }));
  });

  it("reconciles renamed draft Slices only when stale delivery entries are unbound", () => {
    ensureFoundationRfc({ projectDir });
    const safeDraft = createRfcDraft({ projectDir, slug: "rename-safe" });
    completeRfc(safeDraft.metadata.id, "S-01-renamed");
    acceptRfc({
      projectDir,
      rfcId: safeDraft.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    expect(loadRfcDelivery(projectDir, safeDraft.metadata.id).slices).toEqual({
      "S-01-renamed": { status: "unbound" },
    });

    const unsafeDraft = createRfcDraft({ projectDir, slug: "rename-unsafe" });
    const staleSlice = unsafeDraft.slices[0]!.id;
    writeFileSync(unsafeDraft.deliveryPath, [
      "schemaVersion: 1",
      `rfcId: ${unsafeDraft.metadata.id}`,
      "revision: 0",
      "slices:",
      `  ${staleSlice}:`,
      "    status: planned",
      "    binding:",
      "      change: existing-change",
      "      issue:",
      "        provider: none",
      "      sourceDigest: existing-source",
      "      plannedAt: 2026-08-14T00:00:00.000Z",
      "",
    ].join("\n"));
    completeRfc(unsafeDraft.metadata.id, "S-01-renamed-again");
    expect(validateRfc(projectDir, unsafeDraft.metadata.id)).toMatchObject({
      valid: false,
      issues: [{ code: "RFC_DELIVERY_UNKNOWN_SLICE" }],
    });
    expect(() => acceptRfc({
      projectDir,
      rfcId: unsafeDraft.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    })).toThrowError(expect.objectContaining({ code: "RFC_INVALID" }));
  });

  it("requires accepted RFCs on an integration ancestor and binds a Slice with CAS", () => {
    ensureFoundationRfc({ projectDir });
    completeRfc("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
    const feature = createRfcDraft({ projectDir, slug: "export" });
    completeRfc(feature.metadata.id, "S-01-export");
    acceptRfc({
      projectDir,
      rfcId: feature.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    git(["add", "."]);
    git(["commit", "-m", "accept foundation and export RFCs"]);

    const resolved = resolveAcceptedRfcSlice({
      projectDir,
      rfcId: feature.metadata.id,
      sliceId: "S-01-export",
    });
    expect(resolved.integrationBranch).toBe("main");
    expect(resolved.acceptedCommit).toMatch(/^[a-f0-9]{40}$/);
    expect(resolved.slice.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(["AC-001"]);
    expect(assertFoundationAccepted(projectDir).metadata.id).toBe("RFC-0001-project-foundation");

    const before = loadRfcDelivery(projectDir, feature.metadata.id);
    const binding = {
      change: "export-data",
      issue: { provider: "none" as const },
      sourceDigest: resolved.rfc.digest,
      plannedAt: "2026-08-14T00:00:00.000Z",
    };
    const first = bindRfcSliceCas({
      projectDir,
      rfcId: feature.metadata.id,
      sliceId: "S-01-export",
      expectedRevision: before.revision,
      binding,
    });
    expect(first).toMatchObject({ idempotent: false, delivery: { revision: before.revision + 1 } });
    expect(bindRfcSliceCas({
      projectDir,
      rfcId: feature.metadata.id,
      sliceId: "S-01-export",
      expectedRevision: before.revision,
      binding: { ...binding, plannedAt: "2026-08-14T01:00:00.000Z" },
    }).idempotent).toBe(true);
  });

  it("fails the effective gate before RFCs are merged", () => {
    ensureFoundationRfc({ projectDir });
    completeRfc("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
    expect(() => resolveAcceptedRfcSlice({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      sliceId: "S-01-project-foundation",
    })).toThrow(RfcError);
  });

  it("keeps an accepted RFC effective when the integration branch advances independently", () => {
    ensureFoundationRfc({ projectDir });
    completeRfc("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
    git(["add", "."]);
    git(["commit", "-m", "accept foundation"]);
    git(["switch", "-c", "feature/delivery"]);
    git(["switch", "main"]);
    writeFileSync(resolve(projectDir, "unrelated.md"), "unrelated\n");
    git(["add", "unrelated.md"]);
    git(["commit", "-m", "advance main"]);
    git(["switch", "feature/delivery"]);

    expect(resolveAcceptedRfcSlice({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      sliceId: "S-01-project-foundation",
    }).acceptedCommit).toMatch(/^[a-f0-9]{40}$/);
  });

  it("requires integration metadata to match type, amends, author, and acceptance exactly", () => {
    ensureFoundationRfc({ projectDir });
    completeRfc("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
      now: new Date("2026-08-14T00:00:00.000Z"),
    });
    git(["add", "."]);
    git(["commit", "-m", "accept foundation"]);
    const metadataPath = resolve(projectDir, "rfcs/RFC-0001-project-foundation/rfc.yaml");
    const original = readFileSync(metadataPath, "utf8");
    const mutations = [
      original.replace("type: foundation", "type: feature"),
      original.replace("author: human@example.test", "author: other@example.test"),
      original.replace("type: foundation", "type: foundation\namends: RFC-0002-other"),
      original.replace("approver: human@example.test", "approver: other@example.test"),
    ];
    for (const mutation of mutations) {
      writeFileSync(metadataPath, mutation);
      expect(() => resolveAcceptedRfcSlice({
        projectDir,
        rfcId: "RFC-0001-project-foundation",
        sliceId: "S-01-project-foundation",
      })).toThrowError(expect.objectContaining({ code: "RFC_NOT_EFFECTIVE" }));
      writeFileSync(metadataPath, original);
    }
  });
});

describe("RFC persistence and delivery safety", () => {
  it("rejects malformed metadata at the persisted RFC boundary", () => {
    const draft = createRfcDraft({ projectDir, slug: "metadata" });
    completeRfc(draft.metadata.id, "S-01-metadata");
    const metadataPath = draft.metadataPath;
    const digest = computeRfcDigest(readFileSync(draft.documentPath, "utf8"));
    const base = [
      "schemaVersion: 1",
      `id: ${draft.metadata.id}`,
      "type: feature",
      "status: draft",
      "author: author@example.test",
      "createdAt: '2026-08-14T00:00:00.000Z'",
      "",
    ].join("\n");
    const cases = [
      { content: "[]\n", code: "RFC_METADATA_INVALID" },
      { content: base.replace("schemaVersion: 1", "schemaVersion: 2"), code: "RFC_METADATA_VERSION" },
      { content: base.replace(draft.metadata.id, "RFC-0009-wrong"), code: "RFC_METADATA_ID" },
      { content: base.replace("type: feature", "type: unknown"), code: "RFC_METADATA_TYPE" },
      { content: base.replace("status: draft", "status: paused"), code: "RFC_METADATA_STATUS" },
      { content: base.replace("author: author@example.test", "author: ''"), code: "RFC_METADATA_AUTHOR" },
      { content: base.replace("2026-08-14T00:00:00.000Z", "not-a-date"), code: "RFC_METADATA_DATE" },
      { content: base.replace("type: feature", "type: foundation"), code: "RFC_FOUNDATION_ID" },
      { content: base.replace("type: feature", "type: amendment"), code: "RFC_AMENDMENT_TARGET" },
      { content: base.replace("status: draft", "status: accepted"), code: "RFC_ACCEPTANCE_MISSING" },
      {
        content: `${base}acceptance:\n  approver: human@example.test\n  approvedAt: '2026-08-14T00:00:00.000Z'\n  digest: ${digest}\n`,
        code: "RFC_DRAFT_ACCEPTANCE",
      },
      {
        content: `${base.replace("status: draft", "status: accepted")}acceptance: not-a-mapping\n`,
        code: "RFC_ACCEPTANCE_INVALID",
      },
      {
        content: `${base.replace("status: draft", "status: accepted")}acceptance:\n  approver: ''\n  approvedAt: '2026-08-14T00:00:00.000Z'\n  digest: ${digest}\n`,
        code: "RFC_ACCEPTANCE_APPROVER",
      },
      {
        content: `${base.replace("status: draft", "status: accepted")}acceptance:\n  approver: human@example.test\n  approvedAt: not-a-date\n  digest: ${digest}\n`,
        code: "RFC_ACCEPTANCE_DATE",
      },
      {
        content: `${base.replace("status: draft", "status: accepted")}acceptance:\n  approver: human@example.test\n  approvedAt: '2026-08-14T00:00:00.000Z'\n  digest: not-a-digest\n`,
        code: "RFC_ACCEPTANCE_DIGEST",
      },
    ];
    for (const { content, code } of cases) {
      writeFileSync(metadataPath, content);
      expect(() => loadRfc(projectDir, draft.metadata.id))
        .toThrowError(expect.objectContaining({ code }));
    }
  });

  it("validates every delivery state and its mutually exclusive sidecars", () => {
    const draft = createRfcDraft({ projectDir, slug: "delivery" });
    completeRfc(draft.metadata.id, "S-01-delivery");
    const deliveryFor = (slice: string[]) => [
      "schemaVersion: 1",
      `rfcId: ${draft.metadata.id}`,
      "revision: 0",
      "slices:",
      ...slice.map((line) => `  ${line}`),
      "",
    ].join("\n");
    const plannedBinding = [
      "  binding:",
      "    change: delivery-change",
      "    sourceDigest: source-digest",
      "    plannedAt: '2026-08-14T00:00:00.000Z'",
    ];
    const cases = [
      { content: "[unclosed", code: "RFC_DELIVERY_INVALID" },
      { content: deliveryFor(["S-01-delivery:", "  status: unbound"]).replace("revision: 0", "revision: -1"), code: "RFC_DELIVERY_INVALID" },
      { content: deliveryFor(["S-01-delivery:", "  status: unbound"]).replace(draft.metadata.id, "RFC-0009-wrong"), code: "RFC_DELIVERY_ID" },
      { content: deliveryFor(["not-a-slice:", "  status: unbound"]), code: "RFC_DELIVERY_SLICE_INVALID" },
      { content: deliveryFor(["S-01-delivery:", "  status: unbound", ...plannedBinding]), code: "RFC_DELIVERY_BINDING" },
      { content: deliveryFor(["S-01-delivery:", "  status: planned", "  binding:", "    change: delivery-change"]), code: "RFC_DELIVERY_BINDING" },
      {
        content: deliveryFor([
          "S-01-delivery:",
          "  status: planned",
          ...plannedBinding,
          "    issue:",
          "      provider: linear",
        ]),
        code: "RFC_DELIVERY_ISSUE",
      },
      { content: deliveryFor(["S-01-delivery:", "  status: superseded"]), code: "RFC_DELIVERY_SUPERSEDED" },
      {
        content: deliveryFor([
          "S-01-delivery:",
          "  status: planned",
          ...plannedBinding,
          "  supersededBy:",
          "    rfcId: RFC-0003-next",
          "    sliceId: S-01-delivery",
        ]),
        code: "RFC_DELIVERY_SUPERSEDED",
      },
      {
        content: deliveryFor([
          "S-01-delivery:",
          "  status: planned",
          ...plannedBinding,
          "  archive:",
          "    archivedAt: '2026-08-14T00:00:00.000Z'",
          "    commit: abc123",
          "    evidenceManifest: evidence/manifest.json",
        ]),
        code: "RFC_DELIVERY_ARCHIVE",
      },
      { content: deliveryFor(["S-01-delivery:", "  status: archived", ...plannedBinding]), code: "RFC_DELIVERY_ARCHIVE" },
    ];
    for (const { content, code } of cases) {
      writeFileSync(draft.deliveryPath, content);
      expect(() => loadRfcDelivery(projectDir, draft.metadata.id))
        .toThrowError(expect.objectContaining({ code }));
    }

    writeFileSync(draft.deliveryPath, deliveryFor([
      "S-01-delivery:",
      "  status: archived",
      ...plannedBinding,
      "    issue:",
      "      provider: github",
      "      id: '42'",
      "      url: https://example.test/issues/42",
      "  archive:",
      "    archivedAt: '2026-08-14T00:00:00.000Z'",
      "    commit: abc123",
      "    evidenceManifest: evidence/manifest.json",
    ]));
    expect(loadRfcDelivery(projectDir, draft.metadata.id).slices["S-01-delivery"])
      .toMatchObject({
        status: "archived",
        binding: { issue: { provider: "github", id: "42", url: "https://example.test/issues/42" } },
        archive: { commit: "abc123" },
      });

    writeFileSync(draft.deliveryPath, deliveryFor([
      "S-01-delivery:",
      "  status: superseded",
      "  supersededBy:",
      "    rfcId: RFC-0003-next",
      "    sliceId: S-01-delivery",
    ]));
    expect(loadRfcDelivery(projectDir, draft.metadata.id).slices["S-01-delivery"])
      .toEqual({ status: "superseded", supersededBy: { rfcId: "RFC-0003-next", sliceId: "S-01-delivery" } });
  });

  it("guards delivery CAS, archive idempotence, and conflicting archive evidence", () => {
    const foundation = acceptFoundation();
    const binding = {
      change: "foundation-change",
      issue: { provider: "none" as const },
      sourceDigest: foundation.digest,
      plannedAt: "2026-08-14T00:00:00.000Z",
    };
    const evidence = {
      archivedAt: "2026-08-14T01:00:00.000Z",
      commit: "abc123",
      evidenceManifest: "evidence/manifest.json",
    };
    const original = loadRfcDelivery(projectDir, foundation.metadata.id);
    expect(() => archiveRfcSliceCas({
      projectDir,
      rfcId: foundation.metadata.id,
      sliceId: "S-01-project-foundation",
      expectedRevision: original.revision,
      evidence,
    })).toThrowError(expect.objectContaining({ code: "RFC_SLICE_UNBOUND" }));

    const planned = bindRfcSliceCas({
      projectDir,
      rfcId: foundation.metadata.id,
      sliceId: "S-01-project-foundation",
      expectedRevision: original.revision,
      binding,
    }).delivery;
    expect(() => bindRfcSliceCas({
      projectDir,
      rfcId: foundation.metadata.id,
      sliceId: "S-01-project-foundation",
      expectedRevision: planned.revision,
      binding: { ...binding, change: "another-change" },
    })).toThrowError(expect.objectContaining({ code: "RFC_SLICE_BOUND" }));
    expect(() => archiveRfcSliceCas({
      projectDir,
      rfcId: foundation.metadata.id,
      sliceId: "S-01-project-foundation",
      expectedRevision: planned.revision + 1,
      evidence,
    })).toThrowError(expect.objectContaining({ code: "RFC_DELIVERY_CAS" }));

    const archived = archiveRfcSliceCas({
      projectDir,
      rfcId: foundation.metadata.id,
      sliceId: "S-01-project-foundation",
      expectedRevision: planned.revision,
      evidence,
    });
    expect(archived).toMatchObject({ idempotent: false, delivery: { revision: planned.revision + 1 } });
    expect(archiveRfcSliceCas({
      projectDir,
      rfcId: foundation.metadata.id,
      sliceId: "S-01-project-foundation",
      expectedRevision: planned.revision,
      evidence,
    }).idempotent).toBe(true);
    expect(() => archiveRfcSliceCas({
      projectDir,
      rfcId: foundation.metadata.id,
      sliceId: "S-01-project-foundation",
      expectedRevision: planned.revision,
      evidence: { ...evidence, commit: "different" },
    })).toThrowError(expect.objectContaining({ code: "RFC_SLICE_ARCHIVE_CONFLICT" }));
  });

  it("requires an accepted, complete target before accepting an Amendment", () => {
    const feature = createRfcDraft({ projectDir, slug: "unaccepted-target" });
    completeRfc(feature.metadata.id, "S-01-unaccepted-target");
    const amendment = createRfcDraft({
      projectDir,
      slug: "amend-unaccepted-target",
      amends: feature.metadata.id,
    });
    completeRfc(amendment.metadata.id, "S-01-unaccepted-target");
    expect(() => acceptRfc({
      projectDir,
      rfcId: amendment.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    })).toThrowError(expect.objectContaining({ code: "RFC_AMENDMENT_TARGET_UNACCEPTED" }));
  });

  it("rejects Amendments that omit undelivered target Slices", () => {
    acceptFoundation();
    const feature = createRfcDraft({ projectDir, slug: "two-slices" });
    completeTwoSliceRfc(feature.metadata.id);
    acceptRfc({
      projectDir,
      rfcId: feature.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    const amendment = createRfcDraft({ projectDir, slug: "amend-two-slices", amends: feature.metadata.id });
    completeRfc(amendment.metadata.id, "S-01-export");
    expect(() => acceptRfc({
      projectDir,
      rfcId: amendment.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    })).toThrowError(expect.objectContaining({ code: "RFC_AMENDMENT_SLICE_OMITTED" }));
  });

  it("supersedes unbound target Slices while preserving planned delivery during Amendment acceptance", () => {
    acceptFoundation();
    const feature = createRfcDraft({ projectDir, slug: "amendable" });
    completeTwoSliceRfc(feature.metadata.id);
    const acceptedFeature = acceptRfc({
      projectDir,
      rfcId: feature.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    const before = loadRfcDelivery(projectDir, feature.metadata.id);
    bindRfcSliceCas({
      projectDir,
      rfcId: feature.metadata.id,
      sliceId: "S-01-export",
      expectedRevision: before.revision,
      binding: {
        change: "existing-change",
        issue: { provider: "none" },
        sourceDigest: acceptedFeature.digest,
        plannedAt: "2026-08-14T00:00:00.000Z",
      },
    });
    const amendment = createRfcDraft({ projectDir, slug: "amend-amendable", amends: feature.metadata.id });
    completeTwoSliceRfc(amendment.metadata.id);
    acceptRfc({
      projectDir,
      rfcId: amendment.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });

    expect(loadRfcDelivery(projectDir, feature.metadata.id).slices).toMatchObject({
      "S-01-export": { status: "planned", binding: { change: "existing-change" } },
      "S-02-audit": {
        status: "superseded",
        supersededBy: { rfcId: amendment.metadata.id, sliceId: "S-02-audit" },
      },
    });
    expect(loadRfcDelivery(projectDir, amendment.metadata.id).slices).toEqual({
      "S-01-export": { status: "unbound" },
      "S-02-audit": { status: "unbound" },
    });
  });

  it("uses a governance worktree and removes it with its branch when draft creation fails", () => {
    ensureFoundationRfc({ projectDir });
    mkdirSync(resolve(projectDir, ".worktrees"));
    git(["add", "."]);
    git(["commit", "-m", "seed governance"]);

    expect(() => createGovernanceRfcDraft({
      projectDir,
      slug: "invalid-amendment",
      amends: "not-an-rfc-id",
    })).toThrowError(expect.objectContaining({ code: "RFC_ID_INVALID" }));
    expect(existsSync(resolve(projectDir, ".worktrees/rfc-RFC-0002-invalid-amendment"))).toBe(false);
    expect(git(["branch", "--list", "rfc/RFC-0002-invalid-amendment"])).toBe("");

    const governance = createGovernanceRfcDraft({ projectDir, slug: "governed-feature" });
    expect(governance).toMatchObject({ branch: "rfc/RFC-0002-governed-feature" });
    expect(governance.rfc.metadata).toMatchObject({ id: "RFC-0002-governed-feature", status: "draft" });
    expect(existsSync(governance.worktree)).toBe(true);
    git(["worktree", "remove", "--force", governance.worktree]);
    expect(existsSync(governance.worktree)).toBe(false);
  });

  it("rejects invalid draft IDs, slugs, and projects without the RFC contract", () => {
    expect(() => createRfcDraft({ projectDir, slug: "Not valid" }))
      .toThrowError(expect.objectContaining({ code: "RFC_SLUG_INVALID" }));
    expect(() => loadRfc(projectDir, "RFC-12-short"))
      .toThrowError(expect.objectContaining({ code: "RFC_ID_INVALID" }));
    writeFileSync(resolve(projectDir, "openspec/config.yaml"), "schema: custom-flow\n");
    expect(() => listRfcs(projectDir))
      .toThrowError(expect.objectContaining({ code: "RFC_CONTRACT_REQUIRED" }));
  });
});

function completeRfc(rfcId: string, sliceId: string): void {
  writeFileSync(resolve(projectDir, "rfcs", rfcId, "rfc.md"), validDocument(rfcId, sliceId));
}

function acceptFoundation() {
  ensureFoundationRfc({ projectDir });
  completeRfc("RFC-0001-project-foundation", "S-01-project-foundation");
  return acceptRfc({
    projectDir,
    rfcId: "RFC-0001-project-foundation",
    approver: "human@example.test",
    humanConfirmed: true,
  });
}

function completeTwoSliceRfc(rfcId: string): void {
  writeFileSync(resolve(projectDir, "rfcs", rfcId, "rfc.md"), validTwoSliceDocument(rfcId));
}

function validDocument(rfcId: string, sliceId: string): string {
  return [
    `# ${rfcId}: Example`,
    "",
    "## Goal",
    "",
    "Deliver an observable user outcome.",
    "",
    "## Non-goals",
    "",
    "No unrelated platform changes.",
    "",
    "## Boundary",
    "",
    "The public contract is limited to this Slice.",
    "",
    "## Slices",
    "",
    `### ${sliceId}: First delivery`,
    "",
    "- AC-001 [evidence: both]: Export is observable.",
    "",
    "## Risks",
    "",
    "The implementation must preserve compatibility.",
    "",
  ].join("\n");
}

function validTwoSliceDocument(rfcId: string): string {
  return [
    `# ${rfcId}: Two slices`,
    "",
    "## Goal",
    "",
    "Deliver two independently verifiable outcomes.",
    "",
    "## Non-goals",
    "",
    "Do not widen the public contract beyond the two Slices.",
    "",
    "## Boundary",
    "",
    "Each Slice remains independently traceable to its acceptance criteria.",
    "",
    "## Slices",
    "",
    "### S-01-export: Export delivery",
    "",
    "- AC-001 [evidence: automated]: Export output is observable.",
    "",
    "### S-02-audit: Audit delivery",
    "",
    "- AC-002 [evidence: human]: Audit behavior is observable.",
    "",
    "## Risks",
    "",
    "Keep both delivery paths compatible.",
    "",
  ].join("\n");
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: projectDir, encoding: "utf8" }).trim();
}
