import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProposeCommand } from "../src/commands/propose.js";
import {
  loadChangeContract,
  writeChangeTraceability,
} from "../src/lib/change-contract.js";
import {
  acceptRfc,
  createRfcDraft,
  ensureFoundationRfc,
  loadRfc,
  loadRfcDelivery,
} from "../src/lib/rfc.js";
import type { ResolvedChangeArtifacts } from "../src/lib/artifact-resolver.js";
import { featureIssueMarker, repositoryIdentity } from "../src/lib/tracker.js";
import type { TrackerClient, TrackerIssue } from "../src/lib/tracker.js";
import {
  acquireWorkflowLock,
  loadProposeIntent,
  releaseWorkflowLock,
} from "../src/lib/workflow-intent.js";

describe("RFC-aware Propose", () => {
  let root = "";
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-propose-rfc-"));
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
      "isolation:",
      "  mode: none",
      "",
    ].join("\n"));
    writeFileSync(resolve(root, ".gitignore"), ".corgi/loop/\n.corgi/transactions/\n");
    mkdirSync(resolve(root, "memory"), { recursive: true });
    writeFileSync(resolve(root, "memory/session-bridge.md"), [
      "# Session Bridge",
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
      "- none",
      "",
    ].join("\n"));
    git(["init", "-b", "main"]);
    git(["config", "user.email", "human@example.test"]);
    git(["config", "user.name", "Human Reviewer"]);
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = 0;
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps a draft unbound, then CAS-binds only after strict-ready finalization", async () => {
    ensureFoundationRfc({ projectDir: root });
    complete("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir: root,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
    const feature = createRfcDraft({ projectDir: root, slug: "export" });
    complete(feature.metadata.id, "S-01-export");
    acceptRfc({
      projectDir: root,
      rfcId: feature.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    git(["add", "."]);
    git(["commit", "-m", "accept RFCs"]);
    const configPath = resolve(root, "openspec/config.yaml");
    writeFileSync(
      configPath,
      readFileSync(configPath, "utf8").replace("provider: none", "provider: github"),
    );
    git(["add", "openspec/config.yaml"]);
    git(["commit", "-m", "select tracker provider"]);

    const marker = featureIssueMarker({
      repository: repositoryIdentity(root),
      deliveryRef: `${feature.metadata.id}/S-01-export`,
      rfcDigest: loadRfc(root, feature.metadata.id).digest,
    });
    const held = acquireWorkflowLock(root, `propose:${marker.key}`);
    const lockedAdapter = { createChange: vi.fn() };
    await createProposeCommand({ createAdapter: () => lockedAdapter as never }).parseAsync([
      "locked-attempt",
      "--from", `${feature.metadata.id}/S-01-export`,
      "--json",
      "--path", root,
    ], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(lockedAdapter.createChange).not.toHaveBeenCalled();
    releaseWorkflowLock(held);
    process.exitCode = 0;
    log.mockClear();
    error.mockClear();

    const changeRoot = resolve(root, "openspec/changes/export-data");
    let created = false;
    let planningReady = false;
    let trackerIssue: TrackerIssue | null = null;
    const trackerCalls: string[] = [];
    const tracker: TrackerClient = {
      provider: "github",
      async findByMarker(value) {
        trackerCalls.push("find");
        return trackerIssue?.body.includes(value) ? [trackerIssue] : [];
      },
      async getIssue(value) {
        trackerCalls.push("get");
        return { ...value };
      },
      async createIssue(input) {
        trackerCalls.push("create");
        trackerIssue = {
          id: "42",
          url: "https://example.test/issues/42",
          title: input.title,
          body: input.body,
        };
        return trackerIssue;
      },
      async setState(_issue, state) {
        trackerCalls.push(`state:${state}`);
        expect(loadRfcDelivery(root, feature.metadata.id).slices["S-01-export"]).toEqual({ status: "unbound" });
      },
      async updateBody(_issue, body) {
        trackerCalls.push("dashboard");
        if (trackerIssue) trackerIssue.body = body;
      },
      async comment() {
        trackerCalls.push("comment");
      },
      async close() {
        trackerCalls.push("close");
      },
    };
    const resolver = {
      async resolve(): Promise<ResolvedChangeArtifacts> {
        if (!created) throw new Error("change not found");
        const contract = loadChangeContract(changeRoot);
        const artifactPaths = planningReady
          ? {
              tasks: {
                outputPath: "tasks.md",
                resolvedOutputPath: resolve(changeRoot, "tasks.md"),
                existingOutputPaths: [resolve(changeRoot, "tasks.md")],
              },
            }
          : {};
        return {
          changeName: "export-data",
          schemaName: "custom",
          planningHome: {
            kind: "repo",
            root: resolve(root, "openspec"),
            changesDir: resolve(root, "openspec/changes"),
            defaultSchema: "custom",
          },
          changeRoot,
          artifactPaths,
          actionContext: {
            mode: "repo",
            sourceOfTruth: "repo",
            planningArtifacts: [],
            linkedContext: [],
            allowedEditRoots: [changeRoot],
            requiresAffectedAreaSelection: false,
            constraints: [],
          },
          planningRevision: contract
            ? `sha256:${"b".repeat(64)}`
            : `sha256:${"a".repeat(64)}`,
          contract,
          planningComplete: planningReady,
          status: {
            changeName: "export-data",
            schemaName: "custom",
            planningHome: {
              kind: "repo",
              root: resolve(root, "openspec"),
              changesDir: resolve(root, "openspec/changes"),
              defaultSchema: "custom",
            },
            changeRoot,
            artifactPaths,
            nextSteps: [],
            actionContext: {
              mode: "repo",
              sourceOfTruth: "repo",
              planningArtifacts: [],
              linkedContext: [],
              allowedEditRoots: [changeRoot],
              requiresAffectedAreaSelection: false,
              constraints: [],
            },
            isComplete: planningReady,
            applyRequires: [],
            artifacts: planningReady
              ? [{ id: "tasks", outputPath: "tasks.md", status: "done" }]
              : [],
          },
        };
      },
    };
    const adapter = {
      async createChange() {
        mkdirSync(changeRoot, { recursive: true });
        created = true;
        return { change: { id: "export-data", path: changeRoot, metadataPath: resolve(changeRoot, ".openspec.yaml"), schema: "custom" } };
      },
      async validateChange() {
        return { valid: true, issues: [] };
      },
    };

    await createProposeCommand({
      createAdapter: () => adapter as never,
      createResolver: () => resolver as never,
      createTracker: () => tracker,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    }).parseAsync([
      "export-data",
      "--from", `${feature.metadata.id}/S-01-export`,
      "--json",
      "--path", root,
    ], { from: "user" });

    expect(process.exitCode, JSON.stringify(log.mock.calls)).toBe(0);
    expect(error).not.toHaveBeenCalled();
    expect(loadChangeContract(changeRoot, { required: true })).toMatchObject({
      source: {
        kind: "rfc-slice",
        deliveryRef: `${feature.metadata.id}/S-01-export`,
        acceptance: [{ id: "AC-001", evidence: "both" }],
      },
    });
    expect(loadRfcDelivery(root, feature.metadata.id).slices["S-01-export"]).toEqual({ status: "unbound" });
    expect(loadProposeIntent(root, marker.key)?.stage).toBe("source_written");
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      status: "blocked",
      contract: { deliveryRef: `${feature.metadata.id}/S-01-export` },
    });

    mkdirSync(resolve(root, "src"), { recursive: true });
    writeFileSync(resolve(root, "src/unrelated.ts"), "export {};\n");
    const trackerCallsBeforeDirtyRetry = trackerCalls.length;
    await createProposeCommand({
      createAdapter: () => adapter as never,
      createResolver: () => resolver as never,
      createTracker: () => tracker,
    }).parseAsync([
      "export-data",
      "--from", `${feature.metadata.id}/S-01-export`,
      "--finalize",
      "--json",
      "--path", root,
    ], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(log.mock.calls.at(-1)![0]))).toMatchObject({
      error: { code: "PROPOSE_WORKTREE_DIRTY" },
    });
    expect(trackerCalls).toHaveLength(trackerCallsBeforeDirtyRetry);
    rmSync(resolve(root, "src/unrelated.ts"));
    process.exitCode = 0;

    await createProposeCommand({
      createAdapter: () => adapter as never,
      createResolver: () => resolver as never,
      createTracker: () => tracker,
    }).parseAsync([
      "export-data",
      "--from", `${feature.metadata.id}/S-01-export`,
      "--finalize",
      "--json",
      "--path", root,
    ], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(loadRfcDelivery(root, feature.metadata.id).slices["S-01-export"]).toEqual({ status: "unbound" });
    expect(loadProposeIntent(root, marker.key)?.stage).toBe("source_written");
    process.exitCode = 0;

    writeFileSync(resolve(changeRoot, "tasks.md"), "## 1. Export\n\n- [ ] 1.1 Implement export.\n");
    const draftContract = loadChangeContract(changeRoot, { required: true })!;
    writeChangeTraceability(changeRoot, {
      schemaVersion: 1,
      sourceDigest: draftContract.sourceDigest,
      acceptance: [{
        id: "AC-001",
        evidence: "both",
        planningRefs: [{ path: "tasks.md" }],
        taskGroups: ["1"],
      }],
    });
    planningReady = true;
    await createProposeCommand({
      createAdapter: () => adapter as never,
      createResolver: () => resolver as never,
      createTracker: () => tracker,
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    }).parseAsync([
      "export-data",
      "--from", `${feature.metadata.id}/S-01-export`,
      "--finalize",
      "--json",
      "--path", root,
    ], { from: "user" });

    expect(process.exitCode, JSON.stringify(log.mock.calls)).toBe(0);
    expect(loadRfcDelivery(root, feature.metadata.id).slices["S-01-export"]).toMatchObject({
      status: "planned",
      binding: {
        change: "export-data",
        issue: { provider: "github", id: "42", url: "https://example.test/issues/42" },
      },
    });
    expect(loadProposeIntent(root, marker.key)?.stage).toBe("complete");
    expect(trackerCalls).toEqual(expect.arrayContaining(["dashboard", "state:todo"]));
    expect(trackerCalls.indexOf("dashboard")).toBeLessThan(trackerCalls.indexOf("state:todo"));

    const occupiedAdapter = { createChange: vi.fn() };
    await createProposeCommand({ createAdapter: () => occupiedAdapter as never }).parseAsync([
      "other-change",
      "--from", `${feature.metadata.id}/S-01-export`,
      "--json",
      "--path", root,
    ], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(occupiedAdapter.createChange).not.toHaveBeenCalled();
  });

  it("rejects free-form Feature prose before creating a Change", async () => {
    const adapter = { createChange: vi.fn() };
    await createProposeCommand({ createAdapter: () => adapter as never }).parseAsync([
      "free-form", "--description", "add export", "--json", "--path", root,
    ], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(adapter.createChange).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      error: { code: "PROPOSE_SOURCE_REQUIRED" },
    });
  });

  it("rejects an unresolvable contract-bug reference before creating a Change", async () => {
    ensureFoundationRfc({ projectDir: root });
    complete("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir: root,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
    git(["add", "."]);
    git(["commit", "-m", "accept foundation"]);
    const adapter = { createChange: vi.fn() };
    await createProposeCommand({ createAdapter: () => adapter as never }).parseAsync([
      "fix-regression",
      "--maintenance",
      "--description", "Fix a regression",
      "--contract-ref", "nonsense",
      "--json",
      "--path", root,
    ], { from: "user" });
    expect(process.exitCode).toBe(1);
    expect(adapter.createChange).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      error: { code: "MAINTENANCE_CONTRACT_REFERENCE_INVALID" },
    });
  });

  it("rejects a dirty first attempt before creating a tracker client or Issue", async () => {
    ensureFoundationRfc({ projectDir: root });
    complete("RFC-0001-project-foundation", "S-01-project-foundation");
    acceptRfc({
      projectDir: root,
      rfcId: "RFC-0001-project-foundation",
      approver: "human@example.test",
      humanConfirmed: true,
    });
    const feature = createRfcDraft({ projectDir: root, slug: "dirty-preflight" });
    complete(feature.metadata.id, "S-01-dirty-preflight");
    acceptRfc({
      projectDir: root,
      rfcId: feature.metadata.id,
      approver: "human@example.test",
      humanConfirmed: true,
    });
    const configPath = resolve(root, "openspec/config.yaml");
    writeFileSync(
      configPath,
      readFileSync(configPath, "utf8").replace("provider: none", "provider: github"),
    );
    git(["add", "."]);
    git(["commit", "-m", "accept RFCs"]);
    mkdirSync(resolve(root, "src"), { recursive: true });
    writeFileSync(resolve(root, "src/unrelated.ts"), "export {};\n");
    git(["add", "src/unrelated.ts"]);
    writeFileSync(resolve(root, ".gitignore"), `${readFileSync(resolve(root, ".gitignore"), "utf8")}# local edit\n`);

    const createIssue = vi.fn();
    const createTracker = vi.fn(() => ({
      provider: "github" as const,
      findByMarker: vi.fn(),
      getIssue: vi.fn(),
      createIssue,
      setState: vi.fn(),
      updateBody: vi.fn(),
      comment: vi.fn(),
      close: vi.fn(),
    }));
    const adapter = { createChange: vi.fn() };
    const resolver = { resolve: vi.fn(async () => { throw new Error("change not found"); }) };

    await createProposeCommand({
      createAdapter: () => adapter as never,
      createResolver: () => resolver as never,
      createTracker,
    }).parseAsync([
      "dirty-change",
      "--from", `${feature.metadata.id}/S-01-dirty-preflight`,
      "--json",
      "--path", root,
    ], { from: "user" });

    expect(process.exitCode).toBe(1);
    const failure = JSON.parse(String(log.mock.calls[0]![0])) as { error: { code: string; message: string } };
    expect(failure).toMatchObject({
      error: { code: "PROPOSE_WORKTREE_DIRTY" },
    });
    expect(failure.error.message).toContain(".gitignore");
    expect(failure.error.message).toContain("src/unrelated.ts");
    expect(createTracker).not.toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
    expect(adapter.createChange).not.toHaveBeenCalled();
  });

  function complete(rfcId: string, sliceId: string): void {
    writeFileSync(resolve(root, "rfcs", rfcId, "rfc.md"), [
      `# ${rfcId}`,
      "",
      "## Goal",
      "Deliver export.",
      "",
      "## Non-goals",
      "No unrelated work.",
      "",
      "## Boundary",
      "Only this Slice.",
      "",
      "## Slices",
      `### ${sliceId}: First delivery`,
      "- AC-001 [evidence: both]: Export is observable.",
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
