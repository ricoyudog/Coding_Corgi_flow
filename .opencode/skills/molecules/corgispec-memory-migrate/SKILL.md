---
name: corgispec-memory-migrate
description: Migrate existing project knowledge into the memory/wiki structure from docs, archived changes, agent configs, and vault files.
license: MIT
compatibility: Requires memory/ and wiki/ directories (run corgispec-memory-init first).
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.0.0"
---

Migrate existing project knowledge into the memory/wiki structure.

## Overview

When applying memory to an existing project, the `memory-init` skill creates empty templates. This skill fills them with knowledge already present in the project — extracting from agent config files, archived OpenSpec changes, docs/ directory, and any existing Obsidian vault pages.

The migration is **hybrid**: obvious items are auto-populated, ambiguous items prompt the user for categorization. Source files are never moved or deleted — migration creates wiki entries that reference originals.

## When to Use

- After `corgispec-memory-init` on an existing project with accumulated knowledge
- When a project has `docs/`, archived changes, or existing .md files that should feed the memory system
- Via `/corgi-migrate` slash command

Do not use this skill to initialize empty memory (use `corgispec-memory-init`), run lint checks, or extract from active/in-progress changes.

## Preconditions

- [ ] `memory/` directory exists with MEMORY.md, session-bridge.md, pitfalls.md
- [ ] `wiki/` directory exists with hot.md, index.md, and subdirectories
- [ ] At least one knowledge source is present (docs/, archived changes, agent config, or vault .md files)

## Steps

### 1. Survey available knowledge sources

Scan the project root to determine which sources exist:

1. **Agent configs**: Check for `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
2. **Archived changes**: Check for `openspec/changes/archive/` with subdirectories
3. **Documentation**: Check for `docs/` directory with .md files
4. **Vault pages**: Check for .md files outside `memory/`, `wiki/`, `docs/`, `openspec/`, `node_modules/`, `.git/`

Report the survey to the user:

```
## Knowledge Sources Found

- Agent configs: CLAUDE.md, AGENTS.md (2 files)
- Archived changes: 5 archived changes in openspec/changes/archive/
- Documentation: 12 files in docs/
- Vault pages: 3 .md files in project root

Phases to run: 1 (auto), 2 (auto), 3 (hybrid), 4 (hybrid)
```

If NO sources are found, report "No knowledge sources detected — nothing to migrate." and stop.

### 2. Phase 1 — Agent Config Deepening (auto)

**Source**: CLAUDE.md, AGENTS.md, GEMINI.md

**This phase auto-populates without asking** — agent config constraints are never ambiguous.

#### 2.1 Read all agent config files

For each file that exists, extract:
- **Hard constraints**: Lines that contain "must", "never", "always", "required", "forbidden", or are under sections like "Rules", "Constraints", "Must-Follow"
- **Preferences**: Lines under sections like "Style", "Conventions", "Preferences", "Guidelines"
- **Stack info**: Technology mentions, framework names, language versions
- **Architecture context**: Component descriptions, service names, deployment info

#### 2.2 Enrich memory/MEMORY.md

Read the current `memory/MEMORY.md`. For each section:

- **Project Identity**: Fill in Name/Purpose/Stack if they contain placeholders (`{{...}}` or "Not specified" or "Unknown")
- **Hard Constraints**: Append extracted constraints (deduplicate against existing entries)
- **Preferences**: Append extracted preferences (deduplicate against existing entries)

**Rules**:
- Never remove existing entries — only append new ones
- If a section already has real content (not placeholders), preserve it
- Keep the file concise: max 15 constraints, max 10 preferences. If more are found, keep the most important and note "See CLAUDE.md for full list"

#### 2.3 Enrich wiki/hot.md Architecture Pulse

Read `wiki/hot.md`. Update the Architecture Pulse section:
- **Stable**: Core technologies and well-established patterns from agent configs
- **Evolving**: Areas described as "in progress", "experimental", "new"
- **Legacy**: Areas described as "tech debt", "deprecated", "legacy", "to be replaced"

If Architecture Pulse already has real content (not `{{...}}` or "TBD"), merge rather than replace.

#### 2.4 Report Phase 1 results

```
### Phase 1: Agent Config Deepening (auto)
- memory/MEMORY.md: +N constraints, +M preferences
- wiki/hot.md: Architecture Pulse updated (Stable: ..., Evolving: ..., Legacy: ...)
```

---

### 3. Phase 2 — Archived Changes (auto)

**Source**: `openspec/changes/archive/*/`

**This phase auto-populates without asking** — archived change structure is predictable.

#### 3.1 Scan archived changes

List all directories in `openspec/changes/archive/`. For each:
1. Read `proposal.md` — extract change name and purpose
2. Read `tasks.md` — count total tasks, verify all complete
3. Read `design.md` (if exists) — extract key decisions
4. Note the archive date from directory name prefix (YYYY-MM-DD-<name>)

#### 3.2 Generate session summaries

For each archived change, check if `wiki/sessions/<change-name>.md` already exists.

**If it does NOT exist**, create it:

```markdown
---
type: wiki
created: <archive date>
source_change: <change-name>
status: archived
tags: [session, migrated]
---

# Session Summary: <change-name>

## Overview
<1-2 sentence summary from proposal.md>

## Timeline
- **Proposed**: <earliest date available>
- **Completed**: <archive date>
- **Task Groups**: <N groups, M total tasks>

## Key Decisions
<Bullet list from design.md decisions, or "Not recorded" if no design.md>

## Pitfalls Encountered
<If any pitfall in memory/pitfalls.md references this change, list them. Otherwise: "Not recorded">

## Outcome
<Brief from proposal.md "What Changes" section>

## References
- Proposal: [[openspec/changes/archive/<dir-name>/proposal]]
- Design: [[openspec/changes/archive/<dir-name>/design]] (if exists)
- Tasks: [[openspec/changes/archive/<dir-name>/tasks]]
```

**If it already exists**, skip it.

#### 3.3 Extract patterns from design decisions

For each archived change with a `design.md`:
- Look for decisions that describe reusable approaches (not one-off fixes)
- If a pattern is identified, check if `wiki/patterns/<pattern-name>.md` exists
- If not, create a pattern file following the format in `corgispec-memory-extract` skill

**Be conservative** — only extract patterns that clearly solve a recurring problem. When uncertain, skip. Migration errs on the side of less noise.

#### 3.4 Update wiki/hot.md Recently Shipped

Add the 5 most recent archived changes to the Recently Shipped section:
```
- **<change-name>** (<archive date>) — <one-line summary>
```

Trim to 5 entries if more exist.

#### 3.5 Update wiki/index.md

Add links for all newly created pages:
- Session summaries under `## Session History`
- Patterns under `## Patterns`

Check the 80-line cap — if exceeded, keep only the 10 most recent session links.

#### 3.5.1 Update _index.md files

For each newly created wiki page, update the corresponding `_index.md`:
- Session summaries → add entry to `wiki/sessions/_index.md`
- Pattern pages → add entry to `wiki/patterns/_index.md`
- Decision pages → add entry to `wiki/decisions/_index.md`

Follow the format convention: `- [[filename|Title]] — date — brief description`
Reference `wiki/schema.md` for format rules.

#### 3.5.2 Backfill wiki/log.md

For each archived change that was processed in this phase, append a log entry to `wiki/log.md`:
```
<archive-date> | archive <change-name> | +wiki/sessions/<name>.md +wiki/patterns/<pattern-names>.md
```

If `wiki/log.md` does not exist, create it with the format header from `wiki/schema.md` Section D.

#### 3.6 Report Phase 2 results

```
### Phase 2: Archived Changes (auto)
- Session summaries created: N (skipped M already existing)
- Patterns extracted: P
- wiki/hot.md Recently Shipped: updated with 5 most recent
- wiki/index.md: +Q links added
```

---

### 4. Phase 3 — docs/ Directory (hybrid)

**Source**: `docs/` directory tree

**This phase is hybrid** — auto-categorize obvious docs, ask about ambiguous ones.

#### 4.1 Scan docs/ directory

List all .md files in `docs/` (recursively). For each file:
1. Read the filename and path
2. Read the first 50 lines (title, frontmatter, opening content)
3. Attempt auto-categorization based on signals:

| Signal | Category | Target |
|--------|----------|--------|
| Filename contains "adr", "decision", "rfc" | decisions | `wiki/decisions/` |
| Filename contains "architecture", "design", "system" | architecture | `wiki/architecture/` |
| Filename contains "research", "investigation", "spike" | research | `wiki/research/` |
| Filename contains "pattern", "recipe", "howto" | patterns | `wiki/patterns/` |
| Content has "## Decision" or "## Status: Accepted" | decisions | `wiki/decisions/` |
| Content describes system components/boundaries | architecture | `wiki/architecture/` |

#### 4.2 Present categorization to user

Show the auto-categorized files and ask for confirmation:

```
### docs/ Categorization

**Auto-categorized** (confidence: high):
- docs/adr/001-use-postgres.md → wiki/decisions/ (ADR)
- docs/architecture/service-map.md → wiki/architecture/
- docs/research/auth-providers.md → wiki/research/

**Needs your input** (ambiguous):
- docs/api-guide.md — architecture or skip?
- docs/deployment-notes.md — architecture or skip?
- docs/changelog.md — skip? (probably not wiki material)

For ambiguous files, choose: architecture / decisions / research / patterns / skip
```

Wait for user response before proceeding.

#### 4.3 Create wiki reference pages

For each categorized doc (not "skip"), create a wiki reference page:

```markdown
---
type: wiki
created: <today's date>
source: docs/<relative-path>
tags: [<category>, migrated]
---

# <Title from doc>

## Summary
<2-4 sentence summary of the document's content>

## Key Points
- <Most important point 1>
- <Most important point 2>
- <Most important point 3>

## Source
Full document: [[docs/<relative-path>]]
```

**Important**: Do NOT copy the entire doc content. Create a summary that helps the AI decide whether to read the full doc. The original stays in `docs/`.

#### 4.4 Update wiki index pages

Add new entries to the relevant `wiki/<category>/_index.md` page:
```
- [[wiki/<category>/<page-name>|<Title>]]
```

Update `wiki/index.md` if new categories gained their first entries.

#### 4.5 Report Phase 3 results

```
### Phase 3: docs/ Directory (hybrid)
- Auto-categorized: N files
- User-categorized: M files
- Skipped: P files
- Wiki pages created: Q
```

---

### 5. Phase 4 — Existing Vault Pages (hybrid)

**Source**: .md files outside standard directories

**This phase is hybrid** — present all found files for user decision.

#### 5.1 Scan for vault pages

Find .md files in the project that are NOT in:
- `memory/`, `wiki/`, `docs/`, `openspec/`
- `node_modules/`, `.git/`, `.opencode/`, `.claude/`, `.codex/`
- Build output directories (`dist/`, `build/`, `out/`, `target/`)

Common locations: project root, `notes/`, `journal/`, custom directories.

#### 5.2 Present found files

If files are found, present them grouped by location:

```
### Vault Pages Found

**Project root**:
- README.md — skip (already used for identity)
- CONTRIBUTING.md — architecture or skip?
- TROUBLESHOOTING.md — patterns or pitfalls?

**notes/**:
- notes/performance-tuning.md — research or patterns?
- notes/known-issues.md — pitfalls or skip?

Choose for each: architecture / decisions / research / patterns / pitfalls / skip
```

If no files found outside standard directories: "No additional vault pages found." and skip to Step 6.

#### 5.3 Process user decisions

For files categorized as **pitfalls**: extract individual entries and append to `memory/pitfalls.md` Active section (with `(source: [[<original-path>]])` links).

For all other categories: create wiki reference pages following the same format as Phase 3 (summary + link to source, never copy full content).

For **skip**: do nothing.

For all created wiki pages, update the corresponding `_index.md` with a wikilink entry following the format in `wiki/schema.md`.

#### 5.4 Report Phase 4 results

```
### Phase 4: Vault Pages (hybrid)
- Files found: N
- Imported: M (to architecture: A, decisions: D, research: R, patterns: P, pitfalls: X)
- Skipped: S
```

---

### 6. Final validation and report

After all phases complete:

#### 6.1 Size cap check

Verify all memory files respect their caps:
- `wiki/hot.md`: count words — if > 600, compact (trim oldest Recently Shipped)
- `wiki/index.md`: count lines — if > 80, trim oldest session links
- `memory/pitfalls.md`: count active entries — if > 20, rotate oldest to Archive

#### 6.2 Wikilink integrity check

For all newly created wiki pages, verify that:
- Their source wikilinks point to files that exist
- They are referenced in the appropriate `_index.md`

Report any broken links.

#### 6.3 Final summary

```
## Migration Complete

| Phase | Source | Auto | User-Directed | Skipped | Pages Created |
|-------|--------|------|---------------|---------|---------------|
| 1. Agent Config | CLAUDE.md, AGENTS.md | all | — | — | 0 (enriched existing) |
| 2. Archived Changes | openspec/changes/archive/ | all | — | M | N |
| 3. docs/ | docs/ | P | Q | R | S |
| 4. Vault Pages | .md files | — | T | U | V |

**Total wiki pages created**: <sum>
**memory/MEMORY.md**: enriched with N constraints, M preferences
**Size caps**: hot.md <X>/600 words, index.md <Y>/80 lines, pitfalls <Z>/20 active
**Broken links**: <count or "none">

### Next Steps
1. Review created wiki pages for accuracy
2. Run `/corgi-lint` to validate memory health
3. Consider running `/corgi-propose` for your next change — memory will now provide context
```

---

## Incremental Usage

Users can run migration partially:

- **Phases 1+2 only** (auto): Pass `--auto-only` or answer "skip" when prompted for Phases 3/4
- **Single phase**: Pass `--phase N` to run only one phase (requires prior phases already done or skipped)
- **Re-run safe**: All phases are idempotent — existing files are never overwritten

## Common Mistakes

- Moving or deleting source files (migration only creates references, never moves)
- Copying full doc content into wiki pages (always summarize + link)
- Overwriting existing wiki pages (always check-before-write)
- Importing README.md as a vault page (already used for identity in Phase 1)
- Creating patterns from every archived change (be conservative — most changes are mechanical)
- Exceeding size caps after bulk import (always run cap check at the end)
- Running before memory-init (precondition: memory/ and wiki/ must exist)
- Importing node_modules, build output, or .git content (always exclude these)
