import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OpenSpecAdapterError,
  createOpenSpecAdapter,
} from "../src/lib/openspec-adapter.js";
import {
  type CommandRequest,
  type CommandResult,
  type CommandRunner,
} from "../src/lib/openspec-runtime.js";

function execution(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "{}",
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}

function json(value: unknown, overrides: Partial<CommandResult> = {}): CommandResult {
  return execution({ stdout: JSON.stringify(value), ...overrides });
}

class QueueRunner implements CommandRunner {
  readonly requests: CommandRequest[] = [];

  constructor(private readonly queue: Array<CommandResult | Error>) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error("Fake runner queue exhausted");
    if (next instanceof Error) throw next;
    return next;
  }
}

function statusFixture(): Record<string, unknown> {
  const template = readFileSync(
    new URL("./fixtures/openspec-1.6/status-complete.json", import.meta.url),
    "utf8"
  );
  return JSON.parse(
    template
      .replaceAll("${PLANNING_ROOT}", "/stores/shared-product")
      .replaceAll("${CHANGES_DIR}", "/stores/shared-product/openspec/changes")
      .replaceAll("${CHANGE_ROOT}", "/stores/shared-product/openspec/changes/add-auth")
  ) as Record<string, unknown>;
}

const artifactInstructions = {
  changeName: "add-auth",
  artifactId: "proposal",
  schemaName: "custom-delivery",
  changeDir: "/stores/shared-product/openspec/changes/add-auth",
  outputPath: "proposal.md",
  resolvedOutputPath: "/stores/shared-product/openspec/changes/add-auth/proposal.md",
  existingOutputPaths: ["/stores/shared-product/openspec/changes/add-auth/proposal.md"],
  description: "Proposal",
  instruction: "Write it",
  template: "# Proposal",
  dependencies: [],
  unlocks: ["specs"],
};

const applyInstructions = {
  changeName: "add-auth",
  changeDir: "/stores/shared-product/openspec/changes/add-auth",
  schemaName: "custom-delivery",
  contextFiles: { proposal: ["/tmp/proposal.md"] },
  progress: { total: 2, complete: 1, remaining: 1 },
  tasks: [{ id: "1.1", description: "Build", done: false }],
  state: "ready",
  instruction: "Implement remaining tasks",
};

function validation(valid = true) {
  return {
    items: [
      {
        id: "add-auth",
        type: "change",
        valid,
        issues: valid ? [] : [{ level: "ERROR", path: "specs", message: "Missing scenario" }],
        durationMs: 4,
      },
    ],
    summary: {
      totals: { items: 1, passed: valid ? 1 : 0, failed: valid ? 0 : 1 },
    },
    version: "1.0",
  };
}

describe("OpenSpecAdapter command contract", () => {
  it("honors the executable override used by packaged lifecycle commands", async () => {
    const previous = process.env["CORGISPEC_OPENSPEC_BIN"];
    process.env["CORGISPEC_OPENSPEC_BIN"] = "/opt/corgi/fake-openspec";
    const runner = new QueueRunner([json({ changes: [] })]);
    try {
      await createOpenSpecAdapter("/workspace", runner, { verifyRuntime: false }).listChanges();
      expect(runner.requests[0]!.command).toBe("/opt/corgi/fake-openspec");
    } finally {
      if (previous === undefined) delete process.env["CORGISPEC_OPENSPEC_BIN"];
      else process.env["CORGISPEC_OPENSPEC_BIN"] = previous;
    }
  });

  it("checks the runtime once and accepts future status fields", async () => {
    const runner = new QueueRunner([
      execution({ stdout: "1.6.0\n" }),
      json(statusFixture()),
      json(statusFixture()),
    ]);
    const adapter = createOpenSpecAdapter("/workspace", runner, { timeoutMs: 777 });

    const first = await adapter.getStatus("add-auth");
    const second = await adapter.getStatus("add-auth");

    expect(first.futureField).toEqual({ accepted: true });
    expect(second.changeRoot).toContain("/stores/shared-product/");
    expect(runner.requests.map((request) => request.args)).toEqual([
      ["--version"],
      ["status", "--change", "add-auth", "--json"],
      ["status", "--change", "add-auth", "--json"],
    ]);
    expect(runner.requests.every((request) => request.timeoutMs === 777)).toBe(true);
  });

  it("clears a failed runtime probe so a later check can recover", async () => {
    const runner = new QueueRunner([
      execution({ stdout: "1.5.0" }),
      execution({ stdout: "1.6.0" }),
    ]);
    const adapter = createOpenSpecAdapter("/workspace", runner);

    await expect(adapter.getRuntime()).rejects.toMatchObject({
      code: "openspec_version_unsupported",
    });
    await expect(adapter.getRuntime()).resolves.toMatchObject({
      version: { major: 1, minor: 6 },
    });
    expect(runner.requests).toHaveLength(2);
  });

  it("builds stable argv for every public operation", async () => {
    const runner = new QueueRunner([
      json({
        changes: [
          {
            name: "add-auth",
            completedTasks: 1,
            totalTasks: 2,
            lastModified: "2026-07-15T00:00:00.000Z",
            status: "in-progress",
          },
        ],
      }),
      json(artifactInstructions),
      json(applyInstructions),
      json(validation()),
      json({
        change: {
          id: "new-change",
          path: "/store/openspec/changes/new-change",
          metadataPath: "/store/openspec/changes/new-change/.openspec.yaml",
          schema: "custom-delivery",
        },
      }),
      json({
        archive: {
          change: "new-change",
          archivedAs: "2026-08-14-new-change",
          path: "/store/openspec/changes/archive/2026-08-14-new-change",
          specsUpdated: true,
          totals: { added: 1, modified: 0, removed: 0, renamed: 0 },
        },
      }),
    ]);
    const adapter = createOpenSpecAdapter("/workspace", runner, {
      verifyRuntime: false,
      store: "shared-product",
    });

    await expect(adapter.listChanges()).resolves.toMatchObject({ changes: [{ name: "add-auth" }] });
    await expect(
      adapter.getArtifactInstructions("add-auth", "proposal", { schema: "custom-delivery" })
    ).resolves.toMatchObject({ artifactId: "proposal" });
    await expect(adapter.getApplyInstructions("add-auth")).resolves.toMatchObject({ state: "ready" });
    await expect(adapter.validateChange("add-auth", { strict: false })).resolves.toMatchObject({
      items: [{ valid: true }],
    });
    await expect(
      adapter.createChange("new-change", {
        schema: "custom-delivery",
        description: "A description; $(still inert)",
        goal: "Ship safely",
      })
    ).resolves.toMatchObject({ change: { id: "new-change" } });
    await expect(adapter.archiveChange("new-change")).resolves.toMatchObject({
      archive: { archivedAs: "2026-08-14-new-change" },
    });

    expect(runner.requests.map((request) => request.args)).toEqual([
      ["list", "--json", "--store", "shared-product"],
      [
        "instructions",
        "proposal",
        "--change",
        "add-auth",
        "--json",
        "--store",
        "shared-product",
        "--schema",
        "custom-delivery",
      ],
      ["instructions", "apply", "--change", "add-auth", "--json", "--store", "shared-product"],
      [
        "validate",
        "add-auth",
        "--type",
        "change",
        "--json",
        "--store",
        "shared-product",
      ],
      [
        "new",
        "change",
        "new-change",
        "--description",
        "A description; $(still inert)",
        "--goal",
        "Ship safely",
        "--json",
        "--store",
        "shared-product",
        "--schema",
        "custom-delivery",
      ],
      ["archive", "new-change", "--json", "--yes", "--store", "shared-product"],
    ]);
  });

  it("enables strict validation by default and permits a per-command store", async () => {
    const runner = new QueueRunner([json(validation())]);
    const adapter = createOpenSpecAdapter("/workspace", runner, { verifyRuntime: false });

    await adapter.validateChange("add-auth", { store: "release-store" });

    expect(runner.requests[0]!.args).toEqual([
      "validate",
      "add-auth",
      "--type",
      "change",
      "--strict",
      "--json",
      "--store",
      "release-store",
    ]);
  });

  it.each([
    ["list", json({ changes: [{ name: "incomplete" }] })],
    ["status", json({ ...statusFixture(), planningHome: undefined })],
    ["artifact", json({ ...artifactInstructions, dependencies: ["not-an-object"] })],
    ["apply", json({ ...applyInstructions, progress: { total: "2" } })],
    ["create", json({ change: null })],
  ] as const)("rejects invalid %s response shapes", async (operation, response) => {
    const runner = new QueueRunner([response]);
    const adapter = createOpenSpecAdapter("/workspace", runner, { verifyRuntime: false });

    const call =
      operation === "list"
        ? adapter.listChanges()
        : operation === "status"
          ? adapter.getStatus("add-auth")
          : operation === "artifact"
            ? adapter.getArtifactInstructions("add-auth", "proposal")
            : operation === "apply"
              ? adapter.getApplyInstructions("add-auth")
              : adapter.createChange("add-auth");

    await expect(call).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects blank identifiers before invoking the runner", async () => {
    const runner = new QueueRunner([]);
    const adapter = createOpenSpecAdapter("/workspace", runner, { verifyRuntime: false });

    await expect(adapter.getStatus("   ")).rejects.toMatchObject({ code: "invalid_response" });
    await expect(adapter.getArtifactInstructions("change", "")).rejects.toMatchObject({
      code: "invalid_response",
    });
    await expect(adapter.listChanges({ store: "" })).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(runner.requests).toHaveLength(0);
  });
});

describe("OpenSpecAdapter failure normalization", () => {
  it.each([
    [execution({ stdout: "" }), "invalid_json"],
    [execution({ stdout: "not json" }), "invalid_json"],
    [execution({ stdout: "{}", timedOut: true }), "command_timeout"],
  ] as const)("classifies protocol failure as %s", async (response, code) => {
    const adapter = createOpenSpecAdapter("/workspace", new QueueRunner([response]), {
      verifyRuntime: false,
    });
    await expect(adapter.getStatus("add-auth")).rejects.toMatchObject({ code });
  });

  it("preserves structured OpenSpec diagnostics on non-zero exit", async () => {
    const payload = {
      status: [
        {
          severity: "error",
          code: "unknown_store",
          message: "Store does not exist",
          fix: "openspec store list --json",
        },
      ],
    };
    const adapter = createOpenSpecAdapter(
      "/workspace",
      new QueueRunner([json(payload, { exitCode: 1, stderr: "diagnostic details" })]),
      { verifyRuntime: false }
    );

    await expect(adapter.getStatus("add-auth")).rejects.toMatchObject({
      name: "OpenSpecAdapterError",
      code: "command_failed",
      message: "Store does not exist",
      details: { exitCode: 1, stderr: "diagnostic details", payload },
    });
  });

  it("returns a strict invalid validation report even though OpenSpec exits 1", async () => {
    const report = validation(false);
    const adapter = createOpenSpecAdapter(
      "/workspace",
      new QueueRunner([json(report, { exitCode: 1 })]),
      { verifyRuntime: false }
    );

    await expect(adapter.validateChange("add-auth")).resolves.toEqual(report);
  });

  it("does not confuse an exit-1 diagnostic with a validation report", async () => {
    const adapter = createOpenSpecAdapter(
      "/workspace",
      new QueueRunner([
        json(
          { status: [{ severity: "error", code: "unknown_item", message: "Unknown item" }] },
          { exitCode: 1 }
        ),
      ]),
      { verifyRuntime: false }
    );

    await expect(adapter.validateChange("missing")).rejects.toMatchObject({
      code: "command_failed",
      message: "Unknown item",
    });
  });

  it("normalizes runner rejection without leaking it as a raw exception", async () => {
    const cause = new Error("spawn exploded");
    const adapter = createOpenSpecAdapter("/workspace", new QueueRunner([cause]), {
      verifyRuntime: false,
    });

    await expect(adapter.listChanges()).rejects.toEqual(
      expect.objectContaining<Partial<OpenSpecAdapterError>>({
        code: "command_spawn_failed",
        cause,
      })
    );
  });

  it("includes stdout when malformed JSON follows a non-zero command", async () => {
    const adapter = createOpenSpecAdapter(
      "/workspace",
      new QueueRunner([execution({ exitCode: 2, stdout: "human error", stderr: "bad" })]),
      { verifyRuntime: false }
    );

    await expect(adapter.listChanges()).rejects.toMatchObject({
      code: "invalid_json",
      details: { exitCode: 2, stdout: "human error", stderr: "bad" },
    });
  });
});
