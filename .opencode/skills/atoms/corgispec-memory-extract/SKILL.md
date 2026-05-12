---
name: corgispec-memory-extract
description: Extract reusable patterns and session summaries from completed changes into wiki long-term memory.
license: MIT
compatibility: Requires memory/ and wiki/ directories. Called by corgispec-archive before change closure.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.0.0"
---

Extract long-term knowledge from a completed change into wiki.

## Overview

When a change completes its lifecycle (all Task Groups done, review passed), this skill extracts reusable knowledge before the change is archived. It creates:
- Pattern files for reusable approaches (`wiki/patterns/`)
- Session summaries for historical record (`wiki/sessions/`)
- Updates to `wiki/hot.md` (move from Active to Recently Shipped)
- Reset of `memory/session-bridge.md` (clear archived change state)
- Updates to `wiki/index.md` (add new page links)

This is the "knowledge distillation" step — turning ephemeral session work into persistent organizational memory.

## When to Use

- Called automatically by `corgispec-archive` before closing a change
- Manually via direct invocation when you want to extract knowledge without full archive

Do not use this skill to initialize memory, answer questions, or validate health.

## Preconditions

- [ ] The change is complete (all tasks marked `[x]` in tasks.md)
- [ ] `memory/` and `wiki/` directories exist
- [ ] The change has `proposal.md` and `tasks.md` at minimum

## Steps

### 1. Identify the change and gather context

Read the change's artifacts to understand what was accomplished:
1. Read `proposal.md` — the "why" and "what"
2. Read `tasks.md` — the work breakdown and what was done
3. Read `design.md` (if exists) — key design decisions
4. Read `memory/session-bridge.md` — recent session state related to this change
5. Read `memory/pitfalls.md` — pitfalls discovered during this change

### 2. Extract reusable patterns

Analyze the change history to identify reusable approaches:

**What qualifies as a pattern?**
- A technical approach that solved a non-trivial problem
- A workflow or process that could be reused in future changes
- An integration pattern between components
- A testing strategy that proved effective

**What does NOT qualify?**
- Trivial implementation details (just wrote a function)
- One-off fixes unlikely to recur
- Standard library usage
- Dependency version bumps

**If patterns are identified**, create a file for each at `wiki/patterns/<pattern-name>.md`:

```markdown
---
type: wiki
created: <today's date>
source_change: <change-name>
tags: [pattern, <relevant-tags>]
---

# <Pattern Name>

## Context
<When and why this pattern emerged — what problem it solves>

## Pattern
<The approach itself — how to apply it>

## When to Use
- <Condition 1>
- <Condition 2>

## Example
<Brief example from the source change showing the pattern in action>

## Source
- Extracted from change: [[openspec/changes/<change-name>/proposal]]
- Related pitfalls: [[memory/pitfalls]] (if applicable)
```

**If no patterns identified**, report: "No reusable patterns identified — change was mechanical or domain-specific." This is normal and not an error.

### 3. Create session summary

Create `wiki/sessions/<change-name>.md`:

```markdown
---
type: wiki
created: <today's date>
source_change: <change-name>
status: archived
tags: [session, <relevant-tags>]
---

# Session Summary: <change-name>

## Overview
<1-2 sentence summary of what this change accomplished>

## Timeline
- **Proposed**: <date from proposal or git history>
- **Completed**: <today's date>
- **Task Groups**: <N> groups, <M> total tasks

## Key Decisions
<Bullet list of the most important decisions made during implementation, extracted from design.md and session-bridge history>

## Pitfalls Encountered
<Bullet list of pitfalls hit during this change, from pitfalls.md entries linked to this change>
<If none: "No significant pitfalls encountered.">

## Outcome
<Brief assessment: what was delivered, any known limitations>

## References
- Proposal: [[openspec/changes/<change-name>/proposal]]
- Design: [[openspec/changes/<change-name>/design]] (if exists)
- Tasks: [[openspec/changes/<change-name>/tasks]]
```

**If `wiki/sessions/<change-name>.md` already exists**, report "Session summary already exists" and do not overwrite.

### 4. Update wiki/hot.md lifecycle

Read `wiki/hot.md` and make these changes:

1. **Remove from Active Changes**: Find and remove the line referencing this change under `## Active Changes`
2. **Add to Recently Shipped**: Add a new entry under `## Recently Shipped`:
   ```
   - **<change-name>** (<today's date>) — <one-line summary from proposal>
   ```
3. **Check size**: If hot.md exceeds 550 words after the update, trim the oldest entries from "Recently Shipped" (keep the 5 most recent)

If the change is not listed under Active Changes, add it directly to Recently Shipped without error.

### 5. Reset memory/session-bridge.md

Update `memory/session-bridge.md`:

1. Update the `updated:` frontmatter date to today
2. Clear entries in `## Done` that relate to the archived change
3. Clear entries in `## Waiting` that relate to the archived change
4. Clear entries in `## New Pitfalls` that relate to the archived change (they're already in pitfalls.md)
5. Clear entries in `## New Discoveries` that relate to the archived change
6. Update `## Active opsx Change`:
   - If another change is active: set to that change's info
   - If no other change: reset to `none`/`none`/`main`

**Preserve entries related to OTHER active changes.** Only clear entries linked to the change being archived.

### 6. Update wiki/index.md and _index.md files

Add links to newly created pages:

1. If a pattern was created → add under `## Patterns`:
   ```
   - [[wiki/patterns/<pattern-name>|<Pattern Title>]]
   ```
2. Add the session summary under `## Session History`:
   ```
   - [[wiki/sessions/<change-name>|<Change Name>]]
   ```
3. **Check size**: If index.md exceeds 80 lines after updates:
   - Remove the oldest entries from `## Session History` (keep 10 most recent)
   - Do NOT remove pattern or architecture entries

4. **Update _index.md files** (see `wiki/schema.md` for format convention):
   - If a pattern was created → add a wikilink entry to `wiki/patterns/_index.md` following the existing format: `- [[filename|Title]] — date — brief description`
   - If a session was created → add a wikilink entry to `wiki/sessions/_index.md` following the same format

### 7. Report results

```
## Memory Extraction Complete

**Change**: <change-name>
**Patterns extracted**: N (list names)
**Session summary**: wiki/sessions/<change-name>.md
**Hot.md**: moved to Recently Shipped
**Session-bridge**: cleared archived change entries
**Index.md**: updated with N new links

The change is ready for full archive closure.
```

---

## Common Mistakes

- Overwriting an existing session summary (check first)
- Removing other changes' entries from session-bridge (only clear THIS change)
- Not checking hot.md size after update (may exceed cap)
- Creating patterns for trivial work (not everything is a pattern)
- Forgetting to update index.md after creating new wiki pages
- Running extraction on an incomplete change (all tasks must be [x])
