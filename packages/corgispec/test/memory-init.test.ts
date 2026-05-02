import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  extractProjectMemoryContext,
  initializeMemoryStructure,
} from "../src/lib/memory-init.js";

const TEST_ROOT = resolve(tmpdir(), `corgispec-memory-init-${Date.now()}`);

function writeBundledTemplate(assetsRoot: string, relativePath: string, content: string): void {
  const filePath = resolve(assetsRoot, "memory-init/templates", relativePath);
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content);
}

function seedBundledTemplates(assetsRoot: string): void {
  writeBundledTemplate(
    assetsRoot,
    "memory/MEMORY.md",
    [
      "---",
      "type: memory",
      "created: {{DATE}}",
      "---",
      "",
      "# BUNDLED MEMORY for {{PROJECT_NAME}}",
      "",
      "- Purpose: {{PROJECT_PURPOSE}}",
      "- Stack: {{TECH_STACK}}",
      "- Constraints: {{HARD_CONSTRAINTS}}",
      "- Preferences: {{PREFERENCES}}",
    ].join("\n")
  );
  writeBundledTemplate(
    assetsRoot,
    "memory/session-bridge.md",
    "updated: {{DATE}}\n\n# Session Bridge\n"
  );
  writeBundledTemplate(assetsRoot, "memory/pitfalls.md", "updated: {{DATE}}\n\n# Pitfalls\n");
  writeBundledTemplate(
    assetsRoot,
    "wiki/hot.md",
    [
      "updated: {{DATE}}",
      "",
      "# Bundled Hot for {{PROJECT_NAME}} Latest",
      "",
      "- Stable: {{STABLE_COMPONENTS}}",
      "- Evolving: {{EVOLVING_COMPONENTS}}",
      "- Legacy: {{LEGACY_COMPONENTS}}",
    ].join("\n")
  );
  writeBundledTemplate(
    assetsRoot,
    "wiki/index.md",
    "updated: {{DATE}}\n\n# {{PROJECT_NAME}} Wiki Index\n"
  );
  writeBundledTemplate(
    assetsRoot,
    "wiki/architecture/implicit-contracts.md",
    "updated: {{DATE}}\n\n# Implicit Contracts\n"
  );
  writeBundledTemplate(
    assetsRoot,
    "session-memory-protocol.md",
    "## Session Memory Protocol\n\nBundled protocol for {{PROJECT_NAME}}.\n"
  );
}

describe("memory init library", () => {
  let targetDir: string;
  let assetsRoot: string;
  let counter = 0;

  beforeEach(() => {
    counter += 1;
    targetDir = resolve(TEST_ROOT, `case-${counter}`);
    assetsRoot = resolve(TEST_ROOT, `assets-${counter}`);
    mkdirSync(targetDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("creates memory and wiki files from bundled templates", () => {
    seedBundledTemplates(assetsRoot);

    writeFileSync(
      resolve(targetDir, "README.md"),
      "# Sample Project\n\nA tiny TypeScript CLI for project memory bootstrapping.\n"
    );
    writeFileSync(
      resolve(targetDir, "package.json"),
      JSON.stringify(
        {
          name: "sample-project",
          description: "A tiny TypeScript CLI for project memory bootstrapping.",
          dependencies: {
            typescript: "^5.0.0",
            vitest: "^2.0.0",
          },
        },
        null,
        2
      )
    );
    writeFileSync(
      resolve(targetDir, "AGENTS.md"),
      [
        "# AGENTS.md",
        "",
        "## What this repo is",
        "",
        "A toolkit for repeatable automation workflows.",
        "",
        "## Commands",
        "",
        "- Use npm test before merging.",
      ].join("\n")
    );

    const extracted = extractProjectMemoryContext(targetDir);

    expect(extracted.projectName).toBe("Sample Project");
    expect(extracted.projectPurpose).toContain("memory bootstrapping");
    expect(extracted.techStack).toContain("TypeScript");

    const result = initializeMemoryStructure({ targetDir, assetsRoot });

    expect(result.createdFiles).toEqual(
      expect.arrayContaining([
        "memory/MEMORY.md",
        "memory/session-bridge.md",
        "memory/pitfalls.md",
        "wiki/hot.md",
        "wiki/index.md",
        "wiki/architecture/implicit-contracts.md",
      ])
    );
    expect(result.skippedFiles).toEqual([]);
    expect(result.injectedSessionMemoryProtocol).toBe(true);

    expect(existsSync(resolve(targetDir, "memory/MEMORY.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "wiki/hot.md"))).toBe(true);

    const memory = readFileSync(resolve(targetDir, "memory/MEMORY.md"), "utf-8");
    expect(memory).toContain("BUNDLED MEMORY");
    expect(memory).toContain("Sample Project");
    expect(memory).toContain("memory bootstrapping");
    expect(memory).toContain("TypeScript");
    expect(memory).not.toContain("{{PROJECT_NAME}}");

    const hot = readFileSync(resolve(targetDir, "wiki/hot.md"), "utf-8");
    expect(hot).toContain("Bundled Hot for Sample Project Latest");
    expect(hot).not.toContain("{{DATE}}");

    const agents = readFileSync(resolve(targetDir, "AGENTS.md"), "utf-8");
    expect(agents).toContain("## Session Memory Protocol");
  });

  it("does not duplicate the Session Memory Protocol when run twice", () => {
    seedBundledTemplates(assetsRoot);

    writeFileSync(resolve(targetDir, "README.md"), "# Repeatable Project\n");
    writeFileSync(resolve(targetDir, "AGENTS.md"), "# AGENTS.md\n\n## Commands\n\n- Keep docs current.\n");

    const first = initializeMemoryStructure({ targetDir, assetsRoot });
    const second = initializeMemoryStructure({ targetDir, assetsRoot });

    expect(first.injectedSessionMemoryProtocol).toBe(true);
    expect(second.injectedSessionMemoryProtocol).toBe(false);
    expect(second.createdFiles).toEqual([]);
    expect(second.skippedFiles).toEqual(
      expect.arrayContaining([
        "memory/MEMORY.md",
        "memory/session-bridge.md",
        "wiki/hot.md",
      ])
    );

    const agents = readFileSync(resolve(targetDir, "AGENTS.md"), "utf-8");
    expect(agents.match(/## Session Memory Protocol/g)).toHaveLength(1);
  });

  it("requires bundled package assets instead of falling back to source templates", () => {
    writeFileSync(resolve(targetDir, "README.md"), "# Asset Contract Project\n");

    expect(() => initializeMemoryStructure({ targetDir })).toThrow(
      /Memory init templates not found/
    );
  });
});
