import { describe, expect, it } from "vitest";
import {
  CommandRunnerError,
  NodeCommandRunner,
  OpenSpecRuntimeError,
  inspectOpenSpecRuntime,
  isSupportedOpenSpecVersion,
  parseOpenSpecVersion,
  type CommandRequest,
  type CommandResult,
  type CommandRunner,
} from "../src/lib/openspec-runtime.js";

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}

class FakeRunner implements CommandRunner {
  requests: CommandRequest[] = [];

  constructor(private readonly next: CommandResult | Error) {}

  async run(request: CommandRequest): Promise<CommandResult> {
    this.requests.push(request);
    if (this.next instanceof Error) throw this.next;
    return this.next;
  }
}

describe("NodeCommandRunner", () => {
  it("captures stdout, stderr and the exact exit code", async () => {
    const runner = new NodeCommandRunner();
    const execution = await runner.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write('out'); process.stderr.write('err'); process.exit(7)"],
      cwd: process.cwd(),
      timeoutMs: 2_000,
    });

    expect(execution).toMatchObject({
      exitCode: 7,
      stdout: "out",
      stderr: "err",
      timedOut: false,
    });
  });

  it("passes shell-looking values as inert argv", async () => {
    const runner = new NodeCommandRunner();
    const hostile = "$(printf compromised); semi; `whoami`";
    const execution = await runner.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1])", hostile],
      cwd: process.cwd(),
      timeoutMs: 2_000,
    });

    expect(execution.exitCode).toBe(0);
    expect(execution.stdout).toBe(hostile);
  });

  it("merges an explicit environment and uses the default timeout", async () => {
    const runner = new NodeCommandRunner();
    const execution = await runner.run({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.env.CORGI_RUNNER_TEST || '')"],
      cwd: process.cwd(),
      env: { CORGI_RUNNER_TEST: "isolated-value" },
    });

    expect(execution).toMatchObject({ exitCode: 0, stdout: "isolated-value", timedOut: false });
  });

  it("kills a timed-out command", async () => {
    const runner = new NodeCommandRunner();
    const execution = await runner.run({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      timeoutMs: 30,
    });

    expect(execution.timedOut).toBe(true);
    expect(execution.signal).toBe("SIGKILL");
  });

  it("wraps process spawn failures", async () => {
    const runner = new NodeCommandRunner();
    await expect(
      runner.run({
        command: `missing-corgi-command-${Date.now()}`,
        args: [],
        cwd: process.cwd(),
        timeoutMs: 100,
      })
    ).rejects.toMatchObject({ name: "CommandRunnerError", code: "spawn_failed" });
  });

  it("rejects invalid timeouts before spawning", async () => {
    const runner = new NodeCommandRunner();
    await expect(
      runner.run({ command: process.execPath, args: [], cwd: process.cwd(), timeoutMs: 0 })
    ).rejects.toThrow("positive number");
  });
});

describe("OpenSpec version parsing", () => {
  it.each([
    ["1.6.0", { major: 1, minor: 6, patch: 0, raw: "1.6.0" }],
    ["OpenSpec CLI v1.27.4\n", { major: 1, minor: 27, patch: 4, raw: "v1.27.4" }],
    ["openspec/1.8.2 (linux)", { major: 1, minor: 8, patch: 2, raw: "1.8.2" }],
    ["OpenSpec 1.7.0-rc.1", { major: 1, minor: 7, patch: 0, prerelease: "rc.1", raw: "1.7.0-rc.1" }],
  ])("parses %s", (text, expected) => {
    expect(parseOpenSpecVersion(text)).toEqual(expected);
  });

  it.each(["", "OpenSpec dev", "1.6", "vNext"])("rejects invalid version text %s", (text) => {
    expect(parseOpenSpecVersion(text)).toBeNull();
  });

  it("rejects numeric components outside JavaScript's safe integer range", () => {
    expect(parseOpenSpecVersion("999999999999999999999.6.0")).toBeNull();
  });

  it("accepts stable 1.6+ and rejects old, prerelease and 2.x runtimes", () => {
    expect(isSupportedOpenSpecVersion(parseOpenSpecVersion("1.6.0")!)).toBe(true);
    expect(isSupportedOpenSpecVersion(parseOpenSpecVersion("1.99.0")!)).toBe(true);
    expect(isSupportedOpenSpecVersion(parseOpenSpecVersion("1.5.99")!)).toBe(false);
    expect(isSupportedOpenSpecVersion(parseOpenSpecVersion("1.7.0-beta.1")!)).toBe(false);
    expect(isSupportedOpenSpecVersion(parseOpenSpecVersion("2.0.0")!)).toBe(false);
  });
});

describe("inspectOpenSpecRuntime", () => {
  it("returns compatible runtime metadata using an argv probe", async () => {
    const runner = new FakeRunner(result({ stdout: "OpenSpec 1.6.0\n" }));
    const runtime = await inspectOpenSpecRuntime({
      cwd: "/workspace",
      runner,
      executable: "custom-openspec",
      timeoutMs: 321,
    });

    expect(runtime.version).toMatchObject({ major: 1, minor: 6, patch: 0 });
    expect(runner.requests).toEqual([
      {
        command: "custom-openspec",
        args: ["--version"],
        cwd: "/workspace",
        timeoutMs: 321,
        env: { OPENSPEC_TELEMETRY: "0" },
      },
    ]);
  });

  it("can read version output from stderr", async () => {
    const runtime = await inspectOpenSpecRuntime({
      cwd: "/workspace",
      runner: new FakeRunner(result({ stderr: "1.6.1" })),
    });
    expect(runtime.version.raw).toBe("1.6.1");
  });

  it.each([
    [result({ timedOut: true }), "openspec_timeout"],
    [result({ exitCode: 2, stderr: "broken" }), "openspec_version_failed"],
    [result({ stdout: "nightly" }), "openspec_version_invalid"],
    [result({ stdout: "1.5.0" }), "openspec_version_unsupported"],
  ] as const)("classifies runtime failures", async (execution, code) => {
    await expect(
      inspectOpenSpecRuntime({ cwd: "/workspace", runner: new FakeRunner(execution) })
    ).rejects.toMatchObject({ name: "OpenSpecRuntimeError", code });
  });

  it("maps runner spawn failures to openspec_missing", async () => {
    const failure = new CommandRunnerError("ENOENT", "spawn_failed");
    await expect(
      inspectOpenSpecRuntime({ cwd: "/workspace", runner: new FakeRunner(failure) })
    ).rejects.toEqual(
      expect.objectContaining<Partial<OpenSpecRuntimeError>>({ code: "openspec_missing" })
    );
  });

  it("does not hide an unexpected runner error", async () => {
    const failure = new TypeError("unexpected");
    await expect(
      inspectOpenSpecRuntime({ cwd: "/workspace", runner: new FakeRunner(failure) })
    ).rejects.toBe(failure);
  });

  it("uses the native runner when one is not injected", async () => {
    await expect(
      inspectOpenSpecRuntime({
        cwd: process.cwd(),
        executable: process.execPath,
        timeoutMs: 2_000,
      })
    ).rejects.toMatchObject({ code: "openspec_version_unsupported" });
  });
});
