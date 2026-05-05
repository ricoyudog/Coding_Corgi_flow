---
type: wiki
generated: 2026-05-05
tags: [lint, meta]
---

# Lint Report — 2026-05-05

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Error | 1 |
| ⚠️ Warning | 1 |
| ℹ️ Info | 1 |
| ✅ Pass | 8 |

**Overall**: FAIL (1 error)

## Findings

### 🔴 Errors

1. **Check #3 — Broken wikilink detection**: 7 broken wikilinks to archived change `openspec/changes/openspec-llm-memory/`
   - `wiki/patterns/self-compacting-memory-caps.md:34` → `[[openspec/changes/openspec-llm-memory/proposal]]`
   - `wiki/patterns/self-compacting-memory-caps.md:35` → `[[openspec/changes/openspec-llm-memory/design]]`
   - `wiki/patterns/three-layer-memory-architecture.md:32` → `[[openspec/changes/openspec-llm-memory/proposal]]`
   - `wiki/patterns/three-layer-memory-architecture.md:33` → `[[openspec/changes/openspec-llm-memory/design]]`
   - `wiki/sessions/openspec-llm-memory.md:34` → `[[openspec/changes/openspec-llm-memory/proposal]]`
   - `wiki/sessions/openspec-llm-memory.md:35` → `[[openspec/changes/openspec-llm-memory/design]]`
   - `wiki/sessions/openspec-llm-memory.md:36` → `[[openspec/changes/openspec-llm-memory/tasks]]`

   **Suggested fix**: Update links to point to archived path: `openspec/changes/archive/2026-05-05-openspec-llm-memory/`

### ⚠️ Warnings

1. **Check #6 — Orphan wiki page detection**: 2 orphan pages with no incoming wikilinks
   - `wiki/meta/lint-report-2026-05-01.md`
   - `wiki/meta/lint-report-2026-05-05.md`

   **Suggested fix**: Add links from `wiki/meta/_index.md` to lint report files.

### ℹ️ Info

1. **Check #7 — Extraction completeness**: 2 completed changes lack session summaries
   - `corgispec-cli` (40/40 tasks) — no `wiki/sessions/corgispec-cli.md`
   - `plugin-marketplace-distribution` (18/18 tasks) — no `wiki/sessions/plugin-marketplace-distribution.md`

   **Suggested fix**: Run `/corgi-archive` on these changes to trigger knowledge extraction, or manually create session summaries.

## Checks Passed

- ✅ Check #1 — Session-bridge freshness: updated today (0 days ago, threshold: 30)
- ✅ Check #2 — Hot.md freshness: updated today (0 days ago, threshold: 14)
- ✅ Check #4 — Pitfalls source link validation: 1 active entry has source reference
- ✅ Check #5 — Implicit-contracts consistency: 1 contract entry with file reference and description
- ✅ Check #8 — AGENTS.md protocol presence: found at line 156
- ✅ Check #9 — Hot.md size cap: 189 words (cap: 600)
- ✅ Check #10 — Index.md size cap: 30 lines (cap: 80)
- ✅ Check #11 — Pitfalls active entry count: 1 active (cap: 20)

## Suggested Actions

1. **[Error]** Fix 7 broken wikilinks in pattern/session files — update `openspec/changes/openspec-llm-memory/` → `openspec/changes/archive/2026-05-05-openspec-llm-memory/`
2. **[Warning]** Link lint reports from `wiki/meta/_index.md`
3. **[Info]** Archive remaining completed changes (`corgispec-cli`, `plugin-marketplace-distribution`) to generate session summaries
