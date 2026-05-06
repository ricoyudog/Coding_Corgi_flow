## Why

The Skill Graph 2.0 architecture has 4 structural integrity issues discovered during a codebase audit. The most critical is a runtime implicit dependency where `corgispec-verify` reads a reference file from `corgispec-review` without declaring the dependency — violating the molecule-to-molecule isolation rule. Secondary issues include a packaging gap (verify missing from CLI assets), flat directory layout not reflecting declared tiers, and an unreconciled design spec conflict about SKILL.md frontmatter.

## What Changes

- **Copy `worktree-discovery.md` into `corgispec-verify/references/`** and rewrite the SKILL.md cross-reference to point locally, eliminating the undeclared molecule-to-molecule dependency
- **Add `corgispec-verify` to `packages/corgispec/assets/skills/`** so CLI-based installations produce all 17 skills
- **Restructure skill directories into `atoms/` and `molecules/` subdirectories** with updated `base_path` values in all `skill.meta.json` files (loader already supports this)
- **Reconcile the blueprint spec** (`composable-skill-hierarchy-design.md`) by updating its SKILL.md frontmatter example to match the implemented format (removing the never-implemented `type` field)

## Capabilities

### New Capabilities
- `skill-dependency-isolation`: Eliminate implicit cross-skill file references by ensuring each skill's `references/` directory is self-contained
- `skill-tier-directory-layout`: Restructure flat skill directories into tier-based subdirectories (`atoms/`, `molecules/`) matching the declared `tier` field in metadata

### Modified Capabilities
- `cross-platform-skill-sync`: Ensure `packages/corgispec/assets/skills/` contains the full 17-skill set, matching the canonical directories
- `plugin-packaging`: Package assets must include `corgispec-verify` for complete CLI installations

## Impact

- **Files modified**: All 17 `skill.meta.json` files (base_path update), `corgispec-verify/SKILL.md` (remove cross-reference), 1 design spec document
- **Files added**: `corgispec-verify/references/worktree-discovery.md` (copy), `packages/corgispec/assets/skills/corgispec-verify/` (new package entry)
- **Directories restructured**: `.opencode/skills/`, `.claude/skills/`, `.codex/skills/`, `packages/corgispec/assets/skills/` — from flat to `atoms/` + `molecules/`
- **Symlinks regenerated**: `.codex/skills/` symlinks must point to new tier-prefixed paths
- **CLI tooling**: `ds-skills` loader already supports tiered discovery — no code changes needed
- **Risk**: Low — no runtime behavior changes, purely structural. The loader fallback ensures backwards compatibility during transition.

## GitLab Issue

<!-- This section will be filled automatically by the propose skill with the parent issue link. -->
