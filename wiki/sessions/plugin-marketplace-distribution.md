---
type: wiki
created: 2026-05-05
source_change: plugin-marketplace-distribution
status: archived
tags: [session, plugin, marketplace, packaging, symlinks]
---

# Session Summary: plugin-marketplace-distribution

## Overview
Packaged CorgiSpec as installable plugins for both Claude Code and Codex, with symlink-based skill sharing from a single canonical source. Teams can now install via `/plugin install corgispec` (Claude Code) or `codex plugin install corgispec` (Codex).

## Timeline
- **Proposed**: 2026-05-04
- **Completed**: 2026-05-05
- **Task Groups**: 4 groups, 18 total tasks

## Key Decisions
- **D1: Two separate plugin.json files** — Claude Code's manifest is minimal (auto-discovers skills); Codex requires explicit `skills` field + `interface` block for marketplace display. Unified file would lose platform-specific features.
- **D2: `.claude/skills/` is canonical source** — Claude Code caches symlinks without following them, so physical body MUST be on Claude's side. Codex symlinks point inward.
- **D3: Single marketplace.json for both platforms** — Codex reads `.claude-plugin/marketplace.json` at priority 3, making duplication unnecessary.
- **D4: setup.sh handles symlinks, install-skills.sh extended** — setup.sh is the repo-level init; install-skills.sh gains `--codex` flag for user-level Codex symlinks.

## Pitfalls Encountered
- **Windows graceful degradation deferred**: Symlink support requires Developer Mode on Windows. Added runtime detection + fallback instructions in setup.sh during review phase.
- **No `.gitlab.yaml`** — Change was not tracked via GitLab issues. Issue sync skipped silently throughout lifecycle.

## Outcome
All 4 Task Groups complete. Produced:
- 2 platform plugin manifests (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`)
- 34 symlinks (17 Codex + 17 Agents → `.claude/skills/`)
- 2 marketplace registries (Claude Code + Codex repo-scoped)
- Claude Code team auto-install config (`.claude/settings.json`)
- `setup.sh` with idempotent, backup-aware symlink creation + validation
- `install-skills.sh` extended with `--codex` flag

## References
- Proposal: [[openspec/changes/plugin-marketplace-distribution/proposal]]
- Design: [[openspec/changes/plugin-marketplace-distribution/design]]
- Tasks: [[openspec/changes/plugin-marketplace-distribution/tasks]]
