import { Command } from "commander";
import { resolve } from "node:path";
import {
  createArtifactResolver,
  type ArtifactResolver,
} from "../lib/artifact-resolver.js";
import { loadConfigFromDir } from "../lib/config.js";
import { inspectLegacyLoop } from "../lib/legacy-loop.js";
import { lifecycleError } from "../lib/lifecycle.js";
import { LoopStoreV2, type LoopStoreInspectionV2 } from "../lib/loop-store-v2.js";
import {
  createOpenSpecAdapter,
  type OpenSpecAdapter,
} from "../lib/openspec-adapter.js";
import { isActiveLoopPhaseV2 } from "../lib/run-contract-v2.js";

export interface UpdateCommandDependencies {
  createAdapter?: (cwd: string) => OpenSpecAdapter;
  createResolver?: (adapter: OpenSpecAdapter) => ArtifactResolver;
  createLoopStore?: (cwd: string) => Pick<LoopStoreV2, "peek">;
}

export function createUpdateCommand(
  dependencies: UpdateCommandDependencies = {},
): Command {
  const cmd = new Command("update");
  const adapterFactory = dependencies.createAdapter ?? ((cwd) => createOpenSpecAdapter(cwd));
  const resolverFactory = dependencies.createResolver ?? ((adapter) => createArtifactResolver(adapter));
  const loopStoreFactory = dependencies.createLoopStore ?? ((cwd) => new LoopStoreV2({ projectRoot: cwd }));

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
        const legacyLoop = inspectLegacyLoop(cwd, change);
        const canonicalLoop: LoopStoreInspectionV2 = await loopStoreFactory(cwd).peek(change);
        const activeRuns = legacyLoop.runs.filter((run) => run.active);
        const activeV2 = canonicalLoop.state && isActiveLoopPhaseV2(canonicalLoop.state.phase)
          ? canonicalLoop.state
          : null;
        const pendingConvergence = canonicalLoop.state?.phase === "invalidated" &&
          canonicalLoop.state.blockedReason?.details?.["operation"] === "converge"
          ? canonicalLoop.state
          : null;
        const blockers = [
          ...(pendingConvergence
            ? [{
                code: "PENDING_CONVERGENCE",
                message: `Planning updates are blocked while canonical run '${pendingConvergence.runId}' has a recoverable convergence intent. Retry corgispec converge with its original confirmation token first.`,
              }]
            : []),
          ...(activeV2
            ? [{
                code: "ACTIVE_V2_RUN",
                message: `Planning updates are blocked while canonical run '${activeV2.runId}' is active. Finalize or invalidate it first.`,
              }]
            : []),
          ...(activeRuns.length > 0
            ? [{
                code: "ACTIVE_V1_RUN",
                message: "Planning updates are blocked while a legacy v1 loop is active. End or migrate the loop first.",
              }]
            : []),
          ...(legacyLoop.corruptPaths.length > 0
            ? [{
                code: "CORRUPT_V1_STATE",
                message: `Legacy loop state is corrupt: ${legacyLoop.corruptPaths.join(", ")}`,
              }]
            : []),
          ...(legacyLoop.unsupportedPaths.length > 0
            ? [{
                code: "UNSUPPORTED_LOOP_STATE",
                message: `Unsupported loop state must be migrated explicitly: ${legacyLoop.unsupportedPaths.join(", ")}`,
              }]
            : []),
        ];
        const blocked = blockers.length > 0;
        const guardrails = [
          "Edit planning artifacts only.",
          "Read existing files only from artifactPaths.<id>.existingOutputPaths.",
          "Never write resolvedOutputPath when it contains a glob.",
          "Show and confirm one artifact-scoped diff before each write.",
          "Never edit planning while a durable convergence intent is pending; recover it with the original confirmation token.",
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
          legacyLoop,
          canonicalLoop: canonicalLoop.state
            ? {
                runId: canonicalLoop.state.runId,
                phase: canonicalLoop.state.phase,
                stateRevision: canonicalLoop.state.stateRevision,
                nonce: canonicalLoop.state.nonce,
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
          error: lifecycleError(error),
        };
        if (opts.json) console.log(JSON.stringify(failure, null, 2));
        else console.error(`Error: ${failure.error.message}`);
        process.exitCode = 2;
      }
    });

  return cmd;
}
