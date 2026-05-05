---
type: wiki
created: 2026-05-05
source_change: plugin-marketplace-distribution
tags: [pattern, symlinks, cross-platform, packaging]
---

# Canonical Source with Platform Symlink Mirrors

## Context
When distributing files (skills, configs, assets) across multiple AI coding platforms, physical copies introduce sync drift. Symlinks solve this, but some platforms handle them differently — Claude Code caches symlinks without following them, while Codex explicitly supports them. You need a single canonical source without breaking any platform.

This pattern emerged during the `plugin-marketplace-distribution` change where 17 CorgiSpec skills needed to be shared between Claude Code (`.claude/skills/`), Codex (`.codex/skills/`), and Codex's newer agent path (`.agents/skills/`).

## Pattern
1. **Identify the most restrictive platform** — the one with the weakest symlink handling. Make its path the physical body location.
2. **Create symlinks FROM flexible platforms TO the restrictive platform's path** — never the reverse.
3. **Use per-file/per-directory symlinks** rather than a single directory-level symlink (finer control, easier migration).
4. **Provide a setup script** that is idempotent (detects existing correct symlinks, skips re-creation) and handles physical-copy-to-symlink migration with backup.

## When to Use
- Distributing the same files to 2+ platform-specific directories
- One platform has symlink limitations (cache, discovery, or resolution quirks)
- You want to avoid sync tools or CI-based copy pipelines
- The files change infrequently and benefit from immediate cross-platform visibility

## Example
In CorgiSpec:
- **Restrictive platform**: Claude Code — `claude plugin install` caches symlinks without following them, causing empty cached skills if the body is elsewhere
- **Canonical location**: `.claude/skills/<skill-name>/` (physical body)
- **Mirrors**:
  - `.codex/skills/<skill-name>/` → symlink → `../../.claude/skills/<skill-name>/`
  - `.agents/skills/<skill-name>/` → symlink → `../../.claude/skills/<skill-name>/`

The alternative (making `.opencode/skills/` canonical and symlinking both Claude and Codex to it) was rejected because Claude Code's cache wouldn't resolve the symlink.

## Source
- Extracted from change: [[openspec/changes/plugin-marketplace-distribution/proposal]]
- Design decision D2: [[openspec/changes/plugin-marketplace-distribution/design]]
