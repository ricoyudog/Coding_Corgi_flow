---
type: wiki
created: 2026-05-29
source_change: corgispec-hooks-system
status: archived
tags: [session, hooks, cli, integration, testing]
---

# Session Summary: corgispec-hooks-system

## Overview
Added a complete AI platform hook system to the corgispec CLI — 6 runtime hook subcommands (`session-start`, `pre-write`, `pre-bash`, `post-write`, `stop-check`, `post-compact`), config generation for 3 platforms (Claude Code, OpenCode, Codex), doctor integration, and canonical context gates in all molecule skills.

## Timeline
- **Proposed**: pre-existing change
- **Completed**: 2026-05-29
- **Task Groups**: 5 groups, 38 total tasks
- **Branch**: `hook-enhance`

## Key Decisions
- `corgispec hook <name>` (singular) = runtime hook commands; `corgispec hooks generate` (plural) = config generation
- Exit code contract: 0 = allow/success, 1 = error/disabled, 2 = blocked (with stderr message)
- Hooks disabled via `CORGISPEC_HOOKS_DISABLE=1` env var (exact string match)
- Canonical context gate text = 3-line pattern with regex validation: `/\*\*Context Gate\*\*.*isolation\.mode.*active changes.*current branch/`
- Doctor hooks check always `passed: true` (informational, not blocking)
- Three-directory sync: `.opencode/` source of truth, `.claude/` and `.codex/` byte-identical copies
- Test approach: integration tests via `execSync` against built CLI, temp dirs with unique names, exit code verification

## Pitfalls Encountered
- Codex generate filename mismatch: TOML referenced `corgispec_*.py` but files written as `*.py` — fixed by adding `corgispec_` prefix to written filenames
- `rm -rf /` regex only catches exact root path — `rm -rf /*`, `rm -rf ~` slip through (accepted as design limitation, not a bug)
- `git push --force` only blocks `main`, not `master` — enhancement opportunity for future
- Malformed JSON stdin causes unhandled stack trace crash — graceful error handling missing (enhancement)
- `CORGISPEC_HOOKS_DISABLE` only recognizes `"1"` — other truthy values (`true`, `yes`) don't work

## Patterns Introduced
- **CLI Hook Exit Code Contract**: Exit 0 (allow), 1 (skip/error), 2 (block with stderr message) — standardized across all hook subcommands
- **Cross-platform config generation**: Single source hook definition → multiple platform output formats (JSON for Claude/OpenCode, TOML+Python for Codex, TypeScript plugin for OpenCode --deep)
- **Gate-check regression tests**: Automated validation that all skills contain canonical gate text and stay synced across directories

## Stats
- 63 new tests (177 total)
- 119.95 KB build output
- 8 test files, 7 source files added
- 10 molecule skills + 1 command wrapper gated
