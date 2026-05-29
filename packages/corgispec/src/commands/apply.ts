import { Command } from "commander";
import { resolve } from "node:path";
import { resolveApplyInstruction } from "../lib/instructions.js";
import { getChangeInfo, discoverChanges } from "../lib/changes.js";

export function createApplyCommand(): Command {
  const cmd = new Command("apply");

  cmd
    .description("Output instructions for implementing the next task group")
    .argument("[name]", "Change name")
    .option("--json", "Output as JSON")
    .option("--path <dir>", "Working directory", ".")
    .action(async (name: string | undefined, opts) => {
      const cwd = resolve(opts.path);

      try {
        // Auto-select if no name provided and only one change exists
        let changeName = name;
        if (!changeName) {
          const changes = discoverChanges(cwd);
          if (changes.length === 0) {
            console.error(
              "Error: No changes found. Run `corgispec propose` first."
            );
            process.exitCode = 1;
            return;
          }
          if (changes.length === 1) {
            changeName = changes[0];
          } else {
            console.error(
              "Error: Multiple changes exist. Specify a name: corgispec apply <name>"
            );
            process.exitCode = 1;
            return;
          }
        }

        const result = resolveApplyInstruction(cwd, changeName);

        if (result.state === "all_done" || result.currentGroup === null) {
          if (opts.json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            console.log(
              "All task groups complete. Run `corgispec review` next."
            );
          }
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const group = result.currentGroup;
          console.log(`Change: ${result.changeName}`);
          console.log(
            `Group ${group.number}: ${group.name} (${group.completedTasks}/${group.totalTasks} tasks)`
          );
          console.log("");
          console.log(result.instruction);

          if (result.contextFiles.length > 0) {
            console.log("");
            console.log("Context files:");
            for (const file of result.contextFiles) {
              console.log(`  - ${file}`);
            }
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ error: msg }, null, 2));
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exitCode = 1;
      }
    });

  return cmd;
}
