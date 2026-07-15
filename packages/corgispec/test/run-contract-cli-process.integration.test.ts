import { execFileSync, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  installFakeOpenSpec,
  setupFakeChange,
  type FakeOpenSpecFixture,
} from "./hooks/fake-openspec.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const CLI = resolve(PACKAGE_ROOT, "dist/corgispec.js");
const CHANGE = "process-change";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
  }).trim();
}

function expectJsonProcess(
  result: SpawnSyncReturns<string>,
  exitCode: number,
): Record<string, any> {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status, result.stderr || result.stdout).toBe(exitCode);
  expect(result.stderr).toBe("");
  expect(result.stdout).not.toContain("\u001b[");
  expect(result.stdout).toMatch(/^\{[^]*\}\n$/u);
  return JSON.parse(result.stdout) as Record<string, any>;
}

describe("built run-contract CLI process boundary", () => {
  let fixtureRoot: string;
  let projectRoot: string;
  let openspec: FakeOpenSpecFixture;
  let sentinel: string;
  let inertStoreArgument: string;

  beforeEach(() => {
    fixtureRoot = mkdtempSync(resolve(tmpdir(), "corgispec-cli-process-"));
    projectRoot = resolve(fixtureRoot, "project with spaces");
    mkdirSync(resolve(projectRoot, "openspec"), { recursive: true });
    writeFileSync(
      resolve(projectRoot, "openspec/config.yaml"),
      [
        "schema: custom-process-flow",
        "corgi:",
        "  tracking:",
        "    provider: none",
        "  taskArtifactId: tasks",
        "context: Real process boundary test.",
        "",
      ].join("\n"),
      "utf8",
    );
    const change = setupFakeChange({
      projectRoot,
      changeName: CHANGE,
      schemaName: "custom-process-flow",
      taskContent: [
        "## 1. Process contract",
        "",
        "- [ ] 1.1 Exercise the real CLI process",
        "",
      ].join("\n"),
    });
    openspec = installFakeOpenSpec(fixtureRoot, {
      listRoot: change.planningRoot,
      listNames: [CHANGE],
      statuses: { [CHANGE]: change.status },
    });

    git(projectRoot, "init", "-q");
    git(projectRoot, "config", "user.email", "process@example.test");
    git(projectRoot, "config", "user.name", "CorgiSpec Process Test");
    git(projectRoot, "add", "openspec");
    git(projectRoot, "commit", "-q", "-m", "planning baseline");

    sentinel = resolve(fixtureRoot, "SHELL_INJECTION_MUST_NOT_EXIST");
    inertStoreArgument = `shared-store; touch ${sentinel}`;
  });

  afterEach(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  function run(args: string[], input?: string): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [CLI, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      input,
      timeout: 20_000,
      env: {
        ...openspec.env,
        NO_COLOR: "1",
      },
    });
  }

  it("publishes loop help and every canonical mutation subcommand", () => {
    const top = run(["loop", "--help"]);
    expect(top.error).toBeUndefined();
    expect(top.status).toBe(0);
    expect(top.stderr).toBe("");
    expect(top.stdout).toContain("Manage canonical Corgi run-contract v2 state");
    for (const name of [
      "init",
      "inspect",
      "submit",
      "ack-commit",
      "finalize",
      "invalidate",
      "resume",
    ]) {
      expect(top.stdout).toContain(name);
      const child = run(["loop", name, "--help"]);
      expect(child.error, name).toBeUndefined();
      expect(child.status, name).toBe(0);
      expect(child.stderr, name).toBe("");
      expect(child.stdout, name).toContain(`Usage: corgispec loop ${name}`);
    }
  });

  it("keeps init and inspect stdout pure JSON and forwards OpenSpec argv without a shell", () => {
    const initialized = expectJsonProcess(run([
      "loop",
      "init",
      CHANGE,
      "--session",
      "process-session",
      "--owner",
      "process-agent",
      "--mode",
      "self-driven",
      "--run-id",
      "run-process",
      "--store",
      inertStoreArgument,
      "--path",
      projectRoot,
      "--json",
    ]), 0);
    expect(initialized).toMatchObject({
      schemaVersion: 2,
      operation: "init",
      status: "ok",
      changeName: CHANGE,
      state: {
        runId: "run-process",
        sessionId: "process-session",
        phase: "awaiting_group_result",
      },
      action: { type: "dispatch_group", groupId: "1", attempt: 1 },
    });

    const inspected = expectJsonProcess(run([
      "loop",
      "inspect",
      CHANGE,
      "--run-id",
      "run-process",
      "--path",
      projectRoot,
      "--json",
    ]), 0);
    expect(inspected).toMatchObject({
      schemaVersion: 2,
      operation: "inspect",
      status: "ok",
      recovered: false,
      state: {
        runId: "run-process",
        stateRevision: 0,
        lastEventSeq: 0,
      },
    });

    const calls = openspec.calls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.some((argv) => argv[0] === "status" && argv.includes(CHANGE))).toBe(true);
    expect(calls.some((argv) => argv[0] === "validate" && argv.includes(CHANGE))).toBe(true);
    const storeCalls = calls.filter((argv) => argv.includes("--store"));
    expect(storeCalls.length).toBeGreaterThan(0);
    for (const argv of storeCalls) {
      const index = argv.indexOf("--store");
      expect(argv[index + 1]).toBe(inertStoreArgument);
      expect(argv).not.toContain("sh");
      expect(argv).not.toContain("-c");
    }
    expect(existsSync(sentinel)).toBe(false);
  });

  it("maps malformed submit stdin and malformed --input files to JSON exit 2", () => {
    const submit = expectJsonProcess(run([
      "loop",
      "submit",
      CHANGE,
      "--path",
      projectRoot,
      "--json",
    ], "{not-json"), 2);
    expect(submit).toMatchObject({
      schemaVersion: 2,
      operation: "submit",
      status: "error",
      error: { code: "input_invalid" },
    });

    const malformed = resolve(fixtureRoot, "malformed-assessment.json");
    writeFileSync(malformed, "{also-not-json", "utf8");
    const converge = expectJsonProcess(run([
      "converge",
      CHANGE,
      "--input",
      malformed,
      "--path",
      projectRoot,
      "--json",
    ]), 2);
    expect(converge).toMatchObject({
      schemaVersion: 2,
      changeName: CHANGE,
      status: "blocked",
      reason: { code: "input_invalid" },
    });
  });

  it("derives converge assessment from canonical attempt evidence without --input", () => {
    const initialized = expectJsonProcess(run([
      "loop",
      "init",
      CHANGE,
      "--session",
      "canonical-session",
      "--owner",
      "canonical-agent",
      "--run-id",
      "run-canonical",
      "--path",
      projectRoot,
      "--json",
    ]), 0);
    const state = initialized.state as Record<string, any>;
    writeFileSync(resolve(projectRoot, "implementation.ts"), "export const incomplete = true;\n");
    const submitted = expectJsonProcess(run([
      "loop",
      "submit",
      CHANGE,
      "--run-id",
      state.runId,
      "--session",
      state.sessionId,
      "--state-revision",
      String(state.stateRevision),
      "--nonce",
      state.nonce,
      "--path",
      projectRoot,
      "--json",
    ], JSON.stringify({
      schemaVersion: 2,
      evidence: {
        verdict: "FAIL",
        evidence: [{
          id: "process-tests",
          kind: "test",
          status: "fail",
          provenance: "cli",
          command: "npm test",
          cwd: projectRoot,
          exitCode: 1,
        }],
      },
      review: { findings: [] },
      artifacts: { "test-result.json": { passed: false } },
    })), 1);
    expect(submitted.state).toMatchObject({ phase: "verification_failed" });

    const converged = expectJsonProcess(run([
      "converge",
      CHANGE,
      "--path",
      projectRoot,
      "--json",
    ], ""), 1);
    expect(converged).toMatchObject({
      schemaVersion: 2,
      changeName: CHANGE,
      status: "needs_work",
      evidence: [{
        id: "run:run-canonical:group:1:attempt:1",
        status: "fail",
      }],
      gaps: [{ id: "run-run-canonical-group-1-attempt-1" }],
      taskGroupDraft: { number: 2, tasks: [{ id: "2.1" }] },
    });
    expect(converged.confirmationToken).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(converged.reason).toBeUndefined();

    const applied = expectJsonProcess(run([
      "converge",
      CHANGE,
      "--confirm",
      converged.confirmationToken,
      "--path",
      projectRoot,
      "--json",
    ], ""), 0);
    expect(applied).toMatchObject({
      status: "needs_work",
      applied: true,
      successor: { supersedesRunId: "run-canonical" },
    });
    expect(applied.successor.runId).toMatch(/^run-/u);

    const retried = expectJsonProcess(run([
      "converge",
      CHANGE,
      "--confirm",
      converged.confirmationToken,
      "--path",
      projectRoot,
      "--json",
    ], ""), 0);
    expect(retried.successor).toEqual(applied.successor);
    const tasks = readFileSync(
      resolve(projectRoot, "openspec/changes", CHANGE, "tasks.md"),
      "utf8",
    );
    expect(tasks.match(/^## 2\. Convergence follow-up$/gmu)).toHaveLength(1);
    const sourceEvents = readFileSync(resolve(
      projectRoot,
      ".corgi/loop",
      CHANGE,
      "runs/run-canonical/events.jsonl",
    ), "utf8");
    expect(sourceEvents.match(/"type":"run_invalidated"/gu)).toHaveLength(1);
  });
});
