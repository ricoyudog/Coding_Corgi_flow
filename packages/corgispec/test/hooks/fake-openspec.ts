import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export interface FakeOpenSpecData {
  listRoot: string;
  statuses: Record<string, Record<string, unknown>>;
  listNames?: string[];
  malformedCommand?: "list" | "status" | "validate";
  failCommand?: "list" | "status" | "validate";
}

export interface FakeOpenSpecFixture {
  executable: string;
  callsPath: string;
  dataPath: string;
  env: NodeJS.ProcessEnv;
  writeData(data: FakeOpenSpecData): void;
  calls(): string[][];
}

export interface FakeArtifact {
  outputPath: string;
  existingOutputPaths?: string[];
  status?: "done" | "ready" | "blocked";
}

export function createFakeStatus(options: {
  changeName: string;
  planningRoot: string;
  changeRoot: string;
  schemaName?: string;
  artifacts?: Record<string, FakeArtifact>;
}): Record<string, unknown> {
  const artifacts = options.artifacts ?? {};
  return {
    changeName: options.changeName,
    schemaName: options.schemaName ?? "github-tracked",
    planningHome: {
      kind: "repo",
      root: options.planningRoot,
      changesDir: resolve(options.planningRoot, "changes"),
      defaultSchema: options.schemaName ?? "github-tracked",
    },
    changeRoot: options.changeRoot,
    artifactPaths: Object.fromEntries(
      Object.entries(artifacts).map(([id, artifact]) => [
        id,
        {
          outputPath: artifact.outputPath,
          resolvedOutputPath: resolve(options.changeRoot, artifact.outputPath),
          existingOutputPaths: artifact.existingOutputPaths ?? [],
        },
      ]),
    ),
    nextSteps: [],
    actionContext: {
      mode: "planning",
      sourceOfTruth: "openspec",
      planningArtifacts: Object.keys(artifacts),
      linkedContext: [],
      allowedEditRoots: [options.changeRoot],
      requiresAffectedAreaSelection: false,
      constraints: [],
    },
    isComplete: Object.values(artifacts).every((artifact) => artifact.status === "done"),
    applyRequires: [],
    artifacts: Object.entries(artifacts).map(([id, artifact]) => ({
      id,
      outputPath: artifact.outputPath,
      status: artifact.status ?? "done",
    })),
    root: { path: options.planningRoot, source: "test" },
  };
}

export function installFakeOpenSpec(
  root: string,
  initialData: FakeOpenSpecData,
): FakeOpenSpecFixture {
  const fixtureRoot = resolve(root, ".fake-openspec");
  const executable = resolve(fixtureRoot, "openspec.cjs");
  const dataPath = resolve(fixtureRoot, "data.json");
  const callsPath = resolve(fixtureRoot, "calls.jsonl");
  mkdirSync(fixtureRoot, { recursive: true });
  writeFileSync(dataPath, JSON.stringify(initialData, null, 2));
  writeFileSync(callsPath, "");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
const dataPath = ${JSON.stringify(dataPath)};
const callsPath = ${JSON.stringify(callsPath)};
const args = process.argv.slice(2);
fs.appendFileSync(callsPath, JSON.stringify(args) + "\\n");
if (args[0] === "--version") {
  process.stdout.write("1.6.0\\n");
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const command = args[0];
if (data.malformedCommand === command) {
  process.stdout.write("{not-json");
  process.exit(0);
}
if (data.failCommand === command) {
  process.stderr.write("synthetic OpenSpec failure\\n");
  process.stdout.write(JSON.stringify({ status: [{ message: "synthetic OpenSpec failure" }] }));
  process.exit(7);
}
if (command === "list") {
  const names = data.listNames || Object.keys(data.statuses);
  process.stdout.write(JSON.stringify({
    changes: names.map((name) => ({
      name,
      completedTasks: 0,
      totalTasks: 1,
      lastModified: "2026-07-15T00:00:00.000Z",
      status: "in-progress"
    })),
    root: { path: data.listRoot, source: "test" }
  }));
  process.exit(0);
}
if (command === "status") {
  const name = args[args.indexOf("--change") + 1];
  const status = data.statuses[name];
  if (!status) {
    process.stdout.write(JSON.stringify({ status: [{ message: "missing change" }] }));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(status));
  process.exit(0);
}
if (command === "validate") {
  const name = args[1];
  process.stdout.write(JSON.stringify({
    items: [{ id: name, type: "change", valid: true, issues: [], durationMs: 1 }],
    summary: { valid: true },
    version: "1.6.0"
  }));
  process.exit(0);
}
process.stdout.write(JSON.stringify({ status: [{ message: "unsupported fake argv" }] }));
process.exit(9);
`,
  );
  chmodSync(executable, 0o755);

  return {
    executable,
    callsPath,
    dataPath,
    env: {
      ...process.env,
      CORGISPEC_HOOKS_DISABLE: undefined,
      CORGISPEC_OPENSPEC_BIN: executable,
    },
    writeData(data) {
      writeFileSync(dataPath, JSON.stringify(data, null, 2));
    },
    calls() {
      return readFileSync(callsPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[][][number]);
    },
  };
}

export function setupFakeChange(options: {
  projectRoot: string;
  changeName: string;
  taskArtifactId?: string;
  taskFileName?: string;
  taskContent?: string;
  planningRoot?: string;
  schemaName?: string;
}): { status: Record<string, unknown>; taskPath: string; changeRoot: string; planningRoot: string } {
  const planningRoot = options.planningRoot ?? resolve(options.projectRoot, "openspec");
  const changeRoot = resolve(planningRoot, "changes", options.changeName);
  const taskFileName = options.taskFileName ?? "tasks.md";
  const taskPath = resolve(changeRoot, taskFileName);
  mkdirSync(dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, options.taskContent ?? "## 1. Work\n\n- [ ] 1.1 Pending\n");
  const taskArtifactId = options.taskArtifactId ?? "tasks";
  return {
    status: createFakeStatus({
      changeName: options.changeName,
      planningRoot,
      changeRoot,
      schemaName: options.schemaName,
      artifacts: {
        [taskArtifactId]: {
          outputPath: relative(changeRoot, taskPath).replace(/\\/g, "/"),
          existingOutputPaths: [taskPath],
          status: "done",
        },
      },
    }),
    taskPath,
    changeRoot,
    planningRoot,
  };
}
