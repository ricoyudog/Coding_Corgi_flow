import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Command } from "commander";

import {
  completeTaskGroupV3,
  startApplyV3,
  type LifecycleV3Dependencies,
  type TaskGroupEvidenceV3,
} from "../lib/lifecycle-v3.js";
import { LoopStoreV3 } from "../lib/loop-store-v3.js";
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

interface ApplyOptionsV3 extends LifecycleCasOptionsV3 {
  json?: boolean;
  path: string;
  store?: string;
  owner?: string;
  ownerKind?: "human" | "agent" | "automation";
  completeGroup?: string;
  workspaceFingerprint?: string;
  evidence?: string;
  supersedes?: string;
}

export type ApplyV3CommandDependencies = LifecycleV3Dependencies & TrackerSyncV3Dependencies;

export function createApplyV3Command(dependencies: ApplyV3CommandDependencies = {}): Command {
  return new Command("apply")
    .description("Start or advance Run Contract v3 Task Group application")
    .argument("<name>", "Change name")
    .option("--path <dir>", "Working directory", ".")
    .option("--store <id>", "OpenSpec Store id")
    .option("--json", "Output as JSON")
    .option("--session <id>", "Durable session id (generated on first start when omitted)")
    .option("--owner <id>", "Run owner id")
    .option("--owner-kind <kind>", "Run owner kind")
    .option("--run-id <id>", "Run id or CAS run id")
    .option("--state-revision <number>", "CAS state revision")
    .option("--nonce <value>", "CAS nonce")
    .option("--supersedes <run-id>", "Repair predecessor run id")
    .option("--complete-group <id>", "Acknowledge the current Task Group commit")
    .option("--workspace-fingerprint <sha256>", "Evaluated workspace fingerprint")
    .option("--evidence <file>", "Task Group checks/review/artifact evidence JSON")
    .action(async (name: string, options: ApplyOptionsV3) => {
      try {
        const projectRoot = resolve(options.path);
        await reconcileCurrentTrackerStateV3(projectRoot, name, dependencies);
        if (options.completeGroup) {
          const token = resolveLifecycleTokenV3(
            projectRoot,
            name,
            options,
            dependencies.createStore,
          );
          if (!options.workspaceFingerprint || !options.evidence) {
            throw Object.assign(
              new Error("--workspace-fingerprint and --evidence are required with --complete-group"),
              { code: "GROUP_EVIDENCE_REQUIRED" },
            );
          }
          const state = await completeTaskGroupV3({
            projectRoot,
            changeName: name,
            token,
            groupId: options.completeGroup,
            workspaceFingerprint: options.workspaceFingerprint as `sha256:${string}`,
            evidence: readJsonDocument<TaskGroupEvidenceV3>(resolve(options.evidence), "Task Group evidence"),
          }, dependencies);
          await syncTrackerStateV3(projectRoot, state, dependencies);
          emitLifecycleResult(lifecycleCommandOutputV3("complete-group", state), options.json);
          return;
        }
        const existing = (dependencies.createStore?.(projectRoot) ?? new LoopStoreV3(projectRoot))
          .inspect(name).state;
        const ownerKind = options.ownerKind ?? existing?.owner.kind ?? "agent";
        if (!(["human", "agent", "automation"] as unknown[]).includes(ownerKind)) {
          throw Object.assign(new Error("--owner-kind must be human, agent, or automation"), { code: "RUN_OWNER_INVALID" });
        }
        const owner = options.owner?.trim()
          || existing?.owner.id
          || process.env["CORGISPEC_ACTOR_ID"]?.trim()
          || "agent";
        const sessionId = options.session?.trim()
          || existing?.sessionId
          || process.env["CORGISPEC_SESSION_ID"]?.trim()
          || `session-${randomUUID()}`;
        const state = await startApplyV3({
          projectRoot,
          changeName: name,
          sessionId,
          owner: { id: owner, kind: ownerKind },
          store: options.store,
          runId: options.runId,
          supersedesRunId: options.supersedes,
        }, dependencies);
        await syncTrackerStateV3(projectRoot, state, dependencies);
        emitLifecycleResult(lifecycleCommandOutputV3("apply", state), options.json);
      } catch (error) {
        emitLifecycleFailure("apply", error, options.json);
      }
    });
}
