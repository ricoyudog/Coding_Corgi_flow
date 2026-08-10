import { Command } from "commander";
import { delimiter, resolve, dirname } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

const SUPPORTED_PLATFORMS = ["claude", "opencode", "codex"] as const;
type Platform = (typeof SUPPORTED_PLATFORMS)[number];

interface GenerateOptions {
  platform?: string;
  output?: string;
  force?: boolean;
  deep?: boolean;
}

export function createHooksGenerateCommand(): Command {
  const cmd = new Command("generate");

  cmd
    .description(
      "Generate hook configuration for AI platforms (Claude Code, OpenCode, Codex)"
    )
    .option("--platform <name>", "Target platform (claude, opencode, codex)")
    .option("--output <path>", "Output file or directory path")
    .option("--force", "Overwrite existing hook configuration")
    .option(
      "--deep",
      "Deprecated: TypeScript plugin is now the default for OpenCode (flag is a no-op)"
    )
    .action((opts: GenerateOptions) => {
      if (!opts.platform) {
        showPlatformListing();
        return;
      }

      const platform = opts.platform as Platform;
      if (!SUPPORTED_PLATFORMS.includes(platform)) {
        console.error(
          `Unsupported platform '${opts.platform}'. Supported: ${SUPPORTED_PLATFORMS.join(", ")}`
        );
        process.exitCode = 1; return;
      }

      switch (platform) {
        case "claude":
          generateClaudeOutput(resolveBinaryPath(), opts);
          break;
        case "opencode":
          generateOpenCodeOutput(opts);
          break;
        case "codex":
          generateCodexOutput(opts);
          break;
      }
    });

  return cmd;
}

// ─── Binary Path Resolution ─────────────────────────────────────────────

function resolveBinaryPath(): string {
  const names = process.platform === "win32"
    ? ["corgispec.cmd", "corgispec.exe", "corgispec.bat", "corgispec"]
    : ["corgispec"];
  for (const directory of (process.env["PATH"] ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = resolve(directory, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return "npx corgispec";
}

function resolveRunningCliEntry(): string {
  const cliEntry = process.argv[1] ? resolve(process.argv[1]) : "";
  if (!cliEntry || !existsSync(cliEntry)) {
    throw new Error("Cannot resolve the running CorgiSpec CLI entry for generated hooks");
  }
  return cliEntry;
}

// ─── Platform Listing ────────────────────────────────────────────────────

function showPlatformListing(): void {
  console.log("Supported platforms for hook configuration:\n");
  console.log(
    "  claude    Claude Code (.claude/settings.json → hooks key)"
  );
  console.log(
    "  opencode  OpenCode (TypeScript plugin, default)"
  );
  console.log(
    "  codex     Codex (.codex/config.toml + .codex/hooks/*.cjs wrappers)"
  );
  console.log(
    "\nUsage: corgispec hooks generate --platform <name> [--output <path>] [--force] [--deep]"
  );
}

// ─── Claude Code Config ──────────────────────────────────────────────────

export function buildClaudeConfig(
  binaryPath: string
): Record<string, unknown> {
  const binaryCommand = binaryPath === "npx corgispec"
    ? binaryPath
    : `"${binaryPath.replaceAll('"', '\\"')}"`;
  return {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume",
          hooks: [
            {
              type: "command",
              command: `${binaryCommand} hook session-start`,
              timeout: 10,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: `${binaryCommand} hook pre-bash`,
              timeout: 10,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [
            {
              type: "command",
              command: `${binaryCommand} hook post-write`,
              timeout: 30,
              runInBackground: true,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `${binaryCommand} hook loop-check`,
              timeout: 30,
            },
          ],
        },
      ],
      PostCompact: [
        {
          hooks: [
            {
              type: "command",
              command: `${binaryCommand} hook post-compact`,
              timeout: 10,
            },
          ],
        },
      ],
    },
  };
}

function generateClaudeOutput(
  binaryPath: string,
  opts: GenerateOptions
): void {
  const config = buildClaudeConfig(binaryPath);
  const json = JSON.stringify(config, null, 2) + "\n";

  if (!opts.output) {
    process.stdout.write(json);
    return;
  }

  const outputPath = resolve(opts.output);

  if (existsSync(outputPath)) {
    const existing = JSON.parse(readFileSync(outputPath, "utf-8"));

    if (existing.hooks && !opts.force) {
      console.error(
        `Error: ${outputPath} already contains a 'hooks' key. Use --force to overwrite.`
      );
      process.exitCode = 1; return;
    }

    const merged = { ...existing, ...config };
    writeFileSync(outputPath, JSON.stringify(merged, null, 2) + "\n");
    console.log(`Merged hooks configuration into ${outputPath}`);
  } else {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, json);
    console.log(`Wrote hooks configuration to ${outputPath}`);
  }
}

// ─── OpenCode Config ─────────────────────────────────────────────────────

/**
 * OpenCode Plugin API — tool.execute.before argument shapes
 * =========================================================
 *
 * The plugin hook signature (from @opencode-ai/plugin):
 *   "tool.execute.before"?: (
 *     input: { tool: string; sessionID: string; callID: string },
 *     output: { args: any },
 *   ) => Promise<void>
 *
 * `output.args` contains the tool-specific parameters as defined by each
 * built-in tool's Effect Schema. The field names are:
 *
 * **Write tool** (tool === "write"):
 *   output.args = {
 *     filePath: string   // absolute path to the file to write
 *   }
 *
 * **Bash/Shell tool** (tool === "bash"):
 *   output.args = {
 *     command: string             // the shell command to execute
 *     timeout?: number            // optional timeout in ms
 *     workdir?: string            // optional working directory (defaults to cwd)
 *   }
 *
 * **Edit tool** (tool === "edit"):
 *   output.args = {
 *     filePath: string   // absolute path to the file to edit
 *     oldString: string  // text to find
 *     newString: string  // replacement text
 *   }
 *
 * Mapping to our HookInput (hooks.ts:23-31):
 *   HookInput.tool_input.file_path  ← output.args.filePath  (write/edit)
 *   HookInput.tool_input.command    ← output.args.command   (bash)
 *
 * NOTE: OpenCode uses camelCase (`filePath`), while Claude Code uses
 * snake_case (`file_path`). The CLI hooks read the snake_case form from
 * stdin because Claude Code is the primary bridge-format consumer.
 * For a deep plugin, access `output.args.filePath` / `output.args.command` directly.
 *
 * Sources:
 *   - https://github.com/anomalyco/opencode/blob/dev/packages/plugin/src/index.ts (L261-266)
 *   - https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/write.ts (L22)
 *   - https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/tool/shell/prompt.ts (L22-30)
 */
function generateOpenCodeOutput(
  opts: GenerateOptions
): void {
  const tsCode = buildOpenCodeDeepPlugin(resolveRunningCliEntry());
  writeOutput(tsCode, opts.output, opts.force);
}

export function buildOpenCodeDeepPlugin(
  cliEntry: string,
  nodeEntry: string = process.execPath,
): string {
  // OpenCode plugins run inside the standalone OpenCode executable, where
  // process.execPath is not Node. Capture the generator/bootstrap Node runtime.
  const nodeEntryJson = JSON.stringify(nodeEntry);
  const cliEntryJson = JSON.stringify(cliEntry);
  return `import type { Plugin } from "@opencode-ai/plugin";
import { spawnSync } from "node:child_process";

const NODE_ENTRY = ${nodeEntryJson};
const CLI_ENTRY = ${cliEntryJson};

function runHook(
  subcommand: string,
  options: { input?: string; timeout: number; passthrough?: boolean },
): string {
  const result = spawnSync(
    NODE_ENTRY,
    [CLI_ENTRY, "hook", subcommand],
    {
      input: options.input,
      encoding: "utf-8",
      timeout: options.timeout,
      windowsHide: true,
    },
  );
  if (options.passthrough && result.stdout) process.stdout.write(result.stdout);
  if (options.passthrough && result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error(\`corgispec hook \${subcommand} exited with \${String(result.status)}\`);
    Object.assign(error, { exitCode: result.status, stdout: result.stdout, stderr: result.stderr });
    throw error;
  }
  return result.stdout ?? "";
}

function buildStdinPayload(tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    tool_name: tool,
    tool_input: {
      file_path: args.filePath,
      command: args.command,
    },
  });
}

const WRITE_COMMANDS = new Set([
  "corgi-apply",
  "corgi-propose",
  "corgi-update",
  "corgi-converge",
  "corgi-archive",
  "corgi-human-qa",
]);
const STOP_COMMANDS = new Set<string>();
const WRITE_SKILLS = new Set([
  "corgispec-apply",
  "corgispec-propose",
  "corgispec-gh-propose",
  "corgispec-update",
  "corgispec-converge",
  "corgispec-archive-change",
  "corgispec-gh-archive",
  "corgispec-human-qa",
]);
const STOP_SKILLS = new Set<string>();

function buildStopPayload(event: unknown): string {
  const record = event && typeof event === "object" ? event as Record<string, any> : {};
  const properties = record.properties && typeof record.properties === "object"
    ? record.properties as Record<string, any>
    : {};
  const sessionId = properties.sessionID ?? properties.sessionId ?? properties.info?.id
    ?? record.sessionID ?? record.sessionId ?? "";
  return JSON.stringify({
    hook_event_name: "Stop",
    stop_hook_active: false,
    session_id: sessionId,
  });
}

export const CorgiSpecDeep: Plugin = async ({ client, directory }) => {
  const continuationPending = new Set<string>();
  const activationBySession = new Map<string, { write: boolean; stop: boolean }>();
  const activate = (sessionId: string, write: boolean, stop: boolean): void => {
    if (!sessionId) return;
    const current = activationBySession.get(sessionId) ?? { write: false, stop: false };
    activationBySession.set(sessionId, {
      write: current.write || write,
      stop: current.stop || stop,
    });
  };
  const requestContinuation = (sessionId: string, text: string): void => {
    if (!sessionId || continuationPending.has(sessionId)) return;
    continuationPending.add(sessionId);
    void client.session.promptAsync({
      path: { id: sessionId },
      query: { directory },
      body: { parts: [{ type: "text", text }] },
    }).then((result) => {
      if (result.error) {
        process.stderr.write("[corgispec opencode] continuation request failed\\n");
      }
    }).catch((error: unknown) => {
      process.stderr.write("[corgispec opencode] continuation request failed: "
        + (error instanceof Error ? error.message : String(error)) + "\\n");
    }).finally(() => {
      continuationPending.delete(sessionId);
    });
  };
  const hookFailureMessage = (subcommand: string, error: unknown): string => {
    const failure = error as Error & {
      exitCode?: number | null;
      stdout?: string;
      stderr?: string;
    };
    return [
      "CorgiSpec prevented this session from being considered complete.",
      "Run the required canonical CLI action, then continue the task.",
      "Hook: " + subcommand,
      "Exit code: " + String(failure.exitCode ?? "unknown"),
      failure.stderr ? "stderr: " + failure.stderr.trim() : "",
      failure.stdout ? "stdout: " + failure.stdout.trim() : "",
    ].filter(Boolean).join("\\n");
  };
  return {
    "chat.message": async (input, _output) => {
      activationBySession.delete(input.sessionID);
    },
    "command.execute.before": async (input, _output) => {
      const command = input.command.replace(/^\\/+/, "");
      activate(
        input.sessionID,
        WRITE_COMMANDS.has(command),
        STOP_COMMANDS.has(command),
      );
    },
    "experimental.chat.system.transform": async (_input, output) => {
      try {
        const ctx = runHook("session-start", { timeout: 10_000 });
        const parsed = JSON.parse(ctx);
        if (parsed.hookSpecificOutput?.additionalContext) {
          output.system.push(parsed.hookSpecificOutput.additionalContext);
        }
      } catch {
        // Context injection is optional — skip on failure
      }
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool === "skill" && typeof output.args.name === "string") {
        const skill = output.args.name;
        activate(
          input.sessionID,
          WRITE_SKILLS.has(skill),
          STOP_SKILLS.has(skill),
        );
      }
      const payload = buildStdinPayload(input.tool, output.args);
      if (
        (input.tool === "write" || input.tool === "edit")
        && activationBySession.get(input.sessionID)?.write === true
      ) {
        runHook("pre-write", { input: payload, timeout: 5_000, passthrough: true });
      }
      if (input.tool === "bash") {
        runHook("pre-bash", { input: payload, timeout: 5_000, passthrough: true });
      }
    },
    "tool.execute.after": async (input, _output) => {
      if (input.tool !== "write" && input.tool !== "edit") return;
      try {
        const payload = buildStdinPayload(input.tool, input.args);
        runHook("post-write", { input: payload, timeout: 10_000 });
      } catch {
        // Post-write validation is non-blocking
      }
    },
    // session.idle (agent finished responding) — not session.deleted (explicit teardown, too late for loop-check).
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        const payload = buildStopPayload(event);
        const sessionId = String(JSON.parse(payload).session_id ?? "");
        if (activationBySession.get(sessionId)?.stop === true) {
          try {
            runHook("stop-check", { input: payload, timeout: 10_000, passthrough: true });
          } catch (error) {
            // OpenCode's event hook is fire-and-forget, so throwing cannot block
            // session.idle. Use its supported async prompt API to re-enter.
            requestContinuation(sessionId, hookFailureMessage("stop-check", error));
            return;
          }
        }
        try {
          const loopResult = runHook("loop-check", {
            input: payload,
            timeout: 15_000,
            passthrough: true,
          });
          const loopDecision = JSON.parse(loopResult) as {
            decision?: string;
            reason?: string;
            changeName?: string;
            runId?: string;
            action?: unknown;
          };
          if (loopDecision.decision === "block") {
            requestContinuation(
              sessionId,
              "CorgiSpec Run Contract v2 is still active. Continue with the canonical action:\\n"
                + JSON.stringify(loopDecision),
            );
          }
        } catch (error) {
          requestContinuation(sessionId, hookFailureMessage("loop-check", error));
        }
      }
      if (event.type === "session.deleted") {
        const payload = buildStopPayload(event);
        const sessionId = String(JSON.parse(payload).session_id ?? "");
        activationBySession.delete(sessionId);
        continuationPending.delete(sessionId);
      }
      if (event.type === "session.compacted") {
        try {
          runHook("post-compact", { timeout: 10_000 });
        } catch {
          // Post-compact recovery is non-blocking
        }
      }
    },
  };
};
`;
}

// ─── Codex Config ────────────────────────────────────────────────────────

export const HOOK_EVENTS = [
  {
    event: "SessionStart",
    subcommand: "session-start",
    matcher: "startup|resume",
    timeout: 10,
    async: true,
  },
  {
    event: "PreToolUse",
    subcommand: "pre-bash",
    matcher: "^Bash$",
    timeout: 10,
    async: false,
  },
  {
    event: "PostToolUse",
    subcommand: "post-write",
    matcher: "^(Edit|Write|apply_patch)$",
    timeout: 30,
    async: true,
  },
  {
    event: "Stop",
    subcommand: "loop-check",
    matcher: null,
    timeout: 30,
    async: false,
  },
  {
    event: "PostCompact",
    subcommand: "post-compact",
    matcher: null,
    timeout: 10,
    async: false,
  },
] as const;

export function buildCodexToml(): string {
  const lines: string[] = ["[features]", "hooks = true", ""];

  for (const hook of HOOK_EVENTS) {
    const scriptName = `corgispec_${hook.subcommand.replace(/-/g, "_")}`;
    lines.push(`# CorgiSpec: ${hook.subcommand}`);
    lines.push(`[[hooks.${hook.event}]]`);
    if (hook.matcher) {
      lines.push(`matcher = "${hook.matcher}"`);
    }
    lines.push("");
    lines.push(`[[hooks.${hook.event}.hooks]]`);
    lines.push(`type = "command"`);
    lines.push(
      `command = 'node "\${HOME}/.codex/hooks/${scriptName}.cjs"'`
    );
    lines.push(
      `commandWindows = 'node "%USERPROFILE%\\.codex\\hooks\\${scriptName}.cjs"'`
    );
    lines.push(`timeout = ${hook.timeout}`);
    if (hook.async) {
      lines.push("async = true");
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function buildNodeWrapper(
  subcommand: string,
  cliEntry: string,
): string {
  const cliEntryJson = JSON.stringify(cliEntry);
  return `#!/usr/bin/env node
"use strict";
const { spawnSync } = require("node:child_process");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  // Invoke the resolved JavaScript entry with the Node executable that is
  // already running this wrapper. This is shell-free and avoids Windows npm
  // .cmd/.bat shims, which child_process cannot execute directly without a shell.
  const result = spawnSync(process.execPath, [${cliEntryJson}, "hook", "${subcommand}"], {
    input,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    process.stderr.write(result.error.message);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
});
`;
}

function generateCodexOutput(
  opts: GenerateOptions
): void {
  const cliEntry = resolveRunningCliEntry();
  if (!opts.output) {
    const toml = buildCodexToml();
    console.log("=== .codex/config.toml ===");
    process.stdout.write(toml);
    console.log("");
    for (const hook of HOOK_EVENTS) {
      const scriptName = `corgispec_${hook.subcommand.replace(/-/g, "_")}`;
      console.log(`=== .codex/hooks/${scriptName}.cjs ===`);
      process.stdout.write(buildNodeWrapper(hook.subcommand, cliEntry));
      console.log("");
    }
    return;
  }

  const outputDir = resolve(opts.output);
  const configTomlPath = resolve(outputDir, "config.toml");
  const hooksDir = resolve(outputDir, "hooks");

  if (existsSync(configTomlPath) && !opts.force) {
    console.error(
      `Error: ${configTomlPath} already exists. Use --force to overwrite.`
    );
    process.exitCode = 1; return;
  }

  mkdirSync(hooksDir, { recursive: true });

  const toml = buildCodexToml();
  writeFileSync(configTomlPath, toml);
  console.log(`Wrote ${configTomlPath}`);

  for (const hook of HOOK_EVENTS) {
    const scriptName = `corgispec_${hook.subcommand.replace(/-/g, "_")}`;
    const scriptPath = resolve(hooksDir, `${scriptName}.cjs`);
    const code = buildNodeWrapper(hook.subcommand, cliEntry);
    writeFileSync(scriptPath, code);
    console.log(`Wrote ${scriptPath}`);
  }
}

// ─── Shared Output Helper ────────────────────────────────────────────────

function writeOutput(
  content: string,
  outputPath: string | undefined,
  force: boolean | undefined
): void {
  if (!outputPath) {
    process.stdout.write(content);
    return;
  }

  const resolved = resolve(outputPath);

  if (existsSync(resolved) && !force) {
    console.error(
      `Error: ${resolved} already exists. Use --force to overwrite.`
    );
    process.exitCode = 1; return;
  }

  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, content);
  console.log(`Wrote hooks configuration to ${resolved}`);
}
