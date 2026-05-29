---
type: wiki
created: 2026-05-28
source_change: openspec-to-corgi-rebrand
tags: [pattern, brand-migration, multi-platform]
---

# Multi-Platform Brand Text Replacement

## Context
When a project rebrands or renames, user-visible text must be updated across multiple mirrored directory structures (e.g., `.opencode/skills/`, `.claude/skills/`, `.codex/skills/`) while preserving code identifiers, directory paths, and external attribution references.

## Pattern

1. **Phase 0 — Prerequisites**: Create rollback tag. Sync any stale backup directories wholesale (`cp -r`) before incremental edits.
2. **Phase 1 — Atomic replacement**: Replace brand text across all mirrored directories in a single commit. Three separate grep patterns needed:
   - Case-sensitive for proper names: `grep -rn "OldBrand"`
   - Case-insensitive for abbreviations: `grep -rni "ABBR\|abbr"`
   - Author/frontmatter fields: `grep -rni "author:.*oldbrand"`
3. **Phase 2 — CLI + tests**: Update source string literals and test assertions in one atomic commit.
4. **Phase 2b — Docs**: Update documentation, plugin manifests, and package metadata. Use per-line judgment for external attribution.
5. **Phase 3 — Verification**: Multi-point checklist: CLI output, test suite, path reference integrity, multi-platform parity check.

## When to Use
- Brand rename across a codebase with mirrored skill/config directories
- Any text replacement that must distinguish between self-references (change) and external references (preserve)
- CLI output string changes that require synchronized source + test updates

## Example
The `openspec-to-corgi-rebrand` change replaced 126 files across 5 task groups while preserving:
- `openspec/` directory paths (not brand text)
- TypeScript identifiers like `OpenSpecConfig` (code names)
- Fission-AI/OpenSpec attribution links (external references)

Key verification: `grep -rn "openspec/" packages/corgispec/src/` confirmed 36 path references intact after replacement.

## Source
- Extracted from change: [[openspec/changes/openspec-to-corgi-rebrand/proposal]]
- Design decisions: [[openspec/changes/openspec-to-corgi-rebrand/design]]
- Related pitfalls: [[memory/pitfalls]]
