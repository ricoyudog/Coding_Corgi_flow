import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "..");
const CLI = resolve(PACKAGE_ROOT, "dist/corgispec.js");
const CHANGE = "change-a";
const STORE = "shared-product";

interface Invocation {
  cwd: string;
  args: string[];
  telemetry: string | null;
}

interface Fixture {
  list: Record<string, unknown>;
  statusByChange: Record<string, Record<string, unknown>>;
  artifactInstructionsByKey: Record<string, Record<string, unknown>>;
  applyInstructionsByChange: Record<string, Record<string, unknown>>;
  validationByChange: Record<string, Record<string, unknown>>;
  createByChange: Record<string, Record<string, unknown>>;
  behaviors?: Record<string, {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  }>;
}

/**
 * Executable fake for the process boundary. It intentionally records the argv
 * array as JSON instead of joining it into a shell command, making argument
 * forwarding (including inert punctuation) observable end to end.
 */
const FAKE_OPENSPEC = String.raw`#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const fixture = JSON.parse(readFileSync(process.env.CORGISPEC_FAKE_FIXTURE, "utf8"));
appendFileSync(process.env.CORGISPEC_FAKE_LOG, JSON.stringify({
  cwd: process.cwd(),
  args,
  telemetry: process.env.OPENSPEC_TELEMETRY ?? null,
}) + "\n");

if (args[0] === "--version") {
  process.stdout.write("1.6.0\n");
  process.exit(0);
}

const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

let operation;
let payload;
if (args[0] === "list") {
  operation = "list";
  payload = fixture.list;
} else if (args[0] === "status") {
  operation = "status";
  payload = fixture.statusByChange[valueAfter("--change")];
} else if (args[0] === "instructions" && args[1] === "apply") {
  operation = "apply-instructions";
  payload = fixture.applyInstructionsByChange[valueAfter("--change")];
} else if (args[0] === "instructions") {
  operation = "artifact-instructions";
  payload = fixture.artifactInstructionsByKey[valueAfter("--change") + ":" + args[1]];
} else if (args[0] === "validate") {
  operation = "validate";
  payload = fixture.validationByChange[args[1]];
} else if (args[0] === "new" && args[1] === "change") {
  operation = "new-change";
  payload = fixture.createByChange[args[2]];
}

const behavior = fixture.behaviors?.[operation];
if (behavior) {
  if (behavior.stderr) process.stderr.write(behavior.stderr);
  if (behavior.stdout !== undefined) process.stdout.write(behavior.stdout);
  else if (payload !== undefined) process.stdout.write(JSON.stringify(payload) + "\n");
  process.exit(behavior.exitCode ?? 0);
}

if (payload === undefined) {
  process.stdout.write(JSON.stringify({ status: [{ message: "unsupported fake invocation" }] }) + "\n");
  process.exit(9);
}
process.stdout.write(JSON.stringify(payload) + "\n");
`;

describe("lifecycle CLI process contracts", () => {
  let root: string;
  let projectRoot: string;
  let planningRoot: string;
  let changesDir: string;
  let changeRoot: string;
  let fixturePath: string;
  let invocationLog: string;
  let fakeOpenSpec: string;
  let fixture: Fixture;

  beforeEach(() => {
    root = mkdtempSync(resolve(tmpdir(), "corgispec-lifecycle-cli-"));
    projectRoot = resolve(root, "project");
    planningRoot = resolve(root, "external-authoritative-store");
    changesDir = resolve(planningRoot, "changes");
    changeRoot = resolve(changesDir, CHANGE);
    fixturePath = resolve(root, "fixture.json");
    invocationLog = resolve(root, "invocations.jsonl");
    fakeOpenSpec = resolve(root, "openspec-fake.mjs");

    mkdirSync(resolve(projectRoot, "openspec"), { recursive: true });
    mkdirSync(resolve(changeRoot, "specs/search-api"), { recursive: true });
    mkdirSync(resolve(changeRoot, "specs/billing-api"), { recursive: true });
    mkdirSync(resolve(changeRoot, "nested/design"), { recursive: true });
    mkdirSync(resolve(changeRoot, "planning/tasks"), { recursive: true });
    writeFileSync(
      resolve(projectRoot, "openspec/config.yaml"),
      [
        "schema: custom-flow",
        "corgi:",
        "  tracking:",
        "    provider: none",
        "  taskArtifactId: delivery",
        "context: Process-level lifecycle contract fixture.",
        "",
      ].join("\n"),
    );
    writeFileSync(
      resolve(changeRoot, "proposal.md"),
      [
        "## Why",
        "Exercise the authoritative Store contract.",
        "",
        "## Capabilities",
        "- `search-api`: Search behavior.",
        "- `billing-api`: Billing behavior.",
        "",
      ].join("\n"),
    );
    writeFileSync(
      resolve(changeRoot, "specs/search-api/spec.md"),
      "## ADDED Requirements\n### Requirement: Search\n#### Scenario: Query\n- **WHEN** queried\n- **THEN** return results\n",
    );
    writeFileSync(
      resolve(changeRoot, "specs/billing-api/spec.md"),
      "## ADDED Requirements\n### Requirement: Billing\n#### Scenario: Invoice\n- **WHEN** billed\n- **THEN** return an invoice\n",
    );
    writeFileSync(
      resolve(changeRoot, "nested/design/architecture.md"),
      "## Context\nExternal Store design.\n\n## Decisions\nUse authoritative JSON paths.\n",
    );
    writeTasks(false);
    writeFileSync(fakeOpenSpec, FAKE_OPENSPEC);
    writeFileSync(invocationLog, "");
    chmodSync(fakeOpenSpec, 0o755);

    fixture = completeFixture();
    persistFixture();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function artifactPath(
    outputPath: string,
    resolvedOutputPath: string,
    existingOutputPaths: string[],
  ): Record<string, unknown> {
    return { outputPath, resolvedOutputPath, existingOutputPaths };
  }

  function statusFor(name: string, rootForChange = resolve(changesDir, name)): Record<string, unknown> {
    const proposal = resolve(rootForChange, "proposal.md");
    const specsPattern = resolve(rootForChange, "specs/**/*.md");
    const searchSpec = resolve(rootForChange, "specs/search-api/spec.md");
    const billingSpec = resolve(rootForChange, "specs/billing-api/spec.md");
    const design = resolve(rootForChange, "nested/design/architecture.md");
    const delivery = resolve(rootForChange, "planning/tasks/groups.md");
    const artifactPaths = {
      proposal: artifactPath("proposal.md", proposal, [proposal]),
      specs: artifactPath("specs/**/*.md", specsPattern, [searchSpec, billingSpec]),
      design: artifactPath("nested/design/architecture.md", design, [design]),
      delivery: artifactPath("planning/tasks/groups.md", delivery, [delivery]),
    };
    return {
      changeName: name,
      schemaName: "custom-flow",
      planningHome: {
        kind: "repo",
        root: planningRoot,
        changesDir,
        defaultSchema: "custom-flow",
        futurePlanningField: true,
      },
      changeRoot: rootForChange,
      artifactPaths,
      nextSteps: [],
      actionContext: {
        mode: "store",
        sourceOfTruth: "store",
        planningArtifacts: ["proposal", "specs", "design", "delivery"],
        linkedContext: [{ kind: "project", path: projectRoot }],
        allowedEditRoots: [planningRoot],
        requiresAffectedAreaSelection: false,
        constraints: ["planning only"],
      },
      isComplete: true,
      applyRequires: ["delivery"],
      artifacts: [
        { id: "proposal", outputPath: "proposal.md", status: "done" },
        { id: "specs", outputPath: "specs/**/*.md", status: "done" },
        { id: "design", outputPath: "nested/design/architecture.md", status: "done" },
        { id: "delivery", outputPath: "planning/tasks/groups.md", status: "done" },
      ],
      root: { path: planningRoot, source: "store", store_id: STORE },
      futureStatusField: { accepted: true },
    };
  }

  function completeFixture(): Fixture {
    const status = statusFor(CHANGE);
    const artifactPaths = status.artifactPaths as Record<string, {
      outputPath: string;
      resolvedOutputPath: string;
      existingOutputPaths: string[];
    }>;
    return {
      list: {
        changes: [{
          name: CHANGE,
          completedTasks: 1,
          totalTasks: 2,
          lastModified: "2026-07-15T00:00:00.000Z",
          status: "in-progress",
          futureListField: true,
        }],
        root: { path: planningRoot, source: "store", store_id: STORE },
      },
      statusByChange: { [CHANGE]: status },
      artifactInstructionsByKey: {
        [`${CHANGE}:specs`]: {
          changeName: CHANGE,
          artifactId: "specs",
          schemaName: "custom-flow",
          changeDir: changeRoot,
          outputPath: artifactPaths.specs!.outputPath,
          resolvedOutputPath: artifactPaths.specs!.resolvedOutputPath,
          existingOutputPaths: artifactPaths.specs!.existingOutputPaths,
          description: "Maintain capability delta specifications.",
          instruction: "Reconcile both nested capability specifications.",
          template: "## ADDED Requirements",
          dependencies: [{ id: "proposal", status: "done", futureDependencyField: true }],
          unlocks: ["design"],
          futureInstructionField: true,
        },
      },
      applyInstructionsByChange: {
        [CHANGE]: {
          changeName: CHANGE,
          changeDir: changeRoot,
          schemaName: "custom-flow",
          contextFiles: Object.fromEntries(
            Object.entries(artifactPaths).map(([id, value]) => [id, value.existingOutputPaths]),
          ),
          progress: { total: 2, complete: 1, remaining: 1 },
          tasks: [
            { id: "1.1", description: "Create the foundation", done: true },
            { id: "2.1", description: "Ship the change", done: false },
          ],
          state: "ready",
          instruction: "Implement Task Group 2 from the authoritative delivery artifact.",
          futureApplyField: true,
        },
      },
      validationByChange: {
        [CHANGE]: {
          items: [{ id: CHANGE, type: "change", valid: true, issues: [], durationMs: 1 }],
          summary: { valid: 1, invalid: 0 },
          version: "1.6",
          futureValidationField: true,
        },
      },
      createByChange: {},
    };
  }

  function writeTasks(done: boolean): void {
    writeFileSync(
      resolve(changeRoot, "planning/tasks/groups.md"),
      [
        "## 1. Foundation",
        "- [x] 1.1 Create the foundation",
        "",
        "## 2. Delivery",
        `- [${done ? "x" : " "}] 2.1 Ship the change`,
        "",
      ].join("\n"),
    );
  }

  function persistFixture(): void {
    writeFileSync(fixturePath, JSON.stringify(fixture));
  }

  function run(...args: string[]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [CLI, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        CORGISPEC_OPENSPEC_BIN: fakeOpenSpec,
        CORGISPEC_FAKE_FIXTURE: fixturePath,
        CORGISPEC_FAKE_LOG: invocationLog,
        NO_COLOR: "1",
      },
    });
  }

  function parseJson(command: SpawnSyncReturns<string>): Record<string, unknown> | unknown[] {
    expect(command.error).toBeUndefined();
    expect(command.stderr).toBe("");
    return JSON.parse(command.stdout) as Record<string, unknown> | unknown[];
  }

  function invocations(): Invocation[] {
    return readFileSync(invocationLog, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Invocation);
  }

  function operationArgv(): string[][] {
    return invocations()
      .filter((invocation) => invocation.args[0] !== "--version")
      .map((invocation) => invocation.args);
  }

  function expectStoreContract(): void {
    for (const invocation of invocations()) {
      expect(invocation.cwd).toBe(projectRoot);
      expect(invocation.telemetry).toBe("0");
      if (invocation.args[0] !== "--version") {
        expect(invocation.args).toContain("--store");
        expect(invocation.args[invocation.args.indexOf("--store") + 1]).toBe(STORE);
      }
    }
  }

  it("status and list emit standalone JSON from an external authoritative Store", () => {
    const status = run("status", CHANGE, "--store", STORE, "--path", projectRoot, "--json");
    expect(status.status).toBe(0);
    expect(parseJson(status)).toMatchObject({
      changeName: CHANGE,
      schemaName: "custom-flow",
      changeRoot,
      taskArtifactId: "delivery",
      planningComplete: true,
      implementationComplete: false,
      isComplete: false,
      artifactPaths: {
        specs: {
          outputPath: "specs/**/*.md",
          existingOutputPaths: [
            resolve(changeRoot, "specs/billing-api/spec.md"),
            resolve(changeRoot, "specs/search-api/spec.md"),
          ],
        },
      },
    });
    expect(operationArgv()).toEqual([
      ["status", "--change", CHANGE, "--json", "--store", STORE],
    ]);
    expectStoreContract();

    writeFileSync(invocationLog, "");
    const list = run("list", "--store", STORE, "--path", projectRoot, "--json");
    expect(list.status).toBe(0);
    expect(parseJson(list)).toEqual([
      expect.objectContaining({
        name: CHANGE,
        path: planningRoot,
        futureListField: true,
        planningComplete: true,
        implementationComplete: false,
        isComplete: false,
        changeRoot,
        taskArtifactId: "delivery",
        artifactPaths: expect.objectContaining({
          specs: expect.objectContaining({ outputPath: "specs/**/*.md" }),
          delivery: expect.objectContaining({ outputPath: "planning/tasks/groups.md" }),
        }),
      }),
    ]);
    expect(operationArgv()).toEqual([
      ["list", "--json", "--store", STORE],
      ["status", "--change", CHANGE, "--json", "--store", STORE],
    ]);
    expectStoreContract();
  });

  it("instructions preserves nested/glob paths and forwards exact argv", () => {
    const command = run(
      "instructions",
      "specs",
      "--change",
      CHANGE,
      "--store",
      STORE,
      "--path",
      projectRoot,
      "--json",
    );

    expect(command.status).toBe(0);
    expect(parseJson(command)).toMatchObject({
      changeName: CHANGE,
      artifactId: "specs",
      outputPath: "specs/**/*.md",
      resolvedOutputPath: resolve(changeRoot, "specs/**/*.md"),
      existingOutputPaths: [
        resolve(changeRoot, "specs/search-api/spec.md"),
        resolve(changeRoot, "specs/billing-api/spec.md"),
      ],
      contextFiles: [resolve(changeRoot, "proposal.md")],
      changeRoot,
      planningComplete: true,
      implementationComplete: false,
    });
    expect(operationArgv()).toEqual(expect.arrayContaining([
      ["instructions", "specs", "--change", CHANGE, "--json", "--store", STORE],
      ["status", "--change", CHANGE, "--json", "--store", STORE],
    ]));
    expect(operationArgv()).toHaveLength(2);
    expectStoreContract();
  });

  it("rejects legacy free-form Propose before invoking OpenSpec", () => {
    const name = "new-capability";
    const proposedRoot = resolve(changesDir, name);
    mkdirSync(proposedRoot, { recursive: true });
    const proposedStatus = statusFor(name, proposedRoot);
    proposedStatus.isComplete = false;
    proposedStatus.artifactPaths = {
      proposal: artifactPath("proposal.md", resolve(proposedRoot, "proposal.md"), []),
      delivery: artifactPath(
        "planning/tasks/groups.md",
        resolve(proposedRoot, "planning/tasks/groups.md"),
        [],
      ),
    };
    proposedStatus.artifacts = [
      { id: "proposal", outputPath: "proposal.md", status: "ready" },
      {
        id: "delivery",
        outputPath: "planning/tasks/groups.md",
        status: "blocked",
        missingDeps: ["proposal"],
      },
    ];
    fixture.statusByChange[name] = proposedStatus;
    fixture.createByChange[name] = {
      change: {
        id: name,
        path: proposedRoot,
        metadataPath: resolve(proposedRoot, ".openspec.yaml"),
        schema: "custom-flow",
      },
      root: { path: planningRoot, source: "store", store_id: STORE },
    };
    fixture.artifactInstructionsByKey[`${name}:proposal`] = {
      changeName: name,
      artifactId: "proposal",
      schemaName: "custom-flow",
      changeDir: proposedRoot,
      outputPath: "proposal.md",
      resolvedOutputPath: resolve(proposedRoot, "proposal.md"),
      existingOutputPaths: [],
      description: "Describe the proposal.",
      instruction: "Write the proposal.",
      template: "## Why",
      dependencies: [],
      unlocks: ["delivery"],
    };
    persistFixture();
    const description = "Literal semicolon; $(not executed)";
    const goal = "Ship safely && literally";

    const command = run(
      "propose",
      name,
      "--description",
      description,
      "--goal",
      goal,
      "--store",
      STORE,
      "--path",
      projectRoot,
      "--json",
    );

    expect(command.status).toBe(1);
    expect(parseJson(command)).toMatchObject({
      status: "contract_error",
      error: { code: "PROJECT_REQUIRES_V4_MIGRATION" },
    });
    expect(operationArgv()).toEqual([]);
  });

  it("publishes the Run Contract v3 lifecycle and amendment command surface", () => {
    const top = run("--help");
    expect(top.status).toBe(0);
    expect(top.stderr).toBe("");
    for (const name of ["apply", "verify", "review", "human-qa", "archive", "change"]) {
      expect(top.stdout).toMatch(new RegExp(`^  ${name}(?: \\[options\\])?`, "mu"));
    }
    expect(top.stdout).not.toMatch(/^  loop(?: |$)/mu);
    expect(top.stdout).not.toMatch(/^  converge(?: |$)/mu);

    const expectations: Array<[string[], string]> = [
      [["apply", "--help"], "Run Contract v3 Task Group application"],
      [["verify", "--help"], "exact RFC acceptance coverage"],
      [["review", "--help"], "explicit human implementation decision"],
      [["human-qa", "--help"], "Human QA evidence"],
      [["archive", "--help"], "strong, resumable Run Contract v3 archive gate"],
      [["change", "--help"], "adopt-amendment"],
      [["change", "adopt-amendment", "--help"], "--from <RFC-ID>"],
    ];
    for (const [args, expected] of expectations) {
      const command = run(...args);
      expect(command.status, args.join(" ")).toBe(0);
      expect(command.stderr, args.join(" ")).toBe("");
      expect(command.stdout, args.join(" ")).toContain(expected);
    }
    expect(operationArgv()).toEqual([]);
  });

  it("keeps JSON contract errors on stdout and human diagnostics on stderr across v4 Apply", () => {
    fixture.behaviors = { status: { stdout: "not-json\n" } };
    persistFixture();

    const jsonStatus = run("status", CHANGE, "--store", STORE, "--path", projectRoot, "--json");
    expect(jsonStatus.status).toBe(1);
    expect(jsonStatus.stderr).toBe("");
    expect(JSON.parse(jsonStatus.stdout)).toMatchObject({
      status: "contract_error",
      error: { code: "invalid_json" },
    });

    const humanStatus = run("status", CHANGE, "--store", STORE, "--path", projectRoot);
    expect(humanStatus.status).toBe(1);
    expect(humanStatus.stdout).toBe("");
    expect(humanStatus.stderr).toContain("Error: OpenSpec returned malformed JSON");

    const apply = run(
      "apply",
      CHANGE,
      "--session",
      "legacy-session",
      "--owner",
      "legacy-agent",
      "--store",
      STORE,
      "--path",
      projectRoot,
      "--json",
    );
    expect(apply.status).toBe(2);
    expect(apply.stderr).toBe("");
    expect(JSON.parse(apply.stdout)).toMatchObject({
      schemaVersion: 3,
      status: "error",
      error: { code: "invalid_json" },
    });
  });
});
