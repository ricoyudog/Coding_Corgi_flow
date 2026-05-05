<!-- Task Groups (## headings) are checkpoint units. Each group becomes a child GitLab issue. Apply executes one group at a time. -->

## 1. Memory Init Skill — Core Structure

- [x] 1.1 Create `corgispec-memory-init` skill directory in `.opencode/skills/` with `SKILL.md` and `skill.meta.json` (tier: atom, platform: universal)
- [x] 1.2 Write the SKILL.md instructions: detect project identity from README/CLAUDE.md, create `memory/` directory with 3 template files (MEMORY.md, session-bridge.md, pitfalls.md)
- [x] 1.3 Add wiki/ directory creation logic to SKILL.md: create 7 subdirectories (architecture, patterns, research, sessions, decisions, questions, meta) each with `_index.md`, plus `wiki/hot.md` and `wiki/index.md`
- [x] 1.4 Add Session Memory Protocol injection logic: append protocol section to CLAUDE.md/AGENTS.md with startup reads, retrieval budget, size limits, shutdown writes, compaction triggers
- [x] 1.5 Add idempotency guards: skip existing files, detect existing protocol section, report conflicts
- [x] 1.6 Sync skill to `.claude/skills/corgispec-memory-init/` and `.codex/skills/corgispec-memory-init/` (three-directory obligation)
- [x] 1.7 Add `/corgi-memory-init` slash command in `.opencode/commands/`

## 2. Memory Init — Template Files

- [x] 2.1 Create template content for `memory/MEMORY.md` — project identity, hard constraints, preferences sections with placeholder extraction logic
- [x] 2.2 Create template content for `memory/session-bridge.md` — active change, done, waiting, pitfalls, discoveries, next session start sections
- [x] 2.3 Create template content for `memory/pitfalls.md` — active section (max 20) + archive section with rotation instructions
- [x] 2.4 Create template content for `wiki/hot.md` — active changes, recent decisions, architecture pulse, recent pitfalls, recently shipped (target 500 words, cap 600)
- [x] 2.5 Create template content for `wiki/index.md` — navigation hub with wikilinks to all subdirectory indexes (target 40 lines, cap 80)
- [x] 2.6 Create template content for all 7 `_index.md` files (architecture, patterns, research, sessions, decisions, questions, meta)
- [x] 2.7 Create the Session Memory Protocol text block that will be injected into CLAUDE.md/AGENTS.md

## 3. Install Integration

- [x] 3.1 Modify `corgispec-install` SKILL.md to call `corgispec-memory-init` after standard install completes
- [x] 3.2 Add `--no-memory` flag handling: skip memory-init when flag is present
- [x] 3.3 Update `corgispec-install` skill.meta.json to add `corgispec-memory-init` as a dependency
- [x] 3.4 Sync modified install skill across all 3 directories
- [x] 3.5 Validate with `ds-skills validate` that dependency graph is consistent

## 4. Memory Lint Skill

- [x] 4.1 Create `corgispec-lint` skill directory in `.opencode/skills/` with `SKILL.md` and `skill.meta.json` (tier: molecule, platform: universal)
- [x] 4.2 Write lint checks #1-2: freshness checks for session-bridge (>30d) and hot.md (>14d) — parse `updated:` frontmatter field
- [x] 4.3 Write lint check #3: broken wikilink detection — scan all `[[...]]` patterns in memory/ and wiki/, verify target files exist
- [x] 4.4 Write lint check #4: pitfalls source link validation — each active entry must contain a wikilink or change reference
- [x] 4.5 Write lint check #5: implicit-contracts consistency — compare contracts listed vs actual codebase patterns
- [x] 4.6 Write lint check #6: orphan page detection — find wiki pages with zero incoming links
- [x] 4.7 Write lint check #7: extraction completeness — check recent archives have wiki/sessions/ entries
- [x] 4.8 Write lint check #8: CLAUDE.md protocol presence — verify `## Session Memory Protocol` exists
- [x] 4.9 Write lint checks #9-11: size cap validation — hot.md word count, index.md line count, pitfalls active entry count
- [x] 4.10 Write report generation: output structured report to `wiki/meta/lint-report-YYYY-MM-DD.md`
- [x] 4.11 Sync skill to `.claude/skills/` and `.codex/skills/`
- [x] 4.12 Add `/corgi-lint` slash command in `.opencode/commands/`

## 5. Memory Ask Skill

- [x] 5.1 Create `corgispec-ask` skill directory in `.opencode/skills/` with `SKILL.md` and `skill.meta.json` (tier: molecule, platform: universal)
- [x] 5.2 Write single-question mode: read specified question file, execute early-stop retrieval (bridge → hot → index → domain → docs → specs), write answer
- [x] 5.3 Write batch pending mode: scan `wiki/questions/*.md` for `status: pending`, list them, process sequentially
- [x] 5.4 Write retrieval budget enforcement: max 2 wiki pages per question, max 5 total before `needs-deep-session` flag
- [x] 5.5 Write knowledge writeback logic: detect new pitfalls or architecture insights from answers, append to appropriate files
- [x] 5.6 Create question template file structure (frontmatter with status, tags, date; ## Question; ## Answer sections)
- [x] 5.7 Sync skill to `.claude/skills/` and `.codex/skills/`
- [x] 5.8 Add `/corgi-ask` slash command in `.opencode/commands/`

## 6. Memory Extract Skill & Archive Integration

- [x] 6.1 Create `corgispec-memory-extract` skill directory in `.opencode/skills/` with `SKILL.md` and `skill.meta.json` (tier: atom, platform: universal)
- [x] 6.2 Write pattern extraction logic: analyze change history for reusable approaches, create `wiki/patterns/<name>.md` with Context/Pattern/When-to-Use/Example/Source sections
- [x] 6.3 Write session summary creation: produce `wiki/sessions/<change-name>.md` with Overview/Timeline/Key-Decisions/Pitfalls/Outcome sections
- [x] 6.4 Write hot.md lifecycle update: move change from Active to Recently Shipped
- [x] 6.5 Write session-bridge reset: clear archived change entries, preserve other active change entries
- [x] 6.6 Write index.md update logic: add new pattern/session links, trim if exceeding 80 lines
- [x] 6.7 Modify `corgispec-archive` SKILL.md to invoke `corgispec-memory-extract` before closing
- [x] 6.8 Update `corgispec-archive` skill.meta.json dependencies
- [x] 6.9 Sync all modified/new skills across 3 directories
- [x] 6.10 Add apply closeout memory writes to relevant skill instructions (session-bridge, pitfalls, hot.md updates)

## 7. Validation & Slash Commands

- [x] 7.1 Run `ds-skills validate --path ../..` and fix any schema or dependency errors
- [x] 7.2 Verify all new `skill.meta.json` files validate against `schemas/skill-meta.schema.json`
- [x] 7.3 Test end-to-end: run memory-init on a test project, verify all 12+ files created correctly
- [x] 7.4 Test lint: create deliberate violations (stale bridge, oversized hot.md, broken link) and verify lint catches them
- [x] 7.5 Test ask: create a pending question file and verify retrieval + answer flow
- [x] 7.6 Test extract: simulate a completed change and verify pattern/session extraction
- [x] 7.7 Verify three-directory sync: diff `.opencode/skills/` against `.claude/skills/` and `.codex/skills/` for all new/modified skills
