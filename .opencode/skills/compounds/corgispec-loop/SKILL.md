---
name: corgispec-loop
description: Corgi Loop executor — runs one full Task Group bundle (apply → verify → review-evidence) per invocation, writes structured artifacts, and delegates lifecycle decisions to the stop hook. In OpenCode self-driving mode, evaluates loop-check hook and implements fixes directly.
license: MIT
compatibility: Requires corgispec CLI. Requires corgispec-apply-change, corgispec-verify, and corgispec-review-loop skills.
metadata:
  author: corgispec
  version: "1.1.0"
  generatedBy: "1.3.0"
---

Execute **one full Task Group bundle** for a Corgi Loop: apply the current group, run verify checks, collect review evidence, and write machine-readable artifacts. In self-driving mode (OpenCode), evaluate the loop-check hook and implement fixes directly. In Claude Code, stop after each bundle — the stop hook owns all lifecycle decisions.

This skill operates under the **Hard Logic Orchestrates, LLM Executes** principle:
- **Hook (hard logic)**: state-machine decisions, JSON validation, severity derivation, stop/continue/advance, circuit breakers, stale-artifact protection
- **LLM (this skill)**: apply the group, run verify, gather review evidence, write artifacts, implement fixes (self-driving), commit/push only when instructed

## Architecture

```
.corgi/loop <change-name>
         |
         v
.opencode/commands/corgi/loop.md
         |
         v
.opencode/skills/compounds/corgispec-loop/SKILL.md
         |
         +-- Initializes loop state
         +-- Executes one full group bundle when instructed:
         |     apply -> verify -> review-evidence
         +-- Writes machine-readable artifacts
         +-- (Self-driving) Evaluates loop-check, fixes findings, re-verifies
         +-- Stops after the bundle; hook decides next action
         |
         v
.opencode/corgi-loop/<change>/state.json
.opencode/corgi-loop/<change>/groups/<N>/verify.json
.opencode/corgi-loop/<change>/groups/<N>/review.json
         |
         v
Stop hook evaluates artifacts and either stops or injects next group bundle
```

**Why bundle-per-group instead of phase-per-hook:** Stop hooks have an anti-infinite-loop guard. Phase-per-hook (apply block → verify block → review block → next group) can hit the cap on multi-group changes. The bundle approach reduces hook blocks to roughly one per completed group.

## Preconditions (VERIFY BEFORE STARTING)

- [ ] `openspec/config.yaml` is readable
- [ ] Change name resolved (from input, context, or user prompt)
- [ ] `tasks.md` exists in the change directory with numbered Task Groups
- [ ] If `isolation.mode` is `worktree`: worktree MUST exist (error if not)
- [ ] `corgispec status "<name>" --json` does NOT return `state: "blocked"`

## Forbidden Actions

- NEVER ask for human approval — approve/reject is automatic based on review.json severity counts
- NEVER auto-approve a group without explicit hook instruction
- NEVER continue to the next group unless the hook explicitly instructs you to do so
- NEVER run multiple groups in one invocation
- NEVER skip verify or review-evidence phases
- NEVER mutate `state.json` fields that the hook owns (`active`, `terminal`, `blockCount`, `phase`, `currentGroup`, `retryCount`, `groupStatuses`, `completedGroups`, `pushStatus` lifecycle transitions)
- NEVER fabricate file lists, test results, or evidence
- NEVER modify tasks.md during fix passes (no appending, no unchecking)
- NEVER delegate fix passes to corgispec-apply-change (fixes are implemented directly)
- NEVER implement changes beyond the scope of the reported findings
- NEVER skip posting verify report or review report to child issue (if tracked)

---

## Steps

### 1. Context Gate (Pre-Execution Validation)

Before executing any work, verify all required context is present. If any check fails, STOP and report what's missing.

**Required context:**
1. **config.yaml valid**: `openspec/config.yaml` exists and has `schema` field
2. **isolation.mode resolved**: Read `openspec/config.yaml` and check `isolation.mode`. If `isolation.mode: worktree`, follow `references/worktree-discovery.md` for the full discovery procedure. If `isolation.mode: none` or missing, skip worktree discovery.
3. **Change directory exists**: `openspec/changes/<name>/` exists
4. **tasks.md present**: `openspec/changes/<name>/tasks.md` exists and contains at least one `## N.` Task Group heading
5. **Worktree valid** (if `isolation.mode: worktree`): worktree directory exists and is accessible
6. **Issue tracker reachable** (if tracked): `gh` or `glab` CLI available (non-blocking warning if missing)

**Platform detection**: Read `openspec/config.yaml` `schema` field:
- `github-tracked` → platform root: `.opencode/`, tracker: `gh`
- `gitlab-tracked` → platform root: `.opencode/`, tracker: `glab`

If any check fails, report the specific failure and STOP. Do not proceed with partial context.

### 2. Initialization — Create Loop State

**When to initialize**: The first time the skill runs for a change, OR when `state.json` does not exist.

#### 2.1 Count Task Groups

Read `openspec/changes/<name>/tasks.md`. Count all `## N.` headings (regex: `^##\s+\d+\.`). This is `totalGroups`.

If no groups found: STOP with error — nothing to loop over.

#### 2.1b Resolve Worktree Path

If `isolation.mode` is `worktree` (discovered in Context Gate):
- Run the full worktree discovery procedure from `references/worktree-discovery.md`: scan `<isolation.root>/` directories, verify with `git worktree list`, check `openspec/changes/<name>/` exists inside
- Set `worktreePath` to the absolute worktree path (e.g., `<project-root>/.worktrees/<name>`)
- Write this path into state.json under `worktreePath`

If `isolation.mode` is `none` or missing:
- Set `worktreePath: null` in state.json

The `worktreePath` field MUST be populated with the actual path or `null` — never leave it as the literal string `<path-or-null>`.

#### 2.2 Determine Platform Directory

Set `PLATFORM_DIR` based on which platform is running:
- Running as OpenCode → `.opencode/corgi-loop/<change>/`
- Running as Claude Code → `.claude/corgi-loop/<change>/`
- If uncertain: default to `.opencode/corgi-loop/<change>/`

Create the directory: `mkdir -p <PLATFORM_DIR>/groups/`

#### 2.3 Generate session ID

```
sessionId = "session-" + ISO-8601 timestamp (e.g., "session-2026-06-10T10:00:00Z")
```

#### 2.4 Create state.json

Write `<PLATFORM_DIR>/state.json` with the following structure (see exact schema in Section **Artifact Schemas** below). This is the ONLY time the skill writes lifecycle fields to state.json:

```json
{
  "active": true,
  "changeName": "<change-name>",
  "sessionId": "session-2026-06-10T10:00:00Z",
  "nonce": "<init-timestamp>",
  "currentGroup": 1,
  "totalGroups": <count>,
  "phase": "awaiting_group_result",
  "worktreePath": "<path-or-null>",
  "platform": "<github-tracked|gitlab-tracked>",
  "selfDriven": false,
  "maxRetries": 3,
  "retryCount": 0,
  "autoApprovalPolicy": {
    "allowCommitPush": true,
    "allowPassWithWarnings": false
  },
  "startedAt": "<ISO-8601>",
  "updatedAt": "<ISO-8601>",
  "completedGroups": [],
  "groupStatuses": {},
  "pushStatus": {},
  "blockCount": 0,
  "maxBlocks": 7,
  "maxGroups": 10
}
```

#### 2.5 Self-Driving Mode Detection

Determine platform from invocation context:
- If invoked via `.opencode/commands/corgi-loop.md` → OpenCode → `selfDriven: true`
- If invoked via `.claude/commands/corgi/loop.md` → Claude Code → `selfDriven: false`
- Default if uncertain: `selfDriven: false` (safe default)

When `selfDriven: true`, include `selfDriven: true`, `maxRetries: 3`, `retryCount: 0` in the initial state.json (Section 2.4). These are set ONCE at initialization — the hook owns them thereafter.

**After initialization, STOP.** The hook will pick up the newly created state and direct the next invocation.

### 3. Group Bundle Execution

When the hook has directed you to execute a group bundle (either first-run block or "advance to group N" instruction), perform these phases in order:

#### 3.1 Read State

Read `<PLATFORM_DIR>/state.json`. Confirm:
- `active` is `true`
- `currentGroup` points to a valid group (1 ≤ currentGroup ≤ totalGroups)
- If `worktreePath` is non-null, verify the directory exists: `ls <worktreePath>` or equivalent check. If the worktree has been removed, STOP with error "Worktree at <worktreePath> no longer exists. Run /corgi-loop from the worktree directory."

Record current group as in-progress in session context. The hook writes state.json after evaluation.

#### 3.2 Apply Phase — Delegate to corgispec-apply-change

Delegate the apply work for the current group by loading and executing the `corgispec-apply-change` skill.

**Input to delegate**:
- Change name from state: `state.changeName`
- Task Group number: `state.currentGroup`
- Worktree path: `state.worktreePath` (if applicable)
- Platform/tracker: `state.platform`

The delegate handles: task execution, marking checkboxes in `tasks.md`, closeout summary, issue sync (if tracked), memory writes.

**Platform routing**: 
- If `state.platform` is `"github-tracked"`: delegate to `corgispec-gh-apply` (GitHub issue sync)
- If `state.platform` is `"gitlab-tracked"`: delegate to `corgispec-apply-change` (GitLab issue sync)
- The apply delegate MUST execute its full closeout including issue sync (Step 5). 
- Do NOT suppress issue sync when running inside the loop.
- The closeout reads the tracking file (.github.yaml or .gitlab.yaml) and posts updates via gh/glab.

**On apply failure**: If the delegate reports a blocker or error, do NOT proceed to verify. Record the failure in session context and STOP. The hook will detect the missing artifacts and determine the outcome.

#### 3.3 Verify Phase — Delegate to corgispec-verify

After apply succeeds, delegate verification by loading and executing the `corgispec-verify` skill.

**Input to delegate**:
- Change name from state
- Task Group number from state
- Worktree path (if applicable)
- Flag: `--from-loop` (the verify delegate runs its FULL normal flow including posting the verify report to the child issue if tracked. Do NOT suppress issue posting.)

Collect the verify verdict and evidence from the delegate's output.

#### 3.4 Review-Evidence Phase — Delegate to corgispec-review-loop

After verify, delegate review evidence collection by loading and executing the `corgispec-review-loop` skill.

**Input to delegate**:
- Change name from state
- Group number from state
- Worktree path: `state.worktreePath` (from state.json, for file path resolution in worktree-isolated changes)
- Platform root: `<PLATFORM_DIR>`
- The skill will read `tasks.md` and run quality checks autonomously

The review-loop delegate runs the same 5-axis quality checks (Code Quality, Spec Verification, Functional Verification, Architecture, Performance/Security) as normal review but without any human gate. It writes its findings into `finding_details[]`.

**After review.json is written, post the review report to the child issue (if tracked):**
1. Read the tracking file: `openspec/changes/<change>/<change>/.github.yaml` (GitHub) or `.gitlab.yaml` (GitLab)
2. Assemble a review report from `review.json` findings in the format:
   - Severity summary: 🔴 N Critical | 🟡 N Important | 🔵 N Suggestions | ⚪ N Nits | ℹ️ N FYI
   - Code Quality table (file, finding, severity, comment)
   - Architecture check status
   - Performance check status  
   - Spec coverage status
3. Post to child issue:
   - GitHub: `gh issue comment <child_number> --body "$REVIEW_REPORT"`
   - GitLab: `glab issue note <child_iid> --message "$REVIEW_REPORT"`
4. If no tracking file exists, skip issue posting silently.

**Auto-Approve / Auto-Fix Decision (replaces human gate):**

Read `review.json` `finding_details[]` and count severities:

**Auto-Approve** (zero critical AND zero important findings):
1. Post a note to child issue: "✅ Auto-approved. No critical or important findings."
2. Commit all changes: `git add -A && git commit -m "feat(<change-name>): complete Group N - auto-approved"`
3. Push: `git push`
4. Change child issue label to `done`:
   - GitHub: `gh issue edit <child_number> --remove-label "review" --add-label "done"`  
   - GitLab: `glab issue update <child_iid> --unlabel "workflow::review" --label "workflow::done"`
5. Update parent issue progress

**Auto-Fix Loop** (any critical or important findings):
1. Post a note to child issue: "🔄 Auto-fix triggered. Found N critical/important findings. Entering fix loop..."
2. Enter the existing fixing phase (Section 3.6b/3.6c)
3. The fixing loop implements fixes directly (NOT via tasks.md fix tasks), re-runs verify, re-runs review, and re-evaluates
4. Continue fix loop until auto-approve conditions are met OR circuit breaker triggers

**Core principle**: The review's human gate is replaced by severity-based automatic decision. Zero critical+important = approve. Any critical+important = fix loop.

#### 3.5 Write Artifacts

After all three phases complete, write the structured artifacts:

**verify.json** → `<PLATFORM_DIR>/groups/<N>/verify.json`

Construct from the verify delegate's output:
- `schemaVersion`: `1`
- `changeName`, `group`, `nonce`: pull from state.json
- `verdict`: from verify delegate (`PASS`, `PASS_WITH_WARNINGS`, or `FAIL`)
- `evidence`: the evidence array from verify delegate, each entry with `kind`, `command` (if CLI), `status`, `exitCode` (if CLI), `provenance`

**review.json** → `<PLATFORM_DIR>/groups/<N>/review.json`

Collect findings from the review-loop delegate's output. The delegate produces `finding_details[]` entries. Write them into the review.json schema.

**Nonce format** for artifacts: Use the current timestamp in the format `YYYY-MM-DDTHH:MM:SSZ-group-N` where N is the current group number.

**Important**: The nonce in both artifacts MUST match. Generate one nonce before writing and use it in both files.

#### 3.6b Self-Driving Evaluation Loop (OpenCode only)

When `selfDriven: false` in state.json: Skip this section — proceed directly to Section 3.6 (Update State and STOP).

When `selfDriven: true` in state.json: After writing artifacts (Section 3.5), instead of stopping, evaluate the loop state via the CLI hook:

1. **Call the CLI hook**:
   ```
   echo '{"hook_event_name":"Stop","stop_hook_active":false}' | npx corgispec hook loop-check --path <project-root>
   ```
2. **Parse JSON output**: The hook returns `{ decision, phase, terminal, reason }` on stdout. The hook has already evaluated the artifacts, computed severity counts, and made the decision.
3. **Act on the decision**:

   **Phase: `"fixing"` (non-terminal)**:
   a. Read the hook's `reason` field — it describes what needs to be fixed. The hook already evaluated severity and decided fixes are needed.
   b. Also read `review.json` for detailed finding context (file paths, check axes, descriptions).
   c. Implement fixes directly (Section 3.6c)
   d. Re-run verify (Section 3.3 pattern) → review (Section 3.4 pattern) → write artifacts (Section 3.5)
   e. Go back to step 1 (call loop-check again)

   **Phase: `"awaiting_group_result"` with `decision: "proceed"` (clean advance)**:
   a. The hook already updated state.json with `currentGroup` and `retryCount`
   b. If more groups remain (`currentGroup ≤ totalGroups`): execute next group bundle (Sections 3.1–3.5)
   c. If all groups done: STOP with success summary

   **`terminal: true`**:
   a. STOP with message, reason, and remaining findings summary
   b. The hook's `reason` field explains why: which group failed, what findings remain, circuit breaker details

**Circuit breakers**: The CLI hook enforces `maxBlocks`, `maxGroups`, and `maxRetries` limits. If the hook returns `terminal: true` due to a circuit breaker, honor it — do NOT attempt to bypass.

#### 3.6c Direct Fix Implementation

When the hook returns `phase: "fixing"`:

**DO NOT delegate to corgispec-apply-change.** Fixes are implemented directly by the LLM.

**Step 1 — Read findings**: Read the hook output's `reason` field for a description of what to fix. Also read `<PLATFORM_DIR>/groups/<N>/review.json` for detailed finding context (file paths, check axes, descriptions of each issue).

**Step 2 — Implement fixes**: For each finding described by the hook:
- **`file` field present**: `Read(file)` to get current content, then apply the fix from `description` using `Edit`. Match surrounding context precisely for a clean replacement.
- **`file` field absent**: Use the `check` axis (e.g., "Spec Coverage", "Code Quality") and `description` to identify the affected file. Search for the relevant code, then apply the fix.
- **Scope discipline**: Fix ONLY what the finding describes. No new features, no refactoring, no unrelated improvements. Each edit must correspond directly to a reported finding.

**Step 3 — Re-run verify**: Delegate to corgispec-verify using the same pattern as Section 3.3. This produces a fresh verify verdict.

**Step 4 — Re-run review**: Delegate to corgispec-review-loop using the same pattern as Section 3.4. This produces fresh findings.

**Step 5 — Write new artifacts**: Overwrite `<PLATFORM_DIR>/groups/<N>/verify.json` and `<PLATFORM_DIR>/groups/<N>/review.json` with the fresh results. Use a new nonce.

**Step 6 — Call loop-check**: Return to Section 3.6b step 1. The hook evaluates the new artifacts and returns either `phase: "fixing"` (retry needed) or clean advance. If the hook returns `terminal: true` (circuit breaker, max retries exceeded), STOP and report.

**tasks.md is NOT touched during fix passes.** No checkboxes are modified, no content is appended.

#### 3.6 Update State and STOP

After writing both artifacts (and after the self-driving loop completes, if applicable):

1. **DO NOT** make any lifecycle decision. Do not decide whether the group passed or failed.
2. Update state.json with ONLY these non-lifecycle fields:
   - Set `nonce` to the artifact nonce
   - Set `updatedAt` to current ISO-8601 timestamp
   (Do NOT write `phase`, `active`, `currentGroup`, `blockCount`, `retryCount`, `groupStatuses`, `completedGroups`, `pushStatus` — the hook owns those)
3. **STOP.** The stop hook will evaluate the artifacts, recompute severity counts, and decide:
   - **Block + advance**: the hook advances `currentGroup` and instructs the next invocation to execute the next group
   - **Block + auto-approve**: the hook authorizes commit/push + advance
   - **Terminal**: the hook returns `terminal: true` with a reason for the stop

**Do NOT** auto-continue. Do NOT decide the outcome. Write artifacts, update nonce/updatedAt in state.json, stop.

### 4. Compaction Recovery

Context compaction may erase the in-memory state during a loop session. When re-invoked after compaction, recover by re-reading state.json from disk:

1. **Read `state.json`** from `<PLATFORM_DIR>/` — this is the single source of truth
2. **Identify current group**: read `currentGroup` field
3. **Check for existing artifacts**: look for `<PLATFORM_DIR>/groups/<currentGroup>/verify.json` and `review.json`
   - If both exist: the previous invocation completed the bundle; the hook should have advanced. If `currentGroup` still points to this group, check if the hook instructed you to retry.
   - If neither exists: this group has not been started — proceed with the bundle (Section 3)
   - If only one exists: stale artifact — delete it and re-execute the bundle
4. **Re-derive totalGroups** from `tasks.md` if needed (but prefer state.json's value)
5. **Proceed with the bundle** for `currentGroup`

**Key principle**: state.json on disk is authoritative. Never trust session memory over the state file.

### 5. Artifact Schemas

#### 5.1 state.json

**Path**: `<PLATFORM_DIR>/state.json`

```json
{
  "active": true,
  "changeName": "add-user-auth",
  "sessionId": "session-2026-06-10T10:00:00Z",
  "nonce": "2026-06-10T10:12:00Z-group-2",
  "currentGroup": 2,
  "totalGroups": 5,
  "phase": "awaiting_group_result",
  "worktreePath": ".worktrees/feat/add-user-auth",
  "platform": "github-tracked",
  "selfDriven": true,
  "maxRetries": 3,
  "retryCount": 1,
  "autoApprovalPolicy": {
    "allowCommitPush": true,
    "allowPassWithWarnings": false
  },
  "startedAt": "2026-06-10T10:00:00Z",
  "updatedAt": "2026-06-10T10:12:00Z",
  "completedGroups": [1],
  "groupStatuses": {
    "1": "completed",
    "2": "in_progress"
  },
  "pushStatus": {
    "1": "pushed",
    "2": "pending"
  },
  "blockCount": 3,
  "maxBlocks": 7,
  "maxGroups": 10
}
```

**Fields the skill writes at initialization ONLY**: All fields in the template above (Section 2.4). After initialization, the skill writes only `nonce` and `updatedAt` to state.json.

**Fields the hook owns after initialization** (skill MUST NOT write): `active`, `terminal`, `blockCount`, `phase`, `currentGroup`, `retryCount`, `groupStatuses`, `completedGroups`, `pushStatus`, `selfDriven` (after initialization)

**Skill writes after initialization**: `nonce` (after writing artifacts), `updatedAt` (on any artifact write). The skill also writes artifact files (verify.json, review.json).

#### 5.2 verify.json

**Path**: `<PLATFORM_DIR>/groups/<N>/verify.json`

```json
{
  "schemaVersion": 1,
  "changeName": "add-user-auth",
  "group": 2,
  "nonce": "2026-06-10T10:00:00Z-group-2",
  "verdict": "PASS",
  "summary": "All tests and build checks passed",
  "evidence": [
    {
      "kind": "test",
      "command": "npm test",
      "status": "pass",
      "exitCode": 0,
      "provenance": "cli-emitted"
    },
    {
      "kind": "build",
      "command": "npm run build",
      "status": "pass",
      "exitCode": 0,
      "provenance": "cli-emitted"
    },
    {
      "kind": "lint",
      "command": "npx tsc --noEmit",
      "status": "pass",
      "exitCode": 0,
      "provenance": "cli-emitted"
    },
    {
      "kind": "manual-check",
      "description": "Verified output format matches spec",
      "status": "pass",
      "provenance": "llm-interpreted"
    }
  ]
}
```

**Evidence entry kinds**: `test`, `build`, `lint`, `typecheck`, `manual-check`, `security-scan`, `integration-test`

**Provenance**:
- `cli-emitted`: result came from a deterministic CLI tool. `exitCode` MUST be present. The hook cross-checks: `exitCode == 0` iff `status == "pass"`.
- `llm-interpreted`: result reflects LLM judgment. No `exitCode` required.

**Verdicts**: `PASS`, `PASS_WITH_WARNINGS`, `FAIL`
- Default auto-approval: only `PASS` is auto-approvable
- `PASS_WITH_WARNINGS` stops unless `autoApprovalPolicy.allowPassWithWarnings` is `true`

**Critical rule**: If a `cli-emitted` evidence entry has `exitCode != 0` but `status == "pass"`, the hook will detect a mismatch and trigger `error_validation`. Be exact.

#### 5.3 review.json

**Path**: `<PLATFORM_DIR>/groups/<N>/review.json`

```json
{
  "schemaVersion": 1,
  "changeName": "add-user-auth",
  "group": 2,
  "nonce": "2026-06-10T10:00:00Z-group-2",
  "finding_details": [
    {
      "severity": "important",
      "check": "Spec Coverage",
      "requirement": "REQ-3: Error handling",
      "description": "No null input error path in cli.py"
    },
    {
      "severity": "suggestion",
      "check": "Code Quality",
      "file": "src/utils.py",
      "description": "Consider extracting repeated validation logic"
    }
  ]
}
```

**Severity enum** (case-sensitive, MUST be one of): `critical`, `important`, `suggestion`, `nit`, `fyi`

**Field rules**:
- `finding_details` MUST be a JSON array — never null, never a string
- Every finding MUST have a `severity` from the allowed enum — never null
- `check` (required): which check axis produced this finding
- `description` (required): human-readable description
- `requirement` (optional): spec requirement ID (for spec findings)
- `file` (optional): file path (for code-level findings)

**Top-level count fields** (`critical`, `important`) are optional redundant summaries — the hook recomputes counts from `finding_details[]` directly.

### 6. Auto-Approval Policy

The `autoApprovalPolicy` in state.json controls what the hook may do without human intervention:

```json
{
  "allowCommitPush": true,
  "allowPassWithWarnings": false
}
```

- **`allowCommitPush`** (`true`): When a group is auto-approved, the hook may instruct the LLM to commit and push the changes. When `false`, the hook will stop even for clean groups, requiring manual commit.
- **`allowPassWithWarnings`** (`false`): When `false`, a `PASS_WITH_WARNINGS` verify verdict causes the hook to stop (terminal `verify_failed`). When `true`, the hook treats `PASS_WITH_WARNINGS` as acceptable and may auto-advance.

**What auto-approval enables**:
- A clean group (hook returns `phase: "awaiting_group_result"` with clean advance) → hook may mark group as completed, instruct advance to next group, instruct commit/push (if `allowCommitPush` is true)
- If the hook returns `terminal: true` → hook stops with terminal phase regardless of policy

**This skill does NOT implement the policy** — it writes the policy into state.json at initialization. The hook reads and enforces it.

---

## Postconditions (VERIFY BEFORE REPORTING DONE)

- [ ] `state.json` exists at `<PLATFORM_DIR>/state.json` with valid schema
- [ ] `verify.json` exists at `<PLATFORM_DIR>/groups/<N>/verify.json` for the current group
- [ ] `review.json` exists at `<PLATFORM_DIR>/groups/<N>/review.json` for the current group
- [ ] All three files share the same `changeName`, `group`, and `nonce`
- [ ] `nonce` follows format: `YYYY-MM-DDTHH:MM:SSZ-group-N`
- [ ] `verify.json` `verdict` is one of `PASS`, `PASS_WITH_WARNINGS`, `FAIL`
- [ ] `review.json` `finding_details` is a valid array with correct severity values
- [ ] No artifacts from the LLM contain fabricated test results or evidence
- [ ] The skill STOPPED after writing artifacts — no lifecycle decisions made
- [ ] `verify.json` never has `cli-emitted` evidence with mismatched `exitCode` and `status`

**If ANY postcondition fails, STOP and report which one failed. Do not claim completion.**

---

## Guardrails

- Execute ONE group bundle per invocation — never two or more
- The stop hook owns ALL lifecycle decisions — this skill only executes and writes artifacts
- `state.json` on disk is always authoritative — re-read it after compaction or session restart
- Nonce format: `YYYY-MM-DDTHH:MM:SSZ-group-N` — consistent across state, verify, and review artifacts
- When re-invoked: check for existing artifacts before executing (compaction recovery)
- `cli-emitted` evidence MUST have `exitCode` — the hook validates it against `status`
- Severity values MUST be from the exact enum — the hook fails closed on invalid values
- If apply fails (blocker): record failure in context, STOP — do not proceed to verify. The hook detects missing artifacts.
- If verify is `FAIL`: write it honestly — the hook handles the terminal decision
- Never trust session memory over `state.json` — the file on disk is the single source of truth
- In self-driving mode: never edit `tasks.md` during fix passes, never delegate fixes to apply-change, never exceed finding scope
