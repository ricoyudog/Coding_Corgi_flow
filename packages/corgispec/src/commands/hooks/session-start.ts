import { Command } from "commander";
import { resolve } from "node:path";
import {
  isHooksDisabled,
  findProjectRoot,
  gatherSessionContext,
  formatHookOutput,
} from "../../lib/hooks.js";

export function createHookSessionStartCommand(): Command {
  const cmd = new Command("session-start");

  cmd
    .description("Output project context JSON for SessionStart hook")
    .option("--path <dir>", "Working directory", ".")
    .action(async (opts) => {
      if (isHooksDisabled()) {
        process.exitCode = 1; return;
      }

      const cwd = resolve(opts.path);
      const projectRoot = findProjectRoot(cwd);
      if (!projectRoot) {
        process.exitCode = 1; return;
      }

      const ctx = gatherSessionContext(projectRoot);
      if (!ctx) {
        process.exitCode = 1; return;
      }

      process.stdout.write(formatHookOutput("SessionStart", ctx));
      process.exit(0);
    });

  return cmd;
}
