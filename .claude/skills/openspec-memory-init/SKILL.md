---
name: openspec-memory-init
description: Initialize the 3-layer memory structure (memory/ + wiki/) for cross-session AI continuity in an OpenSpec project.
license: MIT
compatibility: Requires openspec CLI. Target project must have openspec/config.yaml.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.0.0"
---

Initialize the 3-layer memory structure for cross-session AI continuity.

## Overview

Creates `memory/` (permanent, agent-focused) and `wiki/` (long-term, human+AI) directories with template files, then injects the Session Memory Protocol into the project's agent configuration file.

The result is a structured memory system that:
- Costs ≤ 3000 tokens at session startup
- Is human-readable in Obsidian (valid markdown with wikilinks)
- Self-compacts via size caps and rotation rules
- Integrates with the OpenSpec lifecycle (apply closeout, archive extraction)

## When to Use

- After `openspec-install` completes (called automatically unless `--no-memory`)
- Manually via `/opsx-memory-init` to add memory to an existing OpenSpec project
- When a project needs cross-session continuity but doesn't have `memory/` or `wiki/` yet

Do not use this skill to modify memory contents, run lint checks, or extract knowledge from changes.

## Preconditions

- [ ] Target project has `openspec/config.yaml`
- [ ] Target project root is known (current working directory or specified path)

## Steps

### 1. Detect project identity and extract knowledge

Read the target project's root for context:

1. If `README.md` exists → extract project name and purpose (first heading + first paragraph)
2. If `CLAUDE.md` exists → extract:
   - Tech stack (languages, frameworks, databases, infrastructure)
   - Hard constraints (lines with "must", "never", "always", "required", "forbidden")
   - Preferences (style, naming conventions, patterns to follow)
   - Architecture notes (component descriptions, service boundaries)
3. If `AGENTS.md` exists → extract same categories as CLAUDE.md (merge, deduplicate)
4. If `GEMINI.md` exists → extract same categories (merge, deduplicate)
5. If `package.json` exists → extract project name from `name` field, framework info from dependencies
6. If `docs/` exists → scan top-level .md filenames for architecture clues (don't deep-read, just note presence)

Store extracted values for template population:
- `PROJECT_NAME`: from README heading or package.json name
- `PROJECT_PURPOSE`: from README first paragraph
- `TECH_STACK`: from agent configs + package.json deps
- `HARD_CONSTRAINTS`: bullet list from agent configs (max 15)
- `PREFERENCES`: bullet list from agent configs (max 10)
- `STABLE_COMPONENTS`: well-established tech from stack info
- `EVOLVING_COMPONENTS`: anything described as new/experimental, or "TBD"
- `LEGACY_COMPONENTS`: anything described as deprecated/debt, or "None identified"

If a file doesn't exist or a value can't be extracted, use placeholder text.

**Note**: This is a lightweight extraction for initial setup. For deep knowledge migration from existing projects, run `/opsx-migrate` after init completes.

### 2. Create memory/ directory structure

Create the following files. **Skip any file that already exists** — never overwrite.

```
memory/
├── MEMORY.md
├── session-bridge.md
└── pitfalls.md
```

#### memory/MEMORY.md

```markdown
---
type: memory
created: <today's date YYYY-MM-DD>
---

# MEMORY — Hard Constraints

> AI agent must obey these every session. Never expires.

## Project Identity
- **Name**: <extracted from README or package.json, or "Unknown">
- **Purpose**: <extracted from README first paragraph, or "Not specified">
- **Stack**: <extracted from CLAUDE.md/AGENTS.md, or "Not specified">

## Hard Constraints
- <extracted from CLAUDE.md Must-Follow Rules, or "None specified yet">

## Preferences
- <extracted from CLAUDE.md style/convention sections, or "None specified yet">
```

#### memory/session-bridge.md

```markdown
---
type: memory
updated: <today's date YYYY-MM-DD>
---

# Session Bridge

> AI agent reads this first at startup. Last session's handoff state.

## Active opsx Change
- **Change**: none
- **Phase**: none
- **Branch**: main

## Done (last session completed)
- (initial setup — memory structure created)

## Waiting (next steps / blockers)
- First change not yet created — run `/opsx-propose`

## New Pitfalls
- (none yet)

## New Discoveries
- (none yet)

## Next Session Start
1. Read this file ← you are here
2. Read [[wiki/hot]]
3. Read [[wiki/index]]
4. Then docs/ or specs/ as needed
```

#### memory/pitfalls.md

```markdown
---
type: memory
updated: <today's date YYYY-MM-DD>
---

# Pitfalls

> Cross-change pitfall log. Each entry links to its source change. Max 20 active entries.

## Active

(No pitfalls yet — these accumulate during opsx apply sessions)

## Archive

(No archived pitfalls yet — oldest entries rotate here when Active exceeds 20)
```

### 3. Create wiki/ directory structure

Create the following structure. **Skip any file that already exists.**

```
wiki/
├── hot.md
├── index.md
├── architecture/
│   ├── _index.md
│   └── implicit-contracts.md
├── patterns/
│   └── _index.md
├── research/
│   └── _index.md
├── sessions/
│   └── _index.md
├── decisions/
│   └── _index.md
├── questions/
│   └── _index.md
└── meta/
    └── _index.md
```

#### wiki/hot.md

```markdown
---
type: wiki
updated: <today's date YYYY-MM-DD>
tags: [hot, entry]
pinned: true
---

# Hot — <Project Name> Latest

> ~500 words | Hard cap 600 words | Updated every session | First entry point for humans and AI

## Active Changes
- (No active change yet — run `/opsx-propose`)

## Recent Decisions
- Initialized memory structure

## Architecture Pulse
- **Stable**: <from CLAUDE.md/README or "TBD">
- **Evolving**: <current work focus or "TBD">
- **Legacy**: <known tech debt or "None identified">

## Recent Pitfalls
- (none yet — see [[memory/pitfalls]])

## Recently Shipped
- (none yet)
```

#### wiki/index.md

```markdown
---
type: wiki
updated: <today's date YYYY-MM-DD>
---

# <Project Name> Wiki Index

> AI-maintained long-term knowledge navigation. Hard cap 80 lines. Click wikilinks to jump to source.

## Architecture Insights
- [[wiki/architecture/_index|Architecture Index]]
- [[wiki/architecture/implicit-contracts|Implicit Contracts]]

## Patterns
- [[wiki/patterns/_index|Patterns Index]]

## Research
- [[wiki/research/_index|Research Index]]

## Decisions
- [[wiki/decisions/_index|Decisions Index]]

## Session History
- [[wiki/sessions/_index|Session Index]]

## Questions
- [[wiki/questions/_index|Questions Index]]
```

#### wiki/architecture/_index.md

```markdown
---
type: wiki
updated: <today's date YYYY-MM-DD>
---

# Architecture Index

> Structural insights about the codebase. Add entries as architecture knowledge is discovered.

## Pages
- [[wiki/architecture/implicit-contracts|Implicit Contracts]]
```

#### wiki/architecture/implicit-contracts.md

```markdown
---
type: wiki
updated: <today's date YYYY-MM-DD>
---

# Implicit Contracts

> Unwritten rules discovered during development. Each entry explains what breaks if violated.

## Contracts

(No implicit contracts discovered yet — these are added during opsx apply sessions when hidden dependencies or assumptions are found)
```

#### wiki/patterns/_index.md

```markdown
---
type: wiki
updated: <today's date YYYY-MM-DD>
---

# Patterns Index

> Reusable approaches extracted from completed changes.

## Patterns

(No patterns extracted yet — these are created during opsx archive)
```

#### wiki/research/_index.md

```markdown
---
type: wiki
updated: <today's date YYYY-MM-DD>
---

# Research Index

> Investigation results from opsx explore sessions.

## Topics

(No research topics yet — these are created during opsx explore)
```

#### wiki/sessions/_index.md

```markdown
---
type: wiki
updated: <today's date YYYY-MM-DD>
---

# Session Index

> Summaries of completed changes, extracted at archive time.

## Sessions

(No session summaries yet — these are created during opsx archive)
```

#### wiki/decisions/_index.md

```markdown
---
type: wiki
updated: <today's date YYYY-MM-DD>
---

# Decisions Index

> Key decisions made during reviews and implementation.

## Decisions

(No decisions recorded yet — these are created when reviews approve significant choices)
```

#### wiki/questions/_index.md

```markdown
---
type: wiki
updated: <today's date YYYY-MM-DD>
---

# Questions Index

> Human questions asked via Obsidian, answered by AI from vault context.

## Questions

(No questions yet — create a markdown file here with `status: pending` frontmatter to ask a question)
```

#### wiki/meta/_index.md

```markdown
---
type: wiki
updated: <today's date YYYY-MM-DD>
---

# Meta Index

> Lint reports, dashboards, and memory health metrics.

## Reports

(No lint reports yet — run `/opsx-lint` to generate one)
```

### 4. Inject Session Memory Protocol

Check the agent configuration file for an existing `## Session Memory Protocol` section:

1. If `CLAUDE.md` exists → check for `## Session Memory Protocol`
2. If `AGENTS.md` exists → check for `## Session Memory Protocol`

**If the section already exists** → skip injection, report "Session Memory Protocol already present."

**If the section does NOT exist** → append the following block to the end of the primary config file (CLAUDE.md if it exists, otherwise AGENTS.md):

```markdown
## Session Memory Protocol

### Startup (every session)
Read in order, max 3 files:
1. `memory/session-bridge.md` — last session's state
2. `wiki/hot.md` — current project context (~500 words, hard cap 600)
3. `wiki/index.md` — jump to relevant domain page
Then read `docs/` or code as needed.

### Retrieval Budget
- Startup: max 3 files (session-bridge + hot + index), then on-demand
- Per-question: max 2 wiki pages before answering
- If >5 pages needed: say "this needs a deep session"

### File Size Limits (hard caps)
| File | Target | Hard Cap | Overflow Action |
|------|--------|----------|-----------------|
| wiki/hot.md | 500 words | 600 words | Trim oldest entries |
| wiki/index.md | 40 lines | 80 lines | Archive completed entries |
| memory/pitfalls.md | 10 active | 20 active | Rotate oldest 10 |
| memory/session-bridge.md | 30 lines | 50 lines | Archive old Done items |

### Shutdown (every session end)
Update `memory/session-bridge.md`: Done / Waiting / New Pitfalls / New Discoveries

### opsx Apply → Long-term Memory
After each Task Group completes:
- New pitfalls → append to `memory/pitfalls.md` (link source change)
- New implicit rules → append to `wiki/architecture/implicit-contracts.md`
- Update `wiki/hot.md` Recent Decisions

### Compaction Triggers (agent self-maintains)
- Every archive: compress session-bridge
- pitfalls > 20 entries: rotate oldest 10 to Archive section
- hot.md > 550 words: trim oldest entries
- Every 10 opsx sessions: suggest running /opsx-lint
```

### 5. Idempotency and safety

Throughout all steps, enforce these rules:

- **Never overwrite existing files.** If a file already exists at the target path, skip it and add to the "skipped" report.
- **Never overwrite existing protocol section.** If `## Session Memory Protocol` already exists in the config file, do not duplicate it.
- **Only operate within the project directory.** Never write to user-home or global paths.
- **Report all actions.** At the end, print a summary:
  - Files created (list paths)
  - Files skipped (already existed)
  - Protocol injection status (injected / already present / no config file found)
  - Next steps recommendation

### 6. Output summary

Print a structured summary:

```
## Memory Init Complete

**Project**: <name>
**Created**: N files
**Skipped**: M files (already existed)
**Protocol**: Injected into <file> / Already present / No config file

### Created Files
- memory/MEMORY.md
- memory/session-bridge.md
- memory/pitfalls.md
- wiki/hot.md
- wiki/index.md
- wiki/architecture/_index.md
- wiki/architecture/implicit-contracts.md
- wiki/patterns/_index.md
- wiki/research/_index.md
- wiki/sessions/_index.md
- wiki/decisions/_index.md
- wiki/questions/_index.md
- wiki/meta/_index.md

### Next Steps
1. Review `memory/MEMORY.md` — fill in any placeholders
2. Run `/opsx-propose` to create your first change
3. Memory will auto-update during apply and archive phases
```

## Common Mistakes

- Overwriting existing memory files (violates idempotency)
- Injecting Session Memory Protocol twice
- Using absolute paths instead of project-relative wikilinks
- Forgetting to extract project identity before writing templates
- Writing outside the target project directory
