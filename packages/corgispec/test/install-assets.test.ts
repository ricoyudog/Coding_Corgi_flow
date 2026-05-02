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
import yaml from "js-yaml";
import {
  classifyTargetState,
  getManagedProjectFiles,
  patchInstallerConfig,
  relativeManagedFiles,
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
      "commands/opencode/opsx-install.md",
      resolve(REPO_ROOT, ".opencode/commands/opsx-install.md")
    );
    expectBundledFile(
      bundleRoot,
      "commands/claude/opsx/install.md",
      resolve(REPO_ROOT, ".claude/commands/opsx/install.md")
    );
    expectBundledFile(
      bundleRoot,
      "memory-init/templates/session-memory-protocol.md",
      resolve(
        REPO_ROOT,
        ".opencode/skills/openspec-memory-init/templates/session-memory-protocol.md"
      )
    );
    expectBundledFile(
      bundleRoot,
      "memory-init/templates/memory/session-bridge.md",
      resolve(
        REPO_ROOT,
        ".opencode/skills/openspec-memory-init/templates/memory/session-bridge.md"
      )
    );
    expectBundledFile(
      bundleRoot,
      "memory-init/templates/wiki/hot.md",
      resolve(REPO_ROOT, ".opencode/skills/openspec-memory-init/templates/wiki/hot.md")
    );

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
    writeFile(resolve(caseDir, ".opencode/commands/opsx-install.md"), "# existing\n");

    const state = classifyTargetState(caseDir);

    expect(state.kind).toBe("legacy");
    expect(state.hasConfig).toBe(true);
    expect(state.hasManifest).toBe(false);
    expect(state.managedFiles).toContain(".opencode/commands/opsx-install.md");
  });

  it("classifies manifest without config as inconsistent", () => {
    writeFile(
      resolve(caseDir, "openspec/install-manifest.yaml"),
      "version: 1\nmanagedFiles:\n  - path: .opencode/commands/opsx-install.md\n"
    );

    const state = classifyTargetState(caseDir);

    expect(state.kind satisfies TargetStateKind).toBe("inconsistent");
    expect(state.hasConfig).toBe(false);
    expect(state.hasManifest).toBe(true);
  });

  it("classifies missing config with legacy-managed files as inconsistent", () => {
    writeFile(resolve(caseDir, ".opencode/commands/opsx-install.md"), "# existing\n");

    const state = classifyTargetState(caseDir);

    expect(state.kind satisfies TargetStateKind).toBe("inconsistent");
    expect(state.hasConfig).toBe(false);
    expect(state.hasManifest).toBe(false);
    expect(state.managedFiles).toContain(".opencode/commands/opsx-install.md");
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

  it("enumerates managed project files from a provided assets root", () => {
    const assetsRoot = resolve(caseDir, "assets");
    writeFile(resolve(assetsRoot, "commands/opencode/opsx-install.md"), "# cmd\n");
    writeFile(resolve(assetsRoot, "commands/claude/opsx/install.md"), "# claude\n");
    writeFile(resolve(assetsRoot, "schemas/github-tracked/schema.yaml"), "name: schema\n");
    writeFile(resolve(assetsRoot, "schemas/github-tracked/templates/spec.md"), "# spec\n");
    writeFile(resolve(assetsRoot, "memory-init/templates/wiki/hot.md"), "# hot\n");

    const files = getManagedProjectFiles("github-tracked", assetsRoot);
    const relativeFiles = relativeManagedFiles(caseDir, files).sort();

    expect(relativeFiles).toEqual([
      "assets/commands/claude/opsx/install.md",
      "assets/commands/opencode/opsx-install.md",
      "assets/schemas/github-tracked/schema.yaml",
      "assets/schemas/github-tracked/templates/spec.md",
    ]);
    expect(relativeFiles).not.toContain("assets/memory-init/templates/wiki/hot.md");
  });

  it("normalizes manifest-managed file paths to forward slashes", () => {
    writeFile(resolve(caseDir, "openspec/config.yaml"), "schema: github-tracked\n");
    writeFile(
      resolve(caseDir, "openspec/install-manifest.yaml"),
      "version: 1\nmanagedFiles:\n  - path: .opencode\\commands\\opsx-install.md\n"
    );

    const state = classifyTargetState(caseDir);

    expect(state.kind satisfies TargetStateKind).toBe("managed-update");
    expect(state.managedFiles).toEqual([".opencode/commands/opsx-install.md"]);
  });
});
