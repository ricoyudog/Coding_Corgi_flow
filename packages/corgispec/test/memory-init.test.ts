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
    [
      "updated: {{DATE}}",
      "",
      "# {{PROJECT_NAME}} Wiki Index",
      "",
      "- [[wiki/architecture/_index|Architecture Index]]",
      "- [[wiki/research/_index|Research Index]]",
      "- [[wiki/patterns/_index|Patterns Index]]",
      "- [[wiki/decisions/_index|Decisions Index]]",
      "- [[wiki/guides/_index|Guides Index]]",
      "- [[wiki/questions/_index|Questions Index]]",
      "- [[wiki/deliveries/_index|Delivery Index]]",
      "- [[wiki/meta/_index|Meta Index]]",
      "",
    ].join("\n")
  );
  writeBundledTemplate(
    assetsRoot,
    "wiki/architecture/implicit-contracts.md",
    "updated: {{DATE}}\n\n# Implicit Contracts\n"
  );
  writeBundledTemplate(assetsRoot, "wiki/architecture/_index.md", "# Architecture\n");
  writeBundledTemplate(assetsRoot, "wiki/research/_index.md", "# Research\n");
  writeBundledTemplate(assetsRoot, "wiki/patterns/_index.md", "# Patterns\n");
  writeBundledTemplate(assetsRoot, "wiki/decisions/_index.md", "# Decisions\n");
  writeBundledTemplate(assetsRoot, "wiki/guides/_index.md", "# Guides\n");
  writeBundledTemplate(assetsRoot, "wiki/questions/_index.md", "# Questions\n");
  writeBundledTemplate(assetsRoot, "wiki/deliveries/_index.md", "# Deliveries\n");
  writeBundledTemplate(assetsRoot, "wiki/meta/_index.md", "# Meta\n");
  writeBundledTemplate(
    assetsRoot,
    "wiki/schema.md",
    "updated: {{DATE}}\n\n# Wiki Schema\n"
  );
  writeBundledTemplate(
    assetsRoot,
    "session-memory-protocol.md",
    [
      "## Session Memory Protocol",
      "",
      "1. `memory/session-bridge.md`",
      "2. `memory/MEMORY.md`",
      "3. `wiki/hot.md`",
      "",
      "Read `wiki/index.md` only on demand.",
    ].join("\n")
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
        "wiki/schema.md",
        "wiki/architecture/implicit-contracts.md",
        "wiki/architecture/_index.md",
        "wiki/research/_index.md",
        "wiki/patterns/_index.md",
        "wiki/decisions/_index.md",
        "wiki/guides/_index.md",
        "wiki/questions/_index.md",
        "wiki/deliveries/_index.md",
        "wiki/meta/_index.md",
      ])
    );
    expect(result.skippedFiles).toEqual([]);
    expect(result.injectedSessionMemoryProtocol).toBe(true);

    expect(existsSync(resolve(targetDir, "memory/MEMORY.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "wiki/hot.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "wiki/sessions"))).toBe(false);
    expect(existsSync(resolve(targetDir, "wiki/log.md"))).toBe(false);

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
    expect(agents.indexOf("memory/session-bridge.md")).toBeLessThan(
      agents.indexOf("memory/MEMORY.md")
    );
    expect(agents.indexOf("memory/MEMORY.md")).toBeLessThan(
      agents.indexOf("wiki/hot.md")
    );
    expect(agents).toContain("wiki/index.md` only on demand");
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

  it("preserves legacy sessions and log files without adding new entries", () => {
    seedBundledTemplates(assetsRoot);
    mkdirSync(resolve(targetDir, "wiki/sessions"), { recursive: true });
    const sessionPath = resolve(targetDir, "wiki/sessions/legacy.md");
    const logPath = resolve(targetDir, "wiki/log.md");
    writeFileSync(sessionPath, "# Legacy session\n");
    writeFileSync(logPath, "2025-01-01 | legacy archive\n");

    initializeMemoryStructure({ targetDir, assetsRoot });

    expect(readFileSync(sessionPath, "utf-8")).toBe("# Legacy session\n");
    expect(readFileSync(logPath, "utf-8")).toBe("2025-01-01 | legacy archive\n");
  });

  it("upgrades the v3 bridge, hot page, index, and startup protocol without losing user content", () => {
    seedBundledTemplates(assetsRoot);
    mkdirSync(resolve(targetDir, "memory"), { recursive: true });
    mkdirSync(resolve(targetDir, "wiki/sessions"), { recursive: true });
    writeFileSync(resolve(targetDir, "memory/session-bridge.md"), [
      "---",
      "type: memory",
      "updated: 2026-08-01",
      "---",
      "",
      "# Session Bridge",
      "",
      "## Active opsx Change",
      "- **Change**: none",
      "- **Phase**: none",
      "- **Branch**: main",
      "",
      "## Done (last session completed)",
      "- Finished custom migration analysis.",
      "",
      "## Waiting (next steps / blockers)",
      "- Waiting for a human decision.",
      "",
      "## New Pitfalls",
      "- Preserve the custom deployment caveat.",
      "",
      "## New Discoveries",
      "- The service owns its compatibility table.",
      "",
      "## Next Session Start",
      "1. Read this file",
      "2. Read wiki/hot.md",
      "3. Read wiki/index.md",
      "",
    ].join("\n"));
    mkdirSync(resolve(targetDir, "wiki"), { recursive: true });
    writeFileSync(resolve(targetDir, "wiki/hot.md"), [
      "---",
      "type: wiki",
      "updated: 2026-08-01",
      "---",
      "",
      "# Legacy Hot",
      "",
      "## Active Changes",
      "- No active delivery.",
      "",
      "## Recent Decisions",
      "- Keep the custom deployment window.",
      "",
      "## Recently Shipped",
      "- [[wiki/deliveries/legacy-export|Legacy export]]",
      "",
    ].join("\n"));
    writeFileSync(resolve(targetDir, "wiki/index.md"), [
      "# Legacy Wiki Index",
      "",
      "- [[wiki/architecture/_index|Architecture Index]]",
      "- Keep this human navigation note.",
      "",
    ].join("\n"));
    writeFileSync(resolve(targetDir, "AGENTS.md"), [
      "# Agent Rules",
      "",
      "## Session Memory Protocol",
      "",
      "1. `memory/session-bridge.md`",
      "2. `wiki/hot.md`",
      "3. `wiki/index.md`",
      "",
      "## Custom Rules",
      "",
      "- Preserve this project-specific rule.",
      "",
    ].join("\n"));
    writeFileSync(resolve(targetDir, "wiki/sessions/legacy.md"), "# Exact legacy session\n");
    writeFileSync(resolve(targetDir, "wiki/log.md"), "legacy log bytes\n");

    const result = initializeMemoryStructure({
      targetDir,
      assetsRoot,
      date: new Date("2026-08-14T00:00:00.000Z"),
    });

    expect(result.upgradedFiles).toEqual(expect.arrayContaining([
      "memory/session-bridge.md",
      "wiki/hot.md",
      "wiki/index.md",
      "AGENTS.md",
    ]));
    const bridge = readFileSync(resolve(targetDir, "memory/session-bridge.md"), "utf8");
    for (const field of [
      "RFC", "RFC Revision", "Slice", "Issue", "Change", "Worktree",
      "Phase at Checkpoint", "Task Group at Checkpoint", "Observed Run Revision", "Last Verified HEAD",
    ]) {
      expect(bridge).toContain(`- **${field}**:`);
    }
    for (const section of ["Next Action", "Blockers", "Uncommitted Work", "Discoveries", "Promotion Queue"]) {
      expect(bridge).toContain(`## ${section}`);
    }
    expect(bridge).toContain("Finished custom migration analysis.");
    expect(bridge).toContain("Waiting for a human decision.");
    expect(bridge).toContain("Preserve the custom deployment caveat.");
    expect(bridge).toContain("The service owns its compatibility table.");

    const hot = readFileSync(resolve(targetDir, "wiki/hot.md"), "utf8");
    for (const region of ["active-rfcs", "active-deliveries", "recently-shipped"]) {
      expect(hot).toContain(`<!-- corgi:managed:start ${region} -->`);
      expect(hot).toContain(`<!-- corgi:managed:end ${region} -->`);
    }
    expect(hot).toContain("Keep the custom deployment window.");
    expect(hot).toContain("Legacy export");

    const index = readFileSync(resolve(targetDir, "wiki/index.md"), "utf8");
    expect(index).toContain("Keep this human navigation note.");
    expect(index).toContain("[[wiki/guides/_index|Guides Index]]");
    expect(index).toContain("[[wiki/deliveries/_index|Delivery Index]]");
    expect(existsSync(resolve(targetDir, "memory/MEMORY.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "wiki/schema.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "wiki/guides/_index.md"))).toBe(true);
    expect(existsSync(resolve(targetDir, "wiki/deliveries/_index.md"))).toBe(true);

    const agents = readFileSync(resolve(targetDir, "AGENTS.md"), "utf8");
    expect(agents.match(/## Session Memory Protocol/gu)).toHaveLength(1);
    expect(agents.indexOf("memory/session-bridge.md")).toBeLessThan(agents.indexOf("memory/MEMORY.md"));
    expect(agents.indexOf("memory/MEMORY.md")).toBeLessThan(agents.indexOf("wiki/hot.md"));
    expect(agents).toContain("Preserve this project-specific rule.");
    expect(readFileSync(resolve(targetDir, "wiki/sessions/legacy.md"), "utf8"))
      .toBe("# Exact legacy session\n");
    expect(readFileSync(resolve(targetDir, "wiki/log.md"), "utf8")).toBe("legacy log bytes\n");

    const beforeSecondRun = { bridge, hot, index, agents };
    initializeMemoryStructure({
      targetDir,
      assetsRoot,
      date: new Date("2026-08-14T00:00:00.000Z"),
    });
    expect(readFileSync(resolve(targetDir, "memory/session-bridge.md"), "utf8")).toBe(beforeSecondRun.bridge);
    expect(readFileSync(resolve(targetDir, "wiki/hot.md"), "utf8")).toBe(beforeSecondRun.hot);
    expect(readFileSync(resolve(targetDir, "wiki/index.md"), "utf8")).toBe(beforeSecondRun.index);
    expect(readFileSync(resolve(targetDir, "AGENTS.md"), "utf8")).toBe(beforeSecondRun.agents);
  });
});
