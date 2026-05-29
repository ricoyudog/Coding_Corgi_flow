---
type: memory
updated: 2026-05-29
---

# Session Bridge

> AI agent reads this first at startup. Last session's handoff state.

## Active corgi Change
- **Change**: none
- **Phase**: none
- **Branch**: main

## Done (last session completed)
- corgispec-hooks-system archived (2026-05-29)

## Waiting (next steps / blockers)
- `corgispec-cli` change exists in `openspec/changes/` — all groups done, ready for archive
- Bug fix `d549960` pushed: Codex filename mismatch resolved

## New Pitfalls
- Codex generate: TOML references must match written filenames (prefix consistency)
- Malformed JSON stdin to hook commands causes unhandled stack trace (enhancement opportunity)
- `CORGISPEC_HOOKS_DISABLE` only recognizes exact string `"1"` — document this clearly

## New Discoveries
- Hook exit code contract (0/1/2) works cleanly across all platforms
- Integration tests via execSync + tmpdir are reliable and fast (~24s for 177 tests)

## Next Session Start
1. Read this file ← you are here
2. Read [[wiki/hot]]
3. Read [[wiki/index]]
4. Then docs/ or specs/ as needed
