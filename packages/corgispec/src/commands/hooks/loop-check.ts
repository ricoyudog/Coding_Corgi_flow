import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { Command } from "commander";

import {
  discoverHookProjectRoots,
  findProjectRoot,
  isHooksDisabled,
  readStdinJson,
} from "../../lib/hooks.js";
import { inspectLegacyLoop } from "../../lib/legacy-loop.js";
import { ACTIVE_PHASES_V2 } from "../../lib/run-contract-v2.js";
import {
  assertRunStateV3,
  isActiveRunPhaseV3,
  reduceRunEventV3,
  type RunEventRecordV3,
  type RunStateV3,
} from "../../lib/run-contract-v3.js";

export interface HookLoopCheckDependenciesV3 {
  listChanges?: (projectRoot: string) => string[];
  inspect?: (projectRoot: string, changeName: string) => InspectedRunV3;
  listWorktrees?: (cwd: string) => string[];
}

export interface InspectedRunV3 {
  state: RunStateV3 | null;
}

interface HookLoopActionV3 {
  type:
    | "apply"
    | "verify"
    | "human_review"
    | "human_qa"
    | "archive"
    | "implementation_repair"
    | "rfc_amendment"
    | "terminal";
  groupId?: string;
}

interface HookLoopOutputV3 {
  schemaVersion: 3;
  decision: "proceed" | "block";
  status: "idle" | "active" | "terminal" | "contract_error";
  changeName?: string;
  runId?: string;
  phase?: RunStateV3["phase"];
  stateRevision?: number;
  nonce?: string;
  terminal?: boolean;
  action?: HookLoopActionV3;
  reason?: string;
  error?: { code: string; message: string };
}

export function createHookLoopCheckCommand(
  dependencies: HookLoopCheckDependenciesV3 = {},
): Command {
  return new Command("loop-check")
    .description("Read canonical Run Contract v3 state for a Stop hook")
    .option("--path <dir>", "Working directory", ".")
    .action(async (options: { path: string }) => {
      if (isHooksDisabled()) {
        emit({ schemaVersion: 3, decision: "proceed", status: "idle" }, 0);
        return;
      }

      try {
        const input = await readStdinJson();
        if (input.stop_hook_active === true) {
          emit({
            schemaVersion: 3,
            decision: "proceed",
            status: "idle",
            reason: "Stop hook re-entry is already active",
          }, 0);
          return;
        }

        const projectRoot = findProjectRoot(resolve(options.path));
        if (!projectRoot) {
          emit({ schemaVersion: 3, decision: "proceed", status: "idle" }, 0);
          return;
        }

        const listChanges = dependencies.listChanges ?? listRunChanges;
        const inspect = dependencies.inspect ?? inspectRunReadOnly;
        const inspected: Array<{
          changeName: string;
          projectRoot: string;
          state: RunStateV3 | null;
        }> = [];
        for (const worktreeRoot of discoverHookProjectRoots(projectRoot, dependencies)) {
          for (const changeName of listChanges(worktreeRoot)) {
            try {
              inspected.push({
                changeName,
                projectRoot: worktreeRoot,
                state: inspect(worktreeRoot, changeName).state,
              });
            } catch (error) {
              emit(contractFailure(changeName, errorCode(error), errorMessage(error)), 2);
              return;
            }
          }
        }

        const active = inspected.filter(({ state }) => state && isActiveRunPhaseV3(state.phase));
        if (active.length > 1) {
          emit(contractFailure(
            undefined,
            "MULTIPLE_ACTIVE_CHANGES",
            `Multiple active Run Contract v3 changes match this Stop hook: ${active.map(({ changeName, projectRoot: root }) => `${changeName} (${root})`).join(", ")}`,
          ), 2);
          return;
        }
        if (active.length === 0) {
          const terminal = inspected.find((entry) => entry.state !== null);
          if (!terminal?.state) {
            emit({ schemaVersion: 3, decision: "proceed", status: "idle" }, 0);
            return;
          }
          emit(stateOutput(terminal.changeName, terminal.state), 0);
          return;
        }

        const selected = active[0]!;
        const state = selected.state!;
        const sessionId = input.session_id?.trim() ?? "";
        if (!sessionId || sessionId !== state.sessionId) {
          emit(contractFailure(
            selected.changeName,
            "SESSION_CONFLICT",
            `Stop hook session '${sessionId || "<missing>"}' does not own run '${state.runId}'`,
          ), 2);
          return;
        }
        emit(stateOutput(selected.changeName, state), 0);
      } catch (error) {
        emit(contractFailure(undefined, errorCode(error), errorMessage(error)), 2);
      }
    });
}

function listRunChanges(projectRoot: string): string[] {
  const names = new Set<string>();
  for (const root of [
    resolve(projectRoot, ".corgi", "loop"),
    resolve(projectRoot, ".claude", "corgi-loop"),
    resolve(projectRoot, ".opencode", "corgi-loop"),
  ]) {
    if (!existsSync(root)) continue;
    assertDirectory(root);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const path = resolve(root, entry.name);
      if (entry.isSymbolicLink() || !entry.isDirectory()) {
        throw hookError("LOOP_PATH_UNSAFE", `Run storage contains an unsafe entry: ${path}`);
      }
      names.add(entry.name);
    }
  }
  return [...names].sort(compareCodeUnits);
}

function inspectRunReadOnly(projectRoot: string, changeName: string): InspectedRunV3 {
  assertSafeSegment(changeName, "change name");
  assertLegacyRunInactive(projectRoot, changeName);
  const changeRoot = resolve(projectRoot, ".corgi", "loop", changeName);
  if (!existsSync(changeRoot)) return { state: null };
  assertDirectory(changeRoot);
  const runsRoot = resolve(changeRoot, "runs");
  const states: RunStateV3[] = [];
  if (existsSync(runsRoot)) {
    assertDirectory(runsRoot);
    for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
      const runRoot = resolve(runsRoot, entry.name);
      if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name.startsWith(".")) {
        throw hookError("LOOP_PATH_UNSAFE", `Run storage contains an unsafe run entry: ${runRoot}`);
      }
      assertSafeSegment(entry.name, "run id");
      const raw = readJsonFile(resolve(runRoot, "state.json"));
      if (isRecord(raw) && raw.schemaVersion === 2) {
        if (typeof raw.phase !== "string") {
          throw hookError("LOOP_V2_STATE_INVALID", `Run Contract v2 '${entry.name}' has no valid phase`);
        }
        if ((ACTIVE_PHASES_V2 as readonly string[]).includes(raw.phase)) {
          throw hookError(
            "ACTIVE_V2_RUN_UNSUPPORTED",
            `Active Run Contract v2 '${entry.name}' must finish or be withdrawn before v4`,
          );
        }
        continue;
      }
      assertRunStateV3(raw);
      if (raw.changeName !== changeName || raw.runId !== entry.name) {
        throw hookError("LOOP_IDENTITY_MISMATCH", `Run '${entry.name}' does not match its storage path`);
      }
      const replayed = replayRecordsReadOnly(resolve(runRoot, "events.jsonl"));
      if (!isDeepStrictEqual(replayed, raw)) {
        throw hookError("LOOP_CORRUPTION", `Run '${entry.name}' state does not match its event log`);
      }
      states.push(raw);
    }
  }

  const active = states.filter((state) => isActiveRunPhaseV3(state.phase));
  if (active.length > 1) {
    throw hookError("LOOP_MULTIPLE_ACTIVE", `Change '${changeName}' has multiple active Run Contract v3 runs`);
  }
  const pointerPath = resolve(changeRoot, "current.json");
  let selected: RunStateV3 | undefined = active[0];
  if (existsSync(pointerPath)) {
    const pointer = readJsonFile(pointerPath);
    if (!isRecord(pointer) || ![2, 3].includes(Number(pointer.schemaVersion))) {
      throw hookError("LOOP_POINTER_INVALID", `Current run pointer for '${changeName}' has an unsupported schema`);
    }
    if (pointer.schemaVersion === 3) {
      const pointed = states.find((state) => state.runId === pointer.runId);
      if (!pointed) throw hookError("LOOP_POINTER_INVALID", `Current run pointer references a missing v3 run`);
      if (
        pointer.stateRevision !== pointed.stateRevision
        || pointer.nonce !== pointed.nonce
        || pointer.phase !== pointed.phase
      ) {
        throw hookError("LOOP_POINTER_STALE", `Current run pointer for '${changeName}' is stale`);
      }
      if (selected && selected.runId !== pointed.runId) {
        throw hookError("LOOP_POINTER_STALE", `Current run pointer does not reference the active v3 run`);
      }
      selected ??= pointed;
    }
  }
  selected ??= states.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  return { state: selected ?? null };
}

function replayRecordsReadOnly(path: string): RunStateV3 {
  const content = readRegularFile(path);
  if (!content.trim()) throw hookError("LOOP_CORRUPTION", `Run event log is empty: ${path}`);
  let state: RunStateV3 | null = null;
  for (const [index, line] of content.trimEnd().split("\n").entries()) {
    let record: RunEventRecordV3;
    try {
      record = JSON.parse(line) as RunEventRecordV3;
    } catch (error) {
      throw hookError("LOOP_CORRUPTION", `Malformed event ${index + 1}: ${errorMessage(error)}`);
    }
    if (record.schemaVersion !== 3 || !record.event || !record.postState) {
      throw hookError("LOOP_CORRUPTION", `Event ${index + 1} has an invalid Run Contract v3 shape`);
    }
    const reduced = reduceRunEventV3(state, record.event);
    if (!isDeepStrictEqual(reduced.postState, record.postState)) {
      throw hookError("LOOP_CORRUPTION", `Event ${index + 1} postState does not match the reducer`);
    }
    state = reduced.postState;
  }
  if (!state) throw hookError("LOOP_CORRUPTION", "Run has no initialization event");
  return state;
}

function assertLegacyRunInactive(projectRoot: string, changeName: string): void {
  const legacy = inspectLegacyLoop(projectRoot, changeName);
  if (legacy.corruptPaths.length > 0 || legacy.unsupportedPaths.length > 0) {
    throw hookError(
      "LEGACY_RUN_INVALID",
      `Legacy run storage is corrupt or unsupported: ${[...legacy.corruptPaths, ...legacy.unsupportedPaths].join(", ")}`,
    );
  }
  const active = legacy.runs.filter((run) => run.active);
  if (active.length > 0) {
    throw hookError(
      "ACTIVE_LEGACY_RUN_UNSUPPORTED",
      `Active legacy run for '${changeName}' must finish or be withdrawn before v4`,
    );
  }
}

function stateOutput(changeName: string, state: RunStateV3): HookLoopOutputV3 {
  const terminal = !isActiveRunPhaseV3(state.phase);
  return {
    schemaVersion: 3,
    decision: terminal ? "proceed" : "block",
    status: terminal ? "terminal" : "active",
    changeName,
    runId: state.runId,
    phase: state.phase,
    stateRevision: state.stateRevision,
    nonce: state.nonce,
    terminal,
    action: actionForState(state),
    ...(state.repair?.reason ? { reason: state.repair.reason } : {}),
  };
}

function actionForState(state: RunStateV3): HookLoopActionV3 {
  switch (state.phase) {
    case "planning_ready":
    case "applying":
      return { type: "apply", ...(state.currentGroupId ? { groupId: state.currentGroupId } : {}) };
    case "awaiting_verify":
      return { type: "verify" };
    case "awaiting_human_review":
      return { type: "human_review" };
    case "awaiting_human_qa":
      return { type: "human_qa" };
    case "ready_for_archive":
    case "archiving":
      return { type: "archive" };
    case "repair_required":
      return { type: state.repair?.kind === "rfc_amendment" ? "rfc_amendment" : "implementation_repair" };
    default:
      return { type: "terminal" };
  }
}

function contractFailure(
  changeName: string | undefined,
  code: string,
  message: string,
): HookLoopOutputV3 {
  return {
    schemaVersion: 3,
    decision: "proceed",
    status: "contract_error",
    terminal: false,
    ...(changeName ? { changeName } : {}),
    error: { code, message },
  };
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readRegularFile(path)) as unknown;
  } catch (error) {
    if (isCodedError(error)) throw error;
    throw hookError("LOOP_CORRUPTION", `Malformed JSON in '${path}': ${errorMessage(error)}`);
  }
}

function readRegularFile(path: string): string {
  if (!existsSync(path)) throw hookError("LOOP_FILE_MISSING", `Run Contract file is missing: ${path}`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw hookError("LOOP_PATH_UNSAFE", `Run Contract path is not a regular file: ${path}`);
  }
  return readFileSync(path, "utf8");
}

function assertDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw hookError("LOOP_PATH_UNSAFE", `Run Contract path is not a directory: ${path}`);
  }
}

function assertSafeSegment(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value) || value === "." || value === "..") {
    throw hookError("LOOP_PATH_UNSAFE", `Unsafe ${label}: '${value}'`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hookError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function isCodedError(error: unknown): error is { code: string } {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string";
}

function errorCode(error: unknown): string {
  return isCodedError(error) ? error.code : "HOOK_CONTRACT_ERROR";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareCodeUnits(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function emit(output: HookLoopOutputV3, exitCode: 0 | 2): void {
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exitCode = exitCode;
}
