import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";

import {
  performLocalArchiveCloseoutV3,
  type ArchiveCloseoutV3Dependencies,
} from "../lib/archive-closeout-v3.js";
import {
  cleanupArchivedWorktreeV3,
  type ArchiveWorktreeCleanupV3,
} from "../lib/archive-worktree-v3.js";
import {
  loadChangeContract,
  type LoadedChangeContract,
  type TrackerBinding,
} from "../lib/change-contract.js";
import {
  assertArchiveCloseoutIntegrityV3,
  beginArchiveV3,
  completeLocalArchiveV3,
  completeTrackerArchiveV3,
  finishArchiveV3,
  LifecycleV3Error,
  materializeArchiveEvidenceV3,
  type LifecycleV3Dependencies,
  type LifecycleTokenV3,
} from "../lib/lifecycle-v3.js";
import { LoopStoreV3 } from "../lib/loop-store-v3.js";
import type { RunStateV3 } from "../lib/run-contract-v3.js";
import {
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

interface ArchiveOptionsV3 extends LifecycleCasOptionsV3 {
  path: string;
  json?: boolean;
  begin?: boolean;
  local?: boolean;
  confirmTracker?: boolean;
  finish?: boolean;
  store?: string;
}

export interface ArchiveV3CommandDependencies extends LifecycleV3Dependencies, TrackerSyncV3Dependencies, ArchiveCloseoutV3Dependencies {
  recordTrackerCompleted?: (input: {
    projectRoot: string;
    changeName: string;
    token: LifecycleTokenV3;
  }) => Promise<RunStateV3>;
  cleanupWorktree?: (projectRoot: string) => Promise<ArchiveWorktreeCleanupV3> | ArchiveWorktreeCleanupV3;
  verifyCloseoutIntegrity?: (projectRoot: string, state: RunStateV3) => Promise<void>;
}

export function createArchiveV3Command(dependencies: ArchiveV3CommandDependencies = {}): Command {
  return new Command("archive")
    .description("Run the strong, resumable Run Contract v3 archive gate")
    .argument("<name>", "Change name")
    .option("--path <dir>", "Working directory", ".")
    .option("--json", "Output as JSON")
    .option("--run-id <id>", "Explicit Run id (advanced CAS override)")
    .option("--session <id>", "Explicit durable session id")
    .option("--state-revision <number>", "Explicit CAS state revision")
    .option("--nonce <value>", "Explicit CAS nonce")
    .option("--store <id>", "OpenSpec Store id")
    .option("--begin", "Persist the archive intent after all strong gates pass")
    .option("--local", "Execute the resumable OpenSpec, delivery, knowledge, and closeout-commit transaction")
    .option("--confirm-tracker", "Move the bound Issue to done and close it through the provider adapter")
    .option("--finish", "Mark the run archived after local and tracker closeout")
    .action(async (name: string, options: ArchiveOptionsV3) => {
      try {
        const projectRoot = resolve(options.path);
        const token = resolveLifecycleTokenV3(
          projectRoot,
          name,
          options,
          dependencies.createStore,
        );
        const explicit = [
          options.begin,
          options.local,
          options.confirmTracker,
          options.finish,
        ].filter(Boolean).length;
        if (explicit > 1) {
          throw Object.assign(new Error("Choose only one archive operation per invocation"), { code: "ARCHIVE_OPERATION_AMBIGUOUS" });
        }
        let operation: "begin" | "local" | "tracker" | "finish" | "cleanup";
        let inspectedState: RunStateV3 | undefined;
        if (options.begin) operation = "begin";
        else if (options.local) operation = "local";
        else if (options.confirmTracker) operation = "tracker";
        else if (options.finish) operation = "finish";
        else {
          const state = inspectArchiveRunV3(projectRoot, name, token.runId, dependencies);
          if (!state) throw Object.assign(new Error(`Run '${token.runId}' was not found`), { code: "RUN_NOT_FOUND" });
          inspectedState = state;
          operation = state.phase === "ready_for_archive"
            ? "begin"
            : state.phase === "archiving" && !state.archive?.localCompleted
              ? "local"
              : state.phase === "archiving" && !state.archive?.trackerCompleted
                ? "tracker"
                : state.phase === "archived"
                  ? "cleanup"
                  : "finish";
        }
        if (operation === "local") {
          const current = inspectedState
            ?? requireArchiveRunV3(projectRoot, name, token.runId, dependencies);
          const evidence = await materializeArchiveEvidenceV3({ projectRoot, changeName: name, token }, dependencies);
          const closeout = await performLocalArchiveCloseoutV3({
            projectRoot,
            changeName: name,
            state: current,
            evidenceManifestHash: evidence.evidenceManifestHash,
            store: options.store,
          }, dependencies);
          const state = await completeLocalArchiveV3({
            projectRoot,
            changeName: name,
            token,
            ...closeout,
          }, dependencies);
          emitLifecycleResult(lifecycleCommandOutputV3("archive-local", state, {
            ...closeout,
            changeEvidencePath: evidence.changeEvidencePath,
            evidenceIdempotent: evidence.idempotent,
          }), options.json);
          return;
        }
        if (operation === "cleanup") {
          const state = inspectedState
            ?? requireArchiveRunV3(projectRoot, name, token.runId, dependencies);
          const cleanup = await (dependencies.cleanupWorktree ?? cleanupArchivedWorktreeV3)(projectRoot);
          emitLifecycleResult(lifecycleCommandOutputV3("archive-cleanup", state, { cleanup }), options.json);
          return;
        }
        const state = operation === "begin"
          ? await beginArchiveV3({ projectRoot, changeName: name, token }, dependencies)
          : operation === "tracker"
              ? await completeArchiveTrackerCloseoutV3({
                  projectRoot,
                  changeName: name,
                  token,
                  state: inspectedState
                    ?? requireArchiveRunV3(projectRoot, name, token.runId, dependencies),
                }, dependencies)
              : await finishArchiveV3({ projectRoot, changeName: name, token }, dependencies);
        if (operation === "finish") {
          const cleanup = await (dependencies.cleanupWorktree ?? cleanupArchivedWorktreeV3)(projectRoot);
          emitLifecycleResult(lifecycleCommandOutputV3("archive-finish", state, { cleanup }), options.json);
          return;
        }
        emitLifecycleResult(lifecycleCommandOutputV3(`archive-${operation}`, state), options.json);
      } catch (error) {
        emitLifecycleFailure("archive", error, options.json);
      }
    });
}

export async function completeArchiveTrackerCloseoutV3(input: {
  projectRoot: string;
  changeName: string;
  token: LifecycleTokenV3;
  state: RunStateV3;
}, dependencies: ArchiveV3CommandDependencies = {}): Promise<RunStateV3> {
  assertCurrentToken(input.state, input.token);
  if (input.state.phase !== "archiving" || input.state.archive?.localCompleted !== true) {
    throw new LifecycleV3Error(
      "RUN_ARCHIVE_LOCAL_REQUIRED",
      "Issue closeout requires the completed local archive transaction",
    );
  }

  const root = resolve(input.projectRoot);
  const verifyIntegrity = dependencies.verifyCloseoutIntegrity
    ?? ((projectRoot: string, state: RunStateV3) => dependencies.createGit
      ? assertArchiveCloseoutIntegrityV3(
          projectRoot,
          state,
          dependencies.createGit(projectRoot),
          dependencies.verifyArchiveCheckpoint,
        )
      : assertArchiveCloseoutIntegrityV3(projectRoot, state));
  await verifyIntegrity(root, input.state);
  const resolved = dependencies.resolveChangeContract
    ? await dependencies.resolveChangeContract(root, input.changeName)
    : resolveArchiveChangeContractV3(root, input.changeName, input.state);
  assertArchiveTrackerContract(input.state, resolved.contract);
  const binding = resolved.contract.source.tracker;

  if (binding.provider === "none") {
    if (!input.state.archive.trackerCompleted) {
      throw new LifecycleV3Error(
        "RUN_TRACKER_STATE_INVALID",
        "provider-none archive did not initialize tracker closeout as complete",
      );
    }
    return input.state;
  }
  if (input.state.archive.trackerCompleted) return input.state;
  await syncTrackerStateV3(root, input.state, dependencies, {
    workflowState: "done",
    close: true,
  });

  const recordCompleted = dependencies.recordTrackerCompleted
    ?? ((request: { projectRoot: string; changeName: string; token: LifecycleTokenV3 }) =>
      completeTrackerArchiveV3(request, dependencies));
  return await recordCompleted({
    projectRoot: root,
    changeName: input.changeName,
    token: input.token,
  });
}

export function resolveArchiveChangeContractV3(
  projectRoot: string,
  changeName: string,
  state: RunStateV3,
): { changeRoot: string; contract: LoadedChangeContract } {
  const activeSource = resolve(projectRoot, state.contract.sourcePath);
  const activeChangeRoot = dirname(dirname(activeSource));
  const candidates = new Set<string>();
  if (existsSync(activeSource)) candidates.add(activeChangeRoot);

  const archiveRoot = resolve(dirname(activeChangeRoot), "archive");
  if (existsSync(archiveRoot)) {
    for (const entry of readdirSync(archiveRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory()
        && (entry.name === changeName || entry.name.endsWith(`-${changeName}`))
        && existsSync(resolve(archiveRoot, entry.name, "corgi", "source.yaml"))
      ) {
        candidates.add(resolve(archiveRoot, entry.name));
      }
    }
  }

  const matches = [...candidates].flatMap((changeRoot) => {
    const contract = loadChangeContract(changeRoot, { required: true })!;
    return contract.sourceDigest === state.contract.sourceDigest
      && contract.traceabilityDigest === state.contract.traceabilityDigest
      ? [{ changeRoot, contract }]
      : [];
  });
  if (matches.length === 0) {
    throw new LifecycleV3Error(
      "ARCHIVE_CHANGE_CONTRACT_NOT_FOUND",
      "Could not find the active or archived Change contract bound to this Run Contract",
    );
  }
  if (matches.length > 1) {
    throw new LifecycleV3Error(
      "ARCHIVE_CHANGE_CONTRACT_AMBIGUOUS",
      "More than one archived Change contract matches this Run Contract",
    );
  }
  return matches[0]!;
}

function inspectArchiveRunV3(
  projectRoot: string,
  changeName: string,
  runId: string,
  dependencies: LifecycleV3Dependencies,
): RunStateV3 | null {
  const store = dependencies.createStore?.(projectRoot) ?? new LoopStoreV3(projectRoot);
  return store.inspect(changeName, runId).state;
}

function requireArchiveRunV3(
  projectRoot: string,
  changeName: string,
  runId: string,
  dependencies: LifecycleV3Dependencies,
): RunStateV3 {
  const state = inspectArchiveRunV3(projectRoot, changeName, runId, dependencies);
  if (!state) throw new LifecycleV3Error("RUN_NOT_FOUND", `Run '${runId}' was not found`);
  return state;
}

function assertCurrentToken(state: RunStateV3, token: LifecycleTokenV3): void {
  if (
    state.runId !== token.runId
    || state.sessionId !== token.sessionId
    || state.stateRevision !== token.stateRevision
    || state.nonce !== token.nonce
  ) {
    throw new LifecycleV3Error("RUN_CAS_CONFLICT", "Run Contract token is stale");
  }
}

function assertArchiveTrackerContract(state: RunStateV3, contract: LoadedChangeContract): void {
  if (
    contract.source.deliveryRef !== state.contract.deliveryRef
    || contract.sourceDigest !== state.contract.sourceDigest
    || contract.traceabilityDigest !== state.contract.traceabilityDigest
    || !sameTrackerBinding(contract.source.tracker, state.contract.tracker)
  ) {
    throw new LifecycleV3Error(
      "ARCHIVE_TRACKER_BINDING_CHANGED",
      "Change contract tracker binding no longer matches the canonical Run Contract",
    );
  }
}

function sameTrackerBinding(left: TrackerBinding, right: TrackerBinding): boolean {
  return left.provider === right.provider
    && left.idempotencyKey === right.idempotencyKey
    && left.issue?.id === right.issue?.id
    && left.issue?.url === right.issue?.url;
}
