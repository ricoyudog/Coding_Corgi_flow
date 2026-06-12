// Integration tests for hook loop-check CLI.
// Runs the FULL pipeline: stdin JSON -> hook CLI -> stdout JSON + state mutation.
// Uses execSync to invoke `corgispec hook loop-check` against real temp dirs.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

const CLI = resolve(__dirname, "../../dist/corgispec.js");

// Helpers

const NONCE = "2026-06-10T00:00:00.000Z";

interface LoopState {
  active: boolean;
  changeName: string;
  sessionId: string;
  nonce: string;
  currentGroup: number;
  totalGroups: number;
  phase: string;
  worktreePath: string;
  platform: string;
  autoApprovalPolicy: { allowCommitPush: boolean; allowPassWithWarnings: boolean };
  startedAt: string;
  updatedAt: string;
  completedGroups: number[];
  groupStatuses: Record<string, string>;
  pushStatus: Record<string, string>;
  blockCount: number;
  maxBlocks: number;
  maxGroups: number;
}

interface VerifyArtifact {
  schemaVersion: number;
  changeName: string;
  group: number;
  nonce: string;
  verdict: "PASS" | "PASS_WITH_WARNINGS" | "FAIL";
  summary?: string;
  evidence: Array<{
    kind: string;
    command?: string;
    description?: string;
    status: string;
    exitCode?: number;
    provenance: "cli-emitted" | "llm-interpreted";
  }>;
}

interface ReviewArtifact {
  schemaVersion: number;
  changeName: string;
  group: number;
  nonce: string;
  finding_details: Array<{
    severity: string;
    check: string;
    requirement?: string;
    file?: string;
    description: string;
  }>;
}

function defaultState(overrides: Partial<LoopState> = {}): LoopState {
  return {
    active: true,
    changeName: "my-change",
    sessionId: "session-test-123",
    nonce: NONCE,
    currentGroup: 1,
    totalGroups: 3,
    phase: "init",
    worktreePath: "/tmp/test",
    platform: "github-tracked",
    autoApprovalPolicy: { allowCommitPush: true, allowPassWithWarnings: true },
    startedAt: "2026-06-10T00:00:00.000Z",
    updatedAt: "2026-06-10T00:00:00.000Z",
    completedGroups: [],
    groupStatuses: {},
    pushStatus: {},
    blockCount: 0,
    maxBlocks: 10,
    maxGroups: 5,
    ...overrides,
  };
}

function defaultVerify(overrides: Partial<VerifyArtifact> = {}): VerifyArtifact {
  return {
    schemaVersion: 1,
    changeName: "my-change",
    group: 1,
    nonce: NONCE,
    verdict: "PASS",
    evidence: [
      {
        kind: "test",
        command: "npm test",
        status: "pass",
        exitCode: 0,
        provenance: "cli-emitted",
      },
    ],
    ...overrides,
  };
}

function defaultReview(overrides: Partial<ReviewArtifact> = {}): ReviewArtifact {
  return {
    schemaVersion: 1,
    changeName: "my-change",
    group: 1,
    nonce: NONCE,
    finding_details: [],
    ...overrides,
  };
}

function runLoopCheck(
  tempDir: string,
  stdin: object = {},
): { exitCode: number; stdout: Record<string, unknown> } {
  try {
    const output = execSync("node " + CLI + " hook loop-check --path " + tempDir, {
      encoding: "utf-8",
      input: JSON.stringify(stdin),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });
    return { exitCode: 0, stdout: JSON.parse(output.trim() || "{}") };
  } catch (err: any) {
    const stdout = err.stdout?.trim() || "{}";
    return { exitCode: err.status ?? 1, stdout: JSON.parse(stdout) };
  }
}

function runStopCheck(
  tempDir: string,
  stdin: object = {},
): { exitCode: number; stdout: string; stderr: string } {
  try {
    const output = execSync("node " + CLI + " hook stop-check --path " + tempDir, {
      encoding: "utf-8",
      input: JSON.stringify(stdin),
      env: { ...process.env, CORGISPEC_HOOKS_DISABLE: undefined },
    });
    return { exitCode: 0, stdout: output || "", stderr: "" };
  } catch (err: any) {
    return {
      exitCode: err.status ?? 1,
      stdout: err.stdout?.toString() || "",
      stderr: err.stderr?.toString() || "",
    };
  }
}

function writeState(tempDir: string, state: LoopState): void {
  const stateDir = resolve(tempDir, ".claude/corgi-loop", state.changeName);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(resolve(stateDir, "state.json"), JSON.stringify(state, null, 2), "utf-8");
}

function writeVerify(tempDir: string, artifact: VerifyArtifact): void {
  const groupDir = resolve(
    tempDir,
    ".claude/corgi-loop",
    artifact.changeName,
    "groups",
    String(artifact.group),
  );
  mkdirSync(groupDir, { recursive: true });
  writeFileSync(resolve(groupDir, "verify.json"), JSON.stringify(artifact, null, 2), "utf-8");
}

function writeReview(tempDir: string, artifact: ReviewArtifact): void {
  const groupDir = resolve(
    tempDir,
    ".claude/corgi-loop",
    artifact.changeName,
    "groups",
    String(artifact.group),
  );
  mkdirSync(groupDir, { recursive: true });
  writeFileSync(resolve(groupDir, "review.json"), JSON.stringify(artifact, null, 2), "utf-8");
}

function readState(tempDir: string, changeName: string): LoopState {
  const statePath = resolve(tempDir, ".claude/corgi-loop", changeName, "state.json");
  return JSON.parse(readFileSync(statePath, "utf-8")) as LoopState;
}

function setupProject(tempDir: string): void {
  mkdirSync(resolve(tempDir, "openspec"), { recursive: true });
  writeFileSync(resolve(tempDir, "openspec/config.yaml"), "schema: github-tracked\n");
}

// Test Suite

describe("hook loop-check (integration)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = resolve(
      tmpdir(),
      "corgispec-loop-check-" + String(Date.now()) + "-" + Math.random().toString(36).slice(2),
    );
    mkdirSync(tempDir, { recursive: true });
    setupProject(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // Scenario 1: Golden path

  it("golden path: 3 groups all clean -> 3 blocks -> done", { timeout: 30000 }, () => {
    // Initial state: group 1 of 3
    const state1 = defaultState({
      currentGroup: 1,
      totalGroups: 3,
      phase: "awaiting_group_result",
    });
    writeState(tempDir, state1);

    // Group 1: PASS verify + clean review
    writeVerify(tempDir, defaultVerify({ group: 1 }));
    writeReview(tempDir, defaultReview({ group: 1 }));

    // Invoke 1: group 1 passes -> block, advance to group 2
    const result1 = runLoopCheck(tempDir);
    expect(result1.exitCode).toBe(0);
    expect(result1.stdout.decision).toBe("block");
    expect(result1.stdout.terminal).toBeFalsy();
    const updated1 = readState(tempDir, "my-change");
    expect(updated1.currentGroup).toBe(2);
    expect(updated1.completedGroups).toContain(1);
    expect(updated1.blockCount).toBe(1);

    // Group 2: PASS verify + clean review
    writeVerify(tempDir, defaultVerify({ group: 2 }));
    writeReview(tempDir, defaultReview({ group: 2 }));

    // Invoke 2: group 2 passes -> block, advance to group 3
    const result2 = runLoopCheck(tempDir);
    expect(result2.exitCode).toBe(0);
    expect(result2.stdout.decision).toBe("block");
    expect(result2.stdout.terminal).toBeFalsy();
    const updated2 = readState(tempDir, "my-change");
    expect(updated2.currentGroup).toBe(3);
    expect(updated2.completedGroups).toContain(2);
    expect(updated2.blockCount).toBe(2);

    // Group 3 (last): PASS verify + clean review
    writeVerify(tempDir, defaultVerify({ group: 3 }));
    writeReview(tempDir, defaultReview({ group: 3 }));

    // Invoke 3: last group passes -> block, phase=awaiting_finalize
    const result3 = runLoopCheck(tempDir);
    expect(result3.exitCode).toBe(0);
    expect(result3.stdout.decision).toBe("block");
    expect(result3.stdout.phase).toBe("awaiting_finalize");
    expect(result3.stdout.terminal).toBeFalsy();
    const updated3 = readState(tempDir, "my-change");
    expect(updated3.completedGroups).toEqual([1, 2, 3]);
    expect(updated3.phase).toBe("awaiting_finalize");
    expect(updated3.blockCount).toBe(3);

    // Invoke 4: all finalized -> proceed, done, terminal
    const result4 = runLoopCheck(tempDir);
    expect(result4.exitCode).toBe(0);
    expect(result4.stdout.decision).toBe("proceed");
    expect(result4.stdout.phase).toBe("done");
    expect(result4.stdout.terminal).toBe(true);
    const updated4 = readState(tempDir, "my-change");
    expect(updated4.active).toBe(false);
    expect(updated4.phase).toBe("done");
  });

  // Scenario 2: Failure path

  it("failure path: group 2 critical finding -> terminal stopped_review_findings", { timeout: 15000 }, () => {
    // State after group 1 passed (currentGroup=2)
    const state2 = defaultState({
      currentGroup: 2,
      totalGroups: 3,
      phase: "awaiting_group_result",
      completedGroups: [1],
      groupStatuses: { "1": "complete" },
      blockCount: 1,
    });
    writeState(tempDir, state2);

    // Group 2: PASS verify but CRITICAL finding in review
    writeVerify(tempDir, defaultVerify({ group: 2 }));
    writeReview(
      tempDir,
      defaultReview({
        group: 2,
        finding_details: [
          {
            severity: "critical",
            check: "Security",
            description: "SQL injection vulnerability in user query",
          },
        ],
      }),
    );

    const result = runLoopCheck(tempDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.decision).toBe("proceed");
    expect(result.stdout.phase).toBe("stopped_review_findings");
    expect(result.stdout.terminal).toBe(true);
    expect(result.stdout.reason).toContain("critical");

    // State should be deactivated
    const updated = readState(tempDir, "my-change");
    expect(updated.active).toBe(false);
    expect(updated.phase).toBe("stopped_review_findings");
  });

  // Scenario 3: Verify fail

  it("verify fail: group 1 verdict FAIL -> terminal verify_failed", () => {
    // Initial state: group 1 of 3
    const state1 = defaultState({
      currentGroup: 1,
      totalGroups: 3,
      phase: "awaiting_group_result",
    });
    writeState(tempDir, state1);

    // Group 1: FAIL verdict
    writeVerify(tempDir, defaultVerify({ verdict: "FAIL", group: 1 }));
    writeReview(tempDir, defaultReview({ group: 1 }));

    const result = runLoopCheck(tempDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.decision).toBe("proceed");
    expect(result.stdout.phase).toBe("verify_failed");
    expect(result.stdout.terminal).toBe(true);
    expect(result.stdout.reason).toContain("FAIL");

    // State should be deactivated
    const updated = readState(tempDir, "my-change");
    expect(updated.active).toBe(false);
    expect(updated.phase).toBe("verify_failed");
  });

  // Scenario 4: stop-check composition

  it("stop-check exits 0 when loop is active (integration with loop state)", () => {
    // Create an active loop state
    const state = defaultState({
      currentGroup: 1,
      totalGroups: 3,
      phase: "awaiting_group_result",
    });
    writeState(tempDir, state);

    // stop-check should detect the active loop state and exit 0
    // (deferring to loop-check instead of its own task-check logic)
    const result = runStopCheck(tempDir);
    expect(result.exitCode).toBe(0);
  });

  it("stop-check exits 2 when no loop and has incomplete tasks", () => {
    // No loop state -> stop-check falls through to normal task check
    mkdirSync(resolve(tempDir, "openspec/changes/wip-change"), { recursive: true });
    writeFileSync(
      resolve(tempDir, "openspec/changes/wip-change/tasks.md"),
      "## 1. Implementation\n\n- [ ] 1.1 Not done yet\n",
    );

    const result = runStopCheck(tempDir);
    expect(result.exitCode).toBe(2);
  });
});
