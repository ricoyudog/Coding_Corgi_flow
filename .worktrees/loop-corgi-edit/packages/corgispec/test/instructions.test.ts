import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveArtifactInstruction,
  resolveApplyInstruction,
  resolveReviewInstruction,
  resolveArchiveInstruction,
} from "../src/lib/instructions.js";

const TEST_DIR = resolve(tmpdir(), "corgispec-instr-test-" + Date.now());

function setupTestProject(dir: string) {
  mkdirSync(resolve(dir, "openspec"), { recursive: true });
  writeFileSync(
    resolve(dir, "openspec/config.yaml"),
    `schema: github-tracked
context: |
  Tech stack: TypeScript, Node.js
rules:
  proposal:
    - Keep under 500 words
`
  );

  const schemaDir = resolve(dir, "openspec/schemas/github-tracked");
  mkdirSync(resolve(schemaDir, "templates"), { recursive: true });
  writeFileSync(
    resolve(schemaDir, "schema.yaml"),
    `name: github-tracked
version: 1
description: Test schema
artifacts:
  - id: proposal
    generates: proposal.md
    description: Proposal document
    template: proposal.md
    instruction: Create the proposal document.
    requires: []
  - id: specs
    generates: specs/**/*.md
    description: Specifications
    template: spec.md
    instruction: Create spec files.
    requires:
      - proposal
  - id: design
    generates: design.md
    description: Design doc
    template: design.md
    instruction: Create design document.
    requires:
      - proposal
  - id: tasks
    generates: tasks.md
    description: Task list
    template: tasks.md
    instruction: Create task list.
    requires:
      - specs
      - design
apply:
  requires:
    - tasks
  tracks: tasks.md
  instruction: Execute one Task Group at a time.
`
  );
  writeFileSync(resolve(schemaDir, "templates/proposal.md"), "## Why\n\n## What\n");
  writeFileSync(resolve(schemaDir, "templates/spec.md"), "## Requirements\n");
  writeFileSync(resolve(schemaDir, "templates/design.md"), "## Context\n");
  writeFileSync(resolve(schemaDir, "templates/tasks.md"), "## 1. Group\n- [ ] 1.1 Task\n");
}

function createChange(dir: string, name: string, files: Record<string, string>) {
  const changeDir = resolve(dir, "openspec/changes", name);
  mkdirSync(changeDir, { recursive: true });
  for (const [path, content] of Object.entries(files)) {
    const full = resolve(changeDir, path);
    mkdirSync(resolve(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return changeDir;
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("resolveArtifactInstruction", () => {
  it("resolves proposal instruction with template and rules", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {});

    const result = resolveArtifactInstruction(TEST_DIR, "my-feat", "proposal");

    expect(result.changeName).toBe("my-feat");
    expect(result.artifactId).toBe("proposal");
    expect(result.template).toContain("## Why");
    expect(result.instruction).toContain("Create the proposal");
    expect(result.dependencies).toEqual([]);
    expect(result.contextFiles).toEqual([]);
    expect(result.projectContext).toContain("TypeScript");
    expect(result.rules).toEqual(["Keep under 500 words"]);
  });

  it("resolves specs instruction with context files from proposal", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {
      "proposal.md": "# My proposal\n",
    });

    const result = resolveArtifactInstruction(TEST_DIR, "my-feat", "specs");

    expect(result.artifactId).toBe("specs");
    expect(result.dependencies).toEqual(["proposal"]);
    expect(result.contextFiles.length).toBe(1);
    expect(result.contextFiles[0]).toContain("proposal.md");
  });

  it("throws for blocked artifact", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {});
    // specs requires proposal which doesn't exist

    expect(() =>
      resolveArtifactInstruction(TEST_DIR, "my-feat", "specs")
    ).toThrow("Artifact 'specs' is blocked. Missing: proposal");
  });

  it("throws for unknown artifact", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {
      "proposal.md": "# Proposal",
    });

    expect(() =>
      resolveArtifactInstruction(TEST_DIR, "my-feat", "nonexistent")
    ).toThrow("Unknown artifact 'nonexistent'");
  });

  it("resolves tasks instruction with spec and design context", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {
      "proposal.md": "# Proposal",
      "specs/core/spec.md": "# Core spec",
      "design.md": "# Design",
    });

    const result = resolveArtifactInstruction(TEST_DIR, "my-feat", "tasks");

    expect(result.dependencies).toEqual(["specs", "design"]);
    expect(result.contextFiles.length).toBe(2);
    expect(result.contextFiles.some((f) => f.includes("spec.md"))).toBe(true);
    expect(result.contextFiles.some((f) => f.includes("design.md"))).toBe(true);
  });
});

describe("resolveApplyInstruction", () => {
  it("returns current task group", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {
      "proposal.md": "# Proposal",
      "specs/core/spec.md": "# Spec",
      "design.md": "# Design",
      "tasks.md": `## 1. Done

- [x] 1.1 Completed

## 2. Current

- [ ] 2.1 Pending task
- [ ] 2.2 Another task
`,
    });

    const result = resolveApplyInstruction(TEST_DIR, "my-feat");

    expect(result.changeName).toBe("my-feat");
    expect(result.state).toBe("applying");
    expect(result.currentGroup).not.toBeNull();
    expect(result.currentGroup!.number).toBe(2);
    expect(result.currentGroup!.name).toBe("Current");
    expect(result.instruction).toContain("Execute one Task Group");
    expect(result.contextFiles.length).toBeGreaterThan(0);
  });

  it("returns null group when all done", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {
      "proposal.md": "# Proposal",
      "specs/core/spec.md": "# Spec",
      "design.md": "# Design",
      "tasks.md": `## 1. Done

- [x] 1.1 All done
`,
    });

    const result = resolveApplyInstruction(TEST_DIR, "my-feat");
    expect(result.state).toBe("all_done");
    expect(result.currentGroup).toBeNull();
  });
});

describe("resolveReviewInstruction", () => {
  it("returns completed groups for review", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {
      "proposal.md": "# Proposal",
      "specs/core/spec.md": "# Spec",
      "design.md": "# Design",
      "tasks.md": `## 1. Setup

- [x] 1.1 Done

## 2. Build

- [ ] 2.1 Not done
`,
    });

    const result = resolveReviewInstruction(TEST_DIR, "my-feat");

    expect(result.changeName).toBe("my-feat");
    expect(result.completedGroups.length).toBe(1);
    expect(result.completedGroups[0]!.name).toBe("Setup");
    expect(result.instruction).toContain("Review the completed task groups");
    expect(result.contextFiles.length).toBeGreaterThan(0);
  });

  it("returns empty completed groups when none done", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {
      "proposal.md": "# Proposal",
      "specs/core/spec.md": "# Spec",
      "design.md": "# Design",
      "tasks.md": `## 1. Setup

- [ ] 1.1 Not done
`,
    });

    const result = resolveReviewInstruction(TEST_DIR, "my-feat");
    expect(result.completedGroups.length).toBe(0);
  });
});

describe("resolveArchiveInstruction", () => {
  it("returns ready when all tasks complete", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {
      "proposal.md": "# Proposal",
      "specs/core/spec.md": "# Spec",
      "design.md": "# Design",
      "tasks.md": `## 1. Setup

- [x] 1.1 Done
- [x] 1.2 Also done
`,
    });

    const result = resolveArchiveInstruction(TEST_DIR, "my-feat");

    expect(result.isReady).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.instruction).toContain("Archive the completed change");
  });

  it("returns not ready with remaining count", () => {
    setupTestProject(TEST_DIR);
    createChange(TEST_DIR, "my-feat", {
      "proposal.md": "# Proposal",
      "specs/core/spec.md": "# Spec",
      "design.md": "# Design",
      "tasks.md": `## 1. Setup

- [x] 1.1 Done
- [ ] 1.2 Not done
- [ ] 1.3 Not done
`,
    });

    const result = resolveArchiveInstruction(TEST_DIR, "my-feat");

    expect(result.isReady).toBe(false);
    expect(result.reason).toBe("Change not ready for archive: 2 tasks remaining");
  });
});
