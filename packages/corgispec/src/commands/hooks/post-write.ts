import { Command } from "commander";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  isHooksDisabled,
  findProjectRoot,
  readStdinJson,
  resolveWrittenChange,
  type HookPlanningDependencies,
} from "../../lib/hooks.js";
import { loadConfigFromDir } from "../../lib/config.js";

export interface PostWriteCommandDependencies extends HookPlanningDependencies {
  triggerValidation?: (
    projectRoot: string,
    changeName: string,
    store?: string,
  ) => void;
}

export function createHookPostWriteCommand(
  dependencies: PostWriteCommandDependencies = {},
): Command {
  const cmd = new Command("post-write");
  const trigger = dependencies.triggerValidation ?? triggerValidation;

  cmd
    .description("Trigger async validation after file write (PostToolUse hook)")
    .option("--path <dir>", "Working directory", ".")
    .option("--store <id>", "OpenSpec Store id")
    .action(async (opts: { path: string; store?: string }) => {
      if (isHooksDisabled()) {
        process.exitCode = 0; return;
      }

      const cwd = resolve(opts.path);
      const projectRoot = findProjectRoot(cwd);

      if (!projectRoot) {
        process.exitCode = 0; return;
      }

      try {
        const input = await readStdinJson();
        const filePath = input.tool_input?.file_path;

        if (!filePath) {
          process.exitCode = 0; return;
        }

        const config = loadConfigFromDir(projectRoot);
        const change = await resolveWrittenChange(
          filePath,
          projectRoot,
          config,
          { store: opts.store },
          dependencies,
        );
        if (change) {
          trigger(change.commandRoot, change.name, opts.store);
        }

        process.exitCode = 0;
      } catch (error) {
        process.stderr.write(`[post-write] ${errorMessage(error)}\n`);
        process.exitCode = 2;
      }
    });

  return cmd;
}

function triggerValidation(
  projectRoot: string,
  changeName: string,
  store?: string,
): void {
  const cliEntry = process.argv[1];
  if (!cliEntry) return;
  const args = [
    cliEntry,
    "ready",
    changeName,
    "--strict",
    "--json",
    "--path",
    projectRoot,
    ...(store ? ["--store", store] : []),
  ];
  const child = spawn(process.execPath, args, {
    stdio: "ignore",
    detached: true,
  });
  // A failed detached validation must not turn the hook into an unhandled
  // child-process error. The next synchronous ready/apply gate remains the
  // canonical enforcement point.
  child.once("error", () => undefined);
  child.unref();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
