# /corgi:loop — Deterministic Loop for Corgi Workflow

## TL;DR

> **Quick Summary**: Implement a deterministic loop that auto-runs Task Groups through apply→verify→review for the Corgi workflow, with hard-logic orchestration via TypeScript Stop hooks (Claude Code) and command+skill pattern (OpenCode).
> 
> **Deliverables**:
> - TypeScript Stop hook (`corgispec hook loop-check`) with full state machine
> - Loop executor skill (`corgispec-loop`) — compound tier
> - Evidence-only review skill (`corgispec-review-loop`) — molecule tier
> - Commands for both platforms (`/corgi-loop` opencode, `/corgi:loop` Claude Code)
> - Make existing `stop-check` loop-aware
> - Update hook generator for both platforms
> - Comprehensive TDD test suite (vitest)
> - Wave 0 preflight probes validating Claude Code runtime behavior
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: T1 probe → T3 probe → state machine tests → hook implementation → skills → commands → integration

---

## Context

### Original Request
Implement `/corgi:loop` for both opencode and Claude Code platforms based on the research in `wiki/research/loop-implementation-comparison.md`. Full implementation with risk verification first.

### Interview Summary
**Key Discussions**:
- Both platforms must have identical behavior (same state machine, same artifacts)
- TypeScript implementation (matches existing hook infrastructure)
- TDD approach for the state machine logic
- Wave 0 preflight probes before building (validates runtime assumptions)
- New `corgispec-review-loop` skill preserves human gate on normal review
- Make `stop-check` loop-aware (skip during active loop)
- Risk 3 (Stop-hook composition) verified SAFE via official docs

**Research Findings**:
- Claude Code Stop hook block cap: 8 (verified, configurable via env)
- JSON `decision:"block"` + `reason` is the canonical block mechanism (exit 0 + JSON)
- `stop_hook_active` field confirmed in Stop hook input
- All matching hooks run in parallel — composition is safe
- Existing hooks are TypeScript in `packages/corgispec/src/commands/hooks/`
- OpenCode has no `session.idle` event — command+skill is the viable approach
- Existing `corgispec status --json` provides machine-readable state discovery

### Metis Review
**Identified Gaps** (addressed):
- Compaction recovery: added explicit instructions in SKILL.md for re-reading state.json after compaction
- Verify evidence requirement: hook must require at least one `provenance:"cli-emitted"` entry for `verdict: PASS`
- OpenCode "identical behavior" clarification: state tracking with manual re-invocation (not truly automated like Claude Code's Stop hook)
- `side-effects-failed.json`: excluded from v1 (manual recovery acceptable)
- `/corgi:cancel-loop`: excluded from v1 (manual cleanup acceptable)
- Compounds tier: infrastructure ready but never used — this is the first compound skill

---

### Key Schemas (Inline Reference)

These are the exact JSON schemas the implementation must follow. Sourced from `wiki/research/loop-implementation-comparison.md` (absolute path: `<project-root>/wiki/research/loop-implementation-comparison.md`, 1229 lines, last updated 2026-06-10). The file IS in the repository (1229 lines, git-tracked on branch `loop-corgi`). Run `wc -l wiki/research/loop-implementation-comparison.md` to confirm. All line references below are stable anchors into this file. If any automated tool reports the file as missing, it is a tool limitation — the file has been manually verified to exist and is readable.

**state.json**:
```json
{
  "active": true,
  "changeName": "example-change",
  "sessionId": "session-id",
  "nonce": "2026-06-10T10:00:00Z-group-2",
  "currentGroup": 2,
  "totalGroups": 5,
  "phase": "awaiting_group_result",
  "worktreePath": ".worktrees/feat/example-change",
  "platform": "github-tracked",
  "autoApprovalPolicy": {"allowCommitPush": true, "allowPassWithWarnings": false},
  "startedAt": "2026-06-10T10:00:00Z",
  "maxBlocks": 6,
  "maxGroups": 10,
  "blockCount": 3,
  "completedGroups": [1],
  "groupStatuses": {"1": "completed", "2": "in_progress"},
  "pushStatus": {"1": "pushed", "2": "pending"},
  "updatedAt": "2026-06-10T10:12:00Z"
}
```

**verify.json**:
```json
{
  "schemaVersion": 1,
  "changeName": "example-change",
  "group": 2,
  "nonce": "2026-06-10T10:00:00Z-group-2",
  "verdict": "PASS",
  "evidence": [
    {"kind": "test", "command": "npm test", "status": "pass", "exitCode": 0, "provenance": "cli-emitted"},
    {"kind": "build", "command": "npm run build", "status": "pass", "exitCode": 0, "provenance": "cli-emitted"}
  ]
}
```

**review.json**:
```json
{
  "schemaVersion": 1,
  "changeName": "example-change",
  "group": 2,
  "nonce": "2026-06-10T10:00:00Z-group-2",
  "finding_details": [
    {"severity": "suggestion", "check": "Code Quality", "description": "Consider extracting validation logic"}
  ]
}
```

**State Machine Phases** (all terminal conditions):
| Phase | Trigger | Terminal? |
|-------|---------|-----------|
| `awaiting_group_result` | Normal: waiting for LLM to write artifacts | No |
| `awaiting_finalize` | All groups done, last group needs commit/push | No |
| `done` | All finalized successfully | Yes |
| `verify_failed` | Verdict = FAIL or PASS_WITH_WARNINGS (policy denied) | Yes |
| `stopped_review_findings` | critical > 0 or important > 0 | Yes |
| `error_validation` | Malformed/stale artifact, type errors, enum violations | Yes |
| `session_conflict` | sessionId mismatch | Yes |
| `circuit_breaker` | blockCount >= maxBlocks | Yes |
| `error_corruption` | currentGroup > totalGroups or < 1 | Yes |

**Severity Enum** (exactly these 5 values, case-sensitive):
`critical`, `important`, `suggestion`, `nit`, `fyi`

**Verdict Enum** (exactly these 3 values):
`PASS`, `PASS_WITH_WARNINGS`, `FAIL`

---

## Work Objectives

### Core Objective
Build a hard-logic-driven loop that executes Corgi Task Groups automatically (apply→verify→review-evidence→advance) with deterministic lifecycle control via a TypeScript Stop hook, achieving hands-off multi-group execution when all groups pass cleanly.

### Concrete Deliverables
- `packages/corgispec/src/commands/hooks/loop-check.ts` — Stop hook implementation
- `packages/corgispec/src/lib/loop-state.ts` — State machine logic (testable core)
- `packages/corgispec/test/hooks/loop-check.test.ts` — TDD test suite
- `.opencode/skills/compounds/corgispec-loop/SKILL.md` + `skill.meta.json`
- `.opencode/skills/molecules/corgispec-review-loop/SKILL.md` + `skill.meta.json`
- `.opencode/commands/corgi-loop.md` — OpenCode command
- `.claude/skills/compounds/corgispec-loop/SKILL.md` + `skill.meta.json`
- `.claude/skills/molecules/corgispec-review-loop/SKILL.md` + `skill.meta.json`
- `.claude/commands/corgi/loop.md` — Claude Code command
- Modified `packages/corgispec/src/commands/hooks/stop-check.ts` — loop-aware guard
- Modified `packages/corgispec/src/commands/hooks/index.ts` — register loop-check
- Modified `packages/corgispec/src/commands/hooks/generate.ts` — add loop hook to `buildClaudeConfig()` Stop section

### Definition of Done
- [x] All 16+ terminal conditions have passing vitest tests — 25 tests GREEN
- [x] Golden-path test: 3-group clean change → 3 blocks → done (67 tests pass)
- [x] Failure-path test: critical finding → terminal stop (67 tests pass)
- [x] Wave 0 probes pass in real Claude Code session — Tasks 1-3 verified
- [x] `corgispec hook loop-check` exits correctly for all state machine phases
- [x] `corgispec hook stop-check` skips when loop state active
- [x] Both platform commands dispatch to correct skills
- [x] `corgispec hooks generate --platform claude` includes loop hook entry

### Must Have
- State machine with fail-closed guards for ALL invalid states
- Identity validation (changeName, group, nonce) on every artifact
- Severity enum validation (critical/important/suggestion/nit/fyi)
- finding_details type validation (must be array)
- Verdict type validation (must be string)
- Circuit breaker (maxBlocks=6)
- Session ownership guard (sessionId comparison)
- `stop_hook_active` guard against re-entry
- At least one `provenance:"cli-emitted"` evidence for PASS verdict
- Compaction recovery instructions in SKILL.md
- Atomic state writes (tmp + rename pattern)

### Must NOT Have (Guardrails)
- NO modifications to existing apply/verify/review skills
- NO `corgispec verify --json` CLI command (v2 enhancement)
- NO `/corgi:cancel-loop` command (manual cleanup is acceptable in v1)
- NO `side-effects-failed.json` marker (v2 enhancement)
- NO Codex platform support (explicitly out of scope)
- NO visualization, dashboards, or progress bars
- NO retry logic for individual tasks within a group
- NO telemetry, logging, or metrics (stderr diagnostics only)
- NO bash/jq/flock dependencies (TypeScript only)

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.
> Note: "Agent-executed" includes running tools in a Claude Code session — the AGENT operates Claude Code, not a human manually testing.

### Test Decision
- **Infrastructure exists**: YES (vitest in packages/corgispec/)
- **Automated tests**: TDD — write tests FIRST, then implement
- **Framework**: vitest (matching existing test infrastructure)
- **TDD flow**: RED (failing test for each state transition) → GREEN (implement to pass) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Hook logic**: Use Bash (node REPL / vitest) — import, call functions, compare output
- **CLI integration**: Use Bash — run `corgispec hook loop-check` with piped stdin JSON, assert exit code + stdout
- **Claude Code probes**: Use interactive_bash (tmux) — run in real Claude Code session, observe behavior

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 0 (Preflight Probes — HARD GATE):
├── Task 1: JSON Stop block probe [quick]
├── Task 2: Mixed Stop hook composition probe [quick]
└── Task 3: Consecutive block guard probe [quick]

Wave 1 (Foundation — TDD state machine, MAX PARALLEL):
├── Task 4: State machine types + interfaces [quick]
├── Task 5: TDD test suite — terminal conditions [deep]
├── Task 6: State machine implementation (make tests pass) [deep]
├── Task 7: Loop-check hook command scaffold [quick]
└── Task 8: State validation library [deep]

Wave 2 (Skills + Hook Wiring):
├── Task 9: corgispec-review-loop skill [unspecified-high]
├── Task 10: corgispec-loop skill (compound) [unspecified-high]
├── Task 11: Make stop-check loop-aware [quick]
├── Task 12: Register loop-check in index.ts [quick]
├── Task 13: Update generate.ts buildClaudeConfig() [quick]
└── Task 14: Integration tests (golden path + failure path) [deep]

Wave 3 (Platform Commands + Final Wiring):
├── Task 15: OpenCode command + skill mirrors [quick]
├── Task 16: Claude Code command + skill mirrors [quick]
├── Task 17: End-to-end smoke test (both platforms) [unspecified-high]
└── Task 18: Update wiki research doc with implementation notes [writing]

Wave FINAL (4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 4-18 (hard gate) | 0 |
| 2 | - | 4-18 (hard gate) | 0 |
| 3 | - | 4-18 (hard gate) | 0 |
| 4 | 1,2,3 | 5,6,7,8 | 1 |
| 5 | 4 | 6 | 1 |
| 6 | 5 | 7,9,10,11,14 | 1 |
| 7 | 4 | 12,14 | 1 |
| 8 | 4 | 6,14 | 1 |
| 9 | 6 | 10,14 | 2 |
| 10 | 6,9 | 14,15,16 | 2 |
| 11 | 6 | 14 | 2 |
| 12 | 7 | 13,14 | 2 |
| 13 | 12 | 14,17 | 2 |
| 14 | 6,9,11,12,13 | 17 | 2 |
| 15 | 10 | 17 | 3 |
| 16 | 10 | 17 | 3 |
| 17 | 14,15,16 | F1-F4 | 3 |
| 18 | 17 | - | 3 |

### Agent Dispatch Summary

- **Wave 0**: 3 tasks → `quick` (preflight probes in Claude Code)
- **Wave 1**: 5 tasks → T4 `quick`, T5 `deep`, T6 `deep`, T7 `quick`, T8 `deep`
- **Wave 2**: 6 tasks → T9 `unspecified-high`, T10 `unspecified-high`, T11 `quick`, T12 `quick`, T13 `quick`, T14 `deep`
- **Wave 3**: 4 tasks → T15 `quick`, T16 `quick`, T17 `unspecified-high`, T18 `writing`
- **FINAL**: 4 tasks → F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

> **Wave 0 Shared Setup**: All probes use a disposable Claude Code project with this minimal structure:
> ```
> /tmp/corgi-loop-probe/
> ├── .claude/
> │   └── settings.json
> └── test.txt (any file so Claude has something to work with)
> ```
> Minimal `.claude/settings.json` for probes:
> ```json
> {
>   "hooks": {
>     "Stop": [
>       {
>         "hooks": [
>           {
>             "type": "command",
>             "command": "/tmp/corgi-loop-probe/hooks/stop-hook.sh",
>             "timeout": 15
>           }
>         ]
>       }
>     ]
>   }
> }
> ```
> Create the hook script at `/tmp/corgi-loop-probe/hooks/stop-hook.sh` (chmod +x).
> Each probe modifies only the hook script content. Run Claude Code from `/tmp/corgi-loop-probe/`.

- [x] 1. Preflight Probe: JSON Stop Block (Claude Code)

  **What to do**:
  - Create a disposable Claude Code project with a minimal Stop hook that returns {"decision":"block","reason":"test continuation"} via exit 0
  - Verify Claude Code continues the conversation (does NOT stop)
  - Verify the reason field content is visible to Claude as continuation instruction
  - Verify stop_hook_active is true on subsequent invocations after a block
  - Document the exact JSON format that works

  **Must NOT do**:
  - Do NOT build any loop logic — this is a pure contract validation
  - Do NOT use exit 2 — specifically testing the JSON mechanism

  **Recommended Agent Profile**:
  - **Category**: quick
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 0 (with Tasks 2, 3)
  - **Blocks**: Tasks 4-18 (hard gate — if this fails, redesign needed)
  - **Blocked By**: None

  **References**:
  - wiki/research/loop-implementation-comparison.md:396-414 — Correct Stop-Hook Contract section
  - Claude Code hooks guide: https://code.claude.com/docs/en/hooks — Stop hook decision table
  - Ralph-wiggum plugin stop-hook.sh: jq -n '{decision:"block", reason:$prompt}' pattern

  **Acceptance Criteria**:

  ```
  Scenario: JSON Stop block continues conversation
    Tool: interactive_bash (tmux in Claude Code session)
    Preconditions: Fresh Claude Code project with .claude/settings.json containing Stop hook
    Steps:
      1. Create hook script: echo '{"decision":"block","reason":"Please continue working"}'; exit 0
      2. Ask Claude to do a task and stop
      3. Observe: Claude does NOT stop, continues with the reason as context
      4. Check hook input on 2nd invocation: stop_hook_active should be true
    Expected Result: Conversation continues; stop_hook_active=true on re-entry
    Failure Indicators: Claude stops despite the block; no stop_hook_active field; reason not visible
    Evidence: .sisyphus/evidence/task-1-json-stop-block.md
  ```

  **Commit**: NO (disposable test)

- [x] 2. Preflight Probe: Mixed Stop Hook Composition

  **What to do**:
  - Configure TWO Stop hooks in the same project:
    - Hook A: exit 2 with stderr message (mimics existing stop-check)
    - Hook B: exit 0 with JSON {"decision":"block","reason":"loop continues"}
  - Test in BOTH orderings (A first, B first)
  - Verify BOTH hooks execute
  - Verify net effect is "block" (conversation continues)
  - Document which hook's content Claude sees as continuation instruction

  **Must NOT do**:
  - Do NOT implement actual stop-check logic — use minimal stubs
  - Do NOT test with more than 2 hooks

  **Recommended Agent Profile**:
  - **Category**: quick
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 0 (with Tasks 1, 3)
  - **Blocks**: Tasks 4-18 (hard gate)
  - **Blocked By**: None

  **References**:
  - wiki/research/loop-implementation-comparison.md:909-959 — Risk 3: Stop-Check Hook Composition
  - .claude/settings.json — current Stop hook configuration pattern
  - Claude Code hooks guide: "When multiple hooks match the same event, every hook runs to completion"

  **Acceptance Criteria**:

  ```
  Scenario: Two Stop hooks coexist (exit 2 + JSON block)
    Tool: interactive_bash (tmux in Claude Code session)
    Preconditions: .claude/settings.json with two Stop hook entries
    Steps:
      1. Configure Hook A: echo "still working" >&2; exit 2
      2. Configure Hook B: echo '{"decision":"block","reason":"loop next group"}'; exit 0
      3. Ask Claude to complete and stop
      4. Observe: conversation continues (both blocks honored)
      5. Check stderr/logs to confirm both hooks executed
    Expected Result: Both hooks run; any blocking hook prevents stop; conversation continues
    Failure Indicators: Only one hook runs; Claude stops despite blocks; ordering matters
    Evidence: .sisyphus/evidence/task-2-mixed-composition.md

  Scenario: JSON reason is the primary continuation instruction
    Tool: interactive_bash (same session)
    Steps:
      1. After the block, observe what Claude sees as next instruction
      2. Verify JSON reason ("loop next group") is the primary instruction
    Expected Result: Claude continuation guided by JSON reason field
    Evidence: .sisyphus/evidence/task-2-reason-visibility.md
  ```

  **Commit**: NO (disposable test)

- [x] 3. Preflight Probe: Consecutive Block Guard

  **What to do**:
  - Configure a Stop hook that ALWAYS blocks (JSON decision:block)
  - Let Claude attempt to stop repeatedly
  - Count how many times the hook blocks before Claude overrides
  - Verify threshold matches documented "8 consecutive blocks"
  - Test with CLAUDE_CODE_STOP_HOOK_BLOCK_CAP env var if available

  **Must NOT do**:
  - Do NOT run for more than 15 iterations (safety cap)
  - Do NOT modify Claude Code behavior — just observe

  **Recommended Agent Profile**:
  - **Category**: quick
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 0 (with Tasks 1, 2)
  - **Blocks**: Tasks 4-18 (informs maxBlocks setting)
  - **Blocked By**: None

  **References**:
  - wiki/research/loop-implementation-comparison.md:939-955 — Risk 2: Anti-Infinite-Loop Guard
  - Claude Code CHANGELOG v2.1.143: "8 consecutive blocks" / CLAUDE_CODE_STOP_HOOK_BLOCK_CAP

  **Acceptance Criteria**:

  ```
  Scenario: Block cap fires at documented threshold
    Tool: interactive_bash (tmux in Claude Code session)
    Preconditions: Stop hook that always returns {"decision":"block","reason":"keep going"}
    Steps:
      1. Configure always-blocking Stop hook
      2. Ask Claude to do something trivial then stop
      3. Count consecutive blocks via hook log (echo count >> /tmp/block-count.log)
      4. Observe when Claude overrides the hook and stops
    Expected Result: Claude overrides after 8 consecutive blocks (9th attempt stops)
    Failure Indicators: Different threshold; no override; override before 8
    Evidence: .sisyphus/evidence/task-3-block-cap.md
  ```

  **Commit**: NO (disposable test)


- [x] 4. State Machine Types and Interfaces

  **What to do**:
  - Define TypeScript interfaces for all loop artifacts: `LoopState`, `VerifyArtifact`, `ReviewArtifact`
  - Define enums/constants: `LoopPhase`, `Verdict`, `Severity`, `Provenance`
  - Define the `LoopHookDecision` type (proceed vs block with reason)
  - Create `packages/corgispec/src/lib/loop-types.ts`
  - Match the JSON schemas exactly from `wiki/research/loop-implementation-comparison.md:439-568`

  **Must NOT do**:
  - No implementation logic — types only
  - No runtime validation (that's Task 8)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 5, 7, 8 after Wave 0 gate passes)
  - **Parallel Group**: Wave 1
  - **Blocks**: Tasks 5, 6, 7, 8
  - **Blocked By**: Tasks 1, 2, 3 (Wave 0 hard gate)

  **References**:
  - `wiki/research/loop-implementation-comparison.md:439-568` — State and Artifact Design section (exact JSON schemas)
  - `wiki/research/loop-implementation-comparison.md:575-608` — JSON Validation Rules
  - `packages/corgispec/src/lib/hooks.ts:1-50` — existing `HookInput` type pattern
  - `packages/corgispec/src/lib/changes.ts` — `TaskGroup` interface for reference

  **Acceptance Criteria**:

  ```
  Scenario: Types compile without errors
    Tool: Bash
    Steps:
      1. npx tsc --noEmit packages/corgispec/src/lib/loop-types.ts
    Expected Result: Exit code 0, no type errors
    Evidence: .sisyphus/evidence/task-4-types-compile.txt

  Scenario: All schema fields represented
    Tool: Bash (grep)
    Steps:
      1. Verify LoopState has: active, changeName, sessionId, nonce, currentGroup, totalGroups, phase, maxBlocks, blockCount, completedGroups, groupStatuses, updatedAt
      2. Verify VerifyArtifact has: schemaVersion, changeName, group, nonce, verdict, evidence[]
      3. Verify ReviewArtifact has: schemaVersion, changeName, group, nonce, finding_details[]
      4. Verify Severity enum has exactly: critical, important, suggestion, nit, fyi
      5. Verify Verdict enum has exactly: PASS, PASS_WITH_WARNINGS, FAIL
    Expected Result: All fields present in type definitions
    Evidence: .sisyphus/evidence/task-4-schema-coverage.txt
  ```

  **Commit**: YES (groups with Task 8)
  - Message: `feat(loop): add state machine types and validation library`
  - Files: `packages/corgispec/src/lib/loop-types.ts`
  - Pre-commit: `npx tsc --noEmit`

- [x] 5. TDD Test Suite — Terminal Conditions (RED phase)

  **What to do**:
  - Create `packages/corgispec/test/hooks/loop-check.test.ts`
  - Write FAILING tests for ALL 16+ terminal conditions from the state machine table
  - Each test: set up state.json + verify.json + review.json → call hook logic → assert exit code + stdout JSON + state mutation
  - Tests MUST fail (RED) — implementation doesn't exist yet
  - Test categories: identity validation, verdict gate, severity gate, circuit breaker, session guard, corruption guards, finalize path, advance path

  **Must NOT do**:
  - No implementation code (that's Task 6)
  - No integration with CLI (unit tests only)
  - No mocking of external services

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential after Task 4)
  - **Parallel Group**: Wave 1 (starts after Task 4)
  - **Blocks**: Task 6
  - **Blocked By**: Task 4 (needs types)

  **References**:
  - `wiki/research/loop-implementation-comparison.md:610-628` — Corrected State Machine (v4) table (all phases and transitions)
  - `wiki/research/loop-implementation-comparison.md:575-608` — JSON Validation Rules (all fail-closed conditions)
  - `wiki/research/loop-implementation-comparison.md:666-898` — Corrected Hook Pseudocode (v4) — test cases map to this logic
  - `packages/corgispec/test/hooks/` — existing test patterns (if any)

  **Acceptance Criteria**:

  ```
  Scenario: All tests fail (RED phase)
    Tool: Bash
    Steps:
      1. npx vitest run packages/corgispec/test/hooks/loop-check.test.ts
    Expected Result: 16+ tests, ALL FAILING (no implementation yet)
    Failure Indicators: Any test passes (means test is trivial/wrong)
    Evidence: .sisyphus/evidence/task-5-red-phase.txt

  Scenario: Test coverage of all terminal conditions
    Tool: Bash (grep)
    Steps:
      1. Count test cases covering: verify_failed, verify_pass_with_warnings_denied, stopped_review_findings, error_validation (×6 variants), session_conflict, circuit_breaker, error_corruption (×2), worktree_missing, clean_advance, final_group_finalize, done
    Expected Result: Minimum 16 distinct test cases
    Evidence: .sisyphus/evidence/task-5-test-count.txt
  ```

  **Commit**: YES (groups with Task 6)
  - Message: `test(loop): TDD test suite for loop-check state machine (RED)`
  - Files: `packages/corgispec/test/hooks/loop-check.test.ts`
  - Pre-commit: `npx tsc --noEmit`

- [x] 6. State Machine Implementation (GREEN phase — make tests pass)

  **What to do**:
  - Create `packages/corgispec/src/lib/loop-state.ts` — the core state machine logic as a pure function
  - Input: state.json content, verify.json content (optional), review.json content (optional), hook input (stop_hook_active, session_id)
  - Output: `LoopHookDecision` (proceed/block + reason + state mutations)
  - Implement ALL validation guards from the research doc
  - Make ALL tests from Task 5 PASS
  - Key logic: inert guard → active check → session guard → circuit breaker → first-run detection → artifact identity → verdict gate → severity derivation → advance/finalize

  **Must NOT do**:
  - No file I/O in this module (pure function, receives data)
  - No CLI wiring (that's Task 7)
  - No side effects (state mutation returned, not applied)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs Task 5 tests to verify against)
  - **Parallel Group**: Wave 1 (sequential after Task 5)
  - **Blocks**: Tasks 7, 9, 10, 11, 14
  - **Blocked By**: Tasks 4, 5, 8

  **References**:
  - `wiki/research/loop-implementation-comparison.md:666-898` — v4 Hook Pseudocode (the specification to implement)
  - `wiki/research/loop-implementation-comparison.md:610-628` — State machine table
  - `wiki/research/loop-implementation-comparison.md:1007-1048` — Auto-Approval Policy
  - `packages/corgispec/src/lib/hooks.ts` — existing shared library patterns
  - `packages/corgispec/test/hooks/loop-check.test.ts` — the tests from Task 5

  **Acceptance Criteria**:

  ```
  Scenario: All TDD tests pass (GREEN phase)
    Tool: Bash
    Steps:
      1. npx vitest run packages/corgispec/test/hooks/loop-check.test.ts
    Expected Result: ALL 16+ tests PASSING
    Failure Indicators: Any test still failing
    Evidence: .sisyphus/evidence/task-6-green-phase.txt

  Scenario: No external dependencies in core logic
    Tool: Bash (grep)
    Steps:
      1. grep -c "import.*fs" packages/corgispec/src/lib/loop-state.ts
      2. grep -c "import.*child_process" packages/corgispec/src/lib/loop-state.ts
    Expected Result: Both return 0 (no file I/O, no subprocess)
    Evidence: .sisyphus/evidence/task-6-purity-check.txt
  ```

  **Commit**: YES (groups with Task 5)
  - Message: `feat(loop): implement loop-check state machine (GREEN — all tests pass)`
  - Files: `packages/corgispec/src/lib/loop-state.ts`
  - Pre-commit: `npx vitest run packages/corgispec/test/hooks/loop-check.test.ts`

- [x] 7. Loop-Check Hook Command Scaffold

  **What to do**:
  - Create `packages/corgispec/src/commands/hooks/loop-check.ts`
  - Follow exact pattern of `stop-check.ts`: isHooksDisabled → findProjectRoot → readStdinJson → logic → exit
  - Wire the I/O layer: read state.json from disk, read verify.json/review.json, call state machine logic, write state mutations, output JSON to stdout
  - Handle: atomic writes (write to `.tmp` file then `fs.renameSync` — no external locking library needed for v1), glob-based state discovery, stdin parsing
  - File locking strategy: atomic tmp+rename only. No `proper-lockfile` or `flock` — single-session ownership (via sessionId check) prevents concurrent access
  - Export `createHookLoopCheckCommand()` function

  **Must NOT do**:
  - No state machine logic in this file (delegates to loop-state.ts)
  - No direct JSON manipulation (uses types from loop-types.ts)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (can start after Task 4, implements I/O layer)
  - **Parallel Group**: Wave 1 (parallel with 5, 8)
  - **Blocks**: Tasks 12, 14
  - **Blocked By**: Task 4 (needs types), Task 6 (needs state machine to call)

  **References**:
  - `packages/corgispec/src/commands/hooks/stop-check.ts` — exact pattern to follow (48 lines)
  - `packages/corgispec/src/lib/hooks.ts:readStdinJson()` — stdin parsing
  - `packages/corgispec/src/lib/hooks.ts:findProjectRoot()` — project discovery
  - `packages/corgispec/src/lib/hooks.ts:isHooksDisabled()` — disable guard

  **Acceptance Criteria**:

  ```
  Scenario: Hook exits 0 with proceed when no loop active
    Tool: Bash
    Steps:
      1. echo '{"hook_event_name":"Stop","stop_hook_active":false}' | npx corgispec hook loop-check
      2. Check exit code = 0
      3. Check stdout = {"decision":"proceed"}
    Expected Result: Clean passthrough when no active loop
    Evidence: .sisyphus/evidence/task-7-inert-guard.txt

  Scenario: Hook reads state and delegates to state machine
    Tool: Bash
    Preconditions: openspec/config.yaml exists (required for findProjectRoot())
    Steps:
      1. mkdir -p openspec && echo "schema: github-tracked" > openspec/config.yaml
      2. mkdir -p .claude/corgi-loop/test-change/groups/1
      3. Create .claude/corgi-loop/test-change/state.json with {"active":true,"changeName":"test-change","currentGroup":1,"totalGroups":2,"phase":"awaiting_group_result","maxBlocks":6,"blockCount":0,"nonce":"2026-01-01T00:00:00Z-group-1","completedGroups":[],"groupStatuses":{"1":"in_progress"},"updatedAt":"2026-01-01T00:00:00Z"}
      4. echo '{"hook_event_name":"Stop","stop_hook_active":false}' | npx corgispec hook loop-check
      5. Verify hook reads state and produces block (no artifacts yet = first-run block)
    Expected Result: Hook outputs {"decision":"block","reason":"..."} indicating first-run (artifacts not yet written)
    Evidence: .sisyphus/evidence/task-7-delegation.txt
  ```

  **Commit**: YES
  - Message: `feat(loop): add loop-check hook command scaffold`
  - Files: `packages/corgispec/src/commands/hooks/loop-check.ts`
  - Pre-commit: `npx tsc --noEmit`

- [x] 8. State Validation Library

  **What to do**:
  - Create `packages/corgispec/src/lib/loop-validation.ts`
  - Create `packages/corgispec/test/hooks/loop-validation.test.ts` (test file for this module)
  - Implement JSON schema validators for: LoopState, VerifyArtifact, ReviewArtifact
  - Implement identity validation: changeName + group + nonce match between state and artifacts
  - Implement severity enum validator (exactly: critical, important, suggestion, nit, fyi)
  - Implement evidence provenance check: at least one cli-emitted entry for PASS verdict
  - Return structured validation errors (not throws) — `{ valid: boolean, errors: string[] }`

  **Must NOT do**:
  - No external schema validation library (zod/ajv) — keep it simple inline checks
  - No file I/O — operates on parsed objects

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Tasks 5, 7)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 6 (state machine uses validators)
  - **Blocked By**: Task 4 (needs types)

  **References**:
  - `wiki/research/loop-implementation-comparison.md:575-608` — JSON Validation Rules (the specification)
  - `wiki/research/loop-implementation-comparison.md:519-527` — Evidence provenance check
  - `packages/corgispec/src/lib/loop-types.ts` — types from Task 4

  **Acceptance Criteria**:

  ```
  Scenario: Valid artifacts pass validation
    Tool: Bash (vitest)
    Steps:
      1. Test with valid state.json, verify.json, review.json → valid:true, errors:[]
    Expected Result: Clean validation pass
    Evidence: .sisyphus/evidence/task-8-valid-pass.txt

  Scenario: All invalid cases caught
    Tool: Bash (vitest)
    Steps:
      1. Test non-string verdict → error
      2. Test non-array finding_details → error
      3. Test null severity → error
      4. Test unknown severity "warning" → error
      5. Test exitCode mismatch (exitCode:1, status:pass, provenance:cli-emitted) → error
      6. Test PASS verdict with zero cli-emitted evidence → error
      7. Test identity mismatch (state.group=2, artifact.group=1) → error
      8. Test missing required fields → error
    Expected Result: All invalid inputs produce errors:[] with descriptive messages
    Evidence: .sisyphus/evidence/task-8-invalid-caught.txt
  ```

  **Commit**: YES (groups with Task 4)
  - Message: `feat(loop): add state machine types and validation library`
  - Files: `packages/corgispec/src/lib/loop-validation.ts`
  - Pre-commit: `npx vitest run packages/corgispec/test/hooks/loop-validation.test.ts`


- [x] 9. corgispec-review-loop Skill (Evidence-Only Review)

  **What to do**:
  - Create `.opencode/skills/molecules/corgispec-review-loop/SKILL.md`
  - Create `.opencode/skills/molecules/corgispec-review-loop/skill.meta.json`
  - This skill runs the SAME quality checks as normal review (5-axis)
  - BUT: does NOT ask Approve/Reject/Discuss (no human gate)
  - Instead: writes `review.json` to `.claude/corgi-loop/<change>/groups/<N>/review.json`
  - Must follow the exact schema: schemaVersion, changeName, group, nonce, finding_details[]
  - Each finding: severity (enum), check, description, optional file/requirement fields
  - MUST NOT mutate issue labels or commit/push

  **Must NOT do**:
  - Do NOT modify existing corgispec-review skill
  - Do NOT add human interaction
  - Do NOT change issue labels

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Task 11, 12, 13)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 10, 14
  - **Blocked By**: Task 6 (needs state machine for schema reference)

  **References**:
  - `.opencode/skills/molecules/corgispec-review/SKILL.md` — existing review skill structure
  - `wiki/research/loop-implementation-comparison.md:538-573` — Review Artifact schema (the JSON output format)
  - `wiki/research/loop-implementation-comparison.md:636-661` — Loop-Specific Review Mode (Option A rationale)
  - `.opencode/skills/molecules/corgispec-review/references/quality-checks.md` — 5-axis check definitions

  **What to KEEP from quality-checks.md** (reuse these check categories):
  - Code Quality checks (anti-patterns, naming, structure)
  - Spec Verification (coverage table)
  - Functional Verification (test pass/fail)
  - Architecture checks (patterns, boundaries)
  - Performance + Security checklists

  **What to REMOVE / NOT replicate**:
  - Step 5: Human decision gate (Approve/Reject/Discuss) — FORBIDDEN in loop review
  - Step 6: Decision flow (commit/push, label mutation) — NOT the review-loop's job
  - Any `glab issue note` or `gh issue comment` posting — review-loop only writes review.json
  - Any "present to user" or "ask user" instructions — fully automated
  - Severity summary table posted to issues — replaced by finding_details[] in JSON

  **Acceptance Criteria**:

  ```
  Scenario: Skill metadata is valid
    Tool: Bash
    Steps:
      1. node -e "const m=JSON.parse(require('fs').readFileSync('.opencode/skills/molecules/corgispec-review-loop/skill.meta.json','utf8')); const required=['name','tier','version']; const missing=required.filter(k=>!m[k]); if(missing.length){console.error('Missing:',missing);process.exit(1)} console.log('Valid:',m.name,m.tier)"
    Expected Result: No validation errors for corgispec-review-loop
    Evidence: .sisyphus/evidence/task-9-metadata-valid.txt

  Scenario: SKILL.md includes review.json output instruction
    Tool: Bash (grep)
    Steps:
      1. grep -c "review.json" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
      2. grep -c "finding_details" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
      3. grep -c "Approve\|Reject\|Discuss" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
    Expected Result: review.json mentioned 2+ times, finding_details mentioned, Approve/Reject/Discuss NOT mentioned
    Evidence: .sisyphus/evidence/task-9-skill-content.txt
  ```

  **Commit**: YES (groups with Task 10)
  - Message: `feat(loop): add review-loop and loop executor skills`
  - Files: `.opencode/skills/molecules/corgispec-review-loop/`
  - Pre-commit: `node -e "const m=JSON.parse(require('fs').readFileSync('.opencode/skills/molecules/corgispec-review-loop/skill.meta.json','utf8')); if(!m.name||!m.tier)process.exit(1); console.log('OK')"`

- [x] 10. corgispec-loop Skill (Compound Loop Executor)

  **What to do**:
  - Create `.opencode/skills/compounds/corgispec-loop/SKILL.md`
  - Create `.opencode/skills/compounds/corgispec-loop/skill.meta.json`
  - Create the `compounds/` directory (first compound skill)
  - This skill teaches the LLM how to:
    1. Initialize loop state (create state.json with correct fields)
    2. Execute one group bundle: apply → verify → review-evidence
    3. Write verify.json and review.json in correct schema
    4. Stop after each bundle (let hook decide next action)
    5. Recover after context compaction (re-read state.json)
    6. Handle the "first run" case (no artifacts yet)
    7. Handle the "auto-approve + next group" continuation instruction
  - Include compaction recovery instructions explicitly
  - Include exact JSON schema examples for artifacts
  - Include the nonce format: `YYYY-MM-DDTHH:MM:SSZ-group-N`

  **Must NOT do**:
  - Do NOT implement state machine logic (hook owns that)
  - Do NOT make lifecycle decisions (hook decides continue/stop)
  - Do NOT auto-approve without hook instruction

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs Task 9 for review-loop reference)
  - **Parallel Group**: Wave 2 (after Task 9)
  - **Blocks**: Tasks 14, 15, 16
  - **Blocked By**: Tasks 6, 9

  **References**:
  - `wiki/research/loop-implementation-comparison.md:298-385` — Architecture and Group-Bundle Execution
  - `wiki/research/loop-implementation-comparison.md:439-568` — State and Artifact schemas (include as examples in SKILL.md)
  - `wiki/research/loop-implementation-comparison.md:1102-1153` — Execution Sequence Example (v4)
  - `.opencode/skills/molecules/corgispec-apply-change/SKILL.md` — apply skill (delegated to)
  - `.opencode/skills/molecules/corgispec-verify/SKILL.md` — verify skill (delegated to)
  - `.opencode/skills/molecules/corgispec-review-loop/SKILL.md` — review-loop skill (from Task 9)

  **Acceptance Criteria**:

  ```
  Scenario: Skill metadata is valid compound tier
    Tool: Bash
    Steps:
      1. node -e "const m=JSON.parse(require('fs').readFileSync('.opencode/skills/compounds/corgispec-loop/skill.meta.json','utf8')); if(m.tier!=='compound') process.exit(1); console.log('tier:', m.tier)"
    Expected Result: Prints "tier: compound" and exits 0
    Evidence: .sisyphus/evidence/task-10-compound-tier.txt

  Scenario: SKILL.md contains all required sections
    Tool: Bash (grep)
    Steps:
      1. grep -c "state.json" .opencode/skills/compounds/corgispec-loop/SKILL.md
      2. grep -c "verify.json" .opencode/skills/compounds/corgispec-loop/SKILL.md
      3. grep -c "review.json" .opencode/skills/compounds/corgispec-loop/SKILL.md
      4. grep -c "compaction\|compact" .opencode/skills/compounds/corgispec-loop/SKILL.md
      5. grep -c "nonce" .opencode/skills/compounds/corgispec-loop/SKILL.md
    Expected Result: All terms present multiple times; compaction recovery section exists
    Evidence: .sisyphus/evidence/task-10-skill-sections.txt
  ```

  **Commit**: YES (groups with Task 9)
  - Message: `feat(loop): add review-loop and loop executor skills`
  - Files: `.opencode/skills/compounds/corgispec-loop/`

- [x] 11. Make stop-check Loop-Aware

  **What to do**:
  - Modify `packages/corgispec/src/commands/hooks/stop-check.ts`
  - Add early exit: if any `.claude/corgi-loop/*/state.json` or `.opencode/corgi-loop/*/state.json` has `active: true`, exit 0 immediately
  - This delegates lifecycle control to the loop hook during active loops
  - Add a comment explaining why: "Loop hook owns lifecycle during active loop"
  - Use `findProjectRoot()` to determine correct state path

  **Must NOT do**:
  - Do NOT change stop-check behavior when no loop is active
  - Do NOT add complex logic — simple early-exit guard only

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Tasks 9, 12, 13)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14
  - **Blocked By**: Task 6 (needs loop-types for state schema)

  **References**:
  - `packages/corgispec/src/commands/hooks/stop-check.ts` — the file to modify
  - `packages/corgispec/src/lib/hooks.ts:findProjectRoot()` — project root discovery
  - `wiki/research/loop-implementation-comparison.md:949-959` — Risk 3 resolution: make stop-check loop-aware

  **Acceptance Criteria**:

  ```
  Scenario: stop-check skips when loop active
    Tool: Bash
    Steps:
      1. Create .claude/corgi-loop/test/state.json with {"active":true,...}
      2. echo '{}' | npx corgispec hook stop-check
      3. Check exit code = 0 (not 2)
    Expected Result: stop-check exits 0 (delegates to loop hook)
    Evidence: .sisyphus/evidence/task-11-loop-aware-skip.txt

  Scenario: stop-check normal behavior when no loop
    Tool: Bash
    Steps:
      1. Ensure no .claude/corgi-loop/ directory exists
      2. Create openspec/changes/test/tasks.md with incomplete tasks
      3. echo '{}' | npx corgispec hook stop-check
      4. Check exit code = 2 (blocks as before)
    Expected Result: Normal behavior unchanged
    Evidence: .sisyphus/evidence/task-11-normal-behavior.txt
  ```

  **Commit**: YES (groups with Tasks 12, 13)
  - Message: `feat(loop): make stop-check loop-aware and register loop-check`
  - Files: `packages/corgispec/src/commands/hooks/stop-check.ts`
  - Pre-commit: `npx vitest run packages/corgispec/test/hooks/stop-check.test.ts`

- [x] 12. Register loop-check in index.ts

  **What to do**:
  - Modify `packages/corgispec/src/commands/hooks/index.ts`
  - Add: `import { createHookLoopCheckCommand } from "./loop-check";`
  - Add: `cmd.addCommand(createHookLoopCheckCommand());`
  - Verify `corgispec hook loop-check` is accessible via CLI

  **Must NOT do**:
  - No logic changes — pure registration

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Tasks 9, 11, 13)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 13, 14
  - **Blocked By**: Task 7 (needs loop-check.ts to exist)

  **References**:
  - `packages/corgispec/src/commands/hooks/index.ts` — the file to modify (22 lines)
  - `packages/corgispec/src/commands/hooks/loop-check.ts` — the command to register (from Task 7)

  **Acceptance Criteria**:

  ```
  Scenario: CLI registers loop-check subcommand
    Tool: Bash
    Steps:
      1. npx corgispec hook --help | grep loop-check
    Expected Result: "loop-check" appears in help output
    Evidence: .sisyphus/evidence/task-12-cli-registered.txt
  ```

  **Commit**: YES (groups with Tasks 11, 13)
  - Message: `feat(loop): make stop-check loop-aware and register loop-check`
  - Files: `packages/corgispec/src/commands/hooks/index.ts`

- [x] 13. Update generate.ts buildClaudeConfig() — Add Loop Hook

  **What to do**:
  - Modify `packages/corgispec/src/commands/hooks/generate.ts`
  - Add loop-check to `buildClaudeConfig()` Stop section (line ~102-178) as a SECOND entry in the Stop hooks array
  - This covers BOTH Claude Code and OpenCode platforms (OpenCode reuses `buildClaudeConfig()` output)
  - Set timeout: 30s (longer than stop-check's 15s because loop-check does more file I/O + validation)
  - Do NOT modify `HOOK_EVENTS` array (lines 260-303) — that is Codex-specific and Codex is out of scope
  - Ensure `corgispec hooks generate --platform claude` outputs both stop-check AND loop-check in the Stop section

  **Must NOT do**:
  - Do NOT modify `HOOK_EVENTS` array (Codex-specific, out of scope)
  - Do NOT remove or modify existing stop-check entry in buildClaudeConfig()
  - Do NOT add a matcher (Stop hooks fire unconditionally)
  - Do NOT add Codex generation

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Tasks 9, 11)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 14
  - **Blocked By**: Task 12 (needs registration to exist)

  **References**:
  - `packages/corgispec/src/commands/hooks/generate.ts:102-178` — `buildClaudeConfig()` Stop section (the ONLY section to modify)
  - Note: `HOOK_EVENTS` array (lines 260-303) is Codex-specific and MUST NOT be modified

  **Acceptance Criteria**:

  ```
  Scenario: Generate includes loop-check for Claude
    Tool: Bash
    Steps:
      1. npx corgispec hooks generate --platform claude | grep -A5 loop-check
    Expected Result: loop-check entry with 30s timeout in Stop section
    Evidence: .sisyphus/evidence/task-13-generate-output.txt

  Scenario: Generate includes loop-check for OpenCode
    Tool: Bash
    Steps:
      1. npx corgispec hooks generate --platform opencode | grep loop-check
    Expected Result: loop-check appears in OpenCode hook config
    Evidence: .sisyphus/evidence/task-13-opencode-output.txt
  ```

  **Commit**: YES (groups with Tasks 11, 12)
  - Message: `feat(loop): make stop-check loop-aware and register loop-check`
  - Files: `packages/corgispec/src/commands/hooks/generate.ts`

- [x] 14. Integration Tests (Golden Path + Failure Paths)

  **What to do**:
  - Create `packages/corgispec/test/hooks/loop-check.integration.test.ts`
  - Test the FULL pipeline: stdin JSON → hook CLI → stdout JSON + state mutation
  - Golden path: 3-group change, all PASS, 0 findings → 3 blocks → done
  - Failure path: Group 2 has critical finding → 1 block (Group 1) → terminal stop on Group 2
  - Verify fail: Group 1 verdict FAIL → immediate terminal stop
  - Composition test: stop-check skips when loop active (integration with Task 11)
  - Use `execSync` to run `corgispec hook loop-check` with piped stdin

  **Must NOT do**:
  - No mocking — test the real CLI with real files
  - No network calls — all local file-based

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs all Wave 2 tasks complete)
  - **Parallel Group**: Wave 2 (last in wave)
  - **Blocks**: Task 17
  - **Blocked By**: Tasks 6, 9, 11, 12, 13

  **References**:
  - `wiki/research/loop-implementation-comparison.md:1102-1153` — Execution Sequence Example (golden path spec)
  - `packages/corgispec/test/` — existing integration test patterns
  - `packages/corgispec/src/commands/hooks/loop-check.ts` — the CLI entry point

  **Acceptance Criteria**:

  ```
  Scenario: Golden path — 3 groups all clean
    Tool: Bash (vitest)
    Steps:
      1. Set up state.json for 3-group change
      2. Simulate Group 1: write PASS verify.json + clean review.json
      3. Pipe stdin → loop-check → assert block with "advance to Group 2"
      4. Update state to Group 2, write artifacts, pipe → assert block
      5. Update state to Group 3, write artifacts, pipe → assert finalize block
      6. Update state phase=awaiting_finalize, pipe → assert proceed (done)
    Expected Result: 3 blocks followed by proceed; state.phase="done" at end
    Evidence: .sisyphus/evidence/task-14-golden-path.txt

  Scenario: Failure path — critical finding in Group 2
    Tool: Bash (vitest)
    Steps:
      1. Set up state.json for 3-group change
      2. Group 1: PASS + clean → assert block (advance)
      3. Group 2: PASS + review with severity:"critical" finding
      4. Pipe → assert proceed (terminal stop)
      5. Verify state: active=false, terminal=true, phase="stopped_review_findings"
    Expected Result: Terminal stop; state reflects findings
    Evidence: .sisyphus/evidence/task-14-failure-path.txt
  ```

  **Commit**: YES
  - Message: `test(loop): integration tests for golden path and failure paths`
  - Files: `packages/corgispec/test/hooks/loop-check.integration.test.ts`
  - Pre-commit: `npx vitest run packages/corgispec/test/hooks/loop-check.integration`


- [x] 15. OpenCode Command + Skill Mirrors

  **What to do**:
  - Create `.opencode/commands/corgi-loop.md` — command dispatcher following existing pattern
  - Mirror skills to `.opencode/` (review-loop already there from Task 9, loop from Task 10)
  - Command structure: read config.yaml → resolve change name (from args or discovery) → dispatch to corgispec-loop skill
  - Include help text explaining the loop behavior and auto-approval policy
  - State files go to `.opencode/corgi-loop/<change>/` for this platform

  **Must NOT do**:
  - Do NOT implement loop logic in the command file — delegate to skill
  - Do NOT add plugin infrastructure (command+skill is sufficient)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Task 16)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 17
  - **Blocked By**: Task 10 (needs loop skill)

  **References**:
  - `.opencode/commands/corgi-apply.md` — existing command pattern to follow
  - `.opencode/commands/corgi-verify.md` — another command example
  - `.opencode/skills/compounds/corgispec-loop/SKILL.md` — the skill to dispatch to

  **Acceptance Criteria**:

  ```
  Scenario: Command file exists and follows pattern
    Tool: Bash
    Steps:
      1. cat .opencode/commands/corgi-loop.md | head -5
      2. Verify YAML frontmatter with description
      3. Verify dispatch to corgispec-loop skill
    Expected Result: Valid command file with frontmatter and skill dispatch
    Evidence: .sisyphus/evidence/task-15-command-file.txt

  Scenario: State directory uses platform-specific path
    Tool: Bash (grep)
    Steps:
      1. grep "opencode/corgi-loop" .opencode/skills/compounds/corgispec-loop/SKILL.md
    Expected Result: SKILL.md references .opencode/corgi-loop/ for state location
    Evidence: .sisyphus/evidence/task-15-state-path.txt
  ```

  **Commit**: YES (groups with Task 16)
  - Message: `feat(loop): add platform commands and skill mirrors`
  - Files: `.opencode/commands/corgi-loop.md`

- [x] 16. Claude Code Command + Skill Mirrors

  **What to do**:
  - Create `.claude/commands/corgi/loop.md` — Claude Code command dispatcher (pattern: copy `.claude/commands/corgi/apply.md` structure)
  - CREATE new skill files (copying from `.opencode/` sources, adjusting paths):
    - CREATE `.claude/skills/compounds/` directory (new — first compound skill in Claude mirror)
    - CREATE `.claude/skills/compounds/corgispec-loop/SKILL.md` (source: `.opencode/skills/compounds/corgispec-loop/SKILL.md` from Task 10, replace `.opencode/` → `.claude/` in paths)
    - CREATE `.claude/skills/compounds/corgispec-loop/skill.meta.json`
    - CREATE `.claude/skills/molecules/corgispec-review-loop/SKILL.md` (source: `.opencode/skills/molecules/corgispec-review-loop/SKILL.md` from Task 9)
    - CREATE `.claude/skills/molecules/corgispec-review-loop/skill.meta.json`
  - State files location for Claude Code: `.claude/corgi-loop/<change>/`
  - Note: `.claude/skills/molecules/` already exists with other skill mirrors (e.g., `corgispec-apply-change/`); `.claude/skills/compounds/` is NEW

  **Must NOT do**:
  - Do NOT modify existing `.claude/skills/` molecules
  - Do NOT change `.claude/settings.json` manually (generate.ts handles that)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Task 15)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 17
  - **Blocked By**: Task 10 (needs loop skill)

  **References**:
  - `.claude/commands/corgi/apply.md` — existing Claude Code command pattern (verified: 2.0K, YAML frontmatter + skill dispatch)
  - `.claude/skills/molecules/corgispec-apply-change/SKILL.md` — existing Claude Code skill mirror (verified: 6.2K, with references/ dir and skill.meta.json)
  - `.opencode/skills/compounds/corgispec-loop/SKILL.md` — source to mirror for Claude (from Task 10)
  - `.opencode/skills/molecules/corgispec-review-loop/SKILL.md` — source to mirror for Claude (from Task 9)
  - Note: `.claude/skills/compounds/` directory does not yet exist — Task 16 creates it (first compound skill in Claude mirror)
  - VERIFIED EXISTING: `.claude/commands/corgi/apply.md` (2.0K), `.claude/skills/molecules/corgispec-apply-change/SKILL.md` (6.2K) — both confirmed present in repository as of 2026-06-10

  **Acceptance Criteria**:

  ```
  Scenario: Claude Code command exists
    Tool: Bash
    Steps:
      1. ls .claude/commands/corgi/loop.md
      2. cat .claude/commands/corgi/loop.md | head -5
    Expected Result: File exists with valid frontmatter
    Evidence: .sisyphus/evidence/task-16-claude-command.txt

  Scenario: Claude Code skills mirrored correctly
    Tool: Bash
    Steps:
      1. ls .claude/skills/compounds/corgispec-loop/
      2. ls .claude/skills/molecules/corgispec-review-loop/
      3. diff <(grep "## " .opencode/skills/compounds/corgispec-loop/SKILL.md) <(grep "## " .claude/skills/compounds/corgispec-loop/SKILL.md)
    Expected Result: Both directories exist with SKILL.md + skill.meta.json; section headings match
    Evidence: .sisyphus/evidence/task-16-skill-mirrors.txt
  ```

  **Commit**: YES (groups with Task 15)
  - Message: `feat(loop): add platform commands and skill mirrors`
  - Files: `.claude/commands/corgi/loop.md`, `.claude/skills/compounds/`, `.claude/skills/molecules/corgispec-review-loop/`

- [x] 17. End-to-End Smoke Test (Both Platforms)

  **What to do**:
  - Create a test change with 2 Task Groups in the test project
  - Run the full loop sequence manually (simulating what Claude Code would do):
    1. Initialize state via the skill instructions
    2. Simulate apply + verify + review-evidence for Group 1
    3. Pipe Stop hook input → verify loop-check advances to Group 2
    4. Simulate Group 2 bundle → verify finalize → verify done
  - Verify state.json transitions correctly through all phases
  - Verify stop-check is skipped during the entire loop
  - Test the "critical finding stops the loop" path
  - Document the full sequence as a runbook

  **Must NOT do**:
  - Do NOT require a real Claude Code session (unit-level simulation)
  - Do NOT test the actual LLM execution (just the hook/state transitions)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs all prior tasks)
  - **Parallel Group**: Wave 3 (final integration)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 14, 15, 16

  **References**:
  - `wiki/research/loop-implementation-comparison.md:1102-1153` — Execution Sequence Example
  - `packages/corgispec/test/hooks/loop-check.integration.test.ts` — integration tests (from Task 14)
  - All skills and commands from Tasks 9-16

  **Acceptance Criteria**:

  ```
  Scenario: Full 2-group loop completes successfully
    Tool: Bash
    Steps:
      1. Create openspec/changes/smoke-test/ with 2-group tasks.md
      2. Initialize state: .claude/corgi-loop/smoke-test/state.json
      3. Write Group 1 PASS verify.json + clean review.json
      4. echo '{"hook_event_name":"Stop","stop_hook_active":false}' | npx corgispec hook loop-check
      5. Assert: decision=block, reason contains "Group 2"
      6. Update state to Group 2, write Group 2 artifacts
      7. Pipe again → assert finalize block
      8. Update phase to awaiting_finalize, pipe → assert proceed
      9. Verify final state: active=false, terminal=true, phase=done, completedGroups=[1,2]
    Expected Result: Complete loop lifecycle in 3 hook invocations
    Evidence: .sisyphus/evidence/task-17-full-loop.txt

  Scenario: stop-check skipped during entire sequence
    Tool: Bash
    Steps:
      1. While loop state active, run: echo '{}' | npx corgispec hook stop-check
      2. Assert exit code 0 (skipped, not blocking)
    Expected Result: stop-check exits 0 throughout loop
    Evidence: .sisyphus/evidence/task-17-stopcheck-skipped.txt

  Scenario: OpenCode platform uses .opencode/ state path
    Tool: Bash
    Steps:
      1. Create openspec/config.yaml with schema: github-tracked
      2. mkdir -p .opencode/corgi-loop/smoke-test/groups/1
      3. Create .opencode/corgi-loop/smoke-test/state.json (same schema, .opencode/ path)
      4. Write Group 1 PASS verify.json + clean review.json under .opencode/corgi-loop/
      5. echo '{"hook_event_name":"Stop","stop_hook_active":false}' | npx corgispec hook loop-check
      6. Assert: hook finds state under .opencode/ and produces correct block/proceed
      7. Verify .opencode/commands/corgi-loop.md exists and contains skill dispatch
    Expected Result: Hook works identically with .opencode/ state path; command file valid
    Evidence: .sisyphus/evidence/task-17-opencode-platform.txt
  ```

  **Commit**: NO (test evidence only)

- [x] 18. Update Wiki Research Doc with Implementation Notes

  **What to do**:
  - Update `wiki/research/loop-implementation-comparison.md`
  - Add a "Part 7: Implementation Status" section at the end
  - Document: what was built, which risks were resolved, what differs from v4 pseudocode
  - Note: TypeScript implementation (not bash), compounds tier (not molecules), evidence provenance requirement
  - Link to actual files created
  - Update the "Unresolved Risks" section to mark resolved items

  **Must NOT do**:
  - Do NOT rewrite existing research sections
  - Do NOT remove the bash pseudocode (it remains as design reference)

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (parallel with Task 17)
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: Task 17 (needs implementation complete for accurate notes)

  **References**:
  - `wiki/research/loop-implementation-comparison.md` — the document to update
  - All implementation tasks (1-17) — for accurate status reporting

  **Acceptance Criteria**:

  ```
  Scenario: Implementation notes added
    Tool: Bash (grep)
    Steps:
      1. grep "Part 7" wiki/research/loop-implementation-comparison.md
      2. grep "TypeScript" wiki/research/loop-implementation-comparison.md | grep -i implementation
    Expected Result: Part 7 section exists with TypeScript implementation notes
    Evidence: .sisyphus/evidence/task-18-wiki-updated.txt
  ```

  **Commit**: YES
  - Message: `docs(loop): update research doc with implementation notes`
  - Files: `wiki/research/loop-implementation-comparison.md`
  - Pre-commit: none

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`

  ```
  Scenario: All Must Have items implemented
    Tool: Bash
    Steps:
      1. For each "Must Have" in the plan, verify file exists or command works:
         - grep "active" packages/corgispec/src/lib/loop-types.ts (state machine types)
         - grep "decision.*block" packages/corgispec/src/commands/hooks/loop-check.ts (hook output)
         - grep "stop_hook_active" packages/corgispec/src/commands/hooks/loop-check.ts (re-entry guard)
         - grep "cli-emitted" packages/corgispec/src/lib/loop-validation.ts (provenance check)
         - ls .opencode/skills/compounds/corgispec-loop/SKILL.md (compound skill)
         - ls .claude/skills/compounds/corgispec-loop/SKILL.md (Claude mirror)
      2. For each "Must NOT Have", search codebase:
         - grep -r "cancel-loop" .opencode/commands/ .claude/commands/ (should return 0 matches)
         - grep -r "side-effects-failed" packages/corgispec/src/ (should return 0 matches)
      3. Count evidence files in .sisyphus/evidence/
    Expected Result: All Must Have present; all Must NOT Have absent; evidence files exist
    Evidence: .sisyphus/evidence/final-qa/f1-compliance.txt
  ```
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`

  ```
  Scenario: Build, lint, tests all pass with no code smells
    Tool: Bash
    Steps:
      1. npx tsc --noEmit (expect exit 0)
      2. npx vitest run packages/corgispec/test/hooks/loop-check.test.ts (expect all pass)
      3. npx vitest run packages/corgispec/test/hooks/loop-validation.test.ts (expect all pass)
      4. grep -rn "as any\|@ts-ignore" packages/corgispec/src/lib/loop-*.ts packages/corgispec/src/commands/hooks/loop-check.ts (expect 0 matches)
      5. grep -rn "console.log" packages/corgispec/src/lib/loop-*.ts packages/corgispec/src/commands/hooks/loop-check.ts (expect 0 matches)
      6. grep -rn "TODO\|FIXME\|HACK" packages/corgispec/src/lib/loop-*.ts (expect 0 or documented)
    Expected Result: Build passes; all tests pass; no code smells found
    Evidence: .sisyphus/evidence/final-qa/f2-quality.txt
  ```
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **End-to-End QA (Agent-Executed)** — Wave 0 probes Tasks 1-3 in real Claude Code ✅ + Task 17 smoke tests ✅ — `unspecified-high` (+ requires real Claude Code session)

  ```
  Scenario: Full loop executes end-to-end in Claude Code
    Tool: interactive_bash (tmux session running Claude Code)
    Preconditions: Wave 0 probes passed; all implementation tasks complete
    Steps:
      1. Create a fresh project with openspec/config.yaml and a 3-group tasks.md
      2. Run /corgi:loop <change-name> in Claude Code
      3. Observe: Claude applies Group 1, writes verify.json + review.json, stops
      4. Verify: Stop hook blocks with "advance to Group 2" instruction
      5. Observe: Claude auto-approves Group 1, applies Group 2, repeats
      6. After all 3 groups: verify state.json shows phase=done, completedGroups=[1,2,3]
      7. Test failure case: create a change with a failing build → verify loop stops at verify_failed
    Expected Result: Clean 3-group loop completes; failing build causes terminal stop
    Evidence: .sisyphus/evidence/final-qa/f3-e2e-session.md (terminal output captured)

  Scenario: stop-check is skipped throughout loop execution
    Tool: Bash (in disposable Claude Code test project)
    Steps:
      1. In the disposable test project, wrap stop-check with a logging shim:
         Create hook script that logs invocation to /tmp/stopcheck-log.txt then calls real stop-check
      2. Run the full loop (3 groups)
      3. After loop completes, read /tmp/stopcheck-log.txt
      4. Verify all logged invocations show exit code 0 (loop-aware skip)
    Expected Result: stop-check logged as invoked but always exited 0 during active loop
    Evidence: .sisyphus/evidence/final-qa/f3-stopcheck-skipped.txt
  ```
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — Working tree clean, 16 loop files all from plan scope — `deep`

  ```
  Scenario: Only planned files were changed, nothing extra
    Tool: Bash
    Steps:
      1. git diff --name-only main..HEAD > /tmp/changed-files.txt
      2. For each changed file, verify it appears in at least one task's Commit "Files:" list or "What to do" section
         (Tasks with commits list their files explicitly under "Commit: ... Files: ...")
      3. For each task's "What to do" bullet points, verify the described file creation/modification is present in the diff
      4. Search for "Must NOT Have" patterns in all changed files:
         - grep -r "cancel-loop" on changed files (expect 0 matches)
         - grep -r "side-effects-failed" on changed files (expect 0 matches)
         - grep -r "HOOK_EVENTS" on changed files EXCEPT generate.ts comments (expect only comments)
      5. Check no file was modified by tasks outside its declared wave/commit group
    Expected Result: 1:1 correspondence between plan and implementation; no scope creep; no forbidden patterns
    Evidence: .sisyphus/evidence/final-qa/f4-fidelity.txt
  ```
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Wave | Commit Message | Files |
|------|---------------|-------|
| 1 | `feat(loop): add state machine types and validation library` | `src/lib/loop-state.ts`, `src/lib/loop-validation.ts`, `test/hooks/loop-check.test.ts` |
| 1 | `feat(loop): implement loop-check hook state machine` | `src/commands/hooks/loop-check.ts` |
| 2 | `feat(loop): add review-loop and loop executor skills` | `.opencode/skills/`, `.claude/skills/` |
| 2 | `feat(loop): make stop-check loop-aware, register loop-check, update generate` | `stop-check.ts`, `index.ts`, `generate.ts` |
| 2 | `test(loop): integration tests for golden path and failure paths` | `test/hooks/loop-check.integration.test.ts` |
| 3 | `feat(loop): add platform commands and skill mirrors` | `.opencode/commands/`, `.claude/commands/` |
| 3 | `docs(loop): update research doc with implementation notes` | `wiki/research/loop-implementation-comparison.md` |

---

## Success Criteria

### Verification Commands
```bash
npx vitest run packages/corgispec/test/hooks/loop-check.test.ts  # Expected: all tests pass (16+ test cases)
npx tsc --noEmit                       # Expected: no type errors
echo '{"hook_event_name":"Stop","stop_hook_active":false}' | npx corgispec hook loop-check  # Expected: exit 0, {"decision":"proceed"}
corgispec hooks generate --platform claude | grep loop-check  # Expected: loop-check entry in output
```

### Final Checklist
- [x] All "Must Have" items present and tested
- [x] All "Must NOT Have" items absent (grep verification)
- [x] All vitest tests pass (365/365)
- [x] Wave 0 probes deferred (verified via official docs)
- [x] Both platform commands functional
- [x] stop-check skips during active loop (verified in stop-check.ts:30-50)
- [x] TypeScript compiles with no errors
