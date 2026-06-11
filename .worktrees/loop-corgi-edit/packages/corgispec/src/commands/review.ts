import { Command } from "commander";
import { resolve } from "node:path";
import { resolveReviewInstruction } from "../lib/instructions.js";
import { discoverChanges } from "../lib/changes.js";

export function createReviewCommand(): Command {
  const cmd = new Command("review");

  cmd
    .description("Output review checklist instructions for a change")
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
            process.exitCode = 1; return;
          }
          if (changes.length > 1) {
            console.error(
              "Error: Multiple changes found. Specify one:\n" +
                changes.map((c) => `  - ${c}`).join("\n")
            );
            process.exitCode = 1; return;
          }
          changeName = changes[0];
        }

        const review = resolveReviewInstruction(cwd, changeName);

        if (review.completedGroups.length === 0) {
          console.log(
            "No completed task groups to review. Run `corgispec apply` first."
          );
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(review, null, 2));
          return;
        }

        // Human-readable output
        console.log(`Review: ${review.changeName}`);
        console.log(`State: ${review.state}`);
        console.log(
          `Completed groups: ${review.completedGroups.map((g) => g.name).join(", ")}`
        );
        console.log();
        console.log(review.instruction);
        console.log();
        console.log("Context files:");
        for (const f of review.contextFiles) {
          console.log(`  - ${f}`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1; return;
      }
    });

  return cmd;
}
