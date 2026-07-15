import { Command } from "commander";
import { resolve } from "node:path";
import { resolveArtifactInstruction } from "../lib/instructions.js";
import { createOpenSpecAdapter, type OpenSpecAdapter } from "../lib/openspec-adapter.js";
import { createArtifactResolver, type ArtifactResolver } from "../lib/artifact-resolver.js";
import { lifecycleError } from "../lib/lifecycle.js";

export interface InstructionsCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
}

export function createInstructionsCommand(
  dependencies: InstructionsCommandDependencies = {},
): Command {
  const cmd = new Command("instructions");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));

  cmd
    .description("Output enriched artifact instructions as JSON for AI assistants")
    .argument("<artifact-id>", "The artifact identifier to resolve")
    .requiredOption("--change <name>", "Change name to resolve instructions for")
    .option("--path <dir>", "Working directory", ".")
    .option("--store <id>", "OpenSpec Store id")
    .option("--json", "Output as JSON (default behavior)")
    .action(async (artifactId: string, opts) => {
      const cwd = resolve(opts.path);

      try {
        const adapter = adapterFactory(cwd);
        const instruction = await resolveArtifactInstruction(
          cwd,
          opts.change,
          artifactId,
          { store: opts.store },
          { adapter, resolver: resolverFactory(adapter) },
        );
        console.log(JSON.stringify(instruction, null, 2));
      } catch (err: unknown) {
        const failure = lifecycleError(err);
        if (opts.json) console.log(JSON.stringify({ status: "contract_error", error: failure }, null, 2));
        else console.error(failure.message);
        process.exitCode = 1; return;
      }
    });

  return cmd;
}
