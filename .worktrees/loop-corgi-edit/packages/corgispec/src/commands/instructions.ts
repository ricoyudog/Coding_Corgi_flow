import { Command } from "commander";
import { resolve } from "node:path";
import { resolveArtifactInstruction } from "../lib/instructions.js";

export function createInstructionsCommand(): Command {
  const cmd = new Command("instructions");

  cmd
    .description("Output enriched artifact instructions as JSON for AI assistants")
    .argument("<artifact-id>", "The artifact identifier to resolve")
    .requiredOption("--change <name>", "Change name to resolve instructions for")
    .option("--path <dir>", "Working directory", ".")
    .option("--json", "Output as JSON (default behavior)")
    .action((artifactId: string, opts) => {
      const cwd = resolve(opts.path);

      try {
        const instruction = resolveArtifactInstruction(cwd, opts.change, artifactId);
        console.log(JSON.stringify(instruction, null, 2));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(message);
        process.exitCode = 1; return;
      }
    });

  return cmd;
}
