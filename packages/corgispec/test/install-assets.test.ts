import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import {
  LEGACY_PROJECT_ASSET_CATALOG,
  classifyManagedProjectFiles,
  classifyTargetState,
  createMigrationSummary,
  getManagedProjectFiles,
  patchInstallerConfig,
  readInstallManifest,
  relativeManagedFiles,
  sha256File,
  type TargetStateKind,
} from "../src/lib/install-assets.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
const ASSETS_ROOT = resolve(PACKAGE_ROOT, "assets");
const TEST_ROOT = resolve(tmpdir(), `corgispec-install-assets-${Date.now()}`);

function writeFile(path: string, content: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function expectBundledFile(assetsRoot: string, relativePath: string, sourcePath: string) {
  const bundledPath = resolve(assetsRoot, relativePath);

  expect(existsSync(bundledPath), `${relativePath} should exist in bundled assets`).toBe(true);
  expect(readFileSync(bundledPath, "utf-8")).toBe(readFileSync(sourcePath, "utf-8"));
}

describe("bundle-assets", () => {
  it("bundles project-local commands and memory-init templates", () => {
    const bundleRoot = resolve(TEST_ROOT, "bundled-assets");

    execSync("node scripts/bundle-assets.js", {
      cwd: PACKAGE_ROOT,
      encoding: "utf-8",
      env: {
        ...process.env,
        CORGISPEC_ASSETS_DIR: bundleRoot,
      },
    });

    expectBundledFile(
      bundleRoot,
      "commands/opencode/corgi-install.md",
      resolve(REPO_ROOT, ".opencode/commands/corgi-install.md")
    );
    expectBundledFile(
      bundleRoot,
      "commands/claude/corgi/install.md",
      resolve(REPO_ROOT, ".claude/commands/corgi/install.md")
    );
    expectBundledFile(
      bundleRoot,
      "memory-init/templates/session-memory-protocol.md",
      resolve(
        REPO_ROOT,
        ".opencode/skills/atoms/corgispec-memory-init/templates/session-memory-protocol.md"
      )
    );
    expectBundledFile(
      bundleRoot,
      "memory-init/templates/memory/session-bridge.md",
      resolve(
        REPO_ROOT,
        ".opencode/skills/atoms/corgispec-memory-init/templates/memory/session-bridge.md"
      )
    );
    expectBundledFile(
      bundleRoot,
      "memory-init/templates/wiki/hot.md",
      resolve(REPO_ROOT, ".opencode/skills/atoms/corgispec-memory-init/templates/wiki/hot.md")
    );

    expectBundledFile(
      bundleRoot,
      "commands/opencode/corgi-apply.md",
      resolve(REPO_ROOT, ".opencode/commands/corgi-apply.md")
    );
    expectBundledFile(
      bundleRoot,
      "commands/claude/corgi/apply.md",
      resolve(REPO_ROOT, ".claude/commands/corgi/apply.md")
    );
    expect(existsSync(resolve(bundleRoot, "commands/opencode/corgi-loop.md"))).toBe(false);
    expect(existsSync(resolve(bundleRoot, "commands/claude/corgi/loop.md"))).toBe(false);
    expect(existsSync(resolve(bundleRoot, "skills/molecules/corgispec-apply-change"))).toBe(false);
    expect(existsSync(resolve(bundleRoot, "skills/molecules/corgispec-gh-apply"))).toBe(false);
    expect(existsSync(resolve(bundleRoot, "skills/compounds/corgispec-apply/SKILL.md"))).toBe(true);
    expect(existsSync(resolve(bundleRoot, "skills/compounds/corgispec-loop"))).toBe(false);
    expect(existsSync(resolve(ASSETS_ROOT, "schemas/skill-meta.schema.json"))).toBe(true);
  });
});

describe("install asset helpers", () => {
  let caseDir: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    caseDir = resolve(TEST_ROOT, `case-${counter}`);
    mkdirSync(caseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("classifies a project with config and manifest as managed-update", () => {
    writeFile(
      resolve(caseDir, "openspec/config.yaml"),
      "schema: github-tracked\ncontext: existing\n"
    );
    writeFile(
      resolve(caseDir, "openspec/install-manifest.yaml"),
      "version: 1\nmanagedFiles:\n  - path: openspec/config.yaml\n"
    );

    const state = classifyTargetState(caseDir);

    expect(state.kind satisfies TargetStateKind).toBe("managed-update");
    expect(state.hasConfig).toBe(true);
    expect(state.hasManifest).toBe(true);
  });

  it("classifies a target without config or managed files as init-needed", () => {
    const state = classifyTargetState(caseDir);

    expect(state.kind satisfies TargetStateKind).toBe("init-needed");
    expect(state.hasConfig).toBe(false);
    expect(state.hasManifest).toBe(false);
    expect(state.managedFiles).toEqual([]);
  });

  it("classifies config without manifest or managed files as fresh", () => {
    writeFile(resolve(caseDir, "openspec/config.yaml"), "schema: github-tracked\n");

    const state = classifyTargetState(caseDir);

    expect(state.kind satisfies TargetStateKind).toBe("fresh");
    expect(state.hasConfig).toBe(true);
    expect(state.hasManifest).toBe(false);
    expect(state.managedFiles).toEqual([]);
  });

  it("classifies config plus managed files without manifest as legacy", () => {
    writeFile(resolve(caseDir, "openspec/config.yaml"), "schema: gitlab-tracked\n");
    writeFile(resolve(caseDir, ".opencode/commands/corgi-install.md"), "# existing\n");

    const state = classifyTargetState(caseDir);

    expect(state.kind).toBe("legacy");
    expect(state.hasConfig).toBe(true);
    expect(state.hasManifest).toBe(false);
    expect(state.managedFiles).toContain(".opencode/commands/corgi-install.md");
  });

  it("classifies manifest without config as inconsistent", () => {
    writeFile(
      resolve(caseDir, "openspec/install-manifest.yaml"),
      "version: 1\nmanagedFiles:\n  - path: .opencode/commands/corgi-install.md\n"
    );

    const state = classifyTargetState(caseDir);

    expect(state.kind satisfies TargetStateKind).toBe("inconsistent");
    expect(state.hasConfig).toBe(false);
    expect(state.hasManifest).toBe(true);
  });

  it("classifies missing config with legacy-managed files as inconsistent", () => {
    writeFile(resolve(caseDir, ".opencode/commands/corgi-install.md"), "# existing\n");

    const state = classifyTargetState(caseDir);

    expect(state.kind satisfies TargetStateKind).toBe("inconsistent");
    expect(state.hasConfig).toBe(false);
    expect(state.hasManifest).toBe(false);
    expect(state.managedFiles).toContain(".opencode/commands/corgi-install.md");
  });

  it("patches only installer-owned config fields while preserving context and rules", () => {
    const existingYaml = `schema: gitlab-tracked
context: |
  Keep this context block.
rules:
  review:
    - Keep review checklists short
installer:
  version: 0
  managed_at: yesterday
isolation:
  mode: none
`;

    const patchedYaml = patchInstallerConfig(existingYaml, {
      schema: "github-tracked",
      installer: {
        version: 2,
        managed_at: "2026-05-02T10:00:00.000Z",
      },
      isolation: {
        mode: "worktree",
        root: ".superpowers/worktrees",
      },
    });

    const parsed = yaml.load(patchedYaml) as Record<string, any>;
    expect(parsed.schema).toBe("github-tracked");
    expect(parsed.context).toContain("Keep this context block.");
    expect(parsed.rules).toEqual({ review: ["Keep review checklists short"] });
    expect(parsed.installer).toEqual({
      version: 2,
      managed_at: "2026-05-02T10:00:00.000Z",
    });
    expect(parsed.isolation).toEqual({
      mode: "worktree",
      root: ".superpowers/worktrees",
    });
  });

  it("adds an explicit tracking provider without replacing other Corgi config", () => {
    const existingYaml = `schema: github-tracked
corgi:
  taskArtifactId: execution-plan
  tracking:
    label: keep-me
context: preserve me
rules:
  execution-plan:
    - Keep this rule
isolation:
  mode: worktree
  root: .worktrees
`;

    const patchedYaml = patchInstallerConfig(existingYaml, {
      schema: "github-tracked",
      trackingProvider: "github",
    });
    const parsed = yaml.load(patchedYaml) as Record<string, any>;

    expect(parsed.corgi).toEqual({
      taskArtifactId: "execution-plan",
      tracking: {
        label: "keep-me",
        provider: "github",
      },
    });
    expect(parsed.context).toBe("preserve me");
    expect(parsed.rules).toEqual({ "execution-plan": ["Keep this rule"] });
    expect(parsed.isolation).toEqual({ mode: "worktree", root: ".worktrees" });
  });

  it("enumerates managed project files from a provided assets root", () => {
    const assetsRoot = resolve(caseDir, "assets");
    writeFile(resolve(assetsRoot, "commands/opencode/corgi-install.md"), "# cmd\n");
    writeFile(resolve(assetsRoot, "commands/claude/corgi/install.md"), "# claude\n");
    writeFile(resolve(assetsRoot, "schemas/github-tracked/schema.yaml"), "name: schema\n");
    writeFile(resolve(assetsRoot, "schemas/github-tracked/templates/spec.md"), "# spec\n");
    writeFile(resolve(assetsRoot, "memory-init/templates/wiki/hot.md"), "# hot\n");

    const files = getManagedProjectFiles("github-tracked", assetsRoot);
    const relativeFiles = relativeManagedFiles(caseDir, files).sort();

    expect(relativeFiles).toEqual([
      "assets/commands/claude/corgi/install.md",
      "assets/commands/opencode/corgi-install.md",
      "assets/schemas/github-tracked/schema.yaml",
      "assets/schemas/github-tracked/templates/spec.md",
    ]);
    expect(relativeFiles).not.toContain("assets/memory-init/templates/wiki/hot.md");
  });

  it("normalizes manifest-managed file paths to forward slashes", () => {
    writeFile(resolve(caseDir, "openspec/config.yaml"), "schema: github-tracked\n");
    writeFile(
      resolve(caseDir, "openspec/install-manifest.yaml"),
      "version: 1\nmanagedFiles:\n  - path: .opencode\\commands\\corgi-install.md\n"
    );

    const state = classifyTargetState(caseDir);

    expect(state.kind satisfies TargetStateKind).toBe("managed-update");
    expect(state.managedFiles).toEqual([".opencode/commands/corgi-install.md"]);
  });

  it("reads v1 JSON and legacy YAML manifests without throwing", () => {
    const jsonDir = resolve(caseDir, "json");
    writeFile(resolve(jsonDir, "openspec/.corgi-install.json"), JSON.stringify({
      version: 1,
      installedAt: "2026-01-02T03:04:05.000Z",
      files: {
        ".opencode\\commands\\corgi-install.md": {},
      },
    }));
    const jsonRead = readInstallManifest(jsonDir);

    expect(jsonRead.status).toBe("valid");
    expect(jsonRead.sourceVersion).toBe(1);
    expect(jsonRead.sourceFormat).toBe("json");
    expect(jsonRead.manifest?.installedAt).toBe("2026-01-02T03:04:05.000Z");
    expect(Object.keys(jsonRead.manifest?.files ?? {})).toEqual([
      ".opencode/commands/corgi-install.md",
    ]);

    const yamlDir = resolve(caseDir, "yaml");
    writeFile(
      resolve(yamlDir, "openspec/install-manifest.yaml"),
      "version: 1\ninstalledAt: 2025-01-01T00:00:00.000Z\nmanagedFiles:\n  - path: openspec/config.yaml\n"
    );
    const yamlRead = readInstallManifest(yamlDir);

    expect(yamlRead.status).toBe("valid");
    expect(yamlRead.sourceVersion).toBe(1);
    expect(yamlRead.sourceFormat).toBe("yaml");
    expect(yamlRead.manifest?.files).toEqual({ "openspec/config.yaml": {} });
  });

  it("prefers the canonical manifest while reporting a legacy manifest for retirement", () => {
    writeFile(
      resolve(caseDir, "openspec/.corgi-install.json"),
      JSON.stringify({ version: 1, files: { "openspec/config.yaml": {} } })
    );
    writeFile(
      resolve(caseDir, "openspec/install-manifest.yaml"),
      "version: 1\nmanagedFiles:\n  - legacy.md\n"
    );

    const read = readInstallManifest(caseDir);

    expect(read.status).toBe("valid");
    expect(read.manifestPath).toBe(resolve(caseDir, "openspec/.corgi-install.json"));
    expect(read.legacyPaths).toEqual([
      resolve(caseDir, "openspec/install-manifest.yaml"),
    ]);
  });

  it("returns invalid or ambiguous results for unsafe manifests instead of throwing", () => {
    writeFile(resolve(caseDir, "openspec/.corgi-install.json"), "{ broken");
    expect(readInstallManifest(caseDir)).toMatchObject({
      status: "invalid",
      manifestPath: resolve(caseDir, "openspec/.corgi-install.json"),
    });

    rmSync(resolve(caseDir, "openspec/.corgi-install.json"));
    writeFile(
      resolve(caseDir, "openspec/install-manifest.yaml"),
      "version: 1\nmanagedFiles: []\n"
    );
    writeFile(
      resolve(caseDir, "openspec/install-manifest.yml"),
      "version: 1\nmanagedFiles: []\n"
    );
    expect(readInstallManifest(caseDir).status).toBe("ambiguous");
  });

  it("classifies managed files independently and treats missing files as repairable", () => {
    const sourceRoot = resolve(caseDir, "source");
    const targetRoot = resolve(caseDir, "target");
    const currentSource = resolve(sourceRoot, "current.md");
    const missingSource = resolve(sourceRoot, "missing.md");
    const outdatedSource = resolve(sourceRoot, "outdated.md");
    const modifiedSource = resolve(sourceRoot, "modified.md");
    writeFile(currentSource, "current package\n");
    writeFile(missingSource, "missing package\n");
    writeFile(outdatedSource, "new package\n");
    writeFile(modifiedSource, "new modified package\n");
    writeFile(resolve(targetRoot, "current.md"), "current package\n");
    writeFile(resolve(targetRoot, "outdated.md"), "old package\n");
    writeFile(resolve(targetRoot, "modified.md"), "user edit\n");

    const oldOutdated = resolve(caseDir, "old-outdated.md");
    const oldModified = resolve(caseDir, "old-modified.md");
    writeFile(oldOutdated, "old package\n");
    writeFile(oldModified, "old modified package\n");
    const classifications = classifyManagedProjectFiles({
      targetDir: targetRoot,
      expectedFiles: [
        { path: "current.md", sourcePath: currentSource },
        { path: "missing.md", sourcePath: missingSource },
        { path: "outdated.md", sourcePath: outdatedSource },
        { path: "modified.md", sourcePath: modifiedSource },
      ],
      manifest: {
        version: 1,
        files: {
          "outdated.md": { sha256: sha256File(oldOutdated) },
          "modified.md": { sha256: sha256File(oldModified) },
          "missing.md": { sha256: sha256File(missingSource) },
        },
      },
      obsoleteCandidates: [],
    });

    expect(Object.fromEntries(classifications.map(({ path, state }) => [path, state]))).toEqual({
      "current.md": "current",
      "missing.md": "missing",
      "modified.md": "locally-modified",
      "outdated.md": "outdated",
    });
  });

  it("only classifies catalog paths as obsolete when the Corgi signature matches", () => {
    const owned = LEGACY_PROJECT_ASSET_CATALOG.find(
      (entry) => entry.path === ".opencode/commands/opsx-install.md"
    )!;
    const custom = {
      path: ".opencode/commands/custom-install.md",
      kind: "command" as const,
      signatures: ["corgispec generated"],
    };
    writeFile(resolve(caseDir, owned.path), "# opsx install\n");
    writeFile(resolve(caseDir, custom.path), "# custom install\n");

    const classifications = classifyManagedProjectFiles({
      targetDir: caseDir,
      expectedFiles: [],
      obsoleteCandidates: [owned, custom],
    });

    expect(classifications).toMatchObject([
      { path: custom.path, state: "ambiguous" },
      { path: owned.path, state: "obsolete" },
    ]);
  });

  it("retires only signature-proven project-local loop commands", () => {
    const opencodeLoop = LEGACY_PROJECT_ASSET_CATALOG.find(
      (entry) => entry.path === ".opencode/commands/corgi-loop.md"
    )!;
    const claudeLoop = LEGACY_PROJECT_ASSET_CATALOG.find(
      (entry) => entry.path === ".claude/commands/corgi/loop.md"
    )!;
    writeFile(
      resolve(caseDir, opencodeLoop.path),
      "Run the corgispec-loop workflow with state in .corgi/loop.\n",
    );
    writeFile(resolve(caseDir, claudeLoop.path), "# custom loop command\n");

    const classifications = classifyManagedProjectFiles({
      targetDir: caseDir,
      expectedFiles: [],
      obsoleteCandidates: [opencodeLoop, claudeLoop],
    });

    expect(classifications).toMatchObject([
      { path: claudeLoop.path, state: "ambiguous" },
      { path: opencodeLoop.path, state: "obsolete" },
    ]);
  });

  it("creates an empty stable migration summary", () => {
    expect(createMigrationSummary(1)).toEqual({
      fromManifestVersion: 1,
      repaired: [],
      updated: [],
      removed: [],
      preserved: [],
      conflicts: [],
      backups: [],
    });
  });
});
