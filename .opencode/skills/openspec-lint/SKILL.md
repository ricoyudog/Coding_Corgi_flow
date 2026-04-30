---
name: openspec-lint
description: Validate memory health across 11 checks — freshness, size caps, broken links, extraction completeness — with severity levels and auto-fix routing.
license: MIT
compatibility: Requires memory/ and wiki/ directories (created by openspec-memory-init).
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.0.0"
---

Validate memory and wiki health with 11 structured checks.

## Overview

Performs a comprehensive health check on the project's memory layer (`memory/` and `wiki/`), producing a structured report with findings at three severity levels: error, warning, and info.

The lint skill is read-only during checks — it gathers evidence and reports findings. It does NOT auto-fix issues. Fixes are suggested with actionable instructions.

## When to Use

- Manually via `/opsx-lint` for a periodic health check
- Before `openspec-archive` (recommended, not blocking)
- When session-bridge seems stale or hot.md feels bloated
- After significant refactoring of wiki/ structure
- Every ~10 opsx sessions (per compaction triggers in Session Memory Protocol)

Do not use this skill to modify memory files, initialize structure, or extract knowledge.

## Preconditions

- [ ] `memory/` directory exists with at least `session-bridge.md`
- [ ] `wiki/` directory exists with at least `hot.md` and `index.md`
- [ ] Project has been initialized with `openspec-memory-init`

If preconditions fail, report: "Memory structure not found. Run `/opsx-memory-init` first." and stop.

## Steps

### 1. Verify memory structure exists

Check that the following paths exist:
- `memory/session-bridge.md`
- `memory/pitfalls.md`
- `wiki/hot.md`
- `wiki/index.md`

If any are missing, report which ones and stop with a suggestion to run `/opsx-memory-init`.

### 2. Run all 11 checks

Execute each check in order. Record findings with severity, description, and suggested fix.

---

#### Check #1: Session-bridge freshness

**Severity**: ⚠️ warning

**Procedure**:
1. Read `memory/session-bridge.md`
2. Parse the `updated:` field from YAML frontmatter
3. Calculate days since last update

**Pass condition**: Updated within the last 30 days.

**Fail finding**: "session-bridge.md last updated {N} days ago (threshold: 30 days)"

**Suggested fix**: "Update session-bridge.md with current session state, or mark as intentionally stale if project is dormant."

---

#### Check #2: Hot.md freshness

**Severity**: ⚠️ warning

**Procedure**:
1. Read `wiki/hot.md`
2. Parse the `updated:` field from YAML frontmatter
3. Calculate days since last update

**Pass condition**: Updated within the last 14 days.

**Fail finding**: "wiki/hot.md last updated {N} days ago (threshold: 14 days)"

**Suggested fix**: "Update hot.md with current project state during next session."

---

#### Check #3: Broken wikilink detection

**Severity**: 🔴 error

**Procedure**:
1. Scan all `.md` files in `memory/` and `wiki/` recursively
2. Extract all `[[target]]` and `[[target|alias]]` patterns
3. For each wikilink, resolve the target path:
   - If target starts with `wiki/` or `memory/` → treat as relative to project root
   - Otherwise → treat as relative to the file's directory
   - Strip any `|alias` portion
   - Append `.md` if no extension
4. Check if the resolved path exists as a file

**Pass condition**: All wikilinks resolve to existing files.

**Fail finding**: "Broken wikilink in {source_file}:{line}: [[{target}]] — file not found"

**Suggested fix**: "Create the missing file, fix the link target, or remove the dead link."

---

#### Check #4: Pitfalls source link validation

**Severity**: ⚠️ warning

**Procedure**:
1. Read `memory/pitfalls.md`
2. Find the `## Active` section
3. For each bullet entry (lines starting with `- `):
   - Check if it contains a wikilink `[[...]]` or a change reference (text like `change:`, `from:`, or `source:` followed by an identifier)

**Pass condition**: Every active pitfall entry has at least one source reference.

**Fail finding**: "Pitfall entry without source link: '{entry_text_first_40_chars}...'"

**Suggested fix**: "Add a source link to identify which change introduced this pitfall. Format: `(source: [[change-name]])`"

---

#### Check #5: Implicit-contracts consistency

**Severity**: ℹ️ info

**Procedure**:
1. Read `wiki/architecture/implicit-contracts.md`
2. If it only contains the initial placeholder text → pass (no contracts to validate)
3. For each contract entry under `## Contracts`:
   - Check that it has a description of what breaks if violated
   - Check that it references specific files or modules

**Pass condition**: All contract entries have both a description and a file/module reference, or the file is still in placeholder state.

**Fail finding**: "Implicit contract '{name}' lacks file/module reference — hard to verify"

**Suggested fix**: "Add specific file paths or module names that enforce this contract."

---

#### Check #6: Orphan wiki page detection

**Severity**: ⚠️ warning

**Procedure**:
1. List all `.md` files in `wiki/` recursively (excluding `_index.md` files)
2. Scan all `.md` files in `memory/` and `wiki/` for wikilinks
3. Build an incoming-link set for each wiki page
4. Identify pages with zero incoming links from any other file

**Pass condition**: Every non-index wiki page has at least one incoming wikilink.

**Fail finding**: "Orphan page: {path} — no incoming wikilinks from memory/ or wiki/"

**Suggested fix**: "Add a link to this page from the relevant `_index.md` or from `wiki/index.md`."

---

#### Check #7: Extraction completeness

**Severity**: ℹ️ info

**Procedure**:
1. List all directories in `openspec/changes/` that contain a `tasks.md` with all tasks marked `[x]` (completed changes)
2. For each completed change, check if `wiki/sessions/{change-name}.md` exists
3. Also check the last 3 archived changes (if identifiable from git history or session records)

**Pass condition**: All recently completed changes have a corresponding session summary.

**Fail finding**: "Completed change '{name}' has no session summary at wiki/sessions/{name}.md"

**Suggested fix**: "Run `/opsx-archive` on this change to trigger knowledge extraction, or manually create the session summary."

---

#### Check #8: CLAUDE.md / AGENTS.md protocol presence

**Severity**: 🔴 error

**Procedure**:
1. Check if `CLAUDE.md` exists → search for `## Session Memory Protocol`
2. If no `CLAUDE.md`, check `AGENTS.md` → search for `## Session Memory Protocol`
3. If neither file exists → report as info (no config file available)

**Pass condition**: At least one agent config file contains `## Session Memory Protocol`.

**Fail finding**: "Session Memory Protocol section missing from agent config file"

**Suggested fix**: "Run `/opsx-memory-init` to inject the protocol, or manually add the `## Session Memory Protocol` section."

---

#### Check #9: Hot.md size cap

**Severity**: ⚠️ warning

**Procedure**:
1. Read `wiki/hot.md`
2. Count words (split by whitespace, exclude YAML frontmatter between `---` delimiters)

**Pass condition**: Word count ≤ 600.

**Fail finding**: "wiki/hot.md is {N} words (hard cap: 600 words)"

**Suggested fix**: "Trim the oldest entries from 'Recently Shipped' or 'Recent Decisions' sections. Target: 500 words."

---

#### Check #10: Index.md size cap

**Severity**: ⚠️ warning

**Procedure**:
1. Read `wiki/index.md`
2. Count total lines (including frontmatter)

**Pass condition**: Line count ≤ 80.

**Fail finding**: "wiki/index.md is {N} lines (hard cap: 80 lines)"

**Suggested fix**: "Archive completed-change entries from 'Session History' section. Target: 40 lines."

---

#### Check #11: Pitfalls active entry count

**Severity**: ℹ️ info

**Procedure**:
1. Read `memory/pitfalls.md`
2. Find the `## Active` section
3. Count bullet entries (lines starting with `- ` that aren't the placeholder text)

**Pass condition**: Active entry count ≤ 20.

**Fail finding**: "memory/pitfalls.md has {N} active entries (cap: 20)"

**Suggested fix**: "Rotate the oldest 10 entries to the `## Archive` section. Keep the most relevant/recent pitfalls active."

---

### 3. Generate lint report

Assemble all findings into a structured report. Write to `wiki/meta/lint-report-{YYYY-MM-DD}.md` (overwrite if same-day report exists).

#### Report format:

```markdown
---
type: wiki
generated: {YYYY-MM-DD}
tags: [lint, meta]
---

# Lint Report — {YYYY-MM-DD}

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Error | {N} |
| ⚠️ Warning | {N} |
| ℹ️ Info | {N} |
| ✅ Pass | {N} |

**Overall**: {PASS if 0 errors, WARN if 0 errors but has warnings, FAIL if any errors}

## Findings

### 🔴 Errors
{list of error findings, or "None"}

### ⚠️ Warnings
{list of warning findings, or "None"}

### ℹ️ Info
{list of info findings, or "None"}

## Checks Passed
{list of passing checks with ✅}

## Suggested Actions
{prioritized list: errors first, then warnings, then info}
```

### 4. Present results

Display the summary to the user:
- Total checks: 11
- Errors / Warnings / Info counts
- Overall status
- Location of full report: `wiki/meta/lint-report-{date}.md`
- Top 3 suggested actions (if any findings)

## Common Mistakes

- Modifying memory files during lint (lint is read-only)
- Counting frontmatter words in hot.md size check (exclude YAML between `---`)
- Treating placeholder text as active pitfall entries
- Failing to resolve wikilink aliases (strip `|alias` before path resolution)
- Reporting orphans for `_index.md` files (these are navigation hubs, exempt from orphan check)
