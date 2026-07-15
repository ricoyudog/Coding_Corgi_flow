import {
  assertLoopStateV2,
  type ArtifactHashV2,
  type LoopGroupStateV2,
  type LoopOwnerV2,
  type LoopStateV2,
} from "./run-contract-v2.js";

export interface SuccessorTaskGroupV2 {
  id: string;
  taskGroupFingerprint: ArtifactHashV2;
}

export interface CreateSuccessorRunV2Input {
  previousState: LoopStateV2;
  runId: string;
  sessionId: string;
  owner: LoopOwnerV2;
  nonce: string;
  startedAt: string;
  planningRevision: ArtifactHashV2;
  baselineGitRevision: string;
  workspaceFingerprint: ArtifactHashV2;
  groups: readonly SuccessorTaskGroupV2[];
  /** Canonically verified reuse allowlist; omit only for trusted internal callers. */
  reusableEvidenceGroupIds?: readonly string[];
}

export interface SuccessorRunV2 {
  state: LoopStateV2;
  reusableEvidenceGroups: string[];
}

export class LoopSuccessorV2Error extends Error {
  constructor(
    public readonly code:
      | "invalid_previous_state"
      | "previous_run_not_terminal"
      | "invalid_successor_groups"
      | "invalid_successor_state",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LoopSuccessorV2Error";
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function pendingGroup(
  input: SuccessorTaskGroupV2,
  ordinal: number,
  current: boolean,
  requirePush: boolean,
): LoopGroupStateV2 {
  return {
    id: input.id,
    ordinal,
    status: current ? "in_progress" : "pending",
    taskGroupFingerprint: input.taskGroupFingerprint,
    attempt: current ? 1 : 0,
    bundle: {
      status: "none",
      bundleId: null,
      bundleHash: null,
      artifactHash: null,
      evidenceHash: null,
      reviewHash: null,
      observedGitRevision: null,
      workspaceFingerprint: null,
    },
    push: {
      status: requirePush ? "pending" : "not_required",
      remoteRevision: null,
    },
    commit: {
      status: "pending",
      revision: null,
      tree: null,
      workspaceFingerprint: null,
    },
    completedAt: null,
  };
}

function reusable(
  previous: LoopGroupStateV2 | undefined,
  next: SuccessorTaskGroupV2,
  ordinal: number,
  allowlist: ReadonlySet<string> | undefined,
): previous is LoopGroupStateV2 {
  return (allowlist === undefined || allowlist.has(next.id))
    && previous !== undefined
    && previous.status === "completed"
    && previous.bundle.status === "approved"
    && previous.commit.status === "acknowledged"
    && previous.taskGroupFingerprint === next.taskGroupFingerprint
    && previous.ordinal === ordinal;
}

/** Construct an event-zero successor without mutating the previous run. */
export function createSuccessorRunV2(
  input: CreateSuccessorRunV2Input,
): SuccessorRunV2 {
  try {
    assertLoopStateV2(input.previousState);
  } catch (error) {
    throw new LoopSuccessorV2Error(
      "invalid_previous_state",
      `Previous run is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!["invalidated", "done"].includes(input.previousState.phase)) {
    throw new LoopSuccessorV2Error(
      "previous_run_not_terminal",
      `Only invalidated or done runs can be superseded, got '${input.previousState.phase}'`,
    );
  }
  if (
    input.groups.length === 0 ||
    input.groups.some((group) => !group.id.trim()) ||
    new Set(input.groups.map((group) => group.id)).size !== input.groups.length
  ) {
    throw new LoopSuccessorV2Error(
      "invalid_successor_groups",
      "Successor task groups must be non-empty with unique non-empty ids",
    );
  }

  const reusableEvidenceGroups: string[] = [];
  const groups: Record<string, LoopGroupStateV2> = {};
  let currentGroupId: string | null = null;
  let reusePrefixOpen = true;
  const reuseAllowlist = input.reusableEvidenceGroupIds === undefined
    ? undefined
    : new Set(input.reusableEvidenceGroupIds);
  if (
    reuseAllowlist &&
    (reuseAllowlist.size !== input.reusableEvidenceGroupIds!.length ||
      [...reuseAllowlist].some((id) => !input.groups.some((group) => group.id === id)))
  ) {
    throw new LoopSuccessorV2Error(
      "invalid_successor_groups",
      "Reusable evidence allowlist must contain unique current Task Group ids",
    );
  }
  for (const [index, next] of input.groups.entries()) {
    const previous = input.previousState.groups[next.id];
    if (reusePrefixOpen && reusable(previous, next, index + 1, reuseAllowlist)) {
      groups[next.id] = {
        ...clone(previous),
        id: next.id,
        ordinal: index + 1,
        taskGroupFingerprint: next.taskGroupFingerprint,
      };
      reusableEvidenceGroups.push(next.id);
      continue;
    }
    reusePrefixOpen = false;
    const current = currentGroupId === null;
    groups[next.id] = pendingGroup(
      next,
      index + 1,
      current,
      input.previousState.policy.requirePush,
    );
    if (current) currentGroupId = next.id;
  }

  const allReused = currentGroupId === null;
  const state: LoopStateV2 = {
    schemaVersion: 2,
    changeName: input.previousState.changeName,
    runId: input.runId,
    supersedesRunId: input.previousState.runId,
    owner: clone(input.owner),
    sessionId: input.sessionId,
    mode: input.previousState.mode,
    stateRevision: 0,
    nonce: input.nonce,
    lastEventSeq: 0,
    phase: allReused ? "awaiting_finalize" : "awaiting_group_result",
    currentGroupId,
    currentAttempt: allReused ? 0 : 1,
    policy: clone(input.previousState.policy),
    limits: {
      ...clone(input.previousState.limits),
      maxGroups: Math.max(input.previousState.limits.maxGroups, input.groups.length),
    },
    blockedReason: null,
    planningRevision: input.planningRevision,
    git: {
      baselineRevision: input.baselineGitRevision,
      finalRevision: null,
      workspaceFingerprint: input.workspaceFingerprint,
    },
    groups,
    startedAt: input.startedAt,
    updatedAt: input.startedAt,
    completedAt: null,
  };
  try {
    assertLoopStateV2(state);
  } catch (error) {
    throw new LoopSuccessorV2Error(
      "invalid_successor_state",
      `Successor run is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return { state, reusableEvidenceGroups };
}
