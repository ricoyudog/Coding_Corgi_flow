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

  it("update blocks active v1 state and exposes stable aliases", async () => {
    const stateDir = resolve(root, ".claude/corgi-loop/change-a");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(resolve(stateDir, "state.json"), JSON.stringify({
      schemaVersion: 1,
      changeName: "change-a",
      sessionId: "session-a",
      active: true,
    }));
    const runner = new QueueRunner([result(status)]);
    const adapter = createOpenSpecAdapter(root, runner, { verifyRuntime: false });

    await createUpdateCommand({ createAdapter: () => adapter }).parseAsync(
      ["change-a", "--json", "--store", "shared", "--path", root],
      { from: "user" },
    );

    expect(process.exitCode).toBe(1);
    const output = JSON.parse(String(log.mock.calls[0]![0]));
    expect(output).toMatchObject({
      status: "blocked",
      reasonCode: "ACTIVE_V1_RUN",
      blockers: [{ code: "ACTIVE_V1_RUN" }],
      existingArtifactIds: ["delivery", "proposal"],
      missingArtifactIds: [],
    });
    expect(output.guardrails).toEqual(output.constraints);
    expect(runner.requests[0]!.args).toEqual([
      "status", "--change", "change-a", "--json", "--store", "shared",
    ]);
  });

  it("update blocks corrupt legacy state instead of treating it as inactive", async () => {
    const stateDir = resolve(root, ".opencode/corgi-loop/change-a");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(resolve(stateDir, "state.json"), "{");
    const runner = new QueueRunner([result(status)]);
    const adapter = createOpenSpecAdapter(root, runner, { verifyRuntime: false });

    await createUpdateCommand({ createAdapter: () => adapter }).parseAsync(
      ["change-a", "--json", "--path", root],
      { from: "user" },
    );

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      status: "blocked",
      blockers: [{ code: "CORRUPT_V1_STATE" }],
    });
  });

  it("update blocks an active canonical v2 run without mutating it", async () => {
    const runner = new QueueRunner([result(status)]);
    const adapter = createOpenSpecAdapter(root, runner, { verifyRuntime: false });
    const peek = vi.fn(async () => ({
      current: null,
      events: [],
      recovered: false,
      repairedTrailingEvent: false,
      state: {
        schemaVersion: 2,
        runId: "run-active",
        phase: "fixing",
        stateRevision: 4,
        nonce: "nonce-4",
      },
    }));

    await createUpdateCommand({
      createAdapter: () => adapter,
      createLoopStore: () => ({ peek }) as never,
    }).parseAsync(
      ["change-a", "--json", "--path", root],
      { from: "user" },
    );

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      status: "blocked",
      reasonCode: "ACTIVE_V2_RUN",
      blockers: [{ code: "ACTIVE_V2_RUN" }],
      canonicalLoop: {
        runId: "run-active",
        phase: "fixing",
        stateRevision: 4,
        nonce: "nonce-4",
      },
    });
    expect(peek).toHaveBeenCalledWith("change-a");
  });

  it("update blocks planning writes while a durable convergence intent is pending", async () => {
    const runner = new QueueRunner([result(status)]);
    const adapter = createOpenSpecAdapter(root, runner, { verifyRuntime: false });
    const peek = vi.fn(async () => ({
      current: null,
      events: [],
      recovered: false,
      repairedTrailingEvent: false,
      recoveryRequired: false,
      state: {
        schemaVersion: 2,
        runId: "run-awaiting-convergence-recovery",
        phase: "invalidated",
        stateRevision: 7,
        nonce: "nonce-7",
        blockedReason: {
          code: "planning_invalidated",
          message: "convergence append interrupted",
          details: { operation: "converge", convergenceIntent: {} },
        },
      },
    }));

    await createUpdateCommand({
      createAdapter: () => adapter,
      createLoopStore: () => ({ peek }) as never,
    }).parseAsync(
      ["change-a", "--json", "--path", root],
      { from: "user" },
    );

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      status: "blocked",
      reasonCode: "PENDING_CONVERGENCE",
      blockers: [{ code: "PENDING_CONVERGENCE" }],
      canonicalLoop: {
        runId: "run-awaiting-convergence-recovery",
        phase: "invalidated",
      },
    });
    expect(peek).toHaveBeenCalledWith("change-a");
  });
});
