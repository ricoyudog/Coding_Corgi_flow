import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { ArtifactResolver, ResolvedChangeArtifacts } from "../src/lib/artifact-resolver.js";
import {
  resolveApplyInstruction,
  resolveArchiveInstruction,
  resolveArtifactInstruction,
  resolveReviewInstruction,
} from "../src/lib/instructions.js";
import type {
  OpenSpecAdapter,
  OpenSpecApplyInstructionsResponse,
  OpenSpecArtifactInstructionsResponse,
} from "../src/lib/openspec-adapter.js";

describe("OpenSpec-backed lifecycle instructions", () => {
  let root: string;
  let resolved: ResolvedChangeArtifacts;
  let adapter: OpenSpecAdapter;
  let resolver: ArtifactResolver;
  let artifactInstruction: OpenSpecArtifactInstructionsResponse;
  let applyInstruction: OpenSpecApplyInstructionsResponse;

  beforeEach(() => {
    root = resolve(tmpdir(), `corgispec-instructions-${Date.now()}-${Math.random()}`);
    const changeRoot = resolve(root, "external-store/change-a");
    mkdirSync(resolve(root, "openspec"), { recursive: true });
    mkdirSync(resolve(changeRoot, "specs/auth"), { recursive: true });
    writeFileSync(resolve(root, "openspec/config.yaml"), [
      "schema: custom-delivery",
      "corgi:",
      "  taskArtifactId: delivery",
      "context: TypeScript project",
      "rules:",
      "  proposal:",
      "    - Keep it focused",
      "",
    ].join("\n"));
    writeFileSync(resolve(changeRoot, "proposal.md"), "# Proposal\n");
    writeFileSync(resolve(changeRoot, "specs/auth/spec.md"), "# Auth spec\n");
    writeFileSync(resolve(changeRoot, "delivery.md"), [
      "## 1. Setup",
      "- [x] 1.1 done",
      "",
      "## 2. Build",
      "- [ ] 2.1 build",
      "",
    ].join("\n"));

    const artifactPaths = {
      proposal: {
        outputPath: "proposal.md",
        resolvedOutputPath: resolve(changeRoot, "proposal.md"),
        existingOutputPaths: [resolve(changeRoot, "proposal.md")],
      },
      specs: {
        outputPath: "specs/**/*.md",
        resolvedOutputPath: resolve(changeRoot, "specs/**/*.md"),
        existingOutputPaths: [resolve(changeRoot, "specs/auth/spec.md")],
      },
      delivery: {
        outputPath: "delivery.md",
        resolvedOutputPath: resolve(changeRoot, "delivery.md"),
        existingOutputPaths: [resolve(changeRoot, "delivery.md")],
      },
    };
    const status = {
      changeName: "change-a",
      schemaName: "custom-delivery",
      planningHome: {
        kind: "repo" as const,
        root: resolve(root, "external-store"),
        changesDir: resolve(root, "external-store"),
        defaultSchema: "custom-delivery",
      },
      changeRoot,
      artifactPaths,
      nextSteps: [],
      actionContext: {
        mode: "store",
        sourceOfTruth: "store",
        planningArtifacts: ["proposal", "specs", "delivery"],
        linkedContext: [],
        allowedEditRoots: [changeRoot],
        requiresAffectedAreaSelection: false,
        constraints: [],
      },
      isComplete: true,
      applyRequires: ["delivery"],
      artifacts: Object.entries(artifactPaths).map(([id, value]) => ({
        id,
        outputPath: value.outputPath,
        status: "done" as const,
      })),
    };
    resolved = {
      changeName: "change-a",
      schemaName: "custom-delivery",
      planningHome: status.planningHome,
      changeRoot,
      artifactPaths,
      actionContext: status.actionContext,
      planningRevision: "sha256:planning",
      planningComplete: true,
      status,
    };
    artifactInstruction = {
      changeName: "change-a",
      artifactId: "proposal",
      schemaName: "custom-delivery",
      changeDir: changeRoot,
      outputPath: "proposal.md",
      resolvedOutputPath: resolve(changeRoot, "proposal.md"),
      existingOutputPaths: [resolve(changeRoot, "proposal.md")],
      description: "Write proposal",
      instruction: "Use upstream instructions",
      template: "# Proposal",
      dependencies: [{ id: "specs" }],
      unlocks: [],
    };
    applyInstruction = {
      changeName: "change-a",
      changeDir: changeRoot,
      schemaName: "custom-delivery",
      contextFiles: { proposal: [resolve(changeRoot, "proposal.md")] },
      progress: { total: 2, complete: 1, remaining: 1 },
      tasks: [{ id: "2.1", description: "build", done: false }],
      state: "ready",
      instruction: "Apply upstream task",
    };
    adapter = {
      getArtifactInstructions: vi.fn().mockImplementation(async () => artifactInstruction),
      getApplyInstructions: vi.fn().mockImplementation(async () => applyInstruction),
    } as unknown as OpenSpecAdapter;
    resolver = { resolve: vi.fn().mockResolvedValue(resolved) } as unknown as ArtifactResolver;
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("enriches upstream artifact instructions without deriving paths", async () => {
    const value = await resolveArtifactInstruction(
      root,
      "change-a",
      "proposal",
      { store: "shared" },
      { adapter, resolver },
    );
    expect(value).toMatchObject({
      changeName: "change-a",
      dependencies: ["specs"],
      contextFiles: [resolved.artifactPaths.specs!.existingOutputPaths[0]],
      projectContext: "TypeScript project",
      rules: ["Keep it focused"],
      planningRevision: "sha256:planning",
      planningComplete: true,
      implementationComplete: false,
      isComplete: false,
      outputPath: "proposal.md",
      resolvedOutputPath: resolve(resolved.changeRoot, "proposal.md"),
    });
    expect(adapter.getArtifactInstructions).toHaveBeenCalledWith(
      "change-a",
      "proposal",
      { store: "shared" },
    );
  });

  it.each([
    ["instructions.changeName", (value: OpenSpecArtifactInstructionsResponse) => { value.changeName = "other-change"; }],
    ["requested artifactId", (value: OpenSpecArtifactInstructionsResponse) => { value.artifactId = "specs"; }],
    ["instructions.schemaName", (value: OpenSpecArtifactInstructionsResponse) => { value.schemaName = "other-schema"; }],
    ["instructions.changeDir", (value: OpenSpecArtifactInstructionsResponse) => { value.changeDir = resolve(root, "other-change"); }],
    ["artifactPaths.proposal.outputPath", (value: OpenSpecArtifactInstructionsResponse) => { value.outputPath = "other.md"; }],
    ["artifactPaths.proposal.resolvedOutputPath", (value: OpenSpecArtifactInstructionsResponse) => { value.resolvedOutputPath = resolve(resolved.changeRoot, "other.md"); }],
    ["artifactPaths.proposal.existingOutputPaths", (value: OpenSpecArtifactInstructionsResponse) => { value.existingOutputPaths = []; }],
  ] as const)("fails closed for %s mismatches", async (field, mutate) => {
    mutate(artifactInstruction);

    await expect(
      resolveArtifactInstruction(root, "change-a", "proposal", {}, { adapter, resolver })
    ).rejects.toMatchObject({ code: "upstream_contract_mismatch", field });
  });

  it.each([
    ["status.changeName", () => { resolved.status.changeName = "other-change"; }],
    ["status.schemaName", () => { resolved.status.schemaName = "other-schema"; }],
    ["status.changeRoot", () => { resolved.status.changeRoot = resolve(root, "other-change"); }],
    ["artifactPaths.proposal", () => { delete resolved.artifactPaths.proposal; }],
    ["status.artifactPaths.proposal", () => {
      const { proposal: _proposal, ...remaining } = resolved.status.artifactPaths;
      resolved.status.artifactPaths = remaining;
    }],
    ["artifacts.proposal", () => {
      resolved.status.artifacts = resolved.status.artifacts.filter((artifact) => artifact.id !== "proposal");
    }],
  ] as const)("fails closed for missing or inconsistent %s status data", async (field, mutate) => {
    mutate();

    await expect(
      resolveArtifactInstruction(root, "change-a", "proposal", {}, { adapter, resolver })
    ).rejects.toMatchObject({ code: "upstream_contract_mismatch", field });
  });

  it("fails closed when the status artifact summary disagrees with artifactPaths", async () => {
    resolved.status.artifacts.find((artifact) => artifact.id === "proposal")!.outputPath = "wrong.md";

    await expect(
      resolveArtifactInstruction(root, "change-a", "proposal", {}, { adapter, resolver })
    ).rejects.toMatchObject({
      code: "upstream_contract_mismatch",
      field: "artifacts.proposal.outputPath",
    });
  });

  it("fails closed when raw status artifact paths disagree with the resolver result", async () => {
    resolved.status.artifactPaths = {
      ...resolved.status.artifactPaths,
      proposal: {
        ...resolved.status.artifactPaths.proposal!,
        existingOutputPaths: [],
      },
    };

    await expect(
      resolveArtifactInstruction(root, "change-a", "proposal", {}, { adapter, resolver })
    ).rejects.toMatchObject({
      code: "upstream_contract_mismatch",
      field: "status.artifactPaths.proposal.existingOutputPaths",
    });
  });

  it("accepts authoritative nested/glob instructions and preserves the glob outputPath", async () => {
    artifactInstruction = {
      ...artifactInstruction,
      artifactId: "specs",
      outputPath: "specs/**/*.md",
      resolvedOutputPath: resolve(resolved.changeRoot, "specs/**/*.md"),
      existingOutputPaths: [resolve(resolved.changeRoot, "specs/auth/spec.md")],
      dependencies: [],
    };

    const value = await resolveArtifactInstruction(
      root,
      "change-a",
      "specs",
      {},
      { adapter, resolver },
    );
    expect(value.outputPath).toBe("specs/**/*.md");
    expect(value.resolvedOutputPath).toBe(resolve(resolved.changeRoot, "specs/**/*.md"));
  });

  it("preserves relative output spelling and handles all dependency key variants", async () => {
    writeFileSync(resolve(root, "openspec/config.yaml"), "schema: custom-delivery\n");
    artifactInstruction.outputPath = "./proposal.md";
    artifactInstruction.instruction = undefined;
    artifactInstruction.dependencies = [
      { artifactId: "specs" },
      { artifact: "specs" },
      { name: "specs" },
      { futureDependencyShape: "ignored" },
    ];

    const value = await resolveArtifactInstruction(
      root,
      "change-a",
      "proposal",
      {},
      { adapter, resolver },
    );
    expect(value).toMatchObject({
      outputPath: "./proposal.md",
      instruction: "Write proposal",
      projectContext: "",
      rules: [],
      dependencies: ["specs", "specs", "specs"],
      implementationComplete: false,
    });
  });

  it("infers a tasks artifact only when that artifact actually exists", async () => {
    writeFileSync(resolve(root, "openspec/config.yaml"), "schema: custom-delivery\n");
    resolved.artifactPaths.tasks = resolved.artifactPaths.delivery!;
    resolved.status.artifactPaths.tasks = resolved.status.artifactPaths.delivery!;

    const value = await resolveArtifactInstruction(
      root,
      "change-a",
      "proposal",
      {},
      { adapter, resolver },
    );
    expect(value.implementationComplete).toBe(false);
  });

  it("rejects an agreed traversal output even when both JSON responses contain it", async () => {
    const outside = resolve(resolved.changeRoot, "../outside.md");
    artifactInstruction.resolvedOutputPath = outside;
    resolved.artifactPaths.proposal!.resolvedOutputPath = outside;

    await expect(
      resolveArtifactInstruction(root, "change-a", "proposal", {}, { adapter, resolver })
    ).rejects.toMatchObject({ code: "path_outside_change" });
  });

  it("rejects an outputPath that does not resolve to resolvedOutputPath", async () => {
    artifactInstruction.outputPath = "different.md";
    resolved.artifactPaths.proposal!.outputPath = "different.md";
    resolved.status.artifactPaths.proposal!.outputPath = "different.md";
    resolved.status.artifacts.find((artifact) => artifact.id === "proposal")!.outputPath = "different.md";

    await expect(
      resolveArtifactInstruction(root, "change-a", "proposal", {}, { adapter, resolver })
    ).rejects.toMatchObject({
      code: "upstream_contract_mismatch",
      field: "instructions.output target",
    });
  });

  it("rejects concrete and glob outputs below a symlink that escapes changeRoot", async () => {
    const outside = resolve(root, "outside-output");
    const linked = resolve(resolved.changeRoot, "linked-output");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, linked, "dir");

    const setOutput = (outputPath: string): void => {
      artifactInstruction.outputPath = outputPath;
      artifactInstruction.resolvedOutputPath = resolve(resolved.changeRoot, outputPath);
      artifactInstruction.existingOutputPaths = [];
      resolved.artifactPaths.proposal!.outputPath = outputPath;
      resolved.artifactPaths.proposal!.resolvedOutputPath = artifactInstruction.resolvedOutputPath;
      resolved.artifactPaths.proposal!.existingOutputPaths = [];
      resolved.status.artifacts.find((artifact) => artifact.id === "proposal")!.outputPath = outputPath;
    };

    setOutput("linked-output/new.md");
    await expect(
      resolveArtifactInstruction(root, "change-a", "proposal", {}, { adapter, resolver })
    ).rejects.toMatchObject({ code: "symlink_escape" });

    setOutput("linked-output/**/*.md");
    await expect(
      resolveArtifactInstruction(root, "change-a", "proposal", {}, { adapter, resolver })
    ).rejects.toMatchObject({ code: "symlink_escape" });
  });

  it("uses configured task artifact and upstream apply context", async () => {
    const value = await resolveApplyInstruction(
      root,
      "change-a",
      { store: "shared" },
      { adapter, resolver },
    );
    expect(value.currentGroup).toMatchObject({ number: 2, name: "Build" });
    expect(value.contextFiles).toEqual([resolve(resolved.changeRoot, "proposal.md")]);
    expect(value.instruction).toBe("Apply upstream task");
    expect(value.implementationComplete).toBe(false);
  });

  it.each([
    ["apply.changeName", { changeName: "other-change" }],
    ["apply.schemaName", { schemaName: "other-schema" }],
    ["apply.changeDir", { changeDir: "/other/change" }],
  ] as const)("fails closed for %s apply identity mismatches", async (field, mutation) => {
    Object.assign(applyInstruction, mutation);

    await expect(
      resolveApplyInstruction(root, "change-a", {}, { adapter, resolver })
    ).rejects.toMatchObject({ code: "upstream_contract_mismatch", field });
  });

  it("rejects unknown, incomplete, and escaping apply context", async () => {
    const base = await adapter.getApplyInstructions("change-a");

    vi.mocked(adapter.getApplyInstructions).mockResolvedValue({
      ...base,
      contextFiles: { unknown: [resolve(resolved.changeRoot, "proposal.md")] },
    });
    await expect(
      resolveApplyInstruction(root, "change-a", {}, { adapter, resolver })
    ).rejects.toMatchObject({
      code: "upstream_contract_mismatch",
      field: "apply.contextFiles.unknown",
    });

    vi.mocked(adapter.getApplyInstructions).mockResolvedValue({
      ...base,
      contextFiles: { proposal: [] },
    });
    await expect(
      resolveApplyInstruction(root, "change-a", {}, { adapter, resolver })
    ).rejects.toMatchObject({
      code: "upstream_contract_mismatch",
      field: "apply.contextFiles.proposal",
    });

    const outside = resolve(resolved.changeRoot, "../outside-context.md");
    resolved.artifactPaths.proposal!.existingOutputPaths = [outside];
    resolved.status.artifactPaths.proposal!.existingOutputPaths = [outside];
    vi.mocked(adapter.getApplyInstructions).mockResolvedValue({
      ...base,
      contextFiles: { proposal: [outside] },
    });
    await expect(
      resolveApplyInstruction(root, "change-a", {}, { adapter, resolver })
    ).rejects.toMatchObject({ code: "path_outside_change" });
  });

  it("rejects apply context when raw status omits its otherwise known artifact", async () => {
    const { proposal: _proposal, ...remaining } = resolved.status.artifactPaths;
    resolved.status.artifactPaths = remaining;

    await expect(
      resolveApplyInstruction(root, "change-a", {}, { adapter, resolver })
    ).rejects.toMatchObject({
      code: "upstream_contract_mismatch",
      field: "status.artifactPaths.proposal",
    });
  });

  it("rejects an apply context path that resolves through an escaping symlink", async () => {
    const base = await adapter.getApplyInstructions("change-a");
    const outside = resolve(root, "outside-context.md");
    const linked = resolve(resolved.changeRoot, "linked-context.md");
    writeFileSync(outside, "outside");
    symlinkSync(outside, linked);
    resolved.artifactPaths.proposal!.existingOutputPaths = [linked];
    resolved.status.artifactPaths.proposal!.existingOutputPaths = [linked];
    vi.mocked(adapter.getApplyInstructions).mockResolvedValue({
      ...base,
      contextFiles: { proposal: [linked] },
    });

    await expect(
      resolveApplyInstruction(root, "change-a", {}, { adapter, resolver })
    ).rejects.toMatchObject({ code: "symlink_escape" });
  });

  it("builds review context from all exact artifact files", async () => {
    const value = await resolveReviewInstruction(root, "change-a", {}, { adapter, resolver });
    expect(value.completedGroups.map((group) => group.number)).toEqual([1]);
    expect(value.contextFiles).toEqual([
      resolve(resolved.changeRoot, "delivery.md"),
      resolve(resolved.changeRoot, "proposal.md"),
      resolve(resolved.changeRoot, "specs/auth/spec.md"),
    ]);
  });

  it("reports no completed review groups when every task remains open", async () => {
    writeFileSync(resolve(resolved.changeRoot, "delivery.md"), "## 1. Pending\n- [ ] 1.1 pending\n");
    const value = await resolveReviewInstruction(root, "change-a", {}, { adapter, resolver });
    expect(value.completedGroups).toEqual([]);
    expect(value.instruction).toContain("Completed groups: none");
  });

  it("requires both planning and implementation completion for archive", async () => {
    const pending = await resolveArchiveInstruction(root, "change-a", {}, { adapter, resolver });
    expect(pending).toMatchObject({ isReady: false, planningComplete: true, isComplete: false });
    expect(pending.reason).toContain("1 tasks remaining");

    writeFileSync(resolve(resolved.changeRoot, "delivery.md"), "## 1. Done\n- [x] 1.1 done\n");
    const done = await resolveArchiveInstruction(root, "change-a", {}, { adapter, resolver });
    expect(done).toMatchObject({ isReady: true, implementationComplete: true, isComplete: true });
  });

  it("blocks archive when planning itself is incomplete", async () => {
    resolved.planningComplete = false;
    const value = await resolveArchiveInstruction(root, "change-a", {}, { adapter, resolver });
    expect(value).toMatchObject({
      isReady: false,
      reason: "Change not ready for archive: planning artifacts are incomplete",
    });
  });
});
