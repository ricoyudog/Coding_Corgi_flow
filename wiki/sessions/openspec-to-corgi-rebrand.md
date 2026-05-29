---
type: wiki
created: 2026-05-28
source_change: openspec-to-corgi-rebrand
status: archived
tags: [session, brand, migration, corgispec]
---

# Session Summary: openspec-to-corgi-rebrand

## Overview
Replaced all user-visible "OpenSpec"/"OPSX"/"opsx" brand text with "Corgi"/"corgi"/"corgispec" across 126 files while preserving directory paths, TypeScript identifiers, and external attribution to Fission-AI/OpenSpec upstream.

## Timeline
- **Proposed**: 2026-05-27
- **Completed**: 2026-05-28
- **Task Groups**: 5 groups, 41 total tasks

## Key Decisions
- Atomic multi-platform replacement across all 3 skill directories in a single commit to prevent mixed-brand installs
- `.codex/skills.backup/` replaced wholesale via `cp -r` before incremental edits (backup had stale CLI references)
- External attribution preserved: README.md/zh-TW unchanged (all "OpenSpec" refers to Fission-AI upstream)
- Historical planning docs preserved — they are records, not user-visible brand text
- Three separate grep patterns required: case-sensitive "OpenSpec", case-insensitive "OPSX|opsx", author frontmatter fields
- Rollback tag `pre-rebrand-v0.1.1` created as safety anchor

## Pitfalls Encountered
- `install-assets.test.ts` had pre-existing failure: source paths referenced flat structure but skills were restructured into tiers — fixed by updating 3 `expectBundledFile` calls to use `atoms/corgispec-memory-init/templates/` paths
- Tiered discovery with flat fallback pattern means tests must track actual directory structure, not historical layout

## Outcome
All 126 files updated, 114/114 tests pass, build clean, 5/5 spec requirements fully covered, three-platform parity verified. Committed as `5df7caa` and pushed to `hook-enhance` branch.

## References
- Proposal: [[openspec/changes/archive/2026-05-28-openspec-to-corgi-rebrand/proposal]]
- Design: [[openspec/changes/archive/2026-05-28-openspec-to-corgi-rebrand/design]]
- Tasks: [[openspec/changes/archive/2026-05-28-openspec-to-corgi-rebrand/tasks]]
