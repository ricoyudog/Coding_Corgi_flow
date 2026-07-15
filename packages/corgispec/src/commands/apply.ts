import { Command } from "commander";
import { resolve } from "node:path";
import {
  createArtifactResolver,
  type ArtifactResolver,
} from "../lib/artifact-resolver.js";
import { loadConfigFromDir } from "../lib/config.js";
import { resolveApplyInstruction } from "../lib/instructions.js";
import {
  buildLifecycleReadyReport,
  lifecycleError,
  selectChangeName,
} from "../lib/lifecycle.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
} from "../lib/openspec-adapter.js";

export interface ApplyCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
}
export function createApplyCommand(
  dependencies: ApplyCommandDependencies = {},
): Command {
  const cmd = new Command("apply");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));

  cmd
    .description("Output instructions for implementing the next task group")
    .argument("[name]", "Change name")
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
        const config = loadConfigFromDir(cwd);
        const adapter = adapterFactory(cwd);
        const resolver = resolverFactory(adapter);
        const changeName = await selectChangeName(adapter, name, { store: opts.store });
        const resolved = await resolver.resolve(changeName, { store: opts.store });
        const { report } = await buildLifecycleReadyReport(
          adapter,
          resolved,
          config,
          false,
          { store: opts.store },
        );
        if (report.status !== "ready") {
          if (opts.json) {
            console.log(JSON.stringify({ status: "not_ready", readiness: report }, null, 2));
          } else {
            console.error("Change is not ready to apply. Run `corgispec ready` for details.");
          }
          process.exitCode = 1;
          return;
        }

        const result = await resolveApplyInstruction(
          cwd,
          changeName,
          { store: opts.store },
          { adapter, resolver },
        );
        if (opts.json) {
          console.log(JSON.stringify({ ...result, readiness: report }, null, 2));
          return;
        }
        if (result.state === "all_done" || result.currentGroup === null) {
          console.log("All task groups complete. Run `corgispec review` next.");
          return;
        }

        const group = result.currentGroup;
        console.log(`Change: ${result.changeName}`);
        console.log(`Group ${group.number}: ${group.name} (${group.completedTasks}/${group.totalTasks} tasks)\n`);
        console.log(result.instruction);
        if (result.contextFiles.length > 0) {
          console.log("\nContext files:");
          for (const file of result.contextFiles) console.log(`  - ${file}`);
        }
      } catch (error) {
        const failure = lifecycleError(error);
        if (opts.json) console.log(JSON.stringify({ status: "contract_error", error: failure }, null, 2));
        else console.error(`Error: ${failure.message}`);
        process.exitCode = 2;
      }
    });

  return cmd;
}
