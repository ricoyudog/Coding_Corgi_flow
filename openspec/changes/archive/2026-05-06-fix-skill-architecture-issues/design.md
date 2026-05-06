## Context

The Skill Graph 2.0 architecture was implemented via a refactor that introduced `tier` metadata, dependency validation via `ds-skills`, and a multi-platform skill sync model. A post-implementation audit revealed 4 structural issues: an undeclared runtime dependency, a packaging omission, flat directory structure not matching declared tiers, and an unreconciled blueprint spec.

Current state:
- 17 skills, 2 atoms + 15 molecules, 0 compounds
- Flat layout in all platform directories (no `atoms/`, `molecules/` subdirs)
- `ds-skills` loader already supports tiered discovery (checks `atoms/`, `molecules/`, `compounds/` first)
- `corgispec-verify` SKILL.md explicitly reads from `corgispec-review`'s `references/` directory
- `packages/corgispec/assets/skills/` has only 16 skills (missing `corgispec-verify`)
- Blueprint design spec mentions `type: capability | composite | playbook` but this was never implemented

## Goals / Non-Goals

**Goals:**
- Eliminate all implicit cross-skill file dependencies
- Ensure package assets contain all 17 skills
- Restructure skill directories to reflect declared tiers
- Reconcile the blueprint spec to match the implemented design
- Maintain backwards compatibility during transition

**Non-Goals:**
- Creating new compound-tier skills (no compounds exist yet)
- Changing the `ds-skills` loader logic (it already supports tiered directories)
- Extracting `worktree-discovery` as a standalone atom skill (Phase 4; for now, copy-based isolation is sufficient)
- Adding a `type` field to SKILL.md frontmatter (the refactor spec intentionally dropped it)

## Unknowns & Investigation

### Unknown: Does the ds-skills loader handle tier subdirectories correctly?
**Investigated**: Read `tools/ds-skills/lib/loader.js` lines 49-62. The `discoverSkills()` function scans for `atoms/`, `molecules/`, `compounds/` subdirectories first, then falls back to flat root.
**Conclusion**: No loader code changes needed. The restructuring is purely filesystem + metadata.

### Unknown: Will Codex symlinks break with tiered paths?
**Investigated**: `.codex/skills/` contains per-skill symlinks pointing to `.claude/skills/<skill-name>`. After restructuring, these need to point to `.claude/skills/<tier>/<skill-name>`.
**Conclusion**: Symlinks must be regenerated. A shell script or manual recreation is needed.

### Unknown: Does the installer (`corgispec install`) reference `base_path` for file placement?
**Investigated**: The installer copies from `packages/corgispec/assets/skills/` into target projects. It reads the directory structure directly, not the `base_path` metadata field.
**Conclusion**: Package asset directory structure must match the desired target layout. If we tier the package assets, installations will produce tiered directories.

### Unknown: Will the `.opencode/skills/` tier structure break OpenCode skill discovery?
**Investigated**: OpenCode discovers skills by scanning directories matching patterns. The `.opencode/package.json` only declares the plugin; skill paths are relative to the skills root.
**Conclusion**: OpenCode scans recursively. Tier subdirectories will be discovered. But command dispatch files (`.opencode/commands/corgi-*.md`) reference skill names, not paths — these are unaffected.

## Decisions

### Decision 1: Copy worktree-discovery.md (not extract as atom)
**Choice**: Copy the file into `corgispec-verify/references/` and rewrite the SKILL.md cross-reference.
**Rationale**: Extracting a `resolve-worktree` atom is architecturally cleaner but requires creating a new skill, updating all consumers (apply, review, archive, explore, verify), and modifying the dependency graph. The copy approach fixes the immediate violation with minimal blast radius. The atom extraction can be a Phase 4 follow-up.
**Alternative considered**: Declare `corgispec-review` in verify's `depends_on`. Rejected because molecule-to-molecule dependency defeats the tier model's purpose.

### Decision 2: Restructure all directories simultaneously
**Choice**: Move all 17 skills into `atoms/` or `molecules/` subdirs across all 4 directory trees (`.opencode/skills/`, `.claude/skills/`, `.codex/skills/`, `packages/corgispec/assets/skills/`) in one change.
**Rationale**: Incremental restructuring (one platform at a time) creates temporary inconsistency. Simultaneous restructuring ensures the "three-directory sync obligation" is maintained. The loader's fallback ensures no tooling breakage during the transition.
**Alternative considered**: Restructure only `.opencode/skills/` (source of truth) and leave others flat. Rejected because the sync obligation requires all directories to match.

### Decision 3: Update blueprint spec rather than implement `type` field
**Choice**: Edit the composable skill hierarchy design spec to remove the `type` field from its SKILL.md example, adding a note that tier info lives in `skill.meta.json`.
**Rationale**: The refactor spec (written same day as blueprint) intentionally dropped `type` in favor of `tier` in metadata. The implementation follows the refactor spec. Adding `type` to 90 SKILL.md files for a field that no tooling reads is unjustified overhead.
**Alternative considered**: Implement `type` field across all SKILL.md files. Rejected — no consumer exists, and `skill.meta.json`'s `tier` field already serves the purpose.

### Decision 4: Add corgispec-verify to package assets with tier structure
**Choice**: When restructuring, add `corgispec-verify` directly into `packages/corgispec/assets/skills/molecules/corgispec-verify/`.
**Rationale**: Fixes the omission simultaneously with the restructuring, ensuring the package starts with the correct tiered layout.

## Risks / Trade-offs

- **[Risk] OpenCode/Claude command dispatch breaks** → Mitigation: Commands reference skill names, not paths. Verified command files don't hardcode directory paths.
- **[Risk] .codex symlinks point to old locations** → Mitigation: Explicitly regenerate all symlinks as part of restructuring task group.
- **[Risk] External tools reference flat paths** → Mitigation: The loader already falls back to flat root. Transition period is safe.
- **[Risk] worktree-discovery.md copy drifts from original** → Mitigation: Acceptable for now. The file is stable (last modified weeks ago). Phase 4 atom extraction will eliminate the copy.
- **[Trade-off] Simultaneous restructuring is a large diff** → Accepted: The alternative (phased) creates sync obligation violations.

## Data Model

Not applicable — no data model changes in this change.

## API Contracts

Not applicable — no API surface changes in this change.
