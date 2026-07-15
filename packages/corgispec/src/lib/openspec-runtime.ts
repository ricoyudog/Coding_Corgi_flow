import { spawn } from "node:child_process";

export const MINIMUM_OPENSPEC_VERSION = "1.6.0";
export const MAXIMUM_OPENSPEC_MAJOR = 2;
export const DEFAULT_OPENSPEC_TIMEOUT_MS = 15_000;

export interface CommandRequest {
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Injectable process boundary used by the OpenSpec adapter. */
export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
}

export type CommandRunnerErrorCode = "spawn_failed";

export class CommandRunnerError extends Error {
  constructor(
    message: string,
    public readonly code: CommandRunnerErrorCode,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "CommandRunnerError";
  }
}

/**
 * Native runner that passes an argv array directly to spawn. `shell: false`
 * is part of the security contract: change and artifact names can never be
 * interpreted as shell syntax.
 */
export class NodeCommandRunner implements CommandRunner {
  async run(request: CommandRequest): Promise<CommandResult> {
    const timeoutMs = request.timeoutMs ?? DEFAULT_OPENSPEC_TIMEOUT_MS;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new CommandRunnerError(
        `Command timeout must be a positive number, got ${String(timeoutMs)}`,
        "spawn_failed"
      );
    }

    return await new Promise<CommandResult>((resolveResult, reject) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const child = spawn(request.command, [...request.args], {
        cwd: request.cwd,
        env: request.env ? { ...process.env, ...request.env } : process.env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(
          new CommandRunnerError(
            `Failed to start '${request.command}': ${error.message}`,
            "spawn_failed",
            error
          )
        );
      });

      child.once("close", (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveResult({ exitCode, signal, stdout, stderr, timedOut });
      });
    });
  }
}

export interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  raw: string;
}

export type OpenSpecRuntimeErrorCode =
  | "openspec_missing"
  | "openspec_timeout"
  | "openspec_version_failed"
  | "openspec_version_invalid"
  | "openspec_version_unsupported";

export class OpenSpecRuntimeError extends Error {
  constructor(
    message: string,
    public readonly code: OpenSpecRuntimeErrorCode,
    public readonly details?: Record<string, unknown>,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "OpenSpecRuntimeError";
  }
}

export interface OpenSpecRuntime {
  executable: string;
  version: SemanticVersion;
  versionText: string;
}

export function parseOpenSpecVersion(output: string): SemanticVersion | null {
  const match = output.match(
    /(?:^|\s|\/)[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?=$|\s|\))/
  );
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;

  return {
    major,
    minor,
    patch,
    ...(match[4] ? { prerelease: match[4] } : {}),
    raw: match[0].trim().replace(/^\//, ""),
  };
}

export function isSupportedOpenSpecVersion(version: SemanticVersion): boolean {
  if (version.prerelease) return false;
  if (version.major !== 1) return false;
  return version.minor >= 6;
}

export async function inspectOpenSpecRuntime(options: {
  cwd: string;
  runner?: CommandRunner;
  executable?: string;
  timeoutMs?: number;
}): Promise<OpenSpecRuntime> {
  const runner = options.runner ?? new NodeCommandRunner();
  const executable = options.executable ?? "openspec";
  let result: CommandResult;

  try {
    result = await runner.run({
      command: executable,
      args: ["--version"],
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? DEFAULT_OPENSPEC_TIMEOUT_MS,
      env: { OPENSPEC_TELEMETRY: "0" },
    });
  } catch (error) {
    if (error instanceof CommandRunnerError) {
      throw new OpenSpecRuntimeError(
        `OpenSpec CLI was not found or could not be started: ${error.message}`,
        "openspec_missing",
        { executable },
        error
      );
    }
    throw error;
  }

  if (result.timedOut) {
    throw new OpenSpecRuntimeError(
      `OpenSpec version check timed out after ${options.timeoutMs ?? DEFAULT_OPENSPEC_TIMEOUT_MS}ms`,
      "openspec_timeout",
      { executable, stderr: result.stderr }
    );
  }
  if (result.exitCode !== 0) {
    throw new OpenSpecRuntimeError(
      `OpenSpec version check exited with code ${String(result.exitCode)}`,
      "openspec_version_failed",
      { executable, exitCode: result.exitCode, stderr: result.stderr }
    );
  }

  const versionText = result.stdout.trim() || result.stderr.trim();
  const version = parseOpenSpecVersion(versionText);
  if (!version) {
    throw new OpenSpecRuntimeError(
      `Could not parse OpenSpec version from: ${JSON.stringify(versionText)}`,
      "openspec_version_invalid",
      { executable, versionText }
    );
  }
  if (!isSupportedOpenSpecVersion(version)) {
    throw new OpenSpecRuntimeError(
      `Unsupported OpenSpec ${version.raw}; Corgi requires >=${MINIMUM_OPENSPEC_VERSION} <${MAXIMUM_OPENSPEC_MAJOR}.0.0`,
      "openspec_version_unsupported",
      { executable, version: version.raw }
    );
  }

  return { executable, version, versionText };
}
