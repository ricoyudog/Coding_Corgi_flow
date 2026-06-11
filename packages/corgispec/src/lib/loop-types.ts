// ─── Enums ─────────────────────────────────────────────────────────────

/**
 * All possible phases of the Corgi Loop state machine.
 * Non-terminal phases: init, awaiting_group_result, fixing, awaiting_finalize.
 * Terminal phases: done, verify_failed, stopped_review_findings,
 * error_validation, session_conflict, circuit_breaker, error_corruption,
 * worktree_missing.
 *
 * Phase descriptions:
 * - **init**: Loop is initializing, loading state and change config.
 * - **awaiting_group_result**: Loop is waiting for the current group to be applied and verified.
 * - **fixing**: Auto-fixing phase — triggered when blocking findings exist. The loop
 *   implements fixes directly and re-evaluates.
 * - **awaiting_finalize**: All groups processed, awaiting finalization or human review.
 * - **done**: Loop completed successfully.
 * - **verify_failed**: Verification failed; loop stopped.
 * - **stopped_review_findings**: Review found blocking issues; loop stopped.
 * - **error_validation**: State validation error; loop stopped.
 * - **session_conflict**: Session ID mismatch; loop stopped.
 * - **circuit_breaker**: Too many blocks; circuit breaker triggered.
 * - **error_corruption**: State file corrupted; loop stopped.
 * - **worktree_missing**: Git worktree not found; loop stopped.
 */
export type LoopPhase =
  | "init"
  | "awaiting_group_result"
  | "awaiting_finalize"
  | "fixing"
  | "done"
  | "verify_failed"
  | "stopped_review_findings"
  | "error_validation"
  | "session_conflict"
  | "circuit_breaker"
  | "error_corruption"
  | "worktree_missing";

/** Allowed values for a verification verdict. */
export type Verdict = "PASS" | "PASS_WITH_WARNINGS" | "FAIL";

/** Severity levels for review findings, ordered from most to least critical. */
export type Severity = "critical" | "important" | "suggestion" | "nit" | "fyi";

/** Source of evidence: deterministic CLI tool vs. LLM judgment. */
export type Provenance = "cli-emitted" | "llm-interpreted";

// ─── Loop State ────────────────────────────────────────────────────────

/**
 * Auto-approval policy controlling which verdicts and actions
 * the loop may take without human intervention.
 */
export interface AutoApprovalPolicy {
  /** Whether the loop may commit and push after a passing group. */
  allowCommitPush: boolean;
  /** Whether PASS_WITH_WARNINGS verdicts are treated as passing. */
  allowPassWithWarnings: boolean;
}

/**
 * Persisted state for an active Corgi Loop session.
 * Stored at `.claude/corgi-loop/<change>/state.json`.
 */
export interface LoopState {
  /** Whether the loop is currently active (false = stopped or completed). */
  active: boolean;
  /** Name of the change being processed. */
  changeName: string;
  /** Runtime session identifier; validated on every hook invocation. */
  sessionId: string;
  /** Unique nonce for this state snapshot (timestamp-based). */
  nonce: string;
  /** 1-based index of the group currently being processed. */
  currentGroup: number;
  /** Total number of task groups in the change. */
  totalGroups: number;
  /** Current phase of the state machine. */
  phase: LoopPhase;
  /** Path to the git worktree for this change. */
  worktreePath: string;
  /** Platform schema name (e.g., "github-tracked", "gitlab-tracked"). */
  platform: string;
  /** Policy controlling auto-approval behavior. */
  autoApprovalPolicy: AutoApprovalPolicy;
  /** ISO-8601 timestamp when the loop was started. */
  startedAt: string;
  /** ISO-8601 timestamp of the last state mutation. */
  updatedAt: string;
  /** Group numbers that have been successfully auto-approved. */
  completedGroups: number[];
  /** Per-group status map: group number string → status string. */
  groupStatuses: Record<string, string>;
  /** Per-group push tracking map: group number string → push status string. */
  pushStatus: Record<string, string>;
  /** Number of times the hook has blocked during this loop session. */
  blockCount: number;
  /** Maximum allowed blocks before circuit breaker triggers. */
  maxBlocks: number;
  /** Maximum number of groups that can be processed in this loop. */
  maxGroups: number;
  /** Number of retry attempts for the current group. Reset on group advance. */
  retryCount: number;
  /** Maximum retry attempts per group before terminal stop. */
  maxRetries: number;
  /** Whether the loop is self-driven (OpenCode) or hook-driven (Claude Code). */
  selfDriven: boolean;
}

// ─── Verify Artifact ───────────────────────────────────────────────────

/**
 * A single evidence entry in a verification artifact.
 * CLI-emitted entries include a `command` and `exitCode`.
 * LLM-interpreted entries include a `description` instead.
 */
export interface EvidenceEntry {
  /** Category of evidence (e.g., "test", "build", "lint", "manual-check"). */
  kind: string;
  /** CLI command that was run (present for cli-emitted evidence). */
  command?: string;
  /** Human-readable description (present for llm-interpreted evidence). */
  description?: string;
  /** Outcome of the evidence check. */
  status: string;
  /** Exit code from the CLI command (optional, present for cli-emitted). */
  exitCode?: number;
  /** Whether the result came from a CLI tool or LLM judgment. */
  provenance: Provenance;
}

/**
 * Verification artifact produced after running checks on a task group.
 * Stored at `.claude/corgi-loop/<change>/groups/<N>/verify.json`.
 */
export interface VerifyArtifact {
  /** Schema version for forward compatibility. */
  schemaVersion: number;
  /** Name of the change being verified. */
  changeName: string;
  /** 1-based group number that was verified. */
  group: number;
  /** Nonce matching the loop state at verification time. */
  nonce: string;
  /** Overall verification verdict. */
  verdict: Verdict;
  /** Optional human-readable summary of the verification result. */
  summary?: string;
  /** Individual evidence entries supporting the verdict. */
  evidence: EvidenceEntry[];
}

// ─── Review Artifact ───────────────────────────────────────────────────

/**
 * A single finding in a review artifact.
 * Each finding is classified by severity and associated with a review axis.
 */
export interface FindingDetail {
  /** Severity level of this finding. */
  severity: Severity;
  /** Review axis or check name (e.g., "Spec Coverage", "Code Quality"). */
  check: string;
  /** Specific requirement being checked (e.g., "REQ-3: Error handling"). */
  requirement?: string;
  /** File path related to the finding, if applicable. */
  file?: string;
  /** Human-readable description of the finding. */
  description: string;
}

/**
 * Review artifact produced after reviewing a task group.
 * Stored at `.claude/corgi-loop/<change>/groups/<N>/review.json`.
 */
export interface ReviewArtifact {
  /** Schema version for forward compatibility. */
  schemaVersion: number;
  /** Name of the change being reviewed. */
  changeName: string;
  /** 1-based group number that was reviewed. */
  group: number;
  /** Nonce matching the loop state at review time. */
  nonce: string;
  /** Detailed findings from the review. */
  finding_details: FindingDetail[];
}

// ─── Hook Decision ─────────────────────────────────────────────────────

/**
 * Decision returned by a loop hook invocation.
 * "proceed" allows the loop to continue; "block" stops advancement.
 */
export interface LoopHookDecision {
  /** Whether the loop should proceed or block. */
  decision: "proceed" | "block";
  /** Optional reason explaining the decision. */
  reason?: string;
}
