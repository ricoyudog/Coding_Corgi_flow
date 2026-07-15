import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  executeConvergeV2,
  type ConvergeCommandDependenciesV2,
  type ConvergeFaultPointV2,
} from "../src/commands/converge.js";
import { executeLoopV2 } from "../src/commands/loop-v2.js";
import {
  computeRunPlanningRevisionV2,
  fingerprintTaskGroupsV2,
  type ConvergencePlanningContextV2,
} from "../src/lib/converge-v2.js";
import { hashCanonicalArtifactV2 } from "../src/lib/evidence-v2.js";
import { LoopStoreV2 } from "../src/lib/loop-store-v2.js";
import { parseTaskGroupsDocument } from "../src/lib/task-groups.js";

const cleanup: string[] = [];
const RECOVERY_E2E_TIMEOUT_MS = 30_000;

afterEach(() => {
  for (const path of cleanup.splice(0)) {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

const FAULT_POINTS: ConvergeFaultPointV2[] = [
  "after_run_invalidated",
  "after_task_rename",
  "after_task_directory_fsync",
  "after_post_append_ready",
  "after_successor_initialized",
];

describe("converge durable recovery v2", { timeout: RECOVERY_E2E_TIMEOUT_MS }, () => {
  for (const point of FAULT_POINTS) {
    it(`recovers idempotently after ${point}`, async () => {
      const fixture = await createFixture();
      let fired = false;
      const failed = await fixture.confirm({
        faults: async (candidate) => {
          if (!fired && candidate === point) {
            fired = true;
            throw Object.assign(new Error(`fault:${point}`), { code: `fault_${point}` });
          }
        },
      });

      expect(fired).toBe(true);
      expect(failed.exitCode).toBe(2);
      expect(failed.output.reason?.code).toBe(`fault_${point}`);

      const recovered = await fixture.confirm();
      expect(recovered.exitCode, JSON.stringify(recovered.output)).toBe(0);
      expect(recovered.output).toMatchObject({
        applied: true,
        successor: {
          runId: "run-converge-successor",
          supersedesRunId: "run-converge-source",
        },
      });
      assertExactlyOneMutation(fixture);
    });
  }

  it("serializes concurrent confirmations and performs one canonical mutation", async () => {
    const fixture = await createFixture();

    const [left, right] = await Promise.all([fixture.confirm(), fixture.confirm()]);

    expect(left.exitCode, JSON.stringify(left.output)).toBe(0);
    expect(right.exitCode, JSON.stringify(right.output)).toBe(0);
    assertExactlyOneMutation(fixture);
  });

  it("rejects unrelated implementation tamper after the append with zero recovery write", async () => {
    const fixture = await createFixture();
    await faultOnce(fixture, "after_task_directory_fsync");
    writeFileSync(resolve(fixture.root, "unrelated.ts"), "export const tampered = true;\n");
    const before = canonicalSnapshot(fixture);

    const result = await fixture.confirm();

    expect(result.exitCode).toBe(2);
    expect(result.output.reason?.code).toBe("converge_workspace_changed");
    expect(canonicalSnapshot(fixture)).toEqual(before);
    expect(runIds(fixture)).toEqual(["run-converge-source"]);
  });

  it("rejects exact task-byte tamper after invalidation with zero recovery write", async () => {
    const fixture = await createFixture();
    await faultOnce(fixture, "after_run_invalidated");
    writeFileSync(fixture.tasks, `${readFileSync(fixture.tasks, "utf8")}\nmanual tamper\n`);
    const before = canonicalSnapshot(fixture);

    const result = await fixture.confirm();

    expect(result.exitCode).toBe(2);
    expect(result.output.reason?.code).toBe("converge_task_artifact_tampered");
    expect(canonicalSnapshot(fixture)).toEqual(before);
    expect(runIds(fixture)).toEqual(["run-converge-source"]);
  });

  it("rejects pre-append planning tamper with zero recovery write", async () => {
    const fixture = await createFixture();
    await faultOnce(fixture, "after_run_invalidated");
    writeFileSync(fixture.spec, "# Requirement\nChanged before append\n");
    const before = canonicalSnapshot(fixture);

    const result = await fixture.confirm();

    expect(result.exitCode).toBe(2);
    expect(result.output.reason?.code).toBe("converge_planning_changed");
    expect(canonicalSnapshot(fixture)).toEqual(before);
    expect(runIds(fixture)).toEqual(["run-converge-source"]);
  });

  it("rejects Git HEAD movement with zero recovery write", async () => {
    const fixture = await createFixture();
    await faultOnce(fixture, "after_run_invalidated");
    writeFileSync(resolve(fixture.root, "head-change.txt"), "new commit\n");
    git(fixture.root, "add", "head-change.txt");
    git(fixture.root, "commit", "-m", "move HEAD during convergence recovery");
    const before = canonicalSnapshot(fixture);

    const result = await fixture.confirm();

    expect(result.exitCode).toBe(2);
    expect(result.output.reason?.code).toBe("converge_git_revision_changed");
    expect(canonicalSnapshot(fixture)).toEqual(before);
    expect(runIds(fixture)).toEqual(["run-converge-source"]);
  });

  it("revalidates canonical attempt artifacts before recovery writes", async () => {
    const fixture = await createFixture();
    await faultOnce(fixture, "after_run_invalidated");
    const evidence = findFile(fixture.sourcePaths.attempts!, "evidence.json");
    const evidenceJson = asRecord(JSON.parse(readFileSync(evidence, "utf8")) as unknown);
    evidenceJson["verdict"] = evidenceJson["verdict"] === "PASS" ? "FAIL" : "PASS";
    writeFileSync(evidence, `${JSON.stringify(evidenceJson)}\n`);
    const before = canonicalSnapshot(fixture);

    const result = await fixture.confirm();

    expect(result.exitCode).toBe(2);
    expect(result.output.reason?.code).toMatch(/^canonical_/u);
    expect(canonicalSnapshot(fixture)).toEqual(before);
    expect(runIds(fixture)).toEqual(["run-converge-source"]);
  });

  it("fails closed when a valid-shaped durable intent binding is altered", async () => {
    const fixture = await createFixture();
    await faultOnce(fixture, "after_run_invalidated");
    tamperIntentTaskHash(fixture);
    const before = canonicalSnapshot(fixture);

    const result = await fixture.confirm();

    expect(result.exitCode).toBe(2);
    expect(result.output.reason?.code).toBe("converge_task_artifact_tampered");
    expect(canonicalSnapshot(fixture)).toEqual(before);
    expect(runIds(fixture)).toEqual(["run-converge-source"]);
  });

  it("binds post planning across an external Store and rejects spec tamper", async () => {
    const fixture = await createFixture({ externalChangeRoot: true });
    await faultOnce(fixture, "after_task_directory_fsync");
    writeFileSync(fixture.spec, "# Requirement\nExternally tampered after append\n");
    const before = canonicalSnapshot(fixture);

    const result = await fixture.confirm();

    expect(result.exitCode).toBe(2);
    expect(result.output.reason?.code).toBe("converge_post_append_revision_mismatch");
    expect(canonicalSnapshot(fixture)).toEqual(before);
    expect(runIds(fixture)).toEqual(["run-converge-source"]);
  });

  it("blocks a competing loop init while a convergence intent is pending", async () => {
    const fixture = await createFixture();
    await faultOnce(fixture, "after_run_invalidated");
    const before = canonicalSnapshot(fixture);

    const competing = await executeLoopV2({
      operation: "init",
      projectRoot: fixture.root,
      changeName: "example",
      sessionId: "competing-session",
      ownerId: "competing-agent",
      runId: "run-competing",
    }, fixture.loopDependencies);

    expect(competing.exitCode).toBe(2);
    expect(competing.output.error?.code).toBe("CONVERGENCE_RECOVERY_REQUIRED");
    expect(canonicalSnapshot(fixture)).toEqual(before);
    expect(runIds(fixture)).toEqual(["run-converge-source"]);

    const recovered = await fixture.confirm();
    expect(recovered.exitCode, JSON.stringify(recovered.output)).toBe(0);
    assertExactlyOneMutation(fixture);
  });
});

interface RecoveryFixture {
  root: string;
  changeRoot: string;
  tasks: string;
  spec: string;
  store: LoopStoreV2;
  sourcePaths: ReturnType<LoopStoreV2["paths"]>;
  dependencies: ConvergeCommandDependenciesV2;
  loopDependencies: NonNullable<ConvergeCommandDependenciesV2["loopDependencies"]>;
  token: string;
  confirm(overrides?: Partial<ConvergeCommandDependenciesV2>): ReturnType<typeof executeConvergeV2>;
}

async function createFixture(
  options: { externalChangeRoot?: boolean } = {},
): Promise<RecoveryFixture> {
  const root = resolve(
    tmpdir(),
    `corgispec-converge-recovery-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const external = resolve(
    tmpdir(),
    `corgispec-converge-external-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  cleanup.push(root);
  if (options.externalChangeRoot) cleanup.push(external);
  mkdirSync(root, { recursive: true });
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "corgi@example.test");
  git(root, "config", "user.name", "Corgi Test");
  const changeRoot = options.externalChangeRoot
    ? resolve(external, "changes/example")
    : resolve(root, "planning/changes/example");
  const tasks = resolve(changeRoot, "tasks.md");
  const spec = resolve(changeRoot, "specs/api.md");
  mkdirSync(resolve(changeRoot, "specs"), { recursive: true });
  writeFileSync(tasks, "# Tasks\n\n## 1. Existing\n\n- [x] 1.1 Existing behavior\n");
  writeFileSync(spec, "# Requirement\nOriginal behavior\n");
  writeFileSync(resolve(root, "README.md"), "baseline\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "baseline");

  const inspectPlanning = async (): Promise<ConvergencePlanningContextV2> => {
    const artifactPaths = {
      tasks: {
        outputPath: "tasks.md",
        resolvedOutputPath: tasks,
        existingOutputPaths: [tasks],
      },
      specs: {
        outputPath: "specs/**/*.md",
        resolvedOutputPath: resolve(changeRoot, "specs/**/*.md"),
        existingOutputPaths: [spec],
      },
    };
    const planningRevision = await computeRunPlanningRevisionV2({
      schemaName: "recovery-test",
      changeRoot,
      artifactPaths,
      taskArtifactId: "tasks",
    });
    return {
      valid: true,
      ready: true,
      planningRevision,
      changeRoot,
      taskArtifactId: "tasks",
      taskArtifactPath: tasks,
      taskGroups: parseTaskGroupsDocument(readFileSync(tasks, "utf8")).groups,
      revisionInput: { schemaName: "recovery-test", artifactPaths },
      issues: [],
    };
  };
  const loopDependencies = {
    inspectPlanning: async () => {
      const planning = await inspectPlanning();
      const fingerprints = fingerprintTaskGroupsV2(planning.taskGroups);
      return {
        ready: true,
        planningRevision: planning.planningRevision as `sha256:${string}`,
        groups: planning.taskGroups.map((group) => ({
          id: String(group.number),
          fingerprint: fingerprints[String(group.number)]! as `sha256:${string}`,
        })),
        blockers: [],
      };
    },
  };
  const initialized = await executeLoopV2({
    operation: "init",
    projectRoot: root,
    changeName: "example",
    sessionId: "source-session",
    ownerId: "source-agent",
    runId: "run-converge-source",
    mode: "hook-driven",
  }, loopDependencies);
  expect(initialized.exitCode, JSON.stringify(initialized.output)).toBe(0);
  let state = initialized.output.state!;
  writeFileSync(resolve(root, "README.md"), "implemented\n");
  const submitted = await executeLoopV2({
    operation: "submit",
    projectRoot: root,
    changeName: "example",
    runId: state.runId,
    sessionId: state.sessionId,
    stateRevision: state.stateRevision,
    nonce: state.nonce,
    bundle: {
      schemaVersion: 2,
      evidence: {
        verdict: "PASS",
        evidence: [{
          id: "tests",
          kind: "test",
          status: "pass",
          provenance: "cli",
          command: "npm test",
          cwd: root,
          exitCode: 0,
        }],
      },
      review: { findings: [] },
      artifacts: { "result.json": { passed: true } },
    },
  }, loopDependencies);
  expect(submitted.exitCode, JSON.stringify(submitted.output)).toBe(0);
  state = submitted.output.state!;
  git(root, "add", "README.md");
  git(root, "commit", "-m", "implement source group");
  const acknowledged = await executeLoopV2({
    operation: "ack-commit",
    projectRoot: root,
    changeName: "example",
    runId: state.runId,
    sessionId: state.sessionId,
    stateRevision: state.stateRevision,
    nonce: state.nonce,
  }, loopDependencies);
  expect(acknowledged.exitCode, JSON.stringify(acknowledged.output)).toBe(0);
  state = acknowledged.output.state!;
  const finalized = await executeLoopV2({
    operation: "finalize",
    projectRoot: root,
    changeName: "example",
    runId: state.runId,
    sessionId: state.sessionId,
    stateRevision: state.stateRevision,
    nonce: state.nonce,
  }, loopDependencies);
  expect(finalized.exitCode, JSON.stringify(finalized.output)).toBe(0);

  const dependencies: ConvergeCommandDependenciesV2 = {
    inspectPlanning,
    newRunId: () => "run-converge-successor",
    newNonce: () => "nonce-converge-successor",
    now: () => "2026-07-15T12:00:00.000Z",
  };
  const assessment = {
    evidence: [],
    gaps: [{
      id: "gap-follow-up",
      summary: "Add follow-up behavior",
      suggestedTasks: ["Implement and test follow-up behavior"],
    }],
  };
  const evaluated = await executeConvergeV2({
    projectRoot: root,
    changeName: "example",
    assessment,
  }, dependencies);
  expect(evaluated.output.status).toBe("needs_work");
  expect(evaluated.output.confirmationToken).toMatch(/^sha256:/u);
  const token = evaluated.output.confirmationToken!;
  const store = new LoopStoreV2({ projectRoot: root });
  return {
    root,
    changeRoot,
    tasks,
    spec,
    store,
    sourcePaths: store.paths("example", "run-converge-source"),
    dependencies,
    loopDependencies,
    token,
    async confirm(overrides = {}) {
      return await executeConvergeV2({
        projectRoot: root,
        changeName: "example",
        assessment,
        confirmationToken: token,
      }, { ...dependencies, ...overrides });
    },
  };
}

async function faultOnce(
  fixture: RecoveryFixture,
  point: ConvergeFaultPointV2,
): Promise<void> {
  let fired = false;
  const result = await fixture.confirm({
    faults: async (candidate) => {
      if (!fired && candidate === point) {
        fired = true;
        throw Object.assign(new Error(`fault:${point}`), { code: `fault_${point}` });
      }
    },
  });
  expect(fired).toBe(true);
  expect(result.exitCode).toBe(2);
}

function assertExactlyOneMutation(fixture: RecoveryFixture): void {
  const groups = parseTaskGroupsDocument(readFileSync(fixture.tasks, "utf8")).groups;
  expect(groups.map((group) => group.number)).toEqual([1, 2]);
  expect(readFileSync(fixture.tasks, "utf8").match(/^## 2\. Convergence follow-up$/gmu))
    .toHaveLength(1);
  expect(runIds(fixture)).toEqual(["run-converge-source", "run-converge-successor"]);
  const sourceEvents = jsonLines(fixture.sourcePaths.events!);
  expect(sourceEvents.filter((record) => eventType(record) === "run_invalidated")).toHaveLength(1);
  const successor = fixture.store.paths("example", "run-converge-successor");
  expect(jsonLines(successor.events!)).toHaveLength(1);
  const current = JSON.parse(readFileSync(
    fixture.store.paths("example").current,
    "utf8",
  )) as { runId: string };
  expect(current.runId).toBe("run-converge-successor");
}

function canonicalSnapshot(fixture: RecoveryFixture): Record<string, string> {
  const paths = fixture.sourcePaths;
  const current = fixture.store.paths("example").current;
  return {
    tasks: readFileSync(fixture.tasks).toString("base64"),
    state: readFileSync(paths.state!).toString("base64"),
    events: readFileSync(paths.events!).toString("base64"),
    current: readFileSync(current).toString("base64"),
    runs: JSON.stringify(runIds(fixture)),
  };
}

function runIds(fixture: RecoveryFixture): string[] {
  const runs = resolve(fixture.root, ".corgi/loop/example/runs");
  return readdirSync(runs, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function findFile(root: string, name: string): string {
  const entries = readdirSync(root, { withFileTypes: true, recursive: true });
  const match = entries.find((entry) => entry.isFile() && entry.name === name);
  if (!match || !match.parentPath) throw new Error(`Missing ${name} below ${root}`);
  return resolve(match.parentPath, match.name);
}

function tamperIntentTaskHash(fixture: RecoveryFixture): void {
  const replacement = hashCanonicalArtifactV2({ tampered: true });
  const state = JSON.parse(readFileSync(fixture.sourcePaths.state!, "utf8")) as JsonRecord;
  intentRecord(state)["preTaskBytesHash"] = replacement;
  writeFileSync(fixture.sourcePaths.state!, `${JSON.stringify(state)}\n`);
  const events = jsonLines(fixture.sourcePaths.events!);
  const latest = events.at(-1)!;
  intentRecord(asRecord(latest["postState"]))["preTaskBytesHash"] = replacement;
  intentRecord(asRecord(latest["event"]))["preTaskBytesHash"] = replacement;
  writeFileSync(
    fixture.sourcePaths.events!,
    `${events.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
}

type JsonRecord = Record<string, unknown>;

function intentRecord(root: JsonRecord): JsonRecord {
  const reason = asRecord(
    root["reason"] ?? root["blockedReason"],
  );
  return asRecord(asRecord(reason["details"])["convergenceIntent"]);
}

function asRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected JSON record");
  }
  return value as JsonRecord;
}

function jsonLines(path: string): JsonRecord[] {
  return readFileSync(path, "utf8").trimEnd().split("\n").map((line) =>
    asRecord(JSON.parse(line) as unknown)
  );
}

function eventType(record: JsonRecord): unknown {
  return asRecord(record["event"])["type"];
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}
