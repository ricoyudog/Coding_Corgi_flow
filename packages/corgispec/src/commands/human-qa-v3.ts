import { resolve } from "node:path";
import { Command } from "commander";

import {
  submitHumanQaV3,
  type LifecycleV3Dependencies,
  type QaInputV3,
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

interface HumanQaOptionsV3 extends LifecycleCasOptionsV3 {
  path: string;
  json?: boolean;
  report: string;
}

export interface HumanQaV3CommandDependencies extends LifecycleV3Dependencies, TrackerSyncV3Dependencies {
  interactive?: () => boolean;
}

export function createHumanQaCommand(dependencies: HumanQaV3CommandDependencies = {}): Command {
  return new Command("human-qa")
    .description("Record source- and final-commit-bound Human QA evidence")
    .argument("<name>", "Change name")
    .option("--path <dir>", "Working directory", ".")
    .option("--json", "Output as JSON")
    .option("--run-id <id>", "Explicit Run id (advanced CAS override)")
    .option("--session <id>", "Explicit durable session id")
    .option("--state-revision <number>", "Explicit CAS state revision")
    .option("--nonce <value>", "Explicit CAS nonce")
    .requiredOption("--report <file>", "JSON Human QA report")
    .action(async (name: string, options: HumanQaOptionsV3) => {
      try {
        const projectRoot = resolve(options.path);
        await reconcileCurrentTrackerStateV3(projectRoot, name, dependencies);
        const interactive = dependencies.interactive ?? (() => process.stdin.isTTY === true && process.stdout.isTTY === true);
        if (!interactive()) {
          throw Object.assign(
            new Error("Human QA must be recorded from an interactive terminal"),
            { code: "HUMAN_QA_INTERACTIVE_REQUIRED" },
          );
        }
        const report = readJsonDocument<QaInputV3>(resolve(options.report), "Human QA report");
        const state = await submitHumanQaV3({
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
        emitLifecycleResult(lifecycleCommandOutputV3("human-qa", state), options.json);
      } catch (error) {
        emitLifecycleFailure("human-qa", error, options.json);
      }
    });
}
