import { Command } from "commander";
import { resolve } from "node:path";
import {
  isHooksDisabled,
  findProjectRoot,
  readStdinJson,
  checkTaskGroupPostconditions,
} from "../../lib/hooks.js";
import { discoverChanges } from "../../lib/changes.js";

export function createHookStopCheckCommand(): Command {
  const cmd = new Command("stop-check");

  cmd
    .description("Verify Task Group postconditions before stop (Stop hook)")
    .option("--path <dir>", "Working directory", ".")
    .action(async (opts) => {
      if (isHooksDisabled()) {
        process.exit(0);
      }

      const cwd = resolve(opts.path);
      const projectRoot = findProjectRoot(cwd);

      if (!projectRoot) {
        process.exit(0);
      }

      await readStdinJson();

      const changes = discoverChanges(projectRoot);
      if (changes.length === 0) {
        process.exit(0);
      }

      for (const changeName of changes) {
        const failures = checkTaskGroupPostconditions(projectRoot, changeName);
        if (failures) {
          process.stderr.write(failures.join("\n"));
          process.exit(2);
        }
      }

      process.exit(0);
    });

  return cmd;
}
