---
type: wiki
updated: 2026-05-29
tags: [hot, entry]
pinned: true
---

# Hot — Corgi GitFlow Latest

> ~500 words | Hard cap 600 words | Updated every session | First entry point for humans and AI

## Active Changes
- (none)

## Recent Decisions
- Hook exit code contract: 0=allow, 1=error/disabled, 2=block (stderr message)
- `corgispec hook` (singular) for runtime; `corgispec hooks generate` (plural) for config
- Canonical context gate validated by automated gate-check test across all skills
- Skills restructured into tier-based directories (`atoms/`, `molecules/`) across all platform dirs
- Installation onboarding collapsed onto `corgispec bootstrap` + fetchable INSTALL.md

## Architecture Pulse
- **Stable**: Corgi schema/workflow toolkit, skill metadata model, three-directory skill mirroring, OpenCode and Claude command support
- **Evolving**: `corgispec` as the unified CLI replacing legacy tooling, GitHub/GitLab tracked workflow assets, cross-session memory workflows
- **Legacy**: `tools/ds-skills/` and `install-skills.sh`

## Recent Pitfalls
- (none yet — see [[memory/pitfalls]])

## Recently Shipped
- **corgispec-cli-p0-p1-fixes** (2026-05-29) — All P0/P1 code review fixes: exit codes, Node 18 compat, error handling, dep hygiene, tier enforcement, template resolution
- **corgispec-hooks-system** (2026-05-29) — Complete AI platform hook system: 6 runtime hooks, config generation for Claude/OpenCode/Codex, canonical context gates in all skills, 63 integration tests
- **openspec-to-corgi-rebrand** (2026-05-28) — Replaced all user-visible "OpenSpec" brand text with "Corgi" across 126 files while preserving directory paths, identifiers, and upstream attribution
