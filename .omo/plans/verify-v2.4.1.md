# Verify v2.4.1 Release — Pre-Push Test Plan

## TL;DR

> **Goal**: Verify all changes since v2.4.0 are correct before pushing to remote.
> **Scope**: Build, tests, CLI smoke test, reference integrity, git state.
> **Estimated Effort**: Quick (~3 min)

---

## Context

Changes since v2.4.0 (56 files, +662/-392):
- **Skill renames**: openspec → corgispec in 44 SKILL.md + worktree-discovery.md files
- **Bootstrap enhancement**: `packages/corgispec/src/commands/bootstrap.ts` (+69 lines)
- **Bootstrap lib**: `packages/corgispec/src/lib/bootstrap.ts` (+23 lines)
- **New tests**: `packages/corgispec/test/bootstrap.test.ts` (188 lines)
- **README update**: minor tweaks
- **New config**: `.opencode/opencode.json` (plugin config)
- **Deleted files**: 4 Claude command dispatch files under `assets/`
- **Version bump**: 2.4.0 → 2.4.1

---

## TODOs

### T1: Build corgispec CLI
- [x] Run `npm run build` in `packages/corgispec/`
- Verify: exit code 0, `dist/corgispec.js` exists

### T2: Run test suite
- [x] Run `npm test` in `packages/corgispec/`
- Verify: all tests pass, 0 failures

### T3: CLI smoke test
- [x] Run `node packages/corgispec/dist/corgispec.js --version`
- Verify: outputs `2.4.1`
- [x] Run `node packages/corgispec/dist/corgispec.js --help`
- Verify: shows help without errors

### T4: Reference integrity — no stale "openspec" in changed skill files
- [x] Grep for "openspec" in `.claude/skills/` and `.opencode/skills/` changed files
- Verify: no unintended "openspec" leftovers (only expected references like OpenSpec the upstream project name are OK)

### T5: Git state verification
- [x] `git tag -l v2.4.1` → returns `v2.4.1`
- [x] `git log master --oneline -3` → shows release commit
- [x] `grep "version" packages/corgispec/package.json` → `2.4.1`
- [x] `git diff --name-only -w` → check for unexpected uncommitted changes

### T6: package.json validity
- [x] `node -e "require('./packages/corgispec/package.json')"` → no parse error
- Verify: version field is "2.4.1"

---

## Guardrails
- Do NOT push to remote
- Do NOT modify any files
- Read-only verification only
- If any test FAILS → stop and report, do not proceed to push
