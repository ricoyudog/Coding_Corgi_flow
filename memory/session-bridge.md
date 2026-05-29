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
- corgispec-cli-p0-p1-fixes archived (2026-05-29)

## Waiting (next steps / blockers)
- Branch `review_fix` has 5 commits ready to merge to main

## New Pitfalls
- `task` tool delegation fails with "Invalid model format" in current environment — work directly in main session as fallback
- Codex generate: TOML references must match written filenames (prefix consistency)

## New Discoveries
- `validateSchemaShape()` pattern: validate before cast for external YAML/JSON loading
- Template variable resolution via regex `{{key}}` replacement is clean and testable
- Tier enforcement via `Map<string, SkillTier>` lookup works cleanly with existing skill discovery

## Next Session Start
1. Read this file ← you are here
2. Read [[wiki/hot]]
3. Read [[wiki/index]]
4. Then docs/ or specs/ as needed
