import { Command } from "commander";
import { resolve } from "node:path";
import {
  createArtifactResolver,
  type ArtifactResolver,
} from "../lib/artifact-resolver.js";
import { resolveArchiveInstruction } from "../lib/instructions.js";
import { lifecycleError, selectChangeName } from "../lib/lifecycle.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
} from "../lib/openspec-adapter.js";

export interface ArchiveCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
}
export function createArchiveCommand(
  dependencies: ArchiveCommandDependencies = {},
): Command {
  const cmd = new Command("archive");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));

  cmd
    .description("Check completeness and output archive instructions")
    .argument("[name]", "Change name (auto-selects if only one exists)")
    .option("--json", "Output as JSON")
    .option("--store <id>", "OpenSpec Store id")
    .option("--path <dir>", "Working directory", ".")
    .action(async (name: string | undefined, opts: {
      json?: boolean;
      store?: string;
      path: string;
    }) => {
      const cwd = resolve(opts.path);
      try {
        const adapter = adapterFactory(cwd);
        const resolver = resolverFactory(adapter);
        const changeName = await selectChangeName(adapter, name, { store: opts.store });
        const result = await resolveArchiveInstruction(
          cwd,
          changeName,
          { store: opts.store },
          { adapter, resolver },
        );
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (!result.isReady) {
          console.error(result.reason ?? "Change not ready for archive");
        } else {
          console.log(`Archive: ${result.changeName}\n`);
          console.log(result.instruction);
          console.log("\nContext files:");
          for (const file of result.contextFiles) console.log(`  - ${file}`);
        }
        if (!result.isReady) process.exitCode = 1;
      } catch (error) {
        const failure = lifecycleError(error);
        if (opts.json) console.log(JSON.stringify({ status: "contract_error", error: failure }, null, 2));
        else console.error(`Error: ${failure.message}`);
        process.exitCode = 1;
      }
    });

  return cmd;
}
