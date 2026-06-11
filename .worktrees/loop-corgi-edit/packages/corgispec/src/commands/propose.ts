import { Command } from "commander";
import { resolve } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { resolveArtifactInstruction } from "../lib/instructions.js";
import { getChangeInfo, discoverChanges } from "../lib/changes.js";

export function createProposeCommand(): Command {
  const cmd = new Command("propose");

  cmd
    .description("Create a change directory and output proposal instructions")
    .argument("<name>", "Name of the change to propose")
    .option("--json", "Output as JSON")
    .option("--path <dir>", "Working directory", ".")
    .action((name: string, opts) => {
      const cwd = resolve(opts.path);
      const changeDir = resolve(cwd, "openspec/changes", name);
      const json = opts.json ?? false;

      try {
        // Create the change directory if it doesn't exist
        if (!existsSync(changeDir)) {
          mkdirSync(changeDir, { recursive: true });
        }

        // Get change info to determine what's needed next
        const changeInfo = getChangeInfo(cwd, name);

        // Find the next artifact that needs creation
        const nextArtifact = changeInfo.artifacts.find(
          (a) => !a.exists && !a.blocked
        );

        if (!nextArtifact) {
          // All artifacts exist
          if (json) {
            console.log(
              JSON.stringify({
                changeName: name,
                status: "complete",
                message: `All artifacts already created for '${name}'. Run \`corgispec apply\` next.`,
              })
            );
          } else {
            console.log(
              `All artifacts already created for '${name}'. Run \`corgispec apply\` next.`
            );
          }
          return;
        }

        // Resolve the instruction for the next artifact
        const instruction = resolveArtifactInstruction(
          cwd,
          name,
          nextArtifact.id
        );

        if (json) {
          console.log(JSON.stringify(instruction, null, 2));
        } else {
          console.log(`Created change: ${name}`);
          console.log(`Output: ${instruction.outputPath}`);
          console.log(`Next: Create the ${nextArtifact.id} artifact\n`);
          console.log(instruction.instruction);
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error occurred";
        if (json) {
          console.log(JSON.stringify({ error: message }));
        } else {
          console.error(`Error: ${message}`);
        }
        process.exitCode = 1;
      }
    });

  return cmd;
}
