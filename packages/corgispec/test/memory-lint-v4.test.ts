import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createLintCommand } from "../src/commands/lint.js";
import { LoopStoreV3 } from "../src/lib/loop-store-v3.js";
import { initializeMemoryStructure } from "../src/lib/memory-init.js";
import {
  lintMemoryWikiV4,
  memoryLintExitCode,
  renderMemoryLintReport,
} from "../src/lib/memory-lint-v4.js";
import {
  createInitialRunStateV3,
  createRunInitializedEventV3,
  type ArtifactHashV3,
} from "../src/lib/run-contract-v3.js";

const DATE = "2026-08-14";
const NOW = new Date("2026-08-14T12:00:00.000Z");
const HASH = `sha256:${"a".repeat(64)}` as ArtifactHashV3;
const HASH_2 = `sha256:${"b".repeat(64)}` as ArtifactHashV3;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryProject(): string {
  const root = mkdtempSync(resolve(tmpdir(), "corgispec-memory-lint-v4-"));
  roots.push(root);
  seedHealthyProject(root);
  return root;
}

function write(root: string, path: string, content: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${content.trimEnd()}\n`, "utf8");
}

function frontmatter(type = "wiki", extra: string[] = []): string {
  return ["---", `type: ${type}`, `updated: ${DATE}`, ...extra, "---"].join("\n");
}

function seedHealthyProject(root: string): void {
  write(root, "AGENTS.md", [
    "# Agents",
    "",
    "## Session Memory Protocol",
    "",
    "1. Read `memory/session-bridge.md`.",
    "2. Read `memory/MEMORY.md`.",
    "3. Read `wiki/hot.md`.",
    "",
    "Read `wiki/index.md` only on demand.",
  ].join("\n"));
  write(root, "memory/MEMORY.md", [frontmatter("memory"), "", "# Memory", "", "- Stable verified knowledge only."].join("\n"));
  write(root, "memory/session-bridge.md", [
    frontmatter("memory"),
    "",
    "# Session Bridge",
    "",
    "## Delivery Pointer",
    "- **RFC**: none",
    "- **RFC Revision**: none",
    "- **Slice**: none",
    "- **Issue**: none",
    "- **Change**: none",
    "- **Worktree**: none",
    "- **Phase at Checkpoint**: none",
    "- **Task Group at Checkpoint**: none",
    "- **Observed Run Revision**: none",
    "- **Last Verified HEAD**: none",
    "",
    "## Next Action",
    "- Review the Foundation RFC.",
    "",
    "## Blockers",
    "- none",
    "",
    "## Uncommitted Work",
    "- none",
    "",
    "## Discoveries",
    "- none",
    "",
    "## Promotion Queue",
    "- none",
  ].join("\n"));
  write(root, "memory/pitfalls.md", [frontmatter("memory"), "", "# Verified Pitfalls", "", "## Active", "", "(No verified pitfalls yet.)", "", "## Archive", "", "(No archived pitfalls yet.)"].join("\n"));
  write(root, "wiki/hot.md", [
    frontmatter(),
    "",
    "# Hot",
    "",
    "## Active RFCs",
    "<!-- corgi:managed:start active-rfcs -->",
    "- none",
    "<!-- corgi:managed:end active-rfcs -->",
    "",
    "## Active Deliveries",
    "<!-- corgi:managed:start active-deliveries -->",
    "- none",
    "<!-- corgi:managed:end active-deliveries -->",
    "",
    "## Recently Shipped",
    "<!-- corgi:managed:start recently-shipped -->",
    "- none",
    "<!-- corgi:managed:end recently-shipped -->",
  ].join("\n"));
  write(root, "wiki/index.md", [
    frontmatter(),
    "",
    "# Wiki Index",
    "",
    ...["architecture", "research", "patterns", "decisions", "guides", "questions", "deliveries", "meta"]
      .map((domain) => `- [[wiki/${domain}/_index|${domain}]]`),
  ].join("\n"));
  write(root, "wiki/schema.md", [frontmatter("schema"), "", "# Wiki Schema", "", "Every non-index page requires type and updated."].join("\n"));
  write(root, "wiki/architecture/_index.md", [frontmatter(), "", "# Architecture Index", "", "- [[wiki/architecture/implicit-contracts|Implicit Contracts]]"].join("\n"));
  write(root, "wiki/architecture/implicit-contracts.md", [frontmatter(), "", "# Implicit Contracts", "", "## Contracts", "", "(No verified implicit contracts yet.)"].join("\n"));
  for (const domain of ["research", "patterns", "decisions", "guides", "questions", "meta"]) {
    write(root, `wiki/${domain}/_index.md`, [frontmatter(), "", `# ${domain} Index`, "", "(No pages yet.)"].join("\n"));
  }
  write(root, "wiki/deliveries/_index.md", [
    frontmatter(),
    "",
    "# Delivery Index",
    "",
    "## Deliveries",
    "<!-- corgi:managed:start deliveries -->",
    "- none",
    "<!-- corgi:managed:end deliveries -->",
  ].join("\n"));
}

function projectSnapshot(root: string): Record<string, string> {
  const output: Record<string, string> = {};
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output[relative(root, path).replace(/\\/gu, "/")] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  visit(root);
  return output;
}

function check(result: ReturnType<typeof lintMemoryWikiV4>, id: number) {
  return result.checks.find((entry) => entry.id === id)!;
}

describe("RFC-first v4 Memory/Wiki lint", () => {
  it("accepts the canonical bundled v4 Memory/Wiki templates", () => {
    const root = mkdtempSync(resolve(tmpdir(), "corgispec-memory-lint-template-"));
    roots.push(root);
    write(root, "README.md", "# Template Project");
    initializeMemoryStructure({ targetDir: root, assetsRoot: resolve(process.cwd(), "assets"), date: NOW });

    const result = lintMemoryWikiV4({ projectRoot: root, now: NOW });

    expect(result.outcome).toBe("PASS");
    expect(result.counts).toEqual({ pass: 13, notApplicable: 1, warning: 0, error: 0 });
  });

  it("runs exactly 14 deterministic checks and is read-only by default", () => {
    const root = temporaryProject();
    const before = projectSnapshot(root);

    const first = lintMemoryWikiV4({ projectRoot: root, now: NOW });
    const second = lintMemoryWikiV4({ projectRoot: root, now: NOW });

    expect(first).toEqual(second);
    expect(first.outcome).toBe("PASS");
    expect(first.counts).toEqual({ pass: 13, notApplicable: 1, warning: 0, error: 0 });
    expect(first.checks).toHaveLength(14);
    expect(check(first, 4)).toMatchObject({ status: "not_applicable" });
    expect(projectSnapshot(root)).toEqual(before);
    expect(existsSync(resolve(root, "wiki/meta/lint-report-2026-08-14.md"))).toBe(false);
    expect(renderMemoryLintReport(first)).toContain("13 pass, 1 N/A");
  });

  it("reports structural errors, stale hot state, broken links, unverified architecture, and managed-region violations", () => {
    const root = temporaryProject();
    rmSync(resolve(root, "wiki/guides/_index.md"));
    const hot = readFileSync(resolve(root, "wiki/hot.md"), "utf8")
      .replace(`updated: ${DATE}`, "updated: 2026-07-01")
      .replace("<!-- corgi:managed:end active-rfcs -->", "");
    writeFileSync(resolve(root, "wiki/hot.md"), hot);
    write(root, "wiki/architecture/implicit-contracts.md", [
      frontmatter(),
      "",
      "# Implicit Contracts",
      "",
      "## Contracts",
      "- The service always retries and links [[wiki/missing-page]].",
    ].join("\n"));

    const result = lintMemoryWikiV4({ projectRoot: root, now: NOW });

    expect(result.outcome).toBe("FAIL");
    expect(check(result, 1).status).toBe("error");
    expect(check(result, 5).status).toBe("warning");
    expect(check(result, 7).findings[0]).toMatchObject({ path: "wiki/architecture/implicit-contracts.md" });
    expect(check(result, 10).status).toBe("error");
    expect(check(result, 13).status).toBe("error");
  });

  it("requires architecture claims to cite an existing source and accepted RFC or archived evidence", () => {
    const root = temporaryProject();
    write(root, "src/retry.ts", "export const retries = 3;");
    write(root, "rfcs/RFC-0002-retry/rfc.yaml", [
      "schemaVersion: 1",
      "id: RFC-0002-retry",
      "type: feature",
      "status: accepted",
    ].join("\n"));
    write(root, "wiki/architecture/implicit-contracts.md", [
      frontmatter(),
      "",
      "# Implicit Contracts",
      "",
      "## Contracts",
      "- Retry count is fixed at three. Source: `src/retry.ts`; accepted evidence: RFC-0002-retry.",
    ].join("\n"));

    expect(check(lintMemoryWikiV4({ projectRoot: root, now: NOW }), 10).status).toBe("pass");

    writeFileSync(resolve(root, "rfcs/RFC-0002-retry/rfc.yaml"), "status: draft\n");
    expect(check(lintMemoryWikiV4({ projectRoot: root, now: NOW }), 10).status).toBe("error");
  });

  it("distinguishes expected live advancement from contradictory Run v3 bridge state without creating a lint lock", () => {
    const root = temporaryProject();
    const state = createInitialRunStateV3({
      changeName: "change-a",
      runId: "run-a",
      owner: { id: "agent", kind: "agent" },
      sessionId: "session-a",
      nonce: "nonce-0",
      planningRevision: HASH,
      baselineRevision: "base-commit",
      contract: {
        kind: "maintenance",
        deliveryRef: "maintenance/change-a",
        rfcId: null,
        rfcDigest: null,
        acceptedCommit: null,
        sliceId: null,
        sourcePath: "openspec/changes/change-a/corgi/source.yaml",
        sourceDigest: HASH,
        traceabilityPath: "openspec/changes/change-a/corgi/traceability.yaml",
        traceabilityDigest: HASH_2,
        acceptance: [{ id: "AC-001", evidence: "automated", taskGroups: ["1"] }],
        tracker: { provider: "none", idempotencyKey: "local" },
      },
      groups: [{ id: "1", fingerprint: HASH_2 }],
      startedAt: "2026-08-14T00:00:00.000Z",
    });
    new LoopStoreV3(root).initialize(state, createRunInitializedEventV3(state));
    const bridgePath = resolve(root, "memory/session-bridge.md");
    const bridge = readFileSync(bridgePath, "utf8")
      .replace("- **Change**: none", "- **Change**: change-a")
      .replace("- **Phase at Checkpoint**: none", "- **Phase at Checkpoint**: planning_ready")
      .replace("- **Task Group at Checkpoint**: none", "- **Task Group at Checkpoint**: 1")
      .replace("- **Observed Run Revision**: none", "- **Observed Run Revision**: 0")
      .replace("- **Last Verified HEAD**: none", "- **Last Verified HEAD**: base-commit");
    writeFileSync(bridgePath, bridge);

    expect(check(lintMemoryWikiV4({ projectRoot: root, now: NOW }), 4).status).toBe("pass");

    writeFileSync(bridgePath, bridge.replace("Observed Run Revision**: 0", "Observed Run Revision**: 1"));
    const drift = check(lintMemoryWikiV4({ projectRoot: root, now: NOW }), 4);
    expect(drift.status).toBe("warning");
    expect(drift.findings[0]!.message).toContain("ahead");
    expect(existsSync(resolve(root, ".corgi/loop/change-a/.lock-v3"))).toBe(false);
  });

  it("checks one immutable delivery page, final HEAD, AC evidence, and canonical manifest per archived RFC Slice", () => {
    const root = temporaryProject();
    write(root, "rfcs/RFC-0002-feature/delivery.yaml", [
      "schemaVersion: 1",
      "rfcId: RFC-0002-feature",
      "revision: 2",
      "slices:",
      "  S-01-slice:",
      "    status: archived",
      "    binding:",
      "      change: feature-change",
      `      sourceDigest: ${HASH}`,
      "      plannedAt: 2026-08-14T00:00:00.000Z",
      "    archive:",
      "      archivedAt: 2026-08-14T01:00:00.000Z",
      "      commit: final-commit",
      `      evidenceManifest: ${HASH_2}`,
    ].join("\n"));
    write(root, "wiki/deliveries/RFC-0002-feature-S-01-slice.md", [
      frontmatter("delivery", [
        "rfc: RFC-0002-feature",
        "slice: S-01-slice",
        "change: feature-change",
        "status: archived",
        `archived: ${DATE}`,
        `evidence_manifest: ${HASH_2}`,
      ]),
      "",
      "# RFC-0002-feature/S-01-slice",
      "",
      "## Acceptance Evidence",
      "| AC | Evidence | Result |",
      "|---|---|---|",
      "| AC-001 | evidence/verify.json | PASS |",
      "",
      "## Implementation",
      "- Final HEAD: `final-commit`",
    ].join("\n"));
    const deliveryIndex = resolve(root, "wiki/deliveries/_index.md");
    writeFileSync(deliveryIndex, readFileSync(deliveryIndex, "utf8").replace("- none", "- [[wiki/deliveries/RFC-0002-feature-S-01-slice|delivery]]"));
    write(root, "openspec/changes/archive/2026-08-14-feature-change/evidence/manifest.json", JSON.stringify({
      schemaVersion: 3,
      changeName: "feature-change",
      runId: "run-1",
      manifestHash: HASH_2,
      finalRevision: "final-commit",
    }, null, 2));
    write(root, "openspec/changes/archive/2026-08-14-feature-change/evidence/verify.json", JSON.stringify({
      acceptance: [{ id: "AC-001", automated: "pass" }],
    }, null, 2));

    expect(check(lintMemoryWikiV4({ projectRoot: root, now: NOW }), 12).status).toBe("pass");

    const page = resolve(root, "wiki/deliveries/RFC-0002-feature-S-01-slice.md");
    writeFileSync(page, readFileSync(page, "utf8").replace("final-commit", "wrong-head"));
    const invalid = check(lintMemoryWikiV4({ projectRoot: root, now: NOW }), 12);
    expect(invalid.status).toBe("error");
    expect(invalid.findings.some((finding) => finding.message.includes("final HEAD"))).toBe(true);
  });

  it("treats missing migration hashes as N/A and verifies byte-for-byte legacy preservation when recorded", () => {
    const root = temporaryProject();
    write(root, "wiki/sessions/old.md", "legacy bytes");

    expect(check(lintMemoryWikiV4({ projectRoot: root, now: NOW }), 14).status).toBe("not_applicable");

    const digest = createHash("sha256").update(readFileSync(resolve(root, "wiki/sessions/old.md"))).digest("hex");
    write(root, "wiki/meta/migration-record.json", JSON.stringify({ legacyHashes: { "wiki/sessions/old.md": digest } }, null, 2));
    expect(check(lintMemoryWikiV4({ projectRoot: root, now: NOW }), 14).status).toBe("pass");

    write(root, "wiki/sessions/old.md", "changed bytes");
    expect(check(lintMemoryWikiV4({ projectRoot: root, now: NOW }), 14).status).toBe("error");
  });

  it("reports malformed knowledge inputs without promoting ambiguous or legacy output", () => {
    const root = temporaryProject();
    write(root, "CLAUDE.md", [
      "# Claude",
      "",
      "## Session Memory Protocol",
      "",
      "A duplicate protocol is not authoritative.",
    ].join("\n"));
    const bridge = readFileSync(resolve(root, "memory/session-bridge.md"), "utf8")
      .replace("- **RFC**: none\n", "")
      .replace("## Blockers", "## Missing Blockers")
      + Array.from({ length: 24 }, () => "extra checkpoint line").join("\n");
    writeFileSync(resolve(root, "memory/session-bridge.md"), `${bridge}\n`);

    const hot = readFileSync(resolve(root, "wiki/hot.md"), "utf8")
      .replace("<!-- corgi:managed:end active-rfcs -->", [
        "<!-- corgi:managed:end active-rfcs -->",
        "<!-- corgi:managed:start unknown-region -->",
        "<!-- corgi:managed:end unknown-region -->",
      ].join("\n"));
    writeFileSync(resolve(root, "wiki/hot.md"), hot);
    write(root, "wiki/research/shared.md", [frontmatter(), "", "# Shared Research"].join("\n"));
    write(root, "wiki/guides/shared.md", [frontmatter(), "", "# Shared Guide"].join("\n"));
    writeFileSync(
      resolve(root, "wiki/research/_index.md"),
      `${readFileSync(resolve(root, "wiki/research/_index.md"), "utf8").trimEnd()}\n- [[shared]]\n`,
    );
    write(root, "wiki/questions/bad.md", [
      "---",
      "type: wiki",
      "updated: yesterday",
      "status: unknown",
      "unlisted: sometimes",
      "---",
      "",
      "# Bad Question",
    ].join("\n"));
    write(root, "wiki/meta/malformed.md", "---\n: malformed\n---\n");

    write(root, "memory/pitfalls.md", [
      frontmatter("memory"),
      "",
      "# Verified Pitfalls",
      "",
      "## Active",
      "",
      ...Array.from({ length: 21 }, (_, index) => `- Pitfall ${index + 1}`),
      "",
      "## Archive",
      "",
      "(No archived pitfalls yet.)",
    ].join("\n"));
    write(root, "rfcs/RFC-0002-malformed/delivery.yaml", "slices: [\n");

    write(root, "wiki/sessions/old.md", "legacy bytes");
    const legacyHash = createHash("sha256").update(readFileSync(resolve(root, "wiki/sessions/old.md"))).digest("hex");
    write(root, "wiki/meta/migration-record.yaml", `legacyHashes:\n  wiki/sessions/old.md: ${legacyHash}`);
    write(root, "wiki/deliveries/legacy-output.md", [
      frontmatter("delivery", [
        "rfc: maintenance",
        "slice: maintenance",
        "change: lint-fixture",
        "status: archived",
        `archived: ${DATE}`,
      ]),
      "",
      "# Legacy output",
      "",
      "## Outputs",
      "- wiki/sessions/old.md",
    ].join("\n"));

    const result = lintMemoryWikiV4({ projectRoot: root, now: NOW });

    expect(check(result, 2).status).toBe("error");
    expect(check(result, 3).status).toBe("error");
    expect(check(result, 7).findings.some((entry) => entry.message.includes("ambiguous"))).toBe(true);
    expect(check(result, 8).status).toBe("warning");
    expect(check(result, 9).status).toBe("warning");
    expect(check(result, 11).status).toBe("warning");
    expect(check(result, 12).status).toBe("error");
    expect(check(result, 13).status).toBe("error");
    expect(check(result, 14).findings.some((entry) => entry.message.includes("legacy read-only"))).toBe(true);
  });

  it("exposes --path, --json, and opt-in --report with PASS/WARN/FAIL exit codes", async () => {
    const root = temporaryProject();
    const outputs: string[] = [];
    const exits: number[] = [];
    await createLintCommand({
      now: () => NOW,
      writeOutput: (output) => outputs.push(output),
      setExitCode: (code) => exits.push(code),
    }).parseAsync(["node", "lint", "--path", root, "--json"]);

    expect(JSON.parse(outputs[0]!)).toMatchObject({ outcome: "PASS", reportPath: null });
    expect(exits).toEqual([0]);
    expect(existsSync(resolve(root, "wiki/meta/lint-report-2026-08-14.md"))).toBe(false);

    outputs.length = 0;
    await createLintCommand({
      now: () => NOW,
      writeOutput: (output) => outputs.push(output),
      setExitCode: (code) => exits.push(code),
    }).parseAsync(["node", "lint", "--path", root, "--report"]);

    const reportPath = resolve(root, "wiki/meta/lint-report-2026-08-14.md");
    expect(readFileSync(reportPath, "utf8")).toBe(outputs[0]);
    expect(readFileSync(reportPath, "utf8")).toMatch(/^---\ntype: meta\nupdated: 2026-08-14\nkind: lint-report\nunlisted: true\n---/u);
    expect(lintMemoryWikiV4({ projectRoot: root, now: NOW }).outcome).toBe("PASS");
    expect(exits).toEqual([0, 0]);
    expect([memoryLintExitCode("PASS"), memoryLintExitCode("WARN"), memoryLintExitCode("FAIL")]).toEqual([0, 1, 2]);
  });
});
