---
type: wiki
created: 2026-05-06
source_change: fix-skill-architecture-issues
status: archived
tags: [session, skills, architecture, tier-restructure]
---

# Session Summary: fix-skill-architecture-issues

## Overview
Fixed 4 structural integrity issues in the Skill Graph 2.0 architecture: eliminated an implicit cross-skill dependency, added a missing package asset, restructured all skill directories into tier-based layout, and reconciled the blueprint design spec with the implemented format.

## Timeline
- **Proposed**: 2026-05-06
- **Completed**: 2026-05-06
- **Task Groups**: 4 groups, 37 total tasks

## Key Decisions
- Copy `worktree-discovery.md` into verify skill (not extract as atom) — minimal blast radius, atom extraction deferred to Phase 4
- Restructure all platform directories simultaneously — prevents sync obligation violations during transition
- Update blueprint spec to remove `type` field rather than implement it — no consumer exists, `tier` in skill.meta.json already serves the purpose
- `discoverSkills()` uses two-phase pattern: scan tier subdirs first, flat-root fallback for backward compat
- `installSkillsTo()` discovers from tiered source but installs flat to target (agent platforms expect flat user-level layout)
- `bundle-assets.js` outputs to `assets/skills/<tier>/<slug>/` preserving tier structure in package
- `.codex/skills/` and `.agents/skills/` use symlinks at `<tier>/<slug>` → `../../../.claude/skills/<tier>/<slug>` (3 levels up for tier nesting)

## Pitfalls Encountered
- Group 3 initial review rejected: spec coverage gaps in `.codex/skills/`, `packages/corgispec/assets/`, and `.agents/skills/` — the task list originally covered only `.opencode/` and `.claude/` restructuring
- `.codex/` symlinks need 3-level relative paths (`../../../`) when tier subdirs add nesting depth
- `bundle-assets.js` needed modification to output tiered structure (not covered in initial task decomposition)
- `docs/` directory is gitignored — required `git add -f` for the blueprint spec file

## Outcome
All 17 skills (2 atoms, 15 molecules) organized into tier-based subdirectories across all 5 directory trees. Blueprint spec now accurately reflects the implemented SKILL.md/skill.meta.json format. All tests pass (ds-skills validate 17/17, corgispec 114/114, ds-skills unit 19/19).

## References
- Proposal: [[openspec/changes/fix-skill-architecture-issues/proposal]]
- Design: [[openspec/changes/fix-skill-architecture-issues/design]]
- Tasks: [[openspec/changes/fix-skill-architecture-issues/tasks]]
