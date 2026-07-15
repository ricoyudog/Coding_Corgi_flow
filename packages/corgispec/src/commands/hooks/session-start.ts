import { Command } from "commander";
import { resolve } from "node:path";
import {
  isHooksDisabled,
  findProjectRoot,
  gatherSessionContext,
  formatHookOutput,
  type HookPlanningDependencies,
} from "../../lib/hooks.js";

export function createHookSessionStartCommand(
  dependencies: HookPlanningDependencies = {},
): Command {
  const cmd = new Command("session-start");

  cmd
    .description("Output project context JSON for SessionStart hook")
    .option("--path <dir>", "Working directory", ".")
    .option("--store <id>", "OpenSpec Store id")
    .action(async (opts: { path: string; store?: string }) => {
      if (isHooksDisabled()) {
        process.exitCode = 1; return;
      }

      const cwd = resolve(opts.path);
      const projectRoot = findProjectRoot(cwd);
      if (!projectRoot) {
        process.exitCode = 1; return;
      }

      try {
        const ctx = await gatherSessionContext(
          projectRoot,
          { store: opts.store },
          dependencies,
        );
        if (!ctx) {
          process.exitCode = 1; return;
        }

        process.stdout.write(formatHookOutput("SessionStart", ctx));
        process.exitCode = 0;
      } catch (error) {
        process.stderr.write(`[session-start] ${errorMessage(error)}\n`);
        process.exitCode = 2;
      }
    });

  return cmd;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
