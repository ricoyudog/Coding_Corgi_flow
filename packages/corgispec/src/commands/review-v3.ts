import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";

import {
  submitHumanReviewV3,
  type LifecycleV3Dependencies,
} from "../lib/lifecycle-v3.js";
import type { HumanReviewDecisionV3 } from "../lib/run-contract-v3.js";
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

interface ReviewOptionsV3 extends LifecycleCasOptionsV3 {
  path: string;
  json?: boolean;
  reviewer?: string;
  reason?: string;
  approve?: boolean;
  rejectImplementation?: boolean;
  requireRfcAmendment?: boolean;
}

export interface ReviewV3CommandDependencies extends LifecycleV3Dependencies, TrackerSyncV3Dependencies {
  interactive?: () => boolean;
}

export function createReviewV3Command(dependencies: ReviewV3CommandDependencies = {}): Command {
  return new Command("review")
    .description("Record the explicit human implementation decision for a verified change")
    .argument("<name>", "Change name")
    .option("--path <dir>", "Working directory", ".")
    .option("--json", "Output as JSON")
    .option("--run-id <id>", "Explicit Run id (advanced CAS override)")
    .option("--session <id>", "Explicit durable session id")
    .option("--state-revision <number>", "Explicit CAS state revision")
    .option("--nonce <value>", "Explicit CAS nonce")
    .option("--reviewer <human-id>", "Human reviewer identity (prompts when omitted)")
    .option("--reason <text>", "Required rejection/amendment reason")
    .option("--approve", "Accept the implementation")
    .option("--reject-implementation", "Require an implementation repair successor")
    .option("--require-rfc-amendment", "Block until a human-authored Amendment RFC is accepted")
    .action(async (name: string, options: ReviewOptionsV3) => {
      try {
        const projectRoot = resolve(options.path);
        await reconcileCurrentTrackerStateV3(projectRoot, name, dependencies);
        const interactive = dependencies.interactive ?? (() => process.stdin.isTTY === true && process.stdout.isTTY === true);
        if (!interactive()) {
          throw Object.assign(
            new Error("Human Review must be recorded from an interactive terminal"),
            { code: "HUMAN_REVIEW_INTERACTIVE_REQUIRED" },
          );
        }
        let reviewer = options.reviewer?.trim() ?? "";
        if (!reviewer) {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            reviewer = (await rl.question("Human reviewer identity: ")).trim();
          } finally {
            rl.close();
          }
        }
        if (!reviewer) {
          throw Object.assign(new Error("Human Review requires a non-empty reviewer identity"), {
            code: "HUMAN_REVIEW_IDENTITY_REQUIRED",
          });
        }
        const decisions = [
          options.approve ? "approve" : null,
          options.rejectImplementation ? "reject-implementation" : null,
          options.requireRfcAmendment ? "require-rfc-amendment" : null,
        ].filter((item): item is HumanReviewDecisionV3 => item !== null);
        if (decisions.length !== 1) {
          throw Object.assign(
            new Error("Choose exactly one of --approve, --reject-implementation, or --require-rfc-amendment"),
            { code: "HUMAN_REVIEW_DECISION_REQUIRED" },
          );
        }
        const state = await submitHumanReviewV3({
          projectRoot,
          changeName: name,
          token: resolveLifecycleTokenV3(
            resolve(options.path),
            name,
            options,
            dependencies.createStore,
          ),
          decision: decisions[0]!,
          reviewer,
          reason: options.reason,
        }, dependencies);
        await syncTrackerStateV3(projectRoot, state, dependencies);
        emitLifecycleResult(lifecycleCommandOutputV3("review", state), options.json);
      } catch (error) {
        emitLifecycleFailure("review", error, options.json);
      }
    });
}
