import { Command } from "commander";
import { resolve, dirname } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";

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

      const binaryPath = resolveBinaryPath();

      switch (platform) {
        case "claude":
          generateClaudeOutput(binaryPath, opts);
          break;
        case "opencode":
          generateOpenCodeOutput(binaryPath, opts);
          break;
        case "codex":
          generateCodexOutput(binaryPath, opts);
          break;
      }
    });

  return cmd;
}

// ─── Binary Path Resolution ─────────────────────────────────────────────

function resolveBinaryPath(): string {
  try {
    const path = execSync("which corgispec", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (path && existsSync(path)) return path;
  } catch (err: unknown) {
    console.error(`[generate] corgispec not found in PATH: ${err instanceof Error ? err.message : String(err)}`);
  }
  return "npx corgispec";
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
    "  codex     Codex (.codex/config.toml + .codex/hooks/*.py wrappers)"
  );
  console.log(
    "\nUsage: corgispec hooks generate --platform <name> [--output <path>] [--force] [--deep]"
  );
}

// ─── Claude Code Config ──────────────────────────────────────────────────

function buildClaudeConfig(
  binaryPath: string
): Record<string, unknown> {
  return {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume",
          hooks: [
            {
              type: "command",
              command: `${binaryPath} hook session-start`,
              timeout: 10,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "Edit|Write",
          hooks: [
            {
              type: "command",
              command: `${binaryPath} hook pre-write`,
              timeout: 15,
            },
          ],
        },
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: `${binaryPath} hook pre-bash`,
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
              command: `${binaryPath} hook post-write`,
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
              command: `${binaryPath} hook stop-check`,
              timeout: 15,
            },
          ],
        },
        {
          hooks: [
            {
              type: "command",
              command: `${binaryPath} hook loop-check`,
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
              command: `${binaryPath} hook post-compact`,
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
  binaryPath: string,
  opts: GenerateOptions
): void {
  const tsCode = buildOpenCodeDeepPlugin(binaryPath);
  writeOutput(tsCode, opts.output, opts.force);
}

function buildOpenCodeDeepPlugin(binaryPath: string): string {
  return `import type { Plugin } from "@opencode-ai/plugin";
import { execSync } from "node:child_process";

const BINARY = "${binaryPath}";

function buildStdinPayload(tool: string, args: Record<string, unknown>): string {
  return JSON.stringify({
    tool_name: tool,
    tool_input: {
      file_path: args.filePath,
      command: args.command,
    },
  });
}

export const CorgiSpecDeep: Plugin = async () => {
  return {
    "experimental.chat.system.transform": async ({ output }) => {
      try {
        const ctx = execSync(BINARY + " hook session-start", {
          encoding: "utf-8",
          timeout: 10_000,
        });
        const parsed = JSON.parse(ctx);
        if (parsed.hookSpecificOutput?.additionalContext) {
          output.system.push(parsed.hookSpecificOutput.additionalContext);
        }
      } catch {
        // Context injection is optional — skip on failure
      }
    },
    "tool.execute.before": async (input, output) => {
      const payload = buildStdinPayload(input.tool, output.args);
      if (input.tool === "write" || input.tool === "edit") {
        execSync(BINARY + " hook pre-write", { input: payload, encoding: "utf-8", timeout: 5000 });
      }
      if (input.tool === "bash") {
        execSync(BINARY + " hook pre-bash", { input: payload, encoding: "utf-8", timeout: 5000 });
      }
    },
    "tool.execute.after": async (input, output) => {
      if (input.tool !== "write" && input.tool !== "edit") return;
      try {
        const payload = buildStdinPayload(input.tool, output.args);
        execSync(BINARY + " hook post-write", { input: payload, encoding: "utf-8", timeout: 10000 });
      } catch {
        // Post-write validation is non-blocking
      }
    },
    // session.idle (agent finished responding) — not session.deleted (explicit teardown, too late for loop-check).
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        try {
          execSync(BINARY + " hook stop-check", { encoding: "utf-8", timeout: 10000 });
        } catch {
          // Stop validation is non-blocking
        }
        try {
          execSync(BINARY + " hook loop-check", { encoding: "utf-8", timeout: 15000 });
        } catch {
          // Loop check is non-blocking
        }
      }
      if (event.type === "session.compacted") {
        try {
          execSync(BINARY + " hook post-compact", { encoding: "utf-8", timeout: 10000 });
        } catch {
          // Post-compact recovery is non-blocking
        }
      }
    },
  };
};
`;
}

function buildExecHookBlock(cmd: string, timeout: number): string {
  return `      try {
        execSync("${cmd}", { encoding: "utf-8", timeout: ${timeout}_000 });
      } catch {
        // Hook execution is best-effort
      }`;
}

// ─── Codex Config ────────────────────────────────────────────────────────

const HOOK_EVENTS = [
  {
    event: "SessionStart",
    subcommand: "session-start",
    matcher: "startup|resume",
    timeout: 10,
    async: true,
  },
  {
    event: "PreToolUse",
    subcommand: "pre-write",
    matcher: "^(Edit|Write|apply_patch)$",
    timeout: 15,
    async: false,
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
    subcommand: "stop-check",
    matcher: null,
    timeout: 15,
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

function buildCodexToml(binaryPath: string): string {
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
      `command = 'python3 "\${HOME}/.codex/hooks/${scriptName}.py"'`
    );
    lines.push(
      `commandWindows = 'python3 "%USERPROFILE%\\.codex\\hooks\\${scriptName}.py"'`
    );
    lines.push(`timeout = ${hook.timeout}`);
    if (hook.async) {
      lines.push("async = true");
    }
    lines.push("");
  }

  return lines.join("\n");
}

function buildPythonWrapper(
  subcommand: string,
  binaryPath: string
): string {
  const binaryParts = binaryPath.split(/\s+/);
  const binaryArgs = binaryParts.map((p) => `"${p}"`).join(", ");
  return `#!/usr/bin/env python3
"""CorgiSpec hook: ${subcommand}"""
import subprocess, sys

def main():
    input_data = sys.stdin.read()
    result = subprocess.run(
        [${binaryArgs}, "hook", "${subcommand}"],
        input=input_data,
        capture_output=True,
        text=True,
    )
    if result.stdout:
        sys.stdout.write(result.stdout)
    if result.stderr:
        sys.stderr.write(result.stderr)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
`;
}

function generateCodexOutput(
  binaryPath: string,
  opts: GenerateOptions
): void {
  if (!opts.output) {
    const toml = buildCodexToml(binaryPath);
    console.log("=== .codex/config.toml ===");
    process.stdout.write(toml);
    console.log("");
    for (const hook of HOOK_EVENTS) {
      const scriptName = `corgispec_${hook.subcommand.replace(/-/g, "_")}`;
      console.log(`=== .codex/hooks/${scriptName}.py ===`);
      process.stdout.write(buildPythonWrapper(hook.subcommand, binaryPath));
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

  const toml = buildCodexToml(binaryPath);
  writeFileSync(configTomlPath, toml);
  console.log(`Wrote ${configTomlPath}`);

  for (const hook of HOOK_EVENTS) {
    const scriptName = `corgispec_${hook.subcommand.replace(/-/g, "_")}`;
    const scriptPath = resolve(hooksDir, `${scriptName}.py`);
    const code = buildPythonWrapper(hook.subcommand, binaryPath);
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
