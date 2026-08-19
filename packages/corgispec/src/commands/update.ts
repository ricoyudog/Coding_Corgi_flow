import { Command } from "commander";
import { resolve } from "node:path";
import {
  createArtifactResolver,
  type ArtifactResolver,
} from "../lib/artifact-resolver.js";
import { loadConfigFromDir } from "../lib/config.js";
import { lifecycleError } from "../lib/lifecycle.js";
import { LoopStoreV3 } from "../lib/loop-store-v3.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
} from "../lib/openspec-adapter.js";
import { summarizeChangeContract } from "../lib/change-contract.js";

export interface UpdateCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
  createLoopStore?: (cwd: string) => Pick<LoopStoreV3, "inspect">;
}

export function createUpdateCommand(
  dependencies: UpdateCommandDependencies = {},
): Command {
  const cmd = new Command("update");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));
  const loopStoreFactory = dependencies.createLoopStore ?? ((cwd) => new LoopStoreV3(cwd));

  cmd
    .description("Output planning-only reconciliation context for an existing change")
    .argument("<change>", "Change name")
    .option("--store <id>", "OpenSpec Store id")
    .option("--json", "Output the machine-readable update contract")
    .option("--path <dir>", "Working directory", ".")
    .action(async (change: string, opts: {
      store?: string;
      json?: boolean;
      path: string;
    }) => {
      const cwd = resolve(opts.path);
      try {
        const config = loadConfigFromDir(cwd);
        const adapter = adapterFactory(cwd);
        const resolved = await resolverFactory(adapter).resolve(change, { store: opts.store });
        const run = loopStoreFactory(cwd).inspect(change).state;
        const repairReconciliation = run?.phase === "repair_required";
        const blockers = run && !repairReconciliation
          ? [{
              code: "ACTIVE_RUN_V3",
              message: `Planning updates are blocked while Run Contract v3 '${run.runId}' is in phase '${run.phase}'.`,
            }]
          : [];
        const blocked = blockers.length > 0;
        const guardrails = [
          "Edit planning artifacts only.",
          "Read existing files only from artifactPaths.<id>.existingOutputPaths.",
          "Never write resolvedOutputPath when it contains a glob.",
          "Show and confirm one artifact-scoped diff before each write.",
          ...(repairReconciliation
            ? ["Preserve every prior Task Group and append exactly one Repair Task Group, then run corgispec change repair or adopt-amendment."]
            : []),
          "Run OpenSpec strict validation and corgispec ready after reconciliation.",
        ];
        const output = {
          schemaVersion: 1,
          changeName: resolved.changeName,
          schemaName: resolved.schemaName,
          status: blocked ? "blocked" as const : "ready" as const,
          ...(blocked ? { reasonCode: blockers[0]!.code, message: blockers[0]!.message } : {}),
          blockers,
          planningRevision: resolved.planningRevision,
          contract: resolved.contract ? summarizeChangeContract(resolved.contract, cwd) : null,
          planningComplete: resolved.planningComplete,
          changeRoot: resolved.changeRoot,
          planningHome: resolved.planningHome,
          artifactPaths: resolved.artifactPaths,
          existingArtifactIds: Object.entries(resolved.artifactPaths)
            .filter(([, artifact]) => artifact.existingOutputPaths.length > 0)
            .map(([artifactId]) => artifactId)
            .sort(),
          missingArtifactIds: resolved.status.artifacts
            .filter((artifact) => artifact.status !== "done")
            .map((artifact) => artifact.id)
            .sort(),
          actionContext: resolved.actionContext,
          projectContext: config.context ?? "",
          rules: config.rules ?? {},
          runContract: run
            ? {
                schemaVersion: run.schemaVersion,
                runId: run.runId,
                phase: run.phase,
                stateRevision: run.stateRevision,
                nonce: run.nonce,
              }
            : null,
          guardrails,
          constraints: guardrails,
        };

        if (opts.json) {
          console.log(JSON.stringify(output, null, 2));
        } else if (blocked) {
          console.error(output.message);
        } else {
          console.log(`Update context ready for '${change}'.`);
          console.log(`Planning revision: ${resolved.planningRevision}`);
          console.log(`Existing artifacts: ${output.existingArtifactIds.join(", ") || "none"}`);
        }
        if (blocked) process.exitCode = 1;
      } catch (error) {
        const failure = {
          schemaVersion: 1,
          changeName: change,
          status: "contract_error" as const,
          contract: null,
          error: lifecycleError(error),
        };
        if (opts.json) console.log(JSON.stringify(failure, null, 2));
        else console.error(`Error: ${failure.error.message}`);
        process.exitCode = 2;
      }
    });

  return cmd;
}
