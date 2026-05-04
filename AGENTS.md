# AGENTS.md

## What this repo is

A workflow/skills toolkit (not an app) that turns AI coding assistants into structured engineering workflows via OpenSpec. It ships skills, schemas, CLI tooling, and slash commands for Claude Code, OpenCode, and Codex.

There is no application code to build or deploy. The "product" is the skill files and their metadata.

## Directory layout

| Path | Role |
|------|------|
| `.opencode/skills/corgispec-*/` | **Source of truth** for skill definitions (SKILL.md + skill.meta.json) |
| `.opencode/commands/corgi-*.md` | OpenCode slash command dispatch |
| `.claude/skills/corgispec-*/` | Claude Code skill mirrors — must stay in sync with `.opencode/skills/` |
| `.codex/skills/corgispec-*/` | Codex skill mirrors — must stay in sync with `.opencode/skills/` |
| `openspec/schemas/` | Schema definitions (gitlab-tracked, github-tracked) |
| `openspec/config.yaml` | Project-level config (schema, isolation, context) |
| `schemas/skill-meta.schema.json` | JSON Schema for validating `skill.meta.json` |
| `packages/corgispec/` | **corgispec CLI** — unified CLI replacing ds-skills + install-skills.sh |
| `tools/ds-skills/` | Node CLI for skill validation + dependency graphing (legacy, use corgispec instead) |
| `install-skills.sh` | Installs user-level skills (legacy, use `corgispec install` instead) |

## Commands

### Run corgispec tests

```bash
cd packages/corgispec && npm test
```

Uses Vitest. Requires Node >= 18.

### Validate all skills (the closest thing to a build/lint step)

```bash
cd tools/ds-skills && npm install && node bin/ds-skills.js validate --path ../..
```

### Run ds-skills tests

```bash
cd tools/ds-skills && npm test
```

Uses Node.js built-in test runner (`node --test`). Requires Node >= 18.

### Other ds-skills commands

```bash
node bin/ds-skills.js list --path ../..    # list all skills
node bin/ds-skills.js graph --path ../..   # dependency graph
```

### Install skills to user level

```bash
./install-skills.sh          # copies to ~/.claude/skills/ and ~/.config/opencode/skill/
./install-skills.sh --dry-run  # preview only
```

## Skill authoring rules

- Each skill lives in its own directory with exactly two files: `SKILL.md` (instructions) and `skill.meta.json` (metadata).
- `skill.meta.json` must validate against `schemas/skill-meta.schema.json`.
- Skill slugs are kebab-case, must match the directory name.
- Tier hierarchy: `atom` (no deps) -> `molecule` (depends on atoms) -> `compound` (depends on molecules/atoms).
- Platform field: `universal`, `github`, or `gitlab`.
- `corgispec-gh-*` skills are GitHub variants; unprefixed `corgispec-*` are GitLab or universal.

## Three-directory sync obligation

`.opencode/skills/`, `.claude/skills/`, and `.codex/skills/` must contain equivalent skill content. When editing a skill, update all three directories. The `.opencode/skills/` version is canonical.

## No CI

There are no CI workflows. Validation is manual via `ds-skills validate` or `corgispec validate`.

## Config

- `openspec/config.yaml` controls which schema (`gitlab-tracked` or `github-tracked`) is active and optional worktree isolation settings.
- `.opencode/package.json` only declares `@opencode-ai/plugin` — this enables skill discovery in OpenCode sessions.

## Conventions

- Markdown skill files reference tool names generically. Platform-specific tool mapping is handled at runtime by each AI platform.
- The workflow is checkpoint-based: propose -> apply (one Task Group at a time) -> review -> archive.
- Delta specs use ADDED/MODIFIED/REMOVED/RENAMED operations.

## Coding Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

> **Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: *"Would a senior engineer say this is overcomplicated?"* If yes, simplify.

### 3. Surgical Changes

Touch only what you must. Clean up only your own mess.

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

**The test:** Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

Define success criteria. Loop until verified.

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

*These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.*

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

### corgi Apply -> Long-term Memory
After each Task Group completes:
- New pitfalls -> append to `memory/pitfalls.md` (link source change)
- New implicit rules -> append to `wiki/architecture/implicit-contracts.md`
- Update `wiki/hot.md` Recent Decisions

### Compaction Triggers (agent self-maintains)
- Every archive: compress session-bridge
- pitfalls > 20 entries: rotate oldest 10 to Archive section
- hot.md > 550 words: trim oldest entries
- Every 10 corgi sessions: suggest running /corgi-lint
