# Loop Fix-Retry Cycle

## TL;DR

> **Quick Summary**: Add an automatic fix-retry cycle to corgi-loop so that when verify FAILs or review finds critical/important findings, the loop self-corrects instead of stopping permanently. On OpenCode (no Stop hooks), the skill becomes self-driving: it calls `corgispec hook loop-check` to get decisions, injects findings into re-apply, and loops internally.
> 
> **Deliverables**:
> - New state machine fields: `retryCount`, `maxRetries`, `selfDriven`
> - New phase: `"fixing"` (non-terminal)
> - Modified Gates 9 & 13: retry before terminal when `selfDriven=true`
> - Self-driving skill loop: call CLI → parse decision → act → repeat
> - Fix apply context injection via delegation prompt (not tasks.md)
> - Full test coverage for all retry scenarios
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 2 waves + final
> **Critical Path**: Types → State Machine → Tests → Skill

---

## Context

### Original Request
User runs corgi-loop on OpenCode and finds it stops at every group. Two root causes: (1) OpenCode has no Stop hooks so state never advances, (2) critical/important findings cause immediate permanent terminal stop with no retry. User wants the loop to auto-fix: findings → apply fix → verify → review again, up to maxRetries times.

### Interview Summary
**Key Discussions**:
- Platform: OpenCode (no Stop hooks) — skill must self-drive
- Fix scope: Re-execute whole group apply with findings injected as context
- Verify FAIL also triggers retry (same cycle as review findings)
- Max retries: 3 per group
- Fix task format: Don't append to tasks.md — loop skill directly implements fixes without delegating to apply
- Findings injection: The loop skill itself reads findings and implements fixes directly (no delegation to apply skill for fix passes)
- State mutation: Skill calls CLI (`corgispec hook loop-check`) for decisions, does NOT implement gate logic inline
- Fix approach: Skip apply delegation for fixes. The loop skill reads findings, implements the fixes itself, then runs verify and review.

**Research Findings**:
- corgi-apply discovers pending tasks by scanning `- [ ]` in tasks.md — re-running on all-[x] group would find nothing
- corgi-review-loop produces machine-readable `finding_details[]` — can be directly consumed
- State machine is a pure function — easy to add new gates/phases
- Existing `blockCount`/`maxBlocks` circuit breaker (default 7) will be exceeded by retries (3 groups × 3 retries = 9 blocks)

### File Existence Verification (pre-verified)
All referenced files have been confirmed to exist in the repository:
- `.opencode/skills/compounds/corgispec-loop/SKILL.md` (18412 bytes)
- `.claude/skills/compounds/corgispec-loop/SKILL.md` (18453 bytes)
- `.opencode/commands/corgi-loop.md` (3189 bytes)
- `.claude/commands/corgi/loop.md` (2314 bytes)
- `packages/corgispec/src/lib/loop-types.ts` (178 lines)
- `packages/corgispec/src/lib/loop-state.ts` (364 lines)
- `packages/corgispec/src/lib/loop-validation.ts` (exists)
- `packages/corgispec/src/commands/hooks/loop-check.ts` (190 lines)
- `packages/corgispec/test/hooks/loop-check.test.ts` (exists)
- `packages/corgispec/test/hooks/loop-validation.test.ts` (exists)
- `.opencode/skills/molecules/corgispec-apply-change/SKILL.md` (exists, NOT modified)
- `.opencode/skills/molecules/corgispec-review-loop/SKILL.md` (exists, used for re-review in fix cycle)

All Claude mirror files ALREADY EXIST. Tasks 6/7 UPDATE these existing files, they do NOT create new ones.

### Issue Sync Bug (discovered during review)
User reported: corgi-loop NEVER updated GitHub issues. Root cause: triple contradiction.
1. Loop SKILL.md line 63 says "hook handles issue sync" but hook has 0 issue code
2. Loop SKILL.md line 164 says "delegate handles issue sync" but line 63 forbids posting
3. Loop delegates to `corgispec-apply-change` (GitLab version) instead of `corgispec-gh-apply` (GitHub version)
4. Verify and review-loop both explicitly suppress issue posting
Fix: Remove the blanket prohibition, add platform-specific delegate routing, ensure apply closeout runs issue sync.

### Metis Review
**Identified Gaps** (all addressed):
- Apply re-invocation on completed tasks → Skill will inject fix instructions as context, apply handles it as "fix mode" addressing specific findings
- blockCount interaction with retries → Increase default maxBlocks to accommodate retries
- LLM editing state.json → Use CLI for all state mutations, skill never edits JSON directly
- Findings injection mechanism → Delegation prompt context (not file, not tasks.md)
- Hook path regression → Gate all retry logic behind `selfDriven: true`
- Missing acceptance criteria → Added comprehensive test scenarios

---

## Work Objectives

### Core Objective
Transform corgi-loop from "stop on any finding" to "auto-fix and continue" on OpenCode, while keeping Claude Code hook path completely unchanged.

### Concrete Deliverables
- `loop-types.ts`: 3 new fields (`retryCount`, `maxRetries`, `selfDriven`) + 1 new phase (`"fixing"`)
- `loop-validation.ts`: 3 new validators for new fields
- `loop-state.ts`: Modified Gates 9 & 13 with retry-before-terminal logic, gated by `selfDriven`
- `loop-check.ts`: Handle `"fixing"` phase in hook output, support CLI-based state evaluation
- `.opencode/skills/compounds/corgispec-loop/SKILL.md`: Self-driving loop with fix-retry cycle, CLI integration, findings injection
- `.claude/skills/compounds/corgispec-loop/SKILL.md`: Documentation mirror of above
- `.opencode/commands/corgi-loop.md`: Updated OpenCode command dispatcher
- `.claude/commands/corgi/loop.md`: Updated Claude Code command mirror
- Tests: All new scenarios + backward compatibility verification

### Definition of Done
- [x] `bun test packages/corgispec/test/hooks/loop-check.test.ts` → ALL tests pass (existing + new)
- [x] `bun test packages/corgispec/test/hooks/loop-validation.test.ts` → ALL tests pass (existing + new)
- [x] `bun test packages/corgispec/test/hooks/loop-check.integration.test.ts` → ALL integration tests pass
- [x] Existing Claude Code path tests pass unchanged (selfDriven=false behavior identical)
- [x] `npx tsc --noEmit` → 0 errors on loop-specific files

### Must Have
- Issue sync MUST work: apply delegate's closeout must post to GitHub/GitLab issues during loop execution
- Fix-retry cycle works on OpenCode: findings → auto-fix → verify → review → check
- Verify FAIL also triggers retry
- Max 3 retries per group
- Self-driving skill loop (calls CLI, parses JSON, acts on decision)
- Claude Code path completely unchanged (backward compatible)
- Circuit breaker still works
- retryCount resets on group advance

### Must NOT Have (Guardrails)
- MUST NOT add issue sync logic to TypeScript hook code (belongs in skill layer)
- MUST NOT modify `corgispec-apply-change` SKILL.md
- MUST NOT modify verify.json or review.json schemas
- MUST NOT modify tasks.md in any way during fix passes (no appending, no unchecking, no temporary tasks)
- MUST NOT delegate fix passes to corgispec-apply-change skill (fix is implemented directly by the loop skill)
- MUST NOT change behavior when `selfDriven === false`
- MUST NOT implement severity-checking logic in SKILL.md (delegate to CLI)
- MUST NOT create new skills or new CLI commands beyond state evaluation
- MUST NOT count retry blocks against circuit breaker (exclude retry iterations from blockCount)
- MUST NOT have skill edit state.json directly (use CLI for all mutations)
- AI slop: No excessive comments, no premature abstraction, no over-engineering of retry logic

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: TDD — new tests first, then implementation
- **Framework**: vitest (bun test)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **State machine**: Use Bash (bun test) — Run tests, assert pass/fail counts
- **CLI hooks**: Use Bash (echo pipe) — Feed JSON stdin, assert stdout JSON
- **Integration**: Use Bash (execSync) — Full loop cycle simulation

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — types, validation, can start immediately):
├── Task 1: Add new types and phase to loop-types.ts [quick]
├── Task 2: Add validators for new fields in loop-validation.ts [quick]
└── Task 3: Write TDD tests for retry scenarios [deep]

Wave 2 (Core — state machine, hook, skill):
├── Task 4: Modify state machine Gates 9 & 13 + add fixing transition [deep]
├── Task 5: Update loop-check.ts hook for fixing phase [quick]
├── Task 6: Update corgispec-loop SKILL.md — self-driving + fix-retry [unspecified-high]
└── Task 7: Update corgi-loop command dispatcher [quick]

Wave FINAL (After ALL tasks — parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Integration + regression QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Task 1 → Task 3 → Task 4 → Task 6
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 1), 4 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1    | -         | 2, 3, 4, 5 | 1 |
| 2    | 1         | 3, 4    | 1 |
| 3    | 1, 2      | 4       | 1 |
| 4    | 3         | 5, 6, 7 | 2 |
| 5    | 4         | 7       | 2 |
| 6    | 4         | F1-F4   | 2 |
| 7    | 5, 6      | F1-F4   | 2 |

### Agent Dispatch Summary

- **Wave 1**: **3** — T1 → `quick`, T2 → `quick`, T3 → `deep`
- **Wave 2**: **4** — T4 → `deep`, T5 → `quick`, T6 → `unspecified-high`, T7 → `quick`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## State Ownership Rules (CRITICAL — read before implementing)

On OpenCode (selfDriven=true), the skill and the CLI hook share state ownership:

| Field | Owner | Who Writes | When |
|-------|-------|------------|------|
| `active`, `terminal`, `blockCount`, `phase` (lifecycle) | **CLI hook** | `corgispec hook loop-check` writes mutated state after evaluation | After each `evaluateLoopState()` call |
| `retryCount`, `maxRetries`, `selfDriven` | **Skill** (init) + **CLI hook** (increment) | Skill sets at init; CLI hook increments `retryCount` during evaluation | Init + each retry evaluation |
| `currentGroup`, `completedGroups`, `groupStatuses` | **CLI hook** | Hook advances group after clean pass | After clean advance |
| `nonce`, `updatedAt` | **Skill** | Skill updates after writing artifacts | After each bundle |
| `changeName`, `sessionId`, `totalGroups`, `worktreePath`, `platform` | **Skill** (init only) | Written once at initialization, never changed | Init |

**Key rule**: The skill calls `corgispec hook loop-check` which runs `evaluateLoopState()`. The hook WRITES the mutated state.json back to disk (this already works — see `loop-check.ts:169-175`). The skill then READS the updated state.json to get the new `retryCount`, `phase`, etc.

**The skill NEVER directly edits `retryCount`, `currentGroup`, `phase`, `active`, or `blockCount`.** It only writes `nonce`, `updatedAt`, and artifact files.

---

- [x] 1. Add retry types, phase, and fields to loop-types.ts

  **What to do**:
  - Add `"fixing"` to the `LoopPhase` union type (non-terminal phase)
  - Add `retryCount: number` to `LoopState` (default 0, per-group counter)
  - Add `maxRetries: number` to `LoopState` (default 0, set to 3 by skill during init)
  - Add `selfDriven: boolean` to `LoopState` (default false, true on OpenCode)
  - Update JSDoc comments for LoopPhase and LoopState

  **Must NOT do**: Do NOT modify existing type definitions. Do NOT remove any LoopPhase values.

  **Recommended Agent Profile**: `quick` — Pure type definition changes. Skills: `[]`

  **Parallelization**: Wave 1 (parallel with Tasks 2, 3). Blocks: 2, 3, 4, 5. Blocked by: None.

  **References**:
  - `packages/corgispec/src/lib/loop-types.ts:10-21` — LoopPhase union (add `"fixing"`)
  - `packages/corgispec/src/lib/loop-types.ts:49-86` — LoopState interface (add 3 fields after `maxGroups`)

  **QA Scenarios**:
  ```
  Scenario: TypeScript compilation — loop-types.ts has no compilation errors
    Tool: Bash
    Preconditions: loop-types.ts modified with new fields
    Steps:
      1. cd packages/corgispec && npx tsc --noEmit --pretty false > /tmp/task1-tsc-output.txt 2>&1 ; echo "TSC_EXIT=$?"
      2. grep "loop-types.ts" /tmp/task1-tsc-output.txt ; echo "GREP_EXIT=$?"
    Expected Result: TSC_EXIT=0 (compiler succeeds, or at least no new errors) AND GREP_EXIT=1 (grep finds no mention of loop-types.ts in errors). Note: other files may have pre-existing errors — only loop-types.ts errors matter.
    Failure Indicators: GREP_EXIT=0 and grep output contains "loop-types.ts" with "error TS" (new type introduced a compilation error)
    Evidence: .sisyphus/evidence/task-1-types-compile.txt
  ```

  **Commit**: Groups with Task 2. Message: `feat(loop): add retry types, validation, and fixing phase`

- [x] 2. Add validators for new fields in loop-validation.ts

  **What to do**:
  - Add `validateRetryCount(value): ValidationResult` — number >= 0
  - Add `validateMaxRetries(value): ValidationResult` — number >= 0
  - Add `validateSelfDriven(value): ValidationResult` — boolean
  - Follow existing validator pattern (return `{ valid: true }` or `{ valid: false, errors: [...] }`)
  - These are STANDALONE field-level validators (like `validateVerdictString`), NOT part of `validateLoopState()`
  - Missing/undefined fields are VALID (backward compat): `validateRetryCount(undefined)` → `{ valid: true }`, `validateSelfDriven(undefined)` → `{ valid: true }`
  - These validators are called directly by `evaluateLoopState()` before accessing the fields, NOT via `validateLoopState()`
  - Write tests in loop-validation.test.ts for each (valid + invalid + undefined cases)

  **Must NOT do**: Do NOT change existing validators.

  **Recommended Agent Profile**: `quick` — Follow exact same pattern as 9 existing validators. Skills: `[]`

  **Parallelization**: Wave 1 (after Task 1). Blocks: 3, 4. Blocked by: Task 1.

  **References**:
  - `packages/corgispec/src/lib/loop-validation.ts:1-30` — Validator pattern
  - `packages/corgispec/test/hooks/loop-validation.test.ts` — Test patterns

  **QA Scenarios**:
  ```
  Scenario: All validator tests pass including new ones
    Tool: Bash
    Preconditions: Validators implemented and tested
    Steps:
      1. cd packages/corgispec && bun test test/hooks/loop-validation.test.ts > /tmp/task2-test-output.txt 2>&1
      2. Check: grep -c "pass" /tmp/task2-test-output.txt (should be >= 1)
      3. Check: grep "fail" /tmp/task2-test-output.txt (should be empty or show 0)
    Expected Result: Output contains "X passed" with X >= 126, "0 failed"
    Failure Indicators: Output contains "failed" with count > 0
    Evidence: .sisyphus/evidence/task-2-validators-pass.txt
  ```

  **Commit**: Groups with Task 1. Message: `feat(loop): add retry types, validation, and fixing phase`

- [x] 3. Write TDD tests for retry scenarios in loop-check.test.ts

  **What to do**:
  - Update `makeState()` factory: add `retryCount: 0, maxRetries: 3, selfDriven: true`
  - Write these RED tests:

    **Verify FAIL retry:**
    - T-retry-1: selfDriven=true, retryCount=0, FAIL → fixing, terminal=false, retryCount=1
    - T-retry-2: selfDriven=true, retryCount=2, FAIL → fixing, terminal=false, retryCount=3
    - T-retry-3: selfDriven=true, retryCount=3, FAIL → verify_failed, terminal=true (exhausted)
    - T-retry-4: selfDriven=false, FAIL → verify_failed, terminal=true (UNCHANGED — Claude Code)

    **Review findings retry:**
    - T-retry-5: selfDriven=true, retryCount=0, critical → fixing, terminal=false, retryCount=1
    - T-retry-6: selfDriven=true, retryCount=2, critical → fixing, terminal=false, retryCount=3
    - T-retry-7: selfDriven=true, retryCount=3, critical → stopped_review_findings, terminal=true (exhausted)
    - T-retry-8: selfDriven=false, critical → stopped_review_findings, terminal=true (UNCHANGED)

    **Edge cases:**
    - T-retry-9: maxRetries=0, critical → stopped_review_findings, terminal=true (disabled)
    - T-retry-10: selfDriven=true, suggestion findings → advance normally (no retry)
    - T-retry-11: Clean advance resets retryCount to 0

  **Must NOT do**: Do NOT modify existing tests. Do NOT change makeState() defaults for existing fields.

  **Recommended Agent Profile**: `deep` — TDD tests defining new behavior, need careful edge case thought. Skills: `[]`

  **Parallelization**: Wave 1 (after Tasks 1, 2). Blocks: Task 4. Blocked by: Tasks 1, 2.

  **References**:
  - `packages/corgispec/test/hooks/loop-check.test.ts:1-40` — Test setup, factories
  - `packages/corgispec/test/hooks/loop-check.test.ts:227-276` — Severity gate tests (follow pattern)
  - `packages/corgispec/test/hooks/loop-check.test.ts:200-225` — Verify FAIL tests (follow pattern)

  **QA Scenarios**:
  ```
  Scenario: TDD RED — new retry tests fail as expected
    Tool: Bash
    Preconditions: New tests written, state machine not yet modified (Task 4 not done)
    Steps:
      1. cd packages/corgispec && bun test test/hooks/loop-check.test.ts > /tmp/task3-test-output.txt 2>&1
      2. grep -c "fixing" /tmp/task3-test-output.txt (tests reference unimplemented phase)
      3. grep "failed" /tmp/task3-test-output.txt (should show > 0 failures from new tests)
      4. grep "25 passed" /tmp/task3-test-output.txt (existing 25 tests should still pass)
    Expected Result: ~11 new tests FAIL, 25 existing tests PASS
    Failure Indicators: All tests pass (tests don't test unimplemented logic) OR existing tests fail (regression)
    Evidence: .sisyphus/evidence/task-3-tdd-red.txt
  ```

  **Commit**: Groups with Task 4. Message: `feat(loop): add retry-before-terminal logic to state machine`

- [x] 4. Modify state machine Gates 9 & 13 + add fixing transition

  **What to do**:
  - **Gate 9 (verify FAIL)**: Before going terminal, check `state.selfDriven && state.retryCount < state.maxRetries`
    - If retry available: return `{ decision: "block", phase: "fixing", terminal: false, state: { ...state, retryCount: retryCount + 1, phase: "fixing" } }`
    - If exhausted or not selfDriven: keep current terminal behavior (UNCHANGED)
  - **Gate 13 (severity gate)**: Same pattern — check retry budget before terminal
    - If retry available: return `{ decision: "block", phase: "fixing", terminal: false, state: { ...state, retryCount: retryCount + 1 } }`
    - If exhausted or not selfDriven: keep current terminal behavior (UNCHANGED)
  - **Gate 14 (clean advance)**: Reset `retryCount` to 0 when advancing to next group
  - Run all tests — new retry tests should now PASS (GREEN phase), existing tests unchanged

  **Must NOT do**:
  - Do NOT change behavior when selfDriven=false
  - Do NOT modify Gates 1-8 or 10-12
  - Do NOT remove any existing gate logic

  **Recommended Agent Profile**: `deep` — Core state machine modification with many edge cases. Skills: `[]`

  **Parallelization**: Wave 2 (after Task 3). Blocks: 5, 6, 7. Blocked by: Task 3.

  **References**:
  - `packages/corgispec/src/lib/loop-state.ts:243-256` — Gate 9 (verify FAIL). BEFORE `buildTerminal("verify_failed", ...)`, insert retry check. DO NOT use `buildBlock()` (it increments blockCount). Instead construct the return inline: `if (state.selfDriven && state.retryCount < state.maxRetries) { const clone = deepCloneState(state); clone.retryCount = state.retryCount + 1; clone.phase = "fixing"; clone.updatedAt = now(); return { decision: "block", phase: "fixing", terminal: false, reason: "verify FAIL - retry attempt ...", state: clone }; }`. NOTE: do NOT increment blockCount — retry blocks excluded from circuit breaker.
  - `packages/corgispec/src/lib/loop-state.ts:302-319` — Gate 13 (severity). Same inline pattern for critical and important: construct return without `buildBlock()`, do NOT increment blockCount.
  - `packages/corgispec/src/lib/loop-state.ts:325-343` — Gate 14 final-group finalize path. Add `clone.retryCount = 0;` here too (reset on finalization).
  - `packages/corgispec/src/lib/loop-state.ts:346-363` — Gate 14 non-final group advance. Add `clone.retryCount = 0;` after `clone.currentGroup = state.currentGroup + 1;`.
  - Both branches of Gate 14 must reset retryCount to ensure the next group starts with a fresh retry budget.
  - `packages/corgispec/src/lib/loop-state.ts:75-92` — `buildBlock()`. Do NOT use for retry returns — it increments blockCount. Retry returns constructed inline.

  **QA Scenarios**:
  ```
  Scenario: TDD GREEN — all retry tests now pass
    Tool: Bash
    Preconditions: State machine modified (Gates 9 & 13 updated with retry logic)
    Steps:
      1. cd packages/corgispec && bun test test/hooks/loop-check.test.ts > /tmp/task4-test-output.txt 2>&1
      2. grep -E "[0-9]+ passed" /tmp/task4-test-output.txt (should show >= 36 total)
      3. grep -E "[0-9]+ failed" /tmp/task4-test-output.txt (should show 0 failed)
    Expected Result: Output shows "36 passed" (25 existing + 11 new) and "0 failed"
    Failure Indicators: Any "failed" count > 0
    Evidence: .sisyphus/evidence/task-4-tdd-green.txt

  Scenario: Backward compat — selfDriven=false produces terminal (Claude Code path unchanged)
    Tool: Bash
    Preconditions: Task 4 completed
    Steps:
      1. cd packages/corgispec && bun test test/hooks/loop-check.test.ts --reporter verbose > /tmp/task4-verbose.txt 2>&1
      2. grep "T-retry-4" /tmp/task4-verbose.txt (verify_failed, terminal=true)
      3. grep "T-retry-8" /tmp/task4-verbose.txt (stopped_review_findings, terminal=true)
    Expected Result: T-retry-4 and T-retry-8 pass with terminal behavior (Claude Code path UNCHANGED)
    Failure Indicators: These tests fail, meaning selfDriven=false path was modified
    Evidence: .sisyphus/evidence/task-4-backward-compat.txt
  ```

  **Commit**: Groups with Task 3. Message: `feat(loop): add retry-before-terminal logic to state machine`

- [x] 5. Update loop-check.ts hook for fixing phase

  **What to do**:
  - When `evaluateLoopState` returns `phase: "fixing"`, the hook output should include:
    - `decision: "block"` (already the case)
    - `phase: "fixing"` (already passed through)
    - `reason` with clear instructions: "Group N has blocking findings. Retry attempt retryCount/maxRetries. Re-execute group with fix context."
  - Ensure the hook writes the mutated state (with incremented retryCount) back to state.json
  - Ensure backward compat: if state file has no `selfDriven`/`retryCount`/`maxRetries` fields, treat as `selfDriven=false` (existing behavior)

  **Must NOT do**: Do NOT add new CLI commands. Do NOT change the hook's stdin/stdout contract.

  **Recommended Agent Profile**: `quick` — Small modification to existing hook. Skills: `[]`

  **Parallelization**: Wave 2 (after Task 4). Blocks: Task 7. Blocked by: Task 4.

  **References**:
  - `packages/corgispec/src/commands/hooks/loop-check.ts:165-184` — Output section (ensure phase passes through)
  - `packages/corgispec/src/commands/hooks/loop-check.ts:105-109` — Atomic write (state mutation already works)

  **QA Scenarios**:
  ```
  Scenario: Hook outputs fixing phase when retry available
    Tool: Bash
    Preconditions: Task 4 completed (state machine supports fixing phase)
    Steps:
      0. cd packages/corgispec && npm run build 2>&1 (rebuild CLI to include Task 4 state machine changes)
      1. mkdir -p /tmp/loop-test/.opencode/corgi-loop/test-change/groups/1/
      2. cat > /tmp/loop-test/.opencode/corgi-loop/test-change/state.json << 'EOF'
         {"active":true,"changeName":"test-change","sessionId":"session-2026-01-01T00:00:00Z","nonce":"2026-01-01T00:00:00Z-group-1","currentGroup":1,"totalGroups":2,"phase":"awaiting_group_result","worktreePath":"","platform":"github-tracked","autoApprovalPolicy":{"allowCommitPush":true,"allowPassWithWarnings":false},"startedAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","completedGroups":[],"groupStatuses":{},"pushStatus":{},"blockCount":0,"maxBlocks":7,"maxGroups":10,"retryCount":0,"maxRetries":3,"selfDriven":true}
         EOF
      3. cat > /tmp/loop-test/.opencode/corgi-loop/test-change/groups/1/verify.json << 'EOF'
         {"schemaVersion":1,"changeName":"test-change","group":1,"nonce":"2026-01-01T00:00:00Z-group-1","verdict":"FAIL","evidence":[{"kind":"test","command":"npm test","status":"fail","exitCode":1,"provenance":"cli-emitted"}]}
         EOF
      4. cat > /tmp/loop-test/.opencode/corgi-loop/test-change/groups/1/review.json << 'EOF'
         {"schemaVersion":1,"changeName":"test-change","group":1,"nonce":"2026-01-01T00:00:00Z-group-1","finding_details":[{"severity":"suggestion","check":"Code Quality","description":"OK"}]}
         EOF
      5. echo '{"hook_event_name":"Stop","stop_hook_active":false}' | node packages/corgispec/dist/corgispec.js hook loop-check --path /tmp/loop-test 2>/dev/null
         Note: hook scans BOTH .claude/corgi-loop/ and .opencode/corgi-loop/ — we use .opencode/ here.
      6. rm -rf /tmp/loop-test (cleanup)
    Expected Result: stdout is JSON with "phase":"fixing" and "terminal":false
    Failure Indicators: stdout contains "terminal":true or "phase":"verify_failed" (retry not triggered)
    Evidence: .sisyphus/evidence/task-5-hook-fixing.txt
  ```

  **Commit**: YES. Message: `feat(loop): update loop-check hook for fixing phase`

- [x] 6. Update corgispec-loop SKILL.md — self-driving + fix-retry cycle

  **What to do**:
  This is the largest change. The skill transforms from "execute once, stop, wait for hook" to "self-driving loop on OpenCode."
  **IMPORTANT**: Edit `.opencode/skills/compounds/corgispec-loop/SKILL.md` as the source of truth. Then copy the result to `.claude/skills/compounds/corgispec-loop/SKILL.md` as a documentation mirror. The Claude Code path (`selfDriven=false`) behavior does NOT change — the mirror is for reference consistency only.

  **New sections to add:**

  **Section 2.5: Self-Driving Mode Detection**
  - Determine platform from context: if invoked via `.opencode/commands/corgi-loop.md` (OpenCode), set `selfDriven: true`. If invoked via `.claude/commands/corgi/loop.md` (Claude Code), set `selfDriven: false`.
  - The signal is which command file dispatched to this skill — OpenCode commands run under OpenCode runtime, Claude commands under Claude Code runtime. No config.yaml field needed.
  - Set `maxRetries: 3` in state.json when `selfDriven: true`, otherwise `maxRetries: 0`
  - Set `retryCount: 0` in state.json

  **Section 3.6b: Self-Driving Evaluation Loop (NEW — OpenCode only)**
  After writing artifacts (Section 3.5), instead of just STOPPING:
  1. Run `echo '{"hook_event_name":"Stop","stop_hook_active":false}' | npx corgispec hook loop-check --path <project-root>` via Bash
  2. Parse the JSON output: `{ decision, phase, terminal, reason }`
  3. Based on the decision:
     - **`phase: "fixing"` (non-terminal)**:
        a. Read the latest `review.json` for current group
        b. Extract only `critical` + `important` findings from `finding_details[]`
        c. **Implement fixes directly** (see Section 3.6c for full procedure):
           - For each finding with a `file` field: read that file, apply the fix described in `description`
           - For findings WITHOUT a `file` field: use the `check` axis (review axis name, e.g. "architecture", "security") + `description` to identify the affected file from context, and apply the fix
           - Use Edit/Write tools. Do NOT delegate to corgispec-apply-change.
        d. Re-run verify → review → write artifacts (overwrite existing)
        e. Go back to step 1 (call loop-check again)
        f. Repeat until maxRetries exhausted or findings clear
     - **`phase: "awaiting_group_result"` with clean advance**:
       a. The hook already advanced `currentGroup` in state.json
       b. If more groups remain: execute next group bundle (Section 3.2-3.5)
       c. If all groups done: STOP with success message
     - **`terminal: true`** (any terminal phase):
       a. STOP with appropriate message
       b. Include reason from hook output
       c. Include remaining findings summary

  **Section 3.6c: Direct Fix Implementation (NEW)**
  When fix mode is triggered (critical/important findings or verify FAIL):
  - **DO NOT delegate to corgispec-apply-change**. The fix is implemented directly by the loop skill.
  - **Step 1 — Read findings**: Read the latest `review.json` for the current group. Extract only critical and important findings from `finding_details[]`.
  - **Step 2 — Implement fixes directly**: For each blocking finding:
    - **Pattern**: The loop skill already has access to Bash, Edit, Write, and Read tools (all OpenCode/Claude Code tools are available). The fix procedure is: (1) read finding `file` + `description` fields, (2) `Read(file)` to see current code, (3) `Edit(file, oldString=bad_code, newString=fixed_code)` to apply the fix. This is a standard edit operation — no special skill or delegation needed. The skill just reads the finding and applies targeted edits.
    - **Example flow**: Finding says `{ file: "src/auth.ts", description: "Missing input validation on email field", check: "security" }`. Steps: `Read("src/auth.ts")` → find the email handler → `Edit("src/auth.ts", oldString="const email = req.body.email", newString="const email = validateEmail(req.body.email)")` → done.
    - If the finding has a `file` field: read that file, apply the fix described in `description`
    - If the finding has NO `file` field (spec/architecture/security findings): use the `check` axis (the review axis name, e.g. "architecture", "security", "performance") + `description` to identify the affected file and fix. For example, a security finding about "missing input validation" — search for the relevant input handler and add validation.
    - Use Edit/Write tools to apply the fix
    - Fix ONLY what the finding describes. Do NOT add new features, refactor, or modify unrelated code.
  - **Step 3 — Re-run verify**: Use the same verify delegation as Section 3.3 (`/corgispec-verify` skill). The `--loop-mode` flag is a context hint passed in the delegation prompt so verify knows it is running inside a loop cycle — it is NOT a CLI flag. Pass it as: "Running verify in loop fix cycle for Group N. Verdict only, no extra context needed."
  - **Step 4 — Re-run review**: Delegate to `corgispec-review-loop` (same as Section 3.4) to check if findings are resolved.
  - **Step 5 — Write new artifacts**: Overwrite `verify.json` and `review.json` for the current group with new results.
  - **Step 6 — Call loop-check**: Run `corgispec hook loop-check` to evaluate new state. If `phase: "fixing"` again (still has findings), repeat. If clean, advance.
  - **tasks.md is NOT touched** during fix passes. No unchecking, no appending, no temporary tasks.

  **Forbidden Actions update:**
  - Add: "NEVER modify tasks.md during fix passes (no appending, no unchecking)"
  - Add: "NEVER delegate fix passes to corgispec-apply-change (fixes are implemented directly)"
  - Add: "NEVER implement changes beyond the scope of the reported findings"

  **Must NOT do**:
  - Do NOT modify corgispec-apply-change SKILL.md
  - Do NOT implement severity-checking logic inline — always use CLI
  - Do NOT edit state.json directly — use CLI for evaluation, only write artifacts and update nonce/updatedAt manually

  **Recommended Agent Profile**: `unspecified-high` — Large SKILL.md rewrite with complex self-driving logic. Skills: `[]`

  **Parallelization**: Wave 2 (after Task 4). Blocks: F1-F4. Blocked by: Task 4.

  **References**:
  - `.opencode/skills/compounds/corgispec-loop/SKILL.md` — Primary skill file to edit (OpenCode)
  - `.claude/skills/compounds/corgispec-loop/SKILL.md` — Claude Code mirror (sync after editing OpenCode version). File already exists. Mirror ONLY the shared instructional content (fix procedure, retry logic, state rules). Platform-specific paths (.opencode/ vs .claude/) and command dispatch must remain platform-correct in each copy.
  - `.opencode/skills/molecules/corgispec-review-loop/SKILL.md` — Review skill used for re-review in fix cycle (DO NOT modify)
  - `packages/corgispec/src/commands/hooks/loop-check.ts` — CLI hook the skill calls via Bash

  **QA Scenarios**:
  ```
  Scenario: SKILL.md contains self-driving loop instructions
    Tool: Bash
    Preconditions: SKILL.md updated with self-driving sections
    Steps:
      1. grep -c "hook loop-check" .opencode/skills/compounds/corgispec-loop/SKILL.md
      2. grep -c "fixing" .opencode/skills/compounds/corgispec-loop/SKILL.md
      3. grep -c "critical" .opencode/skills/compounds/corgispec-loop/SKILL.md
      4. All three counts must be > 0
    Expected Result: Each grep returns count >= 1
    Failure Indicators: Any count is 0 (missing instruction section)
    Evidence: .sisyphus/evidence/task-6-skill-self-driving.txt

  Scenario: SKILL.md fix section does NOT delegate to apply or modify tasks.md
    Tool: Bash
    Steps:
      1. Extract fix section only (Section 3.6c): grep -A 30 "Section 3.6c" .opencode/skills/compounds/corgispec-loop/SKILL.md > /tmp/task6-fix-section.txt
      2. Check no apply delegation in fix section: grep -c "corgispec-apply-change" /tmp/task6-fix-section.txt (should be 0 — fix section must NOT delegate to apply)
      3. Check no tasks.md mutation in fix section: grep -c "uncheck\|append.*tasks" /tmp/task6-fix-section.txt (should be 0)
      4. Check direct fix instruction exists in fix section: grep -c "implement.*fix.*directly\|Edit.*Write.*tools" /tmp/task6-fix-section.txt (should be >= 1)
    Expected Result: Steps 2-3 count is 0, step 4 count >= 1
    Failure Indicators: Steps 2 or 3 > 0, or step 4 == 0
    Evidence: .sisyphus/evidence/task-6-no-tasks-mutation.txt
  ```

  **Commit**: Groups with Task 7. Message: `feat(loop): self-driving skill with fix-retry cycle on OpenCode`

- [x] 7. Update corgi-loop command dispatcher

  **What to do**:
  - Update `.opencode/commands/corgi-loop.md`:
    - Add mention of self-driving mode on OpenCode
    - Update "Stopping conditions" to mention retry behavior
    - Add: "On OpenCode, the loop is self-driving: it calls `corgispec hook loop-check` internally to evaluate state and drive the retry cycle"
  - Update `.claude/commands/corgi/loop.md` as documentation mirror (same wording, no behavior changes for Claude Code). This file already exists at the referenced path.
  - Copy the updated SKILL.md from `.opencode/skills/compounds/corgispec-loop/SKILL.md` to `.claude/skills/compounds/corgispec-loop/SKILL.md` (documentation mirror only — both files already exist). Claude Code behavior with `selfDriven=false` is UNCHANGED.

  **Must NOT do**: Do NOT change the command interface (input/output stays the same).

  **Recommended Agent Profile**: `quick` — Documentation update. Skills: `[]`

  **Parallelization**: Wave 2 (after Tasks 5, 6). Blocks: F1-F4. Blocked by: Tasks 5, 6.

  **References**:
  - `.opencode/commands/corgi-loop.md` — OpenCode command dispatcher (primary, edit this)
  - `.claude/commands/corgi/loop.md` — Claude Code command mirror (sync after editing OpenCode version)
  - `.opencode/skills/compounds/corgispec-loop/SKILL.md` — Skill file (already updated in Task 6, copy to .claude/ mirror here)

  **QA Scenarios**:
  ```
  Scenario: Command files updated with retry mentions
    Tool: Bash
    Steps:
      1. ls -la .opencode/commands/corgi-loop.md .claude/commands/corgi/loop.md (verify both exist)
      2. grep -c "retry" .opencode/commands/corgi-loop.md (count must be > 0)
      3. grep -c "retry" .claude/commands/corgi/loop.md (count must be > 0)
    Expected Result: Both files exist and contain at least 1 mention of "retry"
    Failure Indicators: Either file missing or has 0 mentions of "retry"
    Evidence: .sisyphus/evidence/task-7-command-update.txt
  ```

  **Commit**: Groups with Task 6. Message: `feat(loop): self-driving skill with fix-retry cycle on OpenCode`


---


- [x] 8. Fix issue sync dead zone in corgi-loop skill

  **What to do**:
  - In `.opencode/skills/compounds/corgispec-loop/SKILL.md`:
    - **Line 63**: Replace `"NEVER post to issue trackers during loop execution (the hook handles issue sync)"` with `"Issue sync is performed by the apply delegate during closeout (Step 5). The loop skill itself does not post to issue trackers directly."`
    - **Section 3.2 (Apply Phase)**: After the existing delegation input list, add explicit instruction: `"The apply delegate MUST execute its full closeout including issue sync (Step 5). Do NOT suppress issue sync when running inside the loop. The closeout step reads the tracking file (.github.yaml or .gitlab.yaml) and posts updates via gh/glab."`
    - **Section 3.2**: Fix the platform-specific delegate routing. Add: `"Platform routing: if state.platform is 'github-tracked', delegate to corgispec-gh-apply. If 'gitlab-tracked', delegate to corgispec-apply-change. The platform determines which issue-sync.md reference to use."`
    - **Line 164**: Keep "issue sync (if tracked)" in the delegate description — this is now consistent with the updated line 63.
    - **Section 3.3 (Verify Phase)**: Change line 172 from "no issue posting" to "no SEPARATE issue posting — issue sync is handled by the apply delegate's closeout, not by verify."
  - After editing, sync shared content to `.claude/skills/compounds/corgispec-loop/SKILL.md` (platform-specific paths must remain correct for each platform).

  **Must NOT do**:
  - Do NOT add issue sync logic to the TypeScript hook code (loop-check.ts) — it belongs in the skill layer
  - Do NOT modify `corgispec-gh-apply` or `corgispec-apply-change` skill files — they already have correct issue sync
  - Do NOT modify `references/issue-sync.md` files — they already have correct commands
  - Do NOT remove the verify "produce evidence only" instruction — just clarify it doesn't conflict with issue sync

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file documentation edit, changes are clearly specified
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `corgispec-apply-change`: Not needed — we're not modifying that skill

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4-7)
  - **Blocks**: F1-F4 (final review tasks)
  - **Blocked By**: None (can start immediately — independent of Tasks 1-7)

  **References**:

  **Pattern References** (existing code to follow):
  - `.opencode/skills/molecules/corgispec-gh-apply/references/issue-sync.md` — GitHub issue sync procedures (the commands the apply delegate should execute during closeout)
  - `.opencode/skills/molecules/corgispec-apply-change/references/issue-sync.md` — GitLab issue sync procedures (same pattern but with `glab`)
  - `.opencode/skills/molecules/corgispec-gh-apply/SKILL.md` — GitHub apply skill with full closeout including issue sync (the correct delegate for GitHub platform)

  **API/Type References** (contracts to implement against):
  - `.opencode/skills/compounds/corgispec-loop/SKILL.md:63` — The conflicting "NEVER post" forbidden action
  - `.opencode/skills/compounds/corgispec-loop/SKILL.md:154-166` — Apply phase delegation section
  - `.opencode/skills/compounds/corgispec-loop/SKILL.md:169-180` — Verify phase delegation section

  **WHY Each Reference Matters**:
  - The `issue-sync.md` files contain the ACTUAL commands (`gh issue edit`, `gh issue comment`) that should be executed. The fix is about ensuring these get invoked by routing to the correct delegate.
  - The `corgispec-gh-apply` skill is the correct delegate for GitHub — it has `gh` commands in its issue-sync reference, not `glab` commands.
  - Line 63, 154-166, 169-180 are the three specific locations that need text changes.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: SKILL.md no longer forbids issue sync
    Tool: Bash
    Steps:
      1. grep -c "NEVER post to issue trackers" .opencode/skills/compounds/corgispec-loop/SKILL.md (should be 0 — the old prohibition is removed)
      2. grep -c "issue sync is performed by the apply delegate" .opencode/skills/compounds/corgispec-loop/SKILL.md (should be >= 1 — new clarification present)
    Expected Result: Step 1 is 0, step 2 is >= 1
    Failure Indicators: Step 1 > 0 (old prohibition still present) or step 2 == 0 (new text not added)
    Evidence: .sisyphus/evidence/task-8-no-sync-prohibition.txt

  Scenario: SKILL.md has platform-specific delegate routing
    Tool: Bash
    Steps:
      1. grep -c "corgispec-gh-apply" .opencode/skills/compounds/corgispec-loop/SKILL.md (should be >= 1 — GitHub delegate mentioned)
      2. grep -c "Platform routing" .opencode/skills/compounds/corgispec-loop/SKILL.md (should be >= 1 — routing instruction present)
    Expected Result: Both counts >= 1
    Failure Indicators: Either count is 0
    Evidence: .sisyphus/evidence/task-8-platform-routing.txt

  Scenario: SKILL.md instructs apply to include issue sync closeout
    Tool: Bash
    Steps:
      1. grep -c "full closeout including issue sync" .opencode/skills/compounds/corgispec-loop/SKILL.md (should be >= 1)
      2. grep -c "Do NOT suppress issue sync" .opencode/skills/compounds/corgispec-loop/SKILL.md (should be >= 1)
    Expected Result: Both counts >= 1
    Failure Indicators: Either count is 0
    Evidence: .sisyphus/evidence/task-8-apply-sync-instruction.txt

  Scenario: Claude mirror file also updated
    Tool: Bash
    Steps:
      1. diff <(grep -v "^#" .opencode/skills/compounds/corgispec-loop/SKILL.md | grep -v "^$") <(grep -v "^#" .claude/skills/compounds/corgispec-loop/SKILL.md | grep -v "^$") > /tmp/task8-mirror-diff.txt 2>&1 ; echo "DIFF_EXIT=$?"
      2. Check DIFF_EXIT=0 (shared content is mirrored)
    Expected Result: DIFF_EXIT=0 (shared content matches between OpenCode and Claude versions)
    Failure Indicators: DIFF_EXIT != 0 (mirror not synced)
    Evidence: .sisyphus/evidence/task-8-mirror-sync.txt
  ```

  **Commit**: YES
  - Message: `fix(loop): resolve issue sync dead zone — route to correct platform delegate`
  - Files: `.opencode/skills/compounds/corgispec-loop/SKILL.md`, `.claude/skills/compounds/corgispec-loop/SKILL.md`


## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  **QA Scenario**:
  ```
  Scenario: All "Must Have" items verified present
    Tool: Bash + Read
    Steps:
      1. grep -c "fixing" packages/corgispec/src/lib/loop-types.ts (must be >= 1)
      2. grep -c "retryCount" packages/corgispec/src/lib/loop-types.ts (must be >= 1)
      3. grep -c "selfDriven" packages/corgispec/src/lib/loop-types.ts (must be >= 1)
      4. grep -c "retryCount" packages/corgispec/src/lib/loop-state.ts (must be >= 3 — gate checks)
      5. grep -c "fixing" packages/corgispec/src/lib/loop-state.ts (must be >= 2 — phase returns)
      6. ls .sisyphus/evidence/task-*.txt (must have evidence for all 7 tasks)
    Expected Result: All checks pass
    Evidence: .sisyphus/evidence/f1-plan-compliance.txt
  ```
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  **QA Scenario**:
  ```
  Scenario: Build + tests pass with no regressions
    Tool: Bash
    Steps:
      1. cd packages/corgispec && npx tsc --noEmit --pretty false 2>&1 | grep -E "loop-(types|state|validation|check)" > /tmp/f2-tsc-errors.txt
      2. cd packages/corgispec && bun test test/hooks/ > /tmp/f2-test-output.txt 2>&1
      3. grep -E "[0-9]+ passed" /tmp/f2-test-output.txt
      4. grep -E "[0-9]+ failed" /tmp/f2-test-output.txt
      5. grep -c "loop-types\|loop-state\|loop-validation\|loop-check" /tmp/f2-tsc-errors.txt
    Expected Result: 0 errors in loop files, all tests pass, 0 failures
    Evidence: .sisyphus/evidence/f2-code-quality.txt
  ```
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Integration + Regression QA** — `unspecified-high`
  Run ALL test scenarios from ALL tasks. Verify backward compatibility: run Claude Code path tests (selfDriven=false) and confirm identical behavior. Run the full retry cycle: verify FAIL → fix → pass → advance. Run retry exhaustion: 3 retries → terminal. Run circuit breaker with retries.
  **QA Scenario**:
  ```
  Scenario: Full test suite passes including new retry tests
    Tool: Bash
    Steps:
      1. cd packages/corgispec && bun test test/hooks/ > /tmp/f3-test-output.txt 2>&1
      2. Verify total pass count >= 36 (loop-check.test.ts) + 126+ (loop-validation.test.ts) + 5 (integration) + 6 (stop-check)
      3. grep "failed" /tmp/f3-test-output.txt (must show 0)
    Expected Result: All tests pass, 0 failures, total count matches expected
    Evidence: .sisyphus/evidence/f3-integration-qa.txt
  ```
  Save evidence to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Regression [N/N] | Backward Compat [PASS/FAIL] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Verify corgispec-apply-change SKILL.md was NOT modified. Verify verify.json/review.json schemas unchanged. Verify tasks.md was NOT appended with fix tasks. Detect cross-task contamination.
  **QA Scenario**:
  ```
  Scenario: No scope violations detected
    Tool: Bash + Read
    Steps:
      1. git diff --stat (verify only expected files changed)
      2. grep -c "finding_details" packages/corgispec/src/lib/loop-types.ts (verify.json/review.json schemas unchanged — count should match original)
      3. grep -c "fix.*tasks\.md" .opencode/skills/compounds/corgispec-loop/SKILL.md (verify no tasks.md mutation instructions in fix section)
      4. diff .opencode/skills/molecules/corgispec-apply-change/SKILL.md <(git show HEAD:.opencode/skills/molecules/corgispec-apply-change/SKILL.md) (apply skill UNCHANGED)
    Expected Result: Only loop-specific files changed; apply skill unchanged; no tasks.md mutation
    Evidence: .sisyphus/evidence/f4-scope-fidelity.txt
  ```
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **8**: `fix(loop): resolve issue sync dead zone — route to correct platform delegate` - SKILL.md files

- **Task 1+2**: `feat(loop): add retry types, validation, and fixing phase` — loop-types.ts, loop-validation.ts, loop-validation.test.ts
- **Task 3+4**: `feat(loop): add retry-before-terminal logic to state machine` — loop-state.ts, loop-check.test.ts
- **Task 5**: `feat(loop): update loop-check hook for fixing phase` — loop-check.ts
- **Task 6+7**: `feat(loop): self-driving skill with fix-retry cycle on OpenCode` — SKILL.md, corgi-loop.md

---

## Success Criteria

### Verification Commands
```bash
bun test packages/corgispec/test/hooks/loop-check.test.ts       # Expected: ALL PASS
bun test packages/corgispec/test/hooks/loop-validation.test.ts   # Expected: ALL PASS
bun test packages/corgispec/test/hooks/loop-check.integration.test.ts  # Expected: ALL PASS
npx tsc --noEmit --project packages/corgispec/tsconfig.json     # Expected: 0 errors on loop files
```

### Final Checklist
- [x] All "Must Have" present (including issue sync working)
- [x] All "Must NOT Have" absent
- [x] All tests pass including existing backward-compat tests
- [x] Claude Code path (selfDriven=false) behavior completely unchanged
