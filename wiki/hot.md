---
type: wiki
updated: 2026-05-28
tags: [hot, entry]
pinned: true
---

# Hot — Corgi GitFlow Latest

> ~500 words | Hard cap 600 words | Updated every session | First entry point for humans and AI

## Active Changes
- `corgispec-hooks-system` and `corgispec-cli` changes exist in `openspec/changes/` (status unknown).

## Recent Decisions
- Skills restructured into tier-based directories (`atoms/`, `molecules/`) across all platform dirs — two-phase discovery pattern for backward compat
- Initialized memory structure
- Installation onboarding is being collapsed onto `corgispec bootstrap` plus a fetchable `.opencode/INSTALL.md`, with README quick starts reduced to the bootstrap-first path.
- Bundle-asset tests must use isolated output paths instead of rebuilding the shared `packages/corgispec/assets` directory during the Vitest suite.

## Architecture Pulse
- **Stable**: Corgi schema/workflow toolkit, skill metadata model, three-directory skill mirroring, OpenCode and Claude command support
- **Evolving**: `corgispec` as the unified CLI replacing legacy tooling, GitHub/GitLab tracked workflow assets, cross-session memory workflows
- **Legacy**: `tools/ds-skills/` and `install-skills.sh`

## Recent Pitfalls
- (none yet — see [[memory/pitfalls]])

## Recently Shipped
- **openspec-to-corgi-rebrand** (2026-05-28) — Replaced all user-visible "OpenSpec" brand text with "Corgi" across 126 files while preserving directory paths, identifiers, and upstream attribution
- **fix-skill-architecture-issues** (2026-05-06) — Fixed 4 structural integrity issues: eliminated implicit cross-skill dependency, added missing package asset, restructured all directories into tier-based layout, reconciled blueprint spec
- **plugin-marketplace-distribution** (2026-05-05) — Packaged CorgiSpec as installable plugins for Claude Code and Codex with symlink-based skill sharing from a single canonical source
- **openspec-llm-memory** (2026-05-05) — 3-layer cross-session memory system with 4 new skills (memory-init, lint, ask, extract) and lifecycle integration into install/archive
- `bootstrap-install` worktree: `corgispec bootstrap`, bundled command/memory assets, reusable install/memory helpers, bootstrap reports, and bootstrap-focused docs/tests. Verified with `npm test` in `packages/corgispec` (114 passing tests).
