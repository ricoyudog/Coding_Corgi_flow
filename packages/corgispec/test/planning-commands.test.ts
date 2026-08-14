import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createReadyCommand } from "../src/commands/ready.js";
import { createUpdateCommand } from "../src/commands/update.js";
import { createOpenSpecAdapter } from "../src/lib/openspec-adapter.js";
import type {
  CommandRequest,
  CommandResult,
  CommandRunner,
} from "../src/lib/openspec-runtime.js";

class QueueRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];
  constructor(private readonly queue: CommandResult[]) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    const response = this.queue.shift();
    if (!response) throw new Error("fake runner queue exhausted");
    return response;
  }
}

function result(payload: unknown, exitCode = 0): CommandResult {
  return {
    exitCode,
    signal: null,
    stdout: typeof payload === "string" ? payload : JSON.stringify(payload),
    stderr: "",
    timedOut: false,
  };
}

describe("planning CLI JSON contracts", () => {
  let root: string;
  let status: Record<string, unknown>;
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = resolve(tmpdir(), `corgispec-planning-cli-${Date.now()}-${Math.random()}`);
    const changesDir = resolve(root, "store/changes");
    const changeRoot = resolve(changesDir, "change-a");
    mkdirSync(resolve(root, "openspec"), { recursive: true });
    mkdirSync(changeRoot, { recursive: true });
    writeFileSync(resolve(root, "openspec/config.yaml"), [
      "schema: custom",
      "corgi:",
      "  taskArtifactId: delivery",
      "",
    ].join("\n"));
    writeFileSync(resolve(changeRoot, "proposal.md"), "# Proposal\n");
    writeFileSync(resolve(changeRoot, "delivery.md"), "## 1. Build\n- [ ] 1.1 ship\n");
    const artifactPaths = {
      proposal: {
        outputPath: "proposal.md",
        resolvedOutputPath: resolve(changeRoot, "proposal.md"),
        existingOutputPaths: [resolve(changeRoot, "proposal.md")],
      },
      delivery: {
        outputPath: "delivery.md",
        resolvedOutputPath: resolve(changeRoot, "delivery.md"),
        existingOutputPaths: [resolve(changeRoot, "delivery.md")],
      },
    };
    status = {
      changeName: "change-a",
      schemaName: "custom",
      planningHome: {
        kind: "repo",
        root: resolve(root, "store"),
        changesDir,
        defaultSchema: "custom",
      },
      changeRoot,
      artifactPaths,
      nextSteps: [],
      actionContext: {
        mode: "store",
        sourceOfTruth: "store",
        planningArtifacts: ["proposal", "delivery"],
        linkedContext: [],
        allowedEditRoots: [resolve(root, "store")],
        requiresAffectedAreaSelection: false,
        constraints: ["planning only"],
      },
      isComplete: true,
      applyRequires: ["delivery"],
      artifacts: [
        { id: "proposal", outputPath: "proposal.md", status: "done" },
        { id: "delivery", outputPath: "delivery.md", status: "done" },
      ],
    };
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.exitCode = 0;
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
    process.exitCode = 0;
    rmSync(root, { recursive: true, force: true });
  });

  it("ready emits pure JSON, forwards Store argv, and exits zero", async () => {
    const validation = {
      items: [{ id: "change-a", type: "change", valid: true, issues: [], durationMs: 1 }],
      summary: { valid: 1, invalid: 0 },
      version: "1.6",
    };
    const runner = new QueueRunner([result(status), result(validation)]);
    const adapter = createOpenSpecAdapter(root, runner, { verifyRuntime: false });

    await createReadyCommand({ createAdapter: () => adapter }).parseAsync(
      ["change-a", "--json", "--store", "shared", "--path", root],
      { from: "user" },
    );

    expect(process.exitCode).toBe(0);
    expect(error).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      status: "ready",
      taskArtifactId: "delivery",
      planningRevision: expect.stringMatching(/^sha256:/),
    });
    expect(runner.requests.map((request) => request.args)).toEqual([
      ["status", "--change", "change-a", "--json", "--store", "shared"],
      ["validate", "change-a", "--type", "change", "--strict", "--json", "--store", "shared"],
    ]);
  });

  it("maps a well-formed strict validation failure to not_ready/exit 1", async () => {
    const invalid = {
      items: [{
        id: "change-a",
        type: "change",
        valid: false,
        issues: [{ message: "missing scenario" }],
        durationMs: 1,
      }],
      summary: { valid: 0, invalid: 1 },
      version: "1.6",
    };
    const runner = new QueueRunner([result(status), result(invalid, 1)]);
    const adapter = createOpenSpecAdapter(root, runner, { verifyRuntime: false });

    await createReadyCommand({ createAdapter: () => adapter }).parseAsync(
      ["change-a", "--json", "--path", root],
      { from: "user" },
    );

    expect(process.exitCode).toBe(1);
    const output = JSON.parse(String(log.mock.calls[0]![0]));
    expect(output.status).toBe("not_ready");
    expect(output.checks).toContainEqual(expect.objectContaining({
      code: "OPENSPEC_STRICT_VALIDATION",
      status: "fail",
    }));
  });

  it("maps malformed OpenSpec output to contract_error/exit 2", async () => {
    const runner = new QueueRunner([result("not-json")]);
    const adapter = createOpenSpecAdapter(root, runner, { verifyRuntime: false });

    await createReadyCommand({ createAdapter: () => adapter }).parseAsync(
      ["change-a", "--json", "--path", root],
      { from: "user" },
    );

    expect(process.exitCode).toBe(2);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      status: "contract_error",
      error: { code: "invalid_json" },
    });
  });

  it("update is ready only when no Run Contract v3 owns the Change", async () => {
    const runner = new QueueRunner([result(status)]);
    const adapter = createOpenSpecAdapter(root, runner, { verifyRuntime: false });

    await createUpdateCommand({ createAdapter: () => adapter }).parseAsync(
      ["change-a", "--json", "--store", "shared", "--path", root],
      { from: "user" },
    );

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(String(log.mock.calls[0]![0]));
    expect(output).toMatchObject({
      status: "ready",
      blockers: [],
      runContract: null,
      existingArtifactIds: ["delivery", "proposal"],
      missingArtifactIds: [],
    });
    expect(output.guardrails).toEqual(output.constraints);
    expect(runner.requests[0]!.args).toEqual([
      "status", "--change", "change-a", "--json", "--store", "shared",
    ]);
  });

  it("update blocks an active Run Contract v3 without mutating it", async () => {
    const runner = new QueueRunner([result(status)]);
    const adapter = createOpenSpecAdapter(root, runner, { verifyRuntime: false });
    const inspect = vi.fn(() => ({
      state: {
        schemaVersion: 3,
        runId: "run-active",
        phase: "applying",
        stateRevision: 4,
        nonce: "nonce-4",
      },
    }));

    await createUpdateCommand({
      createAdapter: () => adapter,
      createLoopStore: () => ({ inspect }) as never,
    }).parseAsync(
      ["change-a", "--json", "--path", root],
      { from: "user" },
    );

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      status: "blocked",
      reasonCode: "ACTIVE_RUN_V3",
      blockers: [{ code: "ACTIVE_RUN_V3" }],
      runContract: { runId: "run-active", phase: "applying" },
    });
    expect(inspect).toHaveBeenCalledWith("change-a");
  });

  it("update permits only the expected repair planning reconciliation", async () => {
    const runner = new QueueRunner([result(status)]);
    const adapter = createOpenSpecAdapter(root, runner, { verifyRuntime: false });
    const inspect = vi.fn(() => ({
      state: {
        schemaVersion: 3,
        runId: "run-repair",
        phase: "repair_required",
        stateRevision: 4,
        nonce: "nonce-4",
      },
    }));

    await createUpdateCommand({
      createAdapter: () => adapter,
      createLoopStore: () => ({ inspect }) as never,
    }).parseAsync(
      ["change-a", "--json", "--path", root],
      { from: "user" },
    );

    expect(process.exitCode).toBe(0);
    const output = JSON.parse(String(log.mock.calls[0]![0]));
    expect(output).toMatchObject({
      status: "ready",
      blockers: [],
      runContract: { runId: "run-repair", phase: "repair_required" },
    });
    expect(output.guardrails.join("\n")).toContain("exactly one Repair Task Group");
    expect(inspect).toHaveBeenCalledWith("change-a");
  });
});
