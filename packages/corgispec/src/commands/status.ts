import { Command } from "commander";
import { resolve } from "node:path";
import { discoverChanges, getChangeInfo } from "../lib/changes.js";

export function createStatusCommand(): Command {
  const cmd = new Command("status");

  cmd
    .description("Show artifact completion state for a Corgi change")
    .argument("[name]", "Change name (auto-selects if only one exists)")
    .option("--json", "Output as JSON")
    .option("--path <dir>", "Working directory", ".")
    .action(async (name: string | undefined, opts) => {
      const cwd = resolve(opts.path);

      try {
        let changeName = name;

        if (!changeName) {
          const changes = discoverChanges(cwd);
          if (changes.length === 0) {
            console.error("Error: No changes found.");
            process.exit(1);
          }
          if (changes.length > 1) {
            console.error(
              "Error: Multiple changes found. Specify one:\n" +
                changes.map((c) => `  - ${c}`).join("\n")
            );
            process.exit(1);
          }
          changeName = changes[0];
        }

        const info = getChangeInfo(cwd, changeName);

        if (opts.json) {
          const output = {
            changeName: info.name,
            schemaName: info.schemaName,
            state: info.state,
            isComplete: info.isComplete,
            artifacts: info.artifacts,
            taskGroups: info.taskGroups,
          };
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        // Human-readable output
        console.log(`Change: ${info.name} (state: ${info.state})`);
        console.log(`Schema: ${info.schemaName}`);
        console.log();

        // Artifacts
        console.log("Artifacts:");
        for (const a of info.artifacts) {
          let icon: string;
          if (a.exists) {
            icon = "✓";
          } else if (a.blocked) {
            icon = "✗";
          } else if (a.ready) {
            icon = "○";
          } else {
            icon = "○";
          }
          let suffix = "";
          if (a.blocked && a.blockedBy.length > 0) {
            suffix = ` (blocked by: ${a.blockedBy.join(", ")})`;
          }
          console.log(`  ${icon} ${a.id} — ${a.description}${suffix}`);
        }
        console.log();

        // Task groups
        if (info.taskGroups.length > 0) {
          console.log("Task Groups:");
          for (const tg of info.taskGroups) {
            const pct =
              tg.totalTasks > 0
                ? Math.round((tg.completedTasks / tg.totalTasks) * 100)
                : 0;
            console.log(
              `  ${tg.number}. ${tg.name}  ${tg.completedTasks}/${tg.totalTasks} (${pct}%)  [${tg.status}]`
            );
          }
          console.log();
        }

        // Overall
        const overallPct =
          info.totalTasks > 0
            ? Math.round((info.completedTasks / info.totalTasks) * 100)
            : 0;
        console.log(
          `Overall: ${info.completedTasks}/${info.totalTasks} tasks (${overallPct}%) — ${info.isComplete ? "complete" : "in progress"}`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    });

  return cmd;
}
