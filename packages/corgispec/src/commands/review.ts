import { Command } from "commander";
import { resolve } from "node:path";
import {
  createArtifactResolver,
  type ArtifactResolver,
} from "../lib/artifact-resolver.js";
import { resolveReviewInstruction } from "../lib/instructions.js";
import { lifecycleError, selectChangeName } from "../lib/lifecycle.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
} from "../lib/openspec-adapter.js";

export interface ReviewCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
}
export function createReviewCommand(
  dependencies: ReviewCommandDependencies = {},
): Command {
  const cmd = new Command("review");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));

  cmd
    .description("Output review checklist instructions for a change")
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
        const review = await resolveReviewInstruction(
          cwd,
          changeName,
          { store: opts.store },
          { adapter, resolver },
        );
        if (opts.json) {
          console.log(JSON.stringify(review, null, 2));
          return;
        }
        if (review.completedGroups.length === 0) {
          console.log("No completed task groups to review. Run `corgispec apply` first.");
          return;
        }
        console.log(`Review: ${review.changeName}`);
        console.log(`State: ${review.state}`);
        console.log(`Completed groups: ${review.completedGroups.map((group) => group.name).join(", ")}\n`);
        console.log(review.instruction);
        console.log("\nContext files:");
        for (const file of review.contextFiles) console.log(`  - ${file}`);
      } catch (error) {
        const failure = lifecycleError(error);
        if (opts.json) console.log(JSON.stringify({ status: "contract_error", error: failure }, null, 2));
        else console.error(`Error: ${failure.message}`);
        process.exitCode = 1;
      }
    });

  return cmd;
}
