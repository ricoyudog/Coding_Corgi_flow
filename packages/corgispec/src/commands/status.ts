import { Command } from "commander";
import { resolve } from "node:path";
import {
  createArtifactResolver,
  type ArtifactResolver,
} from "../lib/artifact-resolver.js";
import { loadConfigFromDir, resolveTrackingProvider } from "../lib/config.js";
import { detectHookConfig } from "../lib/hooks.js";
import {
  compatibleArtifacts,
  compatibilityState,
  flattenArtifactFiles,
  lifecycleError,
  selectChangeName,
  summarizeOptionalTaskGroups,
} from "../lib/lifecycle.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
} from "../lib/openspec-adapter.js";

export interface StatusCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
}

export function createStatusCommand(
  dependencies: StatusCommandDependencies = {},
): Command {
  const cmd = new Command("status");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));

  cmd
    .description("Show artifact and implementation completion for a Corgi change")
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
        const changeName = await selectChangeName(adapter, name, { store: opts.store });
        const resolved = await resolverFactory(adapter).resolve(changeName, { store: opts.store });
        const config = loadConfigFromDir(cwd);
        const tracking = resolveTrackingProvider(config);
        const tasks = summarizeOptionalTaskGroups(config, resolved.artifactPaths);
        const hookStatus = detectHookConfig(cwd);
        const artifacts = compatibleArtifacts(resolved.status.artifacts);
        const implementationComplete = tasks.implementationComplete;
        const isComplete = resolved.planningComplete && implementationComplete;
        const output = {
          ...resolved.status,
          changeName: resolved.changeName,
          schemaName: resolved.schemaName,
          state: compatibilityState(resolved, tasks),
          planningComplete: resolved.planningComplete,
          implementationComplete,
          isComplete,
          changeRoot: resolved.changeRoot,
          artifactPaths: resolved.artifactPaths,
          planningRevision: resolved.planningRevision,
          trackingProvider: tracking.provider,
          trackingProviderSource: tracking.source,
          artifacts,
          taskGroups: tasks.groups,
          taskArtifactId: tasks.taskArtifactId || null,
          contextFiles: flattenArtifactFiles(resolved.artifactPaths),
          completedTasks: tasks.completedTasks,
          totalTasks: tasks.totalTasks,
          hooks: {
            configured: hookStatus.configured,
            platform: hookStatus.platform,
            events: hookStatus.events,
          },
        };

        if (opts.json) {
          console.log(JSON.stringify(output, null, 2));
          return;
        }

        console.log(`Change: ${output.changeName} (state: ${output.state})`);
        console.log(`Schema: ${output.schemaName}`);
        console.log(`Planning revision: ${output.planningRevision}`);
        console.log(`Planning: ${output.planningComplete ? "complete" : "in progress"}`);
        console.log(`Implementation: ${implementationComplete ? "complete" : "in progress"}`);
        console.log(`Hooks: ${hookStatus.configured ? `configured (${hookStatus.events.join(", ")})` : "not configured"}`);
        console.log("\nArtifacts:");
        for (const artifact of artifacts) {
          const icon = artifact.exists ? "✓" : artifact.blocked ? "✗" : "○";
          const suffix = artifact.blockedBy.length
            ? ` (blocked by: ${artifact.blockedBy.join(", ")})`
            : "";
          console.log(`  ${icon} ${artifact.id}${suffix}`);
        }
        if (tasks.groups.length > 0) {
          console.log("\nTask Groups:");
          for (const group of tasks.groups) {
            console.log(`  ${group.number}. ${group.name} ${group.completedTasks}/${group.totalTasks} [${group.status}]`);
          }
        }
        console.log(`\nOverall: ${tasks.completedTasks}/${tasks.totalTasks} tasks — ${isComplete ? "complete" : "in progress"}`);
      } catch (error) {
        const failure = lifecycleError(error);
        if (opts.json) console.log(JSON.stringify({ status: "contract_error", error: failure }, null, 2));
        else console.error(`Error: ${failure.message}`);
        process.exitCode = 1;
      }
    });

  return cmd;
}
