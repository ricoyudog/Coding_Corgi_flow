import { readFileSync } from "node:fs";

import { lifecycleTokenV3, type LifecycleTokenV3 } from "../lib/lifecycle-v3.js";
import { LoopStoreV3 } from "../lib/loop-store-v3.js";
import {
  CHANGE_CONTRACT_SCHEMA_VERSION,
  summarizeTrackerBinding,
  type ContractSummary,
} from "../lib/change-contract.js";
import type { RunContractBindingV3, RunStateV3 } from "../lib/run-contract-v3.js";

export interface LifecycleCasOptionsV3 {
  runId?: string;
  session?: string;
  stateRevision?: string;
  nonce?: string;
}

export function requireLifecycleTokenV3(options: LifecycleCasOptionsV3): LifecycleTokenV3 {
  const stateRevision = Number(options.stateRevision);
  if (
    !options.runId?.trim()
    || !options.session?.trim()
    || !Number.isSafeInteger(stateRevision)
    || stateRevision < 0
    || !options.nonce?.trim()
  ) {
    throw commandContractError(
      "RUN_TOKEN_REQUIRED",
      "--run-id, --session, --state-revision, and --nonce are required for lifecycle mutation",
    );
  }
  return {
    runId: options.runId.trim(),
    sessionId: options.session.trim(),
    stateRevision,
    nonce: options.nonce.trim(),
  };
}

export function resolveLifecycleTokenV3(
  projectRoot: string,
  changeName: string,
  options: LifecycleCasOptionsV3,
  createStore?: (projectRoot: string) => LoopStoreV3,
): LifecycleTokenV3 {
  const supplied = [options.runId, options.session, options.stateRevision, options.nonce]
    .filter((value) => value !== undefined).length;
  if (supplied > 0) {
    if (supplied !== 4) {
      throw commandContractError(
        "RUN_TOKEN_INCOMPLETE",
        "Provide all of --run-id, --session, --state-revision, and --nonce, or omit all four to use the current Run Contract",
      );
    }
    return requireLifecycleTokenV3(options);
  }
  const state = (createStore?.(projectRoot) ?? new LoopStoreV3(projectRoot)).inspect(changeName).state;
  if (!state) {
    throw commandContractError(
      "RUN_NOT_FOUND",
      `No current Run Contract exists for '${changeName}'`,
    );
  }
  return lifecycleTokenV3(state);
}

export function readJsonDocument<T>(path: string, label: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    throw commandContractError(
      "LIFECYCLE_REPORT_INVALID",
      `Cannot read ${label} '${path}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function lifecycleCommandOutputV3(
  operation: string,
  state: RunStateV3,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 3,
    status: "ok",
    operation,
    changeName: state.changeName,
    contract: summarizeRunContract(state.contract),
    state,
    token: lifecycleTokenV3(state),
    action: actionFor(state),
    ...extra,
  };
}

/** Keep lifecycle's public contract identical to status and ready summaries. */
export function summarizeRunContract(binding: RunContractBindingV3): ContractSummary {
  return {
    schemaVersion: CHANGE_CONTRACT_SCHEMA_VERSION,
    pathConvention: "project-relative-posix",
    kind: binding.kind,
    deliveryRef: binding.deliveryRef,
    rfcId: binding.rfcId,
    rfcDigest: binding.rfcDigest,
    acceptedCommit: binding.acceptedCommit,
    sliceId: binding.sliceId,
    acceptanceIds: binding.acceptance.map((criterion) => criterion.id).sort(),
    sourcePath: binding.sourcePath.replace(/\\/gu, "/"),
    sourceDigest: binding.sourceDigest,
    traceabilityPath: binding.traceabilityPath.replace(/\\/gu, "/"),
    traceabilityDigest: binding.traceabilityDigest,
    tracker: summarizeTrackerBinding(binding.tracker),
  };
}

export function actionFor(state: RunStateV3): Record<string, unknown> {
  switch (state.phase) {
    case "planning_ready":
      return { type: "start_apply" };
    case "applying":
      return { type: "apply_group", groupId: state.currentGroupId };
    case "awaiting_verify":
      return { type: "verify" };
    case "awaiting_human_review":
      return { type: "human_review" };
    case "awaiting_human_qa":
      return { type: "human_qa" };
    case "ready_for_archive":
      return { type: "archive" };
    case "archiving":
      return {
        type: state.archive?.localCompleted
          ? state.archive.trackerCompleted ? "finish_archive" : "close_tracker"
          : "complete_local_archive",
        intentId: state.archive?.intentId,
      };
    case "repair_required":
      return { type: "repair", repair: state.repair };
    default:
      return { type: "terminal", phase: state.phase };
  }
}

export function lifecycleFailure(error: unknown): { code: string; message: string } {
  return {
    code: error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "LIFECYCLE_V3_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

export function commandContractError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export function emitLifecycleResult(
  output: Record<string, unknown>,
  json: boolean | undefined,
): void {
  if (json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  const state = output.state as RunStateV3 | undefined;
  console.log(`${String(output.operation)}: ${String(output.status)}`);
  if (state) {
    console.log(`Change: ${state.changeName}`);
    console.log(`Run: ${state.runId}`);
    console.log(`Phase: ${state.phase}`);
    const action = output.action as { type?: unknown; groupId?: unknown } | undefined;
    if (action?.type) console.log(`Next: ${String(action.type)}${action.groupId ? ` ${String(action.groupId)}` : ""}`);
  }
}

export function emitLifecycleFailure(
  operation: string,
  error: unknown,
  json: boolean | undefined,
): void {
  const failure = lifecycleFailure(error);
  if (json) console.log(JSON.stringify({
    schemaVersion: 3,
    status: "error",
    operation,
    contract: null,
    error: failure,
  }, null, 2));
  else console.error(`Error [${failure.code}]: ${failure.message}`);
  process.exitCode = 2;
}
