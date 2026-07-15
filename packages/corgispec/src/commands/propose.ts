import { Command } from "commander";
import { resolve } from "node:path";
import {
  createArtifactResolver,
  type ArtifactResolver,
} from "../lib/artifact-resolver.js";
import { loadConfigFromDir } from "../lib/config.js";
import { resolveArtifactInstruction } from "../lib/instructions.js";
import { lifecycleError } from "../lib/lifecycle.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
} from "../lib/openspec-adapter.js";

export interface ProposeCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
}
export function createProposeCommand(
  dependencies: ProposeCommandDependencies = {},
): Command {
  const cmd = new Command("propose");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));

  cmd
    .description("Create an OpenSpec change and output its first artifact instructions")
    .argument("<name>", "Name of the change to propose")
    .option("--description <text>", "Change description")
    .option("--goal <text>", "Change goal")
    .option("--store <id>", "OpenSpec Store id")
    .option("--json", "Output as JSON")
    .option("--path <dir>", "Working directory", ".")
    .action(async (name: string, opts: {
      description?: string;
      goal?: string;
      store?: string;
      json?: boolean;
      path: string;
    }) => {
      const cwd = resolve(opts.path);
      try {
        const config = loadConfigFromDir(cwd);
        const adapter = adapterFactory(cwd);
        const resolver = resolverFactory(adapter);
        const created = await adapter.createChange(name, {
          schema: config.schema,
          store: opts.store,
          description: opts.description,
          goal: opts.goal,
        });
        const resolved = await resolver.resolve(name, { store: opts.store });
        const nextArtifact = resolved.status.artifacts.find(
          (artifact) => artifact.status === "ready",
        );

        if (!nextArtifact) {
          const output = {
            schemaVersion: 1,
            changeName: name,
            status: resolved.planningComplete ? "complete" : "blocked",
            message: resolved.planningComplete
              ? `All planning artifacts already exist for '${name}'.`
              : "No planning artifact is currently ready.",
            created: created.change,
            planningComplete: resolved.planningComplete,
            implementationComplete: false,
            isComplete: false,
            changeRoot: resolved.changeRoot,
            artifactPaths: resolved.artifactPaths,
            planningRevision: resolved.planningRevision,
          };
          if (opts.json) console.log(JSON.stringify(output, null, 2));
          else console.log(output.message);
          if (!resolved.planningComplete) process.exitCode = 1;
          return;
        }

        const instruction = await resolveArtifactInstruction(
          cwd,
          name,
          nextArtifact.id,
          { store: opts.store },
          { adapter, resolver },
        );
        const output = { ...instruction, created: created.change };
        if (opts.json) {
          console.log(JSON.stringify(output, null, 2));
        } else {
          console.log(`Created change: ${name}`);
          console.log(`Root: ${instruction.changeRoot}`);
          console.log(`Next: create '${nextArtifact.id}' at ${instruction.outputPath}\n`);
          console.log(instruction.instruction);
        }
      } catch (error) {
        const failure = lifecycleError(error);
        if (opts.json) console.log(JSON.stringify({ status: "contract_error", error: failure }, null, 2));
        else console.error(`Error: ${failure.message}`);
        process.exitCode = 1;
      }
    });

  return cmd;
}
