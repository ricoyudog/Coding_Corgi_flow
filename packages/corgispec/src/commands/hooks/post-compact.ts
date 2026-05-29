import { Command } from "commander";
import { resolve } from "node:path";
import {
  isHooksDisabled,
  findProjectRoot,
  gatherSessionContext,
  formatHookOutput,
} from "../../lib/hooks.js";

export function createHookPostCompactCommand(): Command {
  const cmd = new Command("post-compact");

  cmd
    .description("Re-emit session context after compaction")
    .option("--path <dir>", "Working directory", ".")
    .action(async (opts) => {
      if (isHooksDisabled()) {
        process.exit(1);
      }

      const cwd = resolve(opts.path);
      const projectRoot = findProjectRoot(cwd);
      if (!projectRoot) {
        process.exit(1);
      }

      const ctx = gatherSessionContext(projectRoot);
      if (!ctx) {
        process.exit(1);
      }

      process.stdout.write(formatHookOutput("PostCompact", ctx));
      process.exit(0);
    });

  return cmd;
}
