---
type: memory
updated: 2026-05-27
---

# Session Bridge

> AI agent reads this first at startup. Last session's handoff state.

## Active corgi Change
- **Change**: openspec-to-corgi-rebrand
- **Phase**: ALL GROUPS COMPLETE (Groups 1-5), ready for `/corgi-verify` then `/corgi-review`
- **Branch**: main

## Done (last session completed)
- openspec-to-corgi-rebrand ALL GROUPS:
  - Group 1: Prerequisites — rollback tag, skills.backup sync, opsx-install-report deletion
  - Group 2: Atomic Brand Replacement (15 tasks) — commands, skills, assets, lowercase opsx
  - Group 3: CLI Source + Tests (6 tasks) — source files, test assertions, build, grep verification
  - Group 4: Documentation, Plugins, README (11 tasks) — plugin JSONs, AGENTS.md, INSTALL.md, docs/, wiki/, MEMORY.md, test fixture, package.json
  - Group 5: Final Verification (5 tasks) — corgispec --help, npm test, path references, platform parity

## Waiting (next steps / blockers)
- Run `/corgi-verify` for automated quality gate
- Then `/corgi-review` for 5-axis review

## New Pitfalls
- `install-assets.test.ts` has pre-existing failure (ENOENT: session-memory-protocol.md) — unrelated to brand changes

## New Discoveries
- Tiered discovery with flat fallback pattern — useful for any flat→hierarchical migration
- `.codex/` symlinks need 3 levels of `../` when tier subdirs add nesting depth
- `git add -f` needed for files under gitignored parent directories (e.g., `docs/`)
- Historical planning docs (docs/superpowers/plans/, docs/superpowers/specs/) contain many "OpenSpec" references that are external attribution or historical records — NOT self-branding, correctly preserved
- README.md/README.zh-TW.md contain zero self-reference "OpenSpec" — all are external attribution to Fission-AI/OpenSpec upstream

## Next Session Start
1. Read this file ← you are here
2. Read [[wiki/hot]]
3. Read [[wiki/index]]
4. Then docs/ or specs/ as needed
