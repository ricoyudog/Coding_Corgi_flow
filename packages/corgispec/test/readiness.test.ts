import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildReadyReport, type ReadyArtifactPath } from "../src/lib/readiness.js";

const roots: string[] = [];

function createArtifacts(overrides: { proposal?: string; tasks?: string } = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "corgi-ready-"));
  roots.push(root);
  const proposal = resolve(root, "proposal.md");
  const tasks = resolve(root, "tasks.md");
  const spec = resolve(root, "specs/cap-a/spec.md");
  mkdirSync(resolve(spec, ".."), { recursive: true });
  writeFileSync(
    proposal,
    overrides.proposal ??
      "# Proposal\nPlanning context.\n\n## Open Questions\nNone.\n\n## Capabilities\n### New Capabilities\n- `cap-a`: capability\n",
  );
  writeFileSync(tasks, overrides.tasks ?? "## 1. Ship\n- [ ] 1.1 implement\n");
  writeFileSync(spec, "## ADDED Requirements\n### Requirement: A\n#### Scenario: A\n");
  const summary = (path: string, outputPath: string): ReadyArtifactPath => ({
    outputPath,
    resolvedOutputPath: path,
    existingOutputPaths: [path],
  });
  return {
    artifactPaths: {
      proposal: summary(proposal, "proposal.md"),
      specs: {
        outputPath: "specs/**/*.md",
        resolvedOutputPath: resolve(root, "specs/**/*.md"),
        existingOutputPaths: [spec],
      },
      tasks: summary(tasks, "tasks.md"),
    },
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function report(overrides: Parameters<typeof buildReadyReport>[0]) {
  return buildReadyReport(overrides);
}

describe("buildReadyReport", () => {
  it("returns ready for complete, valid and coherent planning artifacts", () => {
    const { artifactPaths } = createArtifacts();
    const value = report({
      status: {
        changeName: "change-a",
        schemaName: "custom",
        isComplete: true,
        artifacts: [
          { id: "proposal", status: "done" },
          { id: "specs", status: "done" },
          { id: "tasks", status: "done" },
        ],
      },
      validation: { valid: true },
      planningRevision: "sha256:abc",
      artifactPaths,
      taskArtifactId: "tasks",
      strict: false,
    });

    expect(value.status).toBe("ready");
    expect(value.taskGroups).toHaveLength(1);
    expect(value.checks.every((item) => item.status === "pass")).toBe(true);
  });

  it("returns all deterministic blockers in one report", () => {
    const { artifactPaths } = createArtifacts({
      proposal:
        "## Capabilities\n### New Capabilities\n- `missing-cap`: TBD\n## Open Questions\n- Who decides?\n",
      tasks: "## 1. Empty\n",
    });
    const value = report({
      status: {
        changeName: "change-a",
        schemaName: "custom",
        isComplete: false,
        artifacts: [{ id: "tasks", status: "ready" }],
      },
      validation: { valid: false, issues: ["invalid requirement"] },
      planningRevision: "sha256:def",
      artifactPaths,
      taskArtifactId: "tasks",
      strict: false,
    });

    expect(value.status).toBe("not_ready");
    expect(value.checks.filter((item) => item.status === "fail").map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "ARTIFACTS_COMPLETE",
        "OPENSPEC_STRICT_VALIDATION",
        "EMPTY_TASK_GROUP",
        "NO_PLACEHOLDERS",
        "NO_OPEN_QUESTIONS",
        "CAPABILITY_SPEC_PARITY",
      ]),
    );
  });

  it("treats structural warnings as blockers only in strict mode", () => {
    const { artifactPaths } = createArtifacts({ tasks: "## 2. Later\n- [ ] 2.1 work\n" });
    const base = {
      status: {
        changeName: "change-a",
        schemaName: "custom",
        isComplete: true,
        artifacts: [
          { id: "proposal", status: "done" as const },
          { id: "specs", status: "done" as const },
          { id: "tasks", status: "done" as const },
        ],
      },
      validation: { valid: true },
      planningRevision: "sha256:ghi",
      artifactPaths,
      taskArtifactId: "tasks",
    };

    expect(report({ ...base, strict: false }).status).toBe("ready");
    expect(report({ ...base, strict: true }).status).toBe("not_ready");
  });

  it("reports a missing configured task artifact without guessing conventional paths", () => {
    const value = report({
      status: {
        changeName: "change-a",
        schemaName: "no-task-schema",
        isComplete: true,
        artifacts: [],
      },
      validation: { valid: true },
      planningRevision: "sha256:no-task",
      artifactPaths: {},
      taskArtifactId: "work-items",
      strict: false,
    });

    expect(value.status).toBe("not_ready");
    expect(value.taskGroups).toEqual([]);
    expect(value.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TASK_ARTIFACT_CONFIGURED", status: "fail" }),
        expect.objectContaining({ code: "TASK_ARTIFACT_UNIQUE", status: "fail" }),
      ]),
    );
    expect(value.checks.some((item) => item.code === "CAPABILITY_SPEC_PARITY")).toBe(false);
  });
});
