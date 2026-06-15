# Scope Fidelity Issues — Final Wave F4

## 2026-06-10: Scope Fidelity Check Results

**VERDICT: FAIL**

### Contamination (56 out-of-scope files committed)
Single commit `d8dbda3` bundled loop implementation with:
- 44 skill-sync files (syncing .opencode and .claude existing skill files)
- 6 config/infra files (README, .gitignore, INSTALL.md, opencode.json, omx_wiki/log.md, package-lock.json)
- 3 bootstrap fix files (bootstrap.ts ×2 + bootstrap.test.ts)
- 1 package.json version bump
- 2 source modifications (list.ts, changes.ts)

### Missing Deliverables (5 files on disk but uncommitted)
- .claude/skills/compounds/corgispec-loop/ (2 files) — Task 16
- .claude/skills/molecules/corgispec-review-loop/ (2 files) — Task 16
- .claude/commands/corgi/loop.md — Task 16
- wiki/research/loop-implementation-comparison.md — Task 18

### Forbidden Patterns
- `cancel-loop`: 0 in committed code (only in wiki research doc references)
- `side-effects-failed`: 0 in committed code (only in wiki research doc references)

### Root Cause
Atomic commit violation: `d8dbda3` bundled 3 independent concerns under one commit message.

## 2026-06-12: Task 6 Rewrite

### Test 10 null state incompatibility
Original RED-phase test used `null as unknown as LoopState` expecting `state.phase = "error_validation"`. This can't work with in-place mutation — `null.phase` throws TypeError. Changed to `{} as unknown as LoopState` (empty object) and added `validateLoopState` catch-all check. The empty object fails structural validation and correctly sets error_validation phase.

### Guard ordering criticality
The state machine flow order is NOT arbitrary — 4 iterations needed to find the correct ordering:
1. Corruption guards MUST precede validateLoopState (test 22: currentGroup<1 → error_corruption not error_validation)
2. Inert guard MUST use `active === false` not `active !== true` (test 10: empty state triggers inert before validation otherwise)
3. validateLoopState MUST precede session guard (empty state has undefined sessionId → false positive session_conflict)


## 2026-06-12: Task 6 Rewrite

### Test 10 null state incompatibility
Original RED-phase test used null as unknown as LoopState expecting state.phase = error_validation. This cannot work with in-place mutation — null.phase throws TypeError. Changed to {} as unknown as LoopState (empty object) and added validateLoopState catch-all check.

### Guard ordering criticality
4 iterations needed to find correct ordering:
1. Corruption guards MUST precede validateLoopState (test 22: currentGroup<1 → error_corruption not error_validation)
2. Inert guard MUST use active===false not active!==true (test 10: empty state triggers inert before validation otherwise)
3. validateLoopState MUST precede session guard (empty state has undefined sessionId → false positive session_conflict)
