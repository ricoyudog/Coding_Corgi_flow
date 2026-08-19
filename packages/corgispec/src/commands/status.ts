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
import { summarizeChangeContract } from "../lib/change-contract.js";
import { LoopStoreV3 } from "../lib/loop-store-v3.js";
import type { RunStateV3 } from "../lib/run-contract-v3.js";

export interface StatusCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
  createLoopStore?: (cwd: string) => Pick<LoopStoreV3, "inspect">;
}

export function createStatusCommand(
  dependencies: StatusCommandDependencies = {},
): Command {
  const cmd = new Command("status");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));
  const loopStoreFactory = dependencies.createLoopStore ?? ((cwd) => new LoopStoreV3(cwd));

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
        const run = loopStoreFactory(cwd).inspect(changeName).state;
        const artifactState = compatibilityState(resolved, tasks);
        const runProgress = summarizeRunProgress(run, tasks);
        const implementationComplete = run !== null && [
          "awaiting_verify",
          "awaiting_human_review",
          "awaiting_human_qa",
          "ready_for_archive",
          "archiving",
          "archived",
        ].includes(run.phase);
        const isComplete = run?.phase === "archived";
        const output = {
          ...resolved.status,
          changeName: resolved.changeName,
          schemaName: resolved.schemaName,
          state: run?.phase ?? artifactState,
          artifactState,
          planningComplete: resolved.planningComplete,
          implementationComplete,
          isComplete,
          changeRoot: resolved.changeRoot,
          artifactPaths: resolved.artifactPaths,
          planningRevision: resolved.planningRevision,
          contract: resolved.contract ? summarizeChangeContract(resolved.contract, cwd) : null,
          runContract: run ? {
            schemaVersion: run.schemaVersion,
            runId: run.runId,
            phase: run.phase,
            stateRevision: run.stateRevision,
            planningRevision: run.planningRevision,
            finalRevision: run.finalRevision,
            nextGroupId: run.currentGroupId,
          } : null,
          trackingProvider: tracking.provider,
          trackingProviderSource: tracking.source,
          artifacts,
          taskGroups: runProgress.taskGroups,
          taskArtifactId: tasks.taskArtifactId || null,
          contextFiles: [
            ...flattenArtifactFiles(resolved.artifactPaths),
            ...(resolved.contract
              ? [resolved.contract.sourcePath, resolved.contract.traceabilityPath]
              : []),
          ],
          completedTasks: runProgress.completedTasks,
          totalTasks: runProgress.totalTasks,
          progress: runProgress.progress,
          ...(run ? {
            planningTaskSnapshot: {
              authority: "non_authoritative" as const,
              taskGroups: tasks.groups,
              completedTasks: tasks.completedTasks,
              totalTasks: tasks.totalTasks,
            },
          } : {}),
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
        if (runProgress.taskGroups.length > 0) {
          console.log("\nTask Groups:");
          for (const group of runProgress.taskGroups) {
            console.log(`  ${group.id}. ${group.name} [${group.status}]`);
          }
        }
        console.log(`\nOverall: ${runProgress.completedTasks}/${runProgress.totalTasks} Task Groups — ${isComplete ? "complete" : "in progress"}`);
      } catch (error) {
        const failure = lifecycleError(error);
        if (opts.json) console.log(JSON.stringify({
          schemaVersion: 2,
          changeName: name ?? null,
          status: "contract_error",
          contract: null,
          error: failure,
        }, null, 2));
        else console.error(`Error: ${failure.message}`);
        process.exitCode = 1;
      }
    });

  return cmd;
}

interface StatusTaskGroup {
  id: string;
  name: string;
  status: "pending" | "in_progress" | "completed" | "invalidated" | "done";
  ordinal: number;
  commitRevision: string | null;
  completedAt: string | null;
}

function summarizeRunProgress(
  run: RunStateV3 | null,
  planning: ReturnType<typeof summarizeOptionalTaskGroups>,
): {
  taskGroups: StatusTaskGroup[];
  completedTasks: number;
  totalTasks: number;
  progress: { authority: "run-contract-v3" | "planning"; total: number; complete: number; remaining: number };
} {
  if (!run) {
    const taskGroups = planning.groups.map((group) => ({
      id: String(group.number),
      name: group.name,
      status: group.status,
      ordinal: group.number,
      commitRevision: null,
      completedAt: null,
    }));
    return {
      taskGroups,
      completedTasks: planning.completedTasks,
      totalTasks: planning.totalTasks,
      progress: {
        authority: "planning",
        total: planning.totalTasks,
        complete: planning.completedTasks,
        remaining: Math.max(0, planning.totalTasks - planning.completedTasks),
      },
    };
  }

  const taskGroups = Object.values(run.groups)
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
    .map((group) => ({
      id: group.id,
      name: planning.groups.find((candidate) => String(candidate.number) === group.id)?.name ?? group.id,
      status: group.status,
      ordinal: group.ordinal,
      commitRevision: group.commitRevision,
      completedAt: group.completedAt,
    }));
  const completedTasks = taskGroups.filter((group) => group.status === "completed").length;
  return {
    taskGroups,
    completedTasks,
    totalTasks: taskGroups.length,
    progress: {
      authority: "run-contract-v3",
      total: taskGroups.length,
      complete: completedTasks,
      remaining: taskGroups.length - completedTasks,
    },
  };
}
