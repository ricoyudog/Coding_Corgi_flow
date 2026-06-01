import { Command } from "commander";
import { resolve } from "node:path";
import { resolveArchiveInstruction } from "../lib/instructions.js";
import { discoverChanges } from "../lib/changes.js";

export function createArchiveCommand(): Command {
  const cmd = new Command("archive")
    .description("Check completeness and output archive instructions")
    .argument("[name]", "Change name (auto-selects if only one exists)")
    .option("--json", "Output as JSON")
    .option("--path <dir>", "Working directory", ".")
    .action((name: string | undefined, opts: { json?: boolean; path: string }) => {
      try {
        const cwd = resolve(opts.path);

        let changeName = name;
        if (!changeName) {
          const changes = discoverChanges(cwd);
          if (changes.length === 1) {
            changeName = changes[0]!;
          } else if (changes.length === 0) {
            console.error("Error: No changes found.");
            process.exitCode = 1; return;
          } else {
            console.error(
              "Error: Multiple changes found. Specify one:\n" +
                changes.map((c) => `  - ${c}`).join("\n")
            );
            process.exitCode = 1; return;
          }
        }

        const result = resolveArchiveInstruction(cwd, changeName);

        if (!result.isReady) {
          console.error(result.reason ?? "Change not ready for archive");
          process.exitCode = 1; return;
        }

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Archive: ${result.changeName}\n`);
          console.log(result.instruction);
          console.log("\nContext files:");
          for (const f of result.contextFiles) {
            console.log(`  - ${f}`);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1; return;
      }
    });

  return cmd;
}
