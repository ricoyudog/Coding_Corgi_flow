import { resolve } from "node:path";
import { Command } from "commander";

import {
  submitVerifyV3,
  type LifecycleV3Dependencies,
  type VerifyInputV3,
} from "../lib/lifecycle-v3.js";
import {
  reconcileCurrentTrackerStateV3,
  syncTrackerStateV3,
  type TrackerSyncV3Dependencies,
} from "../lib/tracker-sync-v3.js";
import {
  emitLifecycleFailure,
  emitLifecycleResult,
  lifecycleCommandOutputV3,
  readJsonDocument,
  resolveLifecycleTokenV3,
  type LifecycleCasOptionsV3,
} from "./lifecycle-v3-common.js";

interface VerifyOptionsV3 extends LifecycleCasOptionsV3 {
  path: string;
  json?: boolean;
  report: string;
}

export type VerifyV3CommandDependencies = LifecycleV3Dependencies & TrackerSyncV3Dependencies;

export function createVerifyCommand(dependencies: VerifyV3CommandDependencies = {}): Command {
  return new Command("verify")
    .description("Submit canonical whole-change verification and exact RFC acceptance coverage")
    .argument("<name>", "Change name")
    .option("--path <dir>", "Working directory", ".")
    .option("--json", "Output as JSON")
    .option("--run-id <id>", "Explicit Run id (advanced CAS override)")
    .option("--session <id>", "Explicit durable session id")
    .option("--state-revision <number>", "Explicit CAS state revision")
    .option("--nonce <value>", "Explicit CAS nonce")
    .requiredOption("--report <file>", "JSON verification report")
    .action(async (name: string, options: VerifyOptionsV3) => {
      try {
        const projectRoot = resolve(options.path);
        await reconcileCurrentTrackerStateV3(projectRoot, name, dependencies);
        const report = readJsonDocument<VerifyInputV3>(resolve(options.report), "verification report");
        const state = await submitVerifyV3({
          projectRoot,
          changeName: name,
          token: resolveLifecycleTokenV3(
            resolve(options.path),
            name,
            options,
            dependencies.createStore,
          ),
          report,
        }, dependencies);
        await syncTrackerStateV3(projectRoot, state, dependencies);
        emitLifecycleResult(lifecycleCommandOutputV3("verify", state), options.json);
      } catch (error) {
        emitLifecycleFailure("verify", error, options.json);
      }
    });
}
