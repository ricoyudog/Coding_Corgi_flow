import { Command } from "commander";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  isHooksDisabled,
  findProjectRoot,
  readStdinJson,
} from "../../lib/hooks.js";

export function createHookPostWriteCommand(): Command {
  const cmd = new Command("post-write");

  cmd
    .description("Trigger async validation after file write (PostToolUse hook)")
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

      const input = await readStdinJson();
      const filePath = input.tool_input?.file_path;

      if (filePath && isInChangeDirectory(filePath, projectRoot)) {
        triggerValidation(projectRoot);
      }

      process.exit(0);
    });

  return cmd;
}

function isInChangeDirectory(filePath: string, projectRoot: string): boolean {
  const normalized = resolve(projectRoot, filePath);
  const changesDir = resolve(projectRoot, "openspec/changes");
  return normalized.startsWith(changesDir + "/") || normalized.startsWith(changesDir + "\\");
}

function triggerValidation(projectRoot: string): void {
  const child = spawn("corgispec", ["validate", "--path", projectRoot], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();
}
