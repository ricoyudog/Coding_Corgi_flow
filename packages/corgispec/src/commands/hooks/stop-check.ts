import { Command } from "commander";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isHooksDisabled,
  findProjectRoot,
  readStdinJson,
  checkTaskGroupPostconditions,
  resolveHookChanges,
  type HookPlanningDependencies,
} from "../../lib/hooks.js";
import { loadConfigFromDir } from "../../lib/config.js";

export function createHookStopCheckCommand(
  dependencies: HookPlanningDependencies = {},
): Command {
  const cmd = new Command("stop-check");

  cmd
    .description("Verify Task Group postconditions before stop (Stop hook)")
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
        await readStdinJson();

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
                const state = JSON.parse(raw) as { active?: unknown };
                if (state.active === true) {
                  // Loop is active — skip stop-check, let loop-check handle it
                  process.exitCode = 0; return;
                }
              }
            } catch { /* legacy state is advisory here; loop-check owns validation */ }
          }
        }

        const config = loadConfigFromDir(projectRoot);
        const changes = await resolveHookChanges(
          projectRoot,
          config,
          { store: opts.store },
          dependencies,
        );

        for (const change of changes) {
          const failures = checkTaskGroupPostconditions(change.taskSummary);
          if (failures) {
            process.stderr.write(failures.join("\n"));
            process.exitCode = 2; return;
          }
        }

        process.exitCode = 0;
      } catch (error) {
        process.stderr.write(`[stop-check] ${errorMessage(error)}\n`);
        process.exitCode = 2;
      }
    });

  return cmd;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
