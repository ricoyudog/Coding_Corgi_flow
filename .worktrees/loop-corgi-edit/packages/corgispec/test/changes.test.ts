import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverChanges,
  getChangeInfo,
  loadWorkflowSchema,
  parseTaskGroups,
  findNextTaskGroup,
} from "../src/lib/changes.js";

const TEST_DIR = resolve(tmpdir(), "corgispec-changes-test-" + Date.now());

function setupTestProject(dir: string) {
  // Create config
  mkdirSync(resolve(dir, "openspec"), { recursive: true });
  writeFileSync(
    resolve(dir, "openspec/config.yaml"),
    "schema: github-tracked\n"
  );

  // Create schema
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
    instruction: Create the proposal
    requires: []
  - id: specs
    generates: specs/**/*.md
    description: Specifications
    template: spec.md
    instruction: Create specs
    requires:
      - proposal
  - id: design
    generates: design.md
    description: Design doc
    template: design.md
    instruction: Create design
    requires:
      - proposal
  - id: tasks
    generates: tasks.md
    description: Task list
    template: tasks.md
    instruction: Create tasks
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
  writeFileSync(resolve(schemaDir, "templates/proposal.md"), "# Proposal\n");
  writeFileSync(resolve(schemaDir, "templates/spec.md"), "# Spec\n");
  writeFileSync(resolve(schemaDir, "templates/design.md"), "# Design\n");
  writeFileSync(resolve(schemaDir, "templates/tasks.md"), "# Tasks\n");
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("discoverChanges", () => {
  it("returns empty array when no changes directory", () => {
    setupTestProject(TEST_DIR);
    const changes = discoverChanges(TEST_DIR);
    expect(changes).toEqual([]);
  });

  it("discovers change directories", () => {
    setupTestProject(TEST_DIR);
    mkdirSync(resolve(TEST_DIR, "openspec/changes/feat-a"), { recursive: true });
    mkdirSync(resolve(TEST_DIR, "openspec/changes/feat-b"), { recursive: true });

    const changes = discoverChanges(TEST_DIR);
    expect(changes.sort()).toEqual(["feat-a", "feat-b"]);
  });

  it("ignores files in changes directory", () => {
    setupTestProject(TEST_DIR);
    mkdirSync(resolve(TEST_DIR, "openspec/changes/real-change"), { recursive: true });
    writeFileSync(resolve(TEST_DIR, "openspec/changes/.gitkeep"), "");

    const changes = discoverChanges(TEST_DIR);
    expect(changes).toEqual(["real-change"]);
  });
});

describe("loadWorkflowSchema", () => {
  it("loads and parses schema.yaml", () => {
    setupTestProject(TEST_DIR);
    const schema = loadWorkflowSchema(TEST_DIR);

    expect(schema.name).toBe("github-tracked");
    expect(schema.version).toBe(1);
    expect(schema.artifacts.length).toBe(4);
    expect(schema.artifacts[0]!.id).toBe("proposal");
    expect(schema.apply.tracks).toBe("tasks.md");
  });

  it("throws if schema not found", () => {
    mkdirSync(resolve(TEST_DIR, "openspec"), { recursive: true });
    writeFileSync(
      resolve(TEST_DIR, "openspec/config.yaml"),
      "schema: nonexistent-schema\n"
    );

    expect(() => loadWorkflowSchema(TEST_DIR)).toThrow("Unsupported schema");
  });
});

describe("parseTaskGroups", () => {
  it("parses task groups from markdown content", () => {
    const content = `## 1. Setup

- [x] 1.1 Create directory
- [x] 1.2 Add config

## 2. Implementation

- [ ] 2.1 Build core
- [ ] 2.2 Add tests
- [x] 2.3 Write docs

## 3. Finish

- [ ] 3.1 Deploy
`;
    const groups = parseTaskGroups(content);

    expect(groups.length).toBe(3);

    expect(groups[0]!.number).toBe(1);
    expect(groups[0]!.name).toBe("Setup");
    expect(groups[0]!.totalTasks).toBe(2);
    expect(groups[0]!.completedTasks).toBe(2);
    expect(groups[0]!.status).toBe("done");

    expect(groups[1]!.number).toBe(2);
    expect(groups[1]!.name).toBe("Implementation");
    expect(groups[1]!.totalTasks).toBe(3);
    expect(groups[1]!.completedTasks).toBe(1);
    expect(groups[1]!.status).toBe("in_progress");

    expect(groups[2]!.number).toBe(3);
    expect(groups[2]!.name).toBe("Finish");
    expect(groups[2]!.totalTasks).toBe(1);
    expect(groups[2]!.completedTasks).toBe(0);
    expect(groups[2]!.status).toBe("pending");
  });

  it("handles empty content", () => {
    expect(parseTaskGroups("")).toEqual([]);
  });

  it("handles content with no task groups", () => {
    expect(parseTaskGroups("# Just a heading\n\nSome text")).toEqual([]);
  });

  it("parses tasks with description including dots and special chars", () => {
    const content = `## 1. Core

- [ ] 1.1 Add \`src/lib/config.ts\` — reads YAML file
- [x] 1.2 Create test for edge-case (Node >= 18)
`;
    const groups = parseTaskGroups(content);
    expect(groups[0]!.tasks[0]!.description).toBe("Add `src/lib/config.ts` — reads YAML file");
    expect(groups[0]!.tasks[1]!.description).toBe("Create test for edge-case (Node >= 18)");
  });
});

describe("findNextTaskGroup", () => {
  it("returns first pending group", () => {
    const content = `## 1. Done

- [x] 1.1 Task

## 2. Next

- [ ] 2.1 Task

## 3. Later

- [ ] 3.1 Task
`;
    const groups = parseTaskGroups(content);
    const next = findNextTaskGroup(groups);
    expect(next!.number).toBe(2);
    expect(next!.name).toBe("Next");
  });

  it("returns in-progress group if one exists", () => {
    const content = `## 1. Done

- [x] 1.1 Task

## 2. Partial

- [x] 2.1 First
- [ ] 2.2 Second

## 3. Later

- [ ] 3.1 Task
`;
    const groups = parseTaskGroups(content);
    const next = findNextTaskGroup(groups);
    expect(next!.number).toBe(2);
    expect(next!.name).toBe("Partial");
  });

  it("returns null when all groups done", () => {
    const content = `## 1. Done

- [x] 1.1 Task

## 2. Also Done

- [x] 2.1 Task
`;
    const groups = parseTaskGroups(content);
    const next = findNextTaskGroup(groups);
    expect(next).toBeNull();
  });
});

describe("getChangeInfo", () => {
  it("returns full change info for empty change", () => {
    setupTestProject(TEST_DIR);
    mkdirSync(resolve(TEST_DIR, "openspec/changes/my-feat"), { recursive: true });

    const info = getChangeInfo(TEST_DIR, "my-feat");

    expect(info.name).toBe("my-feat");
    expect(info.state).toBe("empty");
    expect(info.schemaName).toBe("github-tracked");
    expect(info.artifacts.length).toBe(4);
    expect(info.artifacts[0]!.id).toBe("proposal");
    expect(info.artifacts[0]!.exists).toBe(false);
    expect(info.artifacts[0]!.ready).toBe(true);
    expect(info.artifacts[0]!.blocked).toBe(false);
  });

  it("shows specs as blocked when proposal missing", () => {
    setupTestProject(TEST_DIR);
    mkdirSync(resolve(TEST_DIR, "openspec/changes/my-feat"), { recursive: true });

    const info = getChangeInfo(TEST_DIR, "my-feat");
    const specs = info.artifacts.find((a) => a.id === "specs")!;

    expect(specs.blocked).toBe(true);
    expect(specs.blockedBy).toEqual(["proposal"]);
  });

  it("detects proposing state", () => {
    setupTestProject(TEST_DIR);
    const changeDir = resolve(TEST_DIR, "openspec/changes/my-feat");
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(resolve(changeDir, "proposal.md"), "# Proposal");

    const info = getChangeInfo(TEST_DIR, "my-feat");
    expect(info.state).toBe("specifying");
    expect(info.artifacts.find((a) => a.id === "specs")!.blocked).toBe(false);
    expect(info.artifacts.find((a) => a.id === "specs")!.ready).toBe(true);
  });

  it("detects applying state with task groups", () => {
    setupTestProject(TEST_DIR);
    const changeDir = resolve(TEST_DIR, "openspec/changes/my-feat");
    mkdirSync(resolve(changeDir, "specs/core"), { recursive: true });
    writeFileSync(resolve(changeDir, "proposal.md"), "# Proposal");
    writeFileSync(resolve(changeDir, "specs/core/spec.md"), "# Spec");
    writeFileSync(resolve(changeDir, "design.md"), "# Design");
    writeFileSync(
      resolve(changeDir, "tasks.md"),
      `## 1. Setup

- [x] 1.1 Done task

## 2. Build

- [ ] 2.1 Pending task
`
    );

    const info = getChangeInfo(TEST_DIR, "my-feat");
    expect(info.state).toBe("applying");
    expect(info.taskGroups.length).toBe(2);
    expect(info.completedTasks).toBe(1);
    expect(info.totalTasks).toBe(2);
    expect(info.isComplete).toBe(false);
  });

  it("detects all_done state", () => {
    setupTestProject(TEST_DIR);
    const changeDir = resolve(TEST_DIR, "openspec/changes/my-feat");
    mkdirSync(resolve(changeDir, "specs/core"), { recursive: true });
    writeFileSync(resolve(changeDir, "proposal.md"), "# Proposal");
    writeFileSync(resolve(changeDir, "specs/core/spec.md"), "# Spec");
    writeFileSync(resolve(changeDir, "design.md"), "# Design");
    writeFileSync(
      resolve(changeDir, "tasks.md"),
      `## 1. Setup

- [x] 1.1 Done task
- [x] 1.2 Also done
`
    );

    const info = getChangeInfo(TEST_DIR, "my-feat");
    expect(info.state).toBe("all_done");
    expect(info.isComplete).toBe(true);
  });

  it("throws for nonexistent change", () => {
    setupTestProject(TEST_DIR);
    expect(() => getChangeInfo(TEST_DIR, "nonexistent")).toThrow(
      "Change 'nonexistent' not found"
    );
  });
});
