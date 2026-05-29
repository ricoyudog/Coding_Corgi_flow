import { Command } from "commander";
import { resolve } from "node:path";
import {
  isHooksDisabled,
  findProjectRoot,
  readStdinJson,
  validateWriteTarget,
} from "../../lib/hooks.js";
import { loadConfig } from "../../lib/config.js";
import { findConfigPath } from "../../lib/config.js";

export function createHookPreWriteCommand(): Command {
  const cmd = new Command("pre-write");

  cmd
    .description("Validate file write target (PreToolUse hook for Write/Edit)")
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

      const configPath = findConfigPath(projectRoot);
      if (!configPath) {
        process.stdout.write(JSON.stringify({ continue: true }));
        process.exit(0);
      }

      let config;
      try {
        config = loadConfig(configPath);
      } catch {
        process.stdout.write(JSON.stringify({ continue: true }));
        process.exit(0);
      }

      const input = await readStdinJson();
      const filePath = input.tool_input?.file_path;

      if (!filePath) {
        process.stdout.write(JSON.stringify({ continue: true }));
        process.exit(0);
      }

      const rejection = validateWriteTarget(filePath, projectRoot, config);
      if (rejection) {
        process.stderr.write(rejection);
        process.exit(2);
      }

      process.stdout.write(JSON.stringify({ continue: true }));
      process.exit(0);
    });

  return cmd;
}
