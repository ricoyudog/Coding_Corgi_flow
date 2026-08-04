import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Command } from "commander";
import {
  executeLoopV2,
  type LoopExecutionResultV2,
} from "../loop-v2.js";
import { LoopStoreV2 } from "../../lib/loop-store-v2.js";
import {
  findProjectRoot,
  isHooksDisabled,
  readStdinJson,
} from "../../lib/hooks.js";
import { inspectLegacyLoop } from "../../lib/legacy-loop.js";
import { isActiveLoopPhaseV2, type LoopStateV2 } from "../../lib/run-contract-v2.js";

export interface HookLoopCheckDependenciesV2 {
  listChanges?: (projectRoot: string) => Promise<string[]>;
  inspect?: (projectRoot: string, changeName: string) => Promise<LoopExecutionResultV2>;
}

interface HookLoopActionV2 {
  type:
    | "dispatch_group"
    | "evaluate"
    | "fix_group"
    | "commit_group"
    | "sync_tracker"
    | "finalize"
    | "terminal";
  groupId?: string;
  attempt?: number;
}

interface HookLoopOutputV2 {
  schemaVersion: 2;
  decision: "proceed" | "block";
  status: "idle" | "active" | "terminal" | "contract_error";
  changeName?: string;
  runId?: string;
  phase?: LoopStateV2["phase"];
  terminal?: boolean;
  action?: HookLoopActionV2;
  reason?: string;
  error?: { code: string; message: string };
}

export function createHookLoopCheckCommand(
  dependencies: HookLoopCheckDependenciesV2 = {},
): Command {
  const command = new Command("loop-check");

  command
    .description("Inspect canonical Run Contract v2 state for a Stop hook")
    .option("--path <dir>", "Working directory", ".")
    .action(async (options: { path: string }) => {
      if (isHooksDisabled()) {
        emit({ schemaVersion: 2, decision: "proceed", status: "idle" }, 0);
        return;
      }

      try {
        const input = await readStdinJson();
        if (input.stop_hook_active === true) {
          emit({
            schemaVersion: 2,
            decision: "proceed",
            status: "idle",
            reason: "Stop hook re-entry is already active",
          }, 0);
          return;
        }

        const cwd = resolve(options.path);
        const projectRoot = findProjectRoot(cwd);
        if (!projectRoot) {
          emit({ schemaVersion: 2, decision: "proceed", status: "idle" }, 0);
          return;
        }

        const listChanges = dependencies.listChanges ?? listCanonicalChanges;
        const inspect = dependencies.inspect ?? inspectCanonicalChange;
        const inspected = await Promise.all(
          (await listChanges(projectRoot)).map(async (changeName) => ({
            changeName,
            result: await inspect(projectRoot, changeName),
          })),
        );
        const failures = inspected.filter(({ result }) => result.exitCode === 2);
        if (failures.length > 0) {
          const failure = failures[0]!;
          emit(contractFailure(
            failure.changeName,
            failure.result.output.error?.code ?? "loop_inspect_failed",
            failure.result.output.error?.message ?? "Canonical loop inspection failed",
          ), 2);
          return;
        }

        const active = inspected.filter(({ result }) => {
          const state = result.output.state;
          return state !== undefined && isActiveLoopPhaseV2(state.phase);
        });
        if (active.length > 1) {
          emit(contractFailure(
            undefined,
            "multiple_active_changes",
            `Multiple active loop changes match this Stop hook: ${active.map(({ changeName }) => changeName).join(", ")}`,
          ), 2);
          return;
        }
        if (active.length === 0) {
          const terminal = inspected
            .map(({ changeName, result }) => ({ changeName, state: result.output.state }))
            .find((entry) => entry.state !== undefined);
          if (!terminal?.state) {
            emit({ schemaVersion: 2, decision: "proceed", status: "idle" }, 0);
            return;
          }
          emit(stateOutput(terminal.changeName, terminal.state), 0);
          return;
        }

        const selected = active[0]!;
        const state = selected.result.output.state!;
        const sessionId = input.session_id?.trim() ?? "";
        if (!sessionId || sessionId !== state.sessionId) {
          emit(contractFailure(
            selected.changeName,
            "session_conflict",
            `Stop hook session '${sessionId || "<missing>"}' does not own run '${state.runId}'`,
          ), 2);
          return;
        }
        emit(stateOutput(selected.changeName, state), 0);
      } catch (error) {
        emit(contractFailure(
          undefined,
          error && typeof error === "object" && "code" in error && typeof error.code === "string"
            ? error.code
            : "hook_contract_error",
          error instanceof Error ? error.message : String(error),
        ), 2);
      }
    });

  return command;
}

async function listCanonicalChanges(projectRoot: string): Promise<string[]> {
  const names = new Set<string>();
  for (const root of [
    resolve(projectRoot, ".corgi", "loop"),
    resolve(projectRoot, ".claude", "corgi-loop"),
    resolve(projectRoot, ".opencode", "corgi-loop"),
  ]) {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const unsafe = entries.find((entry) => entry.isSymbolicLink());
      if (unsafe) {
        throw Object.assign(
          new Error(`Symbolic links are not allowed in loop storage: ${resolve(root, unsafe.name)}`),
          { code: "loop_path_unsafe" },
        );
      }
      for (const entry of entries) {
        if (entry.isDirectory()) names.add(entry.name);
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error
        && (error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return [...names].sort();
}

async function inspectCanonicalChange(
  projectRoot: string,
  changeName: string,
): Promise<LoopExecutionResultV2> {
  // A Stop hook must not repair canonical files before it has verified the
  // owning session. Read a healthy (or merely stale-pointer) v2 run through
  // strict peek; reserve the mutating inspect path for one-time v1 migration.
  const inspection = await new LoopStoreV2({ projectRoot }).peek(changeName);
  if (inspection.state) {
    return {
      exitCode: 0,
      output: {
        schemaVersion: 2,
        operation: "inspect",
        status: "ok",
        changeName,
        state: inspection.state,
        current: inspection.current,
        recoveryRequired: inspection.recoveryRequired,
        token: {
          stateRevision: inspection.state.stateRevision,
          nonce: inspection.state.nonce,
        },
      },
    };
  }

  const legacy = inspectLegacyLoop(projectRoot, changeName);
  const safelyInactive = legacy.runs.length === 1
    && legacy.runs.every((run) => !run.active)
    && legacy.corruptPaths.length === 0
    && legacy.unsupportedPaths.length === 0;
  if (safelyInactive) {
    return {
      exitCode: 0,
      output: {
        schemaVersion: 2,
        operation: "inspect",
        status: "ok",
        changeName,
      },
    };
  }

  return await executeLoopV2({
    operation: "inspect",
    projectRoot,
    changeName,
  });
}

function stateOutput(changeName: string, state: LoopStateV2): HookLoopOutputV2 {
  const terminal = !isActiveLoopPhaseV2(state.phase);
  return {
    schemaVersion: 2,
    decision: terminal ? "proceed" : "block",
    status: terminal ? "terminal" : "active",
    changeName,
    runId: state.runId,
    phase: state.phase,
    terminal,
    action: actionForState(state),
    ...(state.blockedReason ? { reason: state.blockedReason.message } : {}),
  };
}

function actionForState(state: LoopStateV2): HookLoopActionV2 {
  // Hooks only report the explicit tracker checkpoint action; they never
  // execute it or call a tracker CLI themselves.
  if (state.phase === "awaiting_tracker_sync") {
    return {
      type: "sync_tracker",
      groupId: state.currentGroupId ?? undefined,
      attempt: state.currentAttempt,
    };
  }

  switch (state.phase) {
    case "awaiting_group_result":
      return { type: "dispatch_group", groupId: state.currentGroupId ?? undefined, attempt: state.currentAttempt };
    case "awaiting_evaluation":
      return { type: "evaluate", groupId: state.currentGroupId ?? undefined, attempt: state.currentAttempt };
    case "fixing":
      return { type: "fix_group", groupId: state.currentGroupId ?? undefined, attempt: state.currentAttempt };
    case "awaiting_group_commit":
      return { type: "commit_group", groupId: state.currentGroupId ?? undefined, attempt: state.currentAttempt };
    case "awaiting_finalize":
      return { type: "finalize" };
    default:
      return { type: "terminal" };
  }
}

function contractFailure(
  changeName: string | undefined,
  code: string,
  message: string,
): HookLoopOutputV2 {
  return {
    schemaVersion: 2,
    decision: "proceed",
    status: "contract_error",
    terminal: false,
    ...(changeName ? { changeName } : {}),
    error: { code, message },
  };
}

function emit(output: HookLoopOutputV2, exitCode: 0 | 2): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}
