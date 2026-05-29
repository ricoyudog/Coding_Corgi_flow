import { Command } from "commander";
import { resolve } from "node:path";
import {
  isHooksDisabled,
  findProjectRoot,
  readStdinJson,
  checkDangerousCommand,
} from "../../lib/hooks.js";

export function createHookPreBashCommand(): Command {
  const cmd = new Command("pre-bash");

  cmd
    .description("Detect dangerous bash commands (PreToolUse hook for Bash)")
    .option("--path <dir>", "Working directory", ".")
    .action(async (opts) => {
      if (isHooksDisabled()) {
        process.stdout.write(JSON.stringify({ continue: true }));
        process.exit(0);
      }

      const cwd = resolve(opts.path);
      const projectRoot = findProjectRoot(cwd);

      if (!projectRoot) {
        process.stdout.write(JSON.stringify({ continue: true }));
        process.exit(0);
      }

      const input = await readStdinJson();
      const command = input.tool_input?.command;

      if (!command) {
        process.stdout.write(JSON.stringify({ continue: true }));
        process.exit(0);
      }

      const rejection = checkDangerousCommand(command);
      if (rejection) {
        process.stderr.write(rejection);
        process.exit(2);
      }

      process.stdout.write(JSON.stringify({ continue: true }));
      process.exit(0);
    });

  return cmd;
}
