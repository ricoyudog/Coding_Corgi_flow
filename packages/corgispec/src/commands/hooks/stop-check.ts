import { Command } from "commander";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

      // Check for active loop state — if any loop is running, defer to loop-check hook
      const loopStateDirs = [".claude/corgi-loop", ".opencode/corgi-loop"];
      for (const dir of loopStateDirs) {
        const loopDir = resolve(projectRoot, dir);
        if (existsSync(loopDir)) {
          try {
            const entries = readdirSync(loopDir, { withFileTypes: true });
            for (const entry of entries) {
              if (!entry.isDirectory()) continue;
              const statePath = resolve(loopDir, entry.name, "state.json");
              if (!existsSync(statePath)) continue;
              const raw = readFileSync(statePath, "utf-8");
              const state = JSON.parse(raw);
              if (state.active === true) {
                // Loop is active — skip stop-check, let loop-check handle it
                process.exit(0);
              }
            }
          } catch { /* ignore parse errors, fall through */ }
        }
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
