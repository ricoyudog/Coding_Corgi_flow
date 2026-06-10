---
name: corgispec-loop
description: Corgi Loop executor — runs one full Task Group bundle (apply → verify → review-evidence) per invocation, writes structured artifacts, and delegates lifecycle decisions to the stop hook.
license: MIT
compatibility: Requires corgispec CLI. Requires corgispec-apply-change, corgispec-verify, and corgispec-review-loop skills.
metadata:
  author: corgispec
  version: "1.0.0"
  generatedBy: "1.3.0"
---

Execute **one full Task Group bundle** for a Corgi Loop: apply the current group, run verify checks, collect review evidence, and write machine-readable artifacts. Stop after each bundle — the stop hook owns all lifecycle decisions.

This skill operates under the **Hard Logic Orchestrates, LLM Executes** principle:
- **Hook (hard logic)**: state-machine decisions, JSON validation, severity derivation, stop/continue/advance, circuit breakers, stale-artifact protection
- **LLM (this skill)**: apply the group, run verify, gather review evidence, write artifacts, commit/push only when instructed

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

- NEVER make lifecycle decisions — the hook decides continue/stop/advance/terminal
- NEVER auto-approve a group without explicit hook instruction
- NEVER continue to the next group unless the hook explicitly instructs you to do so
- NEVER run multiple groups in one invocation
- NEVER skip verify or review-evidence phases
- NEVER mutate `state.json` fields that the hook owns (`active`, `terminal`, `blockCount`, `phase` lifecycle transitions)
- NEVER fabricate file lists, test results, or evidence
- NEVER post to issue trackers during loop execution (the hook handles issue sync)

---
## Steps

### 1. Context Gate (Pre-Execution Validation)

Before executing any work, verify all required context is present. If any check fails, STOP and report what's missing.

**Required context:**
1. **config.yaml valid**: `openspec/config.yaml` exists and has `schema` field
2. **Change directory exists**: `openspec/changes/<name>/` exists
3. **tasks.md present**: `openspec/changes/<name>/tasks.md` exists and contains at least one `## N.` Task Group heading
4. **Worktree valid** (if `isolation.mode: worktree`): worktree directory exists and is accessible
5. **Issue tracker reachable** (if tracked): `gh` or `glab` CLI available (non-blocking warning if missing)

**Platform detection**: Read `openspec/config.yaml` `schema` field:
- `github-tracked` → platform root: `.opencode/`, tracker: `gh`
- `gitlab-tracked` → platform root: `.opencode/`, tracker: `glab`

If any check fails, report the specific failure and STOP. Do not proceed with partial context.

### 2. Initialization — Create Loop State

**When to initialize**: The first time the skill runs for a change, OR when `state.json` does not exist.

#### 2.1 Count Task Groups

Read `openspec/changes/<name>/tasks.md`. Count all `## N.` headings (regex: `^##\s+\d+\.`). This is `totalGroups`.

If no groups found: STOP with error — nothing to loop over.

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

Write `<PLATFORM_DIR>/state.json` with the following structure (see exact schema in Section **Artifact Schemas** below):

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

**After initialization, STOP.** The hook will pick up the newly created state and direct the next invocation.

### 3. Group Bundle Execution

When the hook has directed you to execute a group bundle (either first-run block or "advance to group N" instruction), perform these phases in order:

#### 3.1 Read State

Read `<PLATFORM_DIR>/state.json`. Confirm:
- `active` is `true`
- `currentGroup` points to a valid group (1 ≤ currentGroup ≤ totalGroups)

Update `groupStatuses` to mark the current group as `"in_progress"` and write state.json.

#### 3.2 Apply Phase — Delegate to corgispec-apply-change

Delegate the apply work for the current group by loading and executing the `corgispec-apply-change` skill.

**Input to delegate**:
- Change name from state: `state.changeName`
- Task Group number: `state.currentGroup`
- Worktree path: `state.worktreePath` (if applicable)
- Platform/tracker: `state.platform`

The delegate handles: task execution, marking checkboxes in `tasks.md`, closeout summary, issue sync (if tracked), memory writes.

**On apply failure**: If the delegate reports a blocker or error, do NOT proceed to verify. Update state: `groupStatuses["<N>"] = "failed"`, write state.json, STOP.

#### 3.3 Verify Phase — Delegate to corgispec-verify

After apply succeeds, delegate verification by loading and executing the `corgispec-verify` skill.

**Important**: The verify delegate's normal behavior includes posting reports to issue trackers and printing user guidance. When invoked from the loop, instruct it to **only produce evidence** — no issue posting, no user guidance printing. The loop writes structured artifacts instead.

**Input to delegate**:
- Change name from state
- Task Group number from state
- Worktree path (if applicable)
- Flag: `--loop-mode` (suppress user-facing output, produce structured evidence)

Collect the verify verdict and evidence from the delegate's output.

#### 3.4 Review-Evidence Phase — Delegate to corgispec-review-loop

After verify, delegate review evidence collection by loading and executing the `corgispec-review-loop` skill.

**Input to delegate**:
- Change name from state
- Group number from state
- Platform root: `<PLATFORM_DIR>`
- The skill will read `tasks.md` and run quality checks autonomously

The review-loop delegate runs the same 5-axis quality checks (Code Quality, Spec Verification, Functional Verification, Architecture, Performance/Security) as normal review but without any human gate. It writes its findings into `finding_details[]`.

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

#### 3.6 Update State and STOP

After writing both artifacts:

1. **DO NOT** make any lifecycle decision. Do not decide whether the group passed or failed.
2. Update state.json:
   - Set `nonce` to the artifact nonce
   - Set `updatedAt` to current ISO-8601 timestamp
   - Keep `phase` as is (the hook owns phase transitions)
   - Keep `active` as `true`
3. **STOP.** The stop hook will evaluate the artifacts, recompute severity counts, and decide:
   - **Block + advance**: "advance to group N+1" → the next invocation will execute the next group
   - **Block + auto-approve**: the hook authorizes commit/push + advance
   - **Terminal**: verification failed, review found critical/important issues, or circuit breaker tripped

**Do NOT** auto-continue. Do NOT decide the outcome. Write artifacts, update state, stop.

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

**Fields you own** (LLM may write): `changeName`, `sessionId`, `nonce`, `currentGroup`, `totalGroups`, `worktreePath`, `platform`, `autoApprovalPolicy`, `startedAt`, `updatedAt`, `completedGroups`, `groupStatuses`, `pushStatus`, `maxBlocks`, `maxGroups`

**Fields the hook owns** (do NOT mutate without explicit instruction): `active` (set to `false` only by hook), `terminal` (set by hook), `blockCount` (hook increments on block), `phase` lifecycle transitions

**You MAY write**: `updatedAt` (always on any mutation), `nonce` (after writing artifacts), `groupStatuses` (mark in_progress/completed/failed), `completedGroups` (append after hook instructs), `pushStatus` (after hook instructs commit/push), `currentGroup` (increment ONLY when hook explicitly instructs to advance)

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
- A clean group (`PASS` verdict, no critical/important review findings) → hook may mark group as completed, instruct advance to next group, instruct commit/push (if `allowCommitPush` is true)
- If any guard trips (FAIL verdict, critical/important findings, circuit breaker, corruption) → hook stops with terminal phase regardless of policy

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
- If apply fails (blocker): update `groupStatuses`, write state, STOP — do not proceed to verify
- If verify is `FAIL`: write it honestly — the hook handles the terminal decision
- Never trust session memory over `state.json` — the file on disk is the single source of truth
