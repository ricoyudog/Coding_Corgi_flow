import { resolve } from "node:path";
import { Command } from "commander";

import {
  adoptAmendmentV3,
  createRepairSuccessorV3,
  type LifecycleV3Dependencies,
} from "../lib/lifecycle-v3.js";
import type { RunOwnerV3 } from "../lib/run-contract-v3.js";
import {
  reconcileCurrentTrackerStateV3,
  syncTrackerStateV3,
  type TrackerSyncV3Dependencies,
} from "../lib/tracker-sync-v3.js";
import {
  emitLifecycleFailure,
  emitLifecycleResult,
  lifecycleCommandOutputV3,
  resolveLifecycleTokenV3,
  type LifecycleCasOptionsV3,
} from "./lifecycle-v3-common.js";

interface SuccessorOptionsV3 extends LifecycleCasOptionsV3 {
  path: string;
  json?: boolean;
  owner?: string;
  ownerKind?: RunOwnerV3["kind"];
  store?: string;
  from?: string;
}

function successorCommand(
  name: "repair" | "adopt-amendment",
  dependencies: LifecycleV3Dependencies & TrackerSyncV3Dependencies,
): Command {
  const command = new Command(name)
    .description(name === "repair"
      ? "Create an implementation-repair successor Run Contract"
      : "Adopt a human-approved Amendment RFC into a successor Run Contract")
    .argument("<name>", "Change name")
    .option("--path <dir>", "Working directory", ".")
    .option("--store <id>", "OpenSpec Store id")
    .option("--json", "Output as JSON")
    .option("--run-id <id>", "Explicit predecessor Run id (advanced CAS override)")
    .option("--session <id>", "Explicit predecessor session id")
    .option("--state-revision <number>", "Explicit predecessor CAS state revision")
    .option("--nonce <value>", "Explicit predecessor CAS nonce")
    .option("--owner <id>", "Successor owner id", "agent")
    .option("--owner-kind <kind>", "Successor owner kind", "agent");
  if (name === "adopt-amendment") command.requiredOption("--from <RFC-ID>", "Accepted Amendment RFC now bound by source.yaml");
  return command.action(async (changeName: string, options: SuccessorOptionsV3) => {
    try {
      if (!(["human", "agent", "automation"] as unknown[]).includes(options.ownerKind)) {
        throw Object.assign(new Error("--owner-kind must be human, agent, or automation"), { code: "RUN_OWNER_INVALID" });
      }
      const projectRoot = resolve(options.path);
      await reconcileCurrentTrackerStateV3(projectRoot, changeName, dependencies);
      const token = resolveLifecycleTokenV3(
        projectRoot,
        changeName,
        options,
        dependencies.createStore,
      );
      const owner = { id: options.owner!.trim(), kind: options.ownerKind! };
      if (name === "adopt-amendment") {
        const result = await adoptAmendmentV3({
          projectRoot,
          changeName,
          token,
          sessionId: token.sessionId,
          owner,
          rfcId: options.from!,
          store: options.store,
        }, dependencies);
        if (!result.state) {
          emitLifecycleResult({
            schemaVersion: 3,
            status: result.status,
            operation: name,
            changeName,
            rfcId: result.rfcId,
            sliceId: result.sliceId,
            sourcePath: result.sourcePath,
            traceabilityPath: result.traceabilityPath,
            blockers: result.blockers,
            next: "Reconcile planning artifacts and traceability, then rerun this exact command; successor creation will commit the dedicated planning baseline",
          }, options.json);
          process.exitCode = 1;
          return;
        }
        await syncTrackerStateV3(projectRoot, result.state, dependencies);
        emitLifecycleResult(lifecycleCommandOutputV3(name, result.state), options.json);
        return;
      }
      const state = await createRepairSuccessorV3({
        projectRoot,
        changeName,
        token,
        sessionId: token.sessionId,
        owner,
        amendmentRequired: false,
        store: options.store,
      }, dependencies);
      await syncTrackerStateV3(projectRoot, state, dependencies);
      emitLifecycleResult(lifecycleCommandOutputV3(name, state), options.json);
    } catch (error) {
      emitLifecycleFailure(name, error, options.json);
    }
  });
}

export function createChangeV3Command(
  dependencies: LifecycleV3Dependencies & TrackerSyncV3Dependencies = {},
): Command {
  const command = new Command("change").description("Run Contract v3 repair and amendment operations");
  command.addCommand(successorCommand("repair", dependencies));
  command.addCommand(successorCommand("adopt-amendment", dependencies));
  return command;
}
