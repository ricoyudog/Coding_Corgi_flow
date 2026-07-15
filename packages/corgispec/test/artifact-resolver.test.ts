import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ArtifactResolver,
  assertArtifactOutputPath,
  assertWritableArtifactPath,
  createArtifactResolver,
  type ArtifactStatusProvider,
} from "../src/lib/artifact-resolver.js";
import type {
  OpenSpecCommandOptions,
  OpenSpecStatusResponse,
} from "../src/lib/openspec-adapter.js";

let testDir: string;
let planningRoot: string;
let changesDir: string;
let changeRoot: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "corgispec-artifacts-"));
  // This deliberately models a registered Store outside the caller's cwd.
  planningRoot = resolve(testDir, "registered-store");
  changesDir = resolve(planningRoot, "openspec/changes");
  changeRoot = resolve(changesDir, "add-auth");

  writeArtifact("proposal.md", "# Proposal\n");
  writeArtifact("specs/auth/spec.md", "# Auth\n");
  writeArtifact("specs/session/nested/spec.md", "# Session\n");
  writeArtifact("delivery.md", "## 1. Delivery\n\n- [ ] 1.1 Ship\n");
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

function writeArtifact(relativePath: string, content: string): void {
  const target = resolve(changeRoot, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function fixtureStatus(): OpenSpecStatusResponse {
  const template = readFileSync(
    new URL("./fixtures/openspec-1.6/status-complete.json", import.meta.url),
    "utf8"
  );
  const status = JSON.parse(
    template
      .replaceAll("${PLANNING_ROOT}", jsonStringFragment(planningRoot))
      .replaceAll("${CHANGES_DIR}", jsonStringFragment(changesDir))
      .replaceAll("${CHANGE_ROOT}", jsonStringFragment(changeRoot))
  ) as OpenSpecStatusResponse;

  // The checked-in fixture intentionally uses OpenSpec's portable `/` JSON
  // spelling. Convert only concrete filesystem paths to the host spelling so
  // this test exercises the same authoritative paths OpenSpec emits on each OS.
  for (const artifact of Object.values(status.artifactPaths)) {
    artifact.resolvedOutputPath = normalize(artifact.resolvedOutputPath);
    artifact.existingOutputPaths = artifact.existingOutputPaths.map(normalize);
  }
  return status;
}

function jsonStringFragment(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

class StatusProvider implements ArtifactStatusProvider {
  readonly calls: Array<{ changeName: string; options?: OpenSpecCommandOptions }> = [];

  constructor(public status: OpenSpecStatusResponse) {}

  async getStatus(
    changeName: string,
    options?: OpenSpecCommandOptions
  ): Promise<OpenSpecStatusResponse> {
    this.calls.push({ changeName, options });
    return this.status;
  }
}

describe("ArtifactResolver", () => {
  it("resolves nested/glob files from authoritative OpenSpec paths", async () => {
    const provider = new StatusProvider(fixtureStatus());
    const resolver = new ArtifactResolver(provider);

    const resolved = await resolver.resolve("add-auth", { store: "shared-product" });

    expect(resolved).toMatchObject({
      changeName: "add-auth",
      schemaName: "custom-delivery",
      planningHome: { root: planningRoot, changesDir },
      changeRoot,
      planningComplete: true,
      planningRevision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      actionContext: { sourceOfTruth: "repo" },
    });
    expect(resolved.artifactPaths.specs!.existingOutputPaths).toEqual([
      resolve(changeRoot, "specs/auth/spec.md"),
      resolve(changeRoot, "specs/session/nested/spec.md"),
    ]);
    expect(resolved.artifactPaths.specs!.resolvedOutputPath).toContain("**/*.md");
    expect(provider.calls).toEqual([
      { changeName: "add-auth", options: { store: "shared-product" } },
    ]);
  });

  it("provides a default factory for CLI composition", async () => {
    const resolver = createArtifactResolver(new StatusProvider(fixtureStatus()));
    await expect(resolver.resolve("add-auth")).resolves.toMatchObject({ changeRoot });
  });

  it("deduplicates concrete outputs and computes a deterministic revision", async () => {
    const firstStatus = fixtureStatus();
    firstStatus.artifactPaths.specs!.existingOutputPaths.reverse();
    firstStatus.artifactPaths.specs!.existingOutputPaths.push(
      firstStatus.artifactPaths.specs!.existingOutputPaths[0]!
    );
    const reordered = fixtureStatus();
    reordered.artifactPaths = {
      delivery: reordered.artifactPaths.delivery!,
      proposal: reordered.artifactPaths.proposal!,
      specs: reordered.artifactPaths.specs!,
    };

    const first = await new ArtifactResolver(new StatusProvider(firstStatus)).resolve("add-auth");
    const second = await new ArtifactResolver(new StatusProvider(reordered)).resolve("add-auth");

    expect(first.artifactPaths.specs!.existingOutputPaths).toHaveLength(2);
    expect(first.planningRevision).toBe(second.planningRevision);
  });

  it("changes planningRevision when an artifact byte changes", async () => {
    const resolver = new ArtifactResolver(new StatusProvider(fixtureStatus()));
    const before = await resolver.resolve("add-auth");

    writeArtifact("proposal.md", "# Changed Proposal\n");
    const after = await resolver.resolve("add-auth");

    expect(after.planningRevision).not.toBe(before.planningRevision);
  });

  it("supports an injected revision reader", async () => {
    const reads: string[] = [];
    const resolver = new ArtifactResolver(new StatusProvider(fixtureStatus()), {
      fileReader: {
        async read(filePath) {
          reads.push(filePath);
          return Buffer.from(`virtual:${filePath}`);
        },
      },
    });

    await resolver.resolve("add-auth");
    expect(reads).toHaveLength(4);
  });

  it.each([
    [
      (status: OpenSpecStatusResponse) => {
        status.planningHome.root = "relative/root";
      },
      "path_not_absolute",
    ],
    [
      (status: OpenSpecStatusResponse) => {
        status.planningHome.changesDir = resolve(testDir, "unrelated-changes");
      },
      "path_outside_planning_home",
    ],
    [
      (status: OpenSpecStatusResponse) => {
        status.changeRoot = resolve(testDir, "somewhere-else");
      },
      "path_outside_planning_home",
    ],
    [
      (status: OpenSpecStatusResponse) => {
        status.artifactPaths.proposal!.existingOutputPaths = ["proposal.md"];
      },
      "path_not_absolute",
    ],
    [
      (status: OpenSpecStatusResponse) => {
        const outside = resolve(changeRoot, "../outside.md");
        writeFileSync(outside, "outside");
        status.artifactPaths.proposal!.existingOutputPaths = [outside];
      },
      "path_outside_change",
    ],
    [
      (status: OpenSpecStatusResponse) => {
        status.artifactPaths.proposal!.existingOutputPaths = [resolve(changeRoot, "missing.md")];
      },
      "path_unavailable",
    ],
    [
      (status: OpenSpecStatusResponse) => {
        const directory = resolve(changeRoot, "not-a-file");
        mkdirSync(directory);
        status.artifactPaths.proposal!.existingOutputPaths = [directory];
      },
      "path_not_file",
    ],
  ] as const)("rejects invalid authoritative path contracts", async (mutate, code) => {
    const status = fixtureStatus();
    mutate(status);

    await expect(new ArtifactResolver(new StatusProvider(status)).resolve("add-auth")).rejects.toMatchObject({
      code,
    });
  });

  it("rejects an existing artifact symlink that escapes the change root", async () => {
    const outside = resolve(testDir, "outside-secret.md");
    const linked = resolve(changeRoot, "linked.md");
    writeFileSync(outside, "secret");
    symlinkSync(outside, linked);
    const status = fixtureStatus();
    status.artifactPaths.proposal!.existingOutputPaths = [linked];

    await expect(new ArtifactResolver(new StatusProvider(status)).resolve("add-auth")).rejects.toMatchObject({
      code: "symlink_escape",
      targetPath: linked,
    });
  });

  it("rejects a changesDir symlink that escapes the authoritative planning root", async () => {
    const root = resolve(testDir, "symlinked-store");
    const outsideChanges = resolve(testDir, "outside-changes");
    const linkedChanges = resolve(root, "changes");
    mkdirSync(resolve(outsideChanges, "add-auth"), { recursive: true });
    mkdirSync(root, { recursive: true });
    symlinkSync(outsideChanges, linkedChanges, "dir");

    const status = fixtureStatus();
    status.planningHome.root = root;
    status.planningHome.changesDir = linkedChanges;
    status.changeRoot = resolve(linkedChanges, "add-auth");

    await expect(new ArtifactResolver(new StatusProvider(status)).resolve("add-auth")).rejects.toMatchObject({
      code: "symlink_escape",
      targetPath: linkedChanges,
    });
  });

  it("rejects a changeRoot symlink that escapes its authoritative changesDir", async () => {
    const root = resolve(testDir, "change-link-store");
    const safeChanges = resolve(root, "changes");
    const outsideChange = resolve(testDir, "outside-change");
    const linkedChange = resolve(safeChanges, "add-auth");
    mkdirSync(safeChanges, { recursive: true });
    mkdirSync(outsideChange, { recursive: true });
    symlinkSync(outsideChange, linkedChange, "dir");

    const status = fixtureStatus();
    status.planningHome.root = root;
    status.planningHome.changesDir = safeChanges;
    status.changeRoot = linkedChange;

    await expect(new ArtifactResolver(new StatusProvider(status)).resolve("add-auth")).rejects.toMatchObject({
      code: "symlink_escape",
      targetPath: linkedChange,
    });
  });
});

describe("assertWritableArtifactPath", () => {
  it("accepts existing and new descendants", async () => {
    await expect(assertWritableArtifactPath({ changeRoot }, "proposal.md")).resolves.toBe(
      resolve(changeRoot, "proposal.md")
    );
    await expect(
      assertWritableArtifactPath({ changeRoot }, "specs/new-capability/spec.md")
    ).resolves.toBe(resolve(changeRoot, "specs/new-capability/spec.md"));
  });

  it("rejects lexical traversal", async () => {
    await expect(assertWritableArtifactPath({ changeRoot }, "../escape.md")).rejects.toMatchObject({
      code: "path_outside_change",
    });
  });

  it("rejects a new file below a symlinked directory that escapes", async () => {
    const outsideDir = resolve(testDir, "outside-dir");
    mkdirSync(outsideDir);
    symlinkSync(outsideDir, resolve(changeRoot, "escaped-dir"), "dir");

    await expect(
      assertWritableArtifactPath({ changeRoot }, "escaped-dir/new.md")
    ).rejects.toMatchObject({ code: "symlink_escape" });
  });

  it("validates a nested glob through its static ancestor without treating it as a file", async () => {
    await expect(
      assertArtifactOutputPath({ changeRoot }, resolve(changeRoot, "specs/**/*.md"), true)
    ).resolves.toBe(resolve(changeRoot, "specs/**/*.md"));
  });

  it("rejects traversal and symlink escape in glob outputs", async () => {
    await expect(
      assertArtifactOutputPath({ changeRoot }, resolve(changeRoot, "../**/*.md"), true)
    ).rejects.toMatchObject({ code: "path_outside_change" });

    const outsideDir = resolve(testDir, "glob-outside-dir");
    mkdirSync(outsideDir);
    symlinkSync(outsideDir, resolve(changeRoot, "linked-specs"), "dir");
    await expect(
      assertArtifactOutputPath({ changeRoot }, resolve(changeRoot, "linked-specs/**/*.md"), true)
    ).rejects.toMatchObject({ code: "symlink_escape" });
  });
});
