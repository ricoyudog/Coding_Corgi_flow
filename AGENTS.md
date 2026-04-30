# AGENTS.md

## What this repo is

A workflow/skills toolkit (not an app) that turns AI coding assistants into structured engineering workflows via OpenSpec. It ships skills, schemas, CLI tooling, and slash commands for Claude Code, OpenCode, and Codex.

There is no application code to build or deploy. The "product" is the skill files and their metadata.

## Directory layout

| Path | Role |
|------|------|
| `.opencode/skills/openspec-*/` | **Source of truth** for skill definitions (SKILL.md + skill.meta.json) |
| `.opencode/commands/opsx-*.md` | OpenCode slash command dispatch |
| `.claude/skills/openspec-*/` | Claude Code skill mirrors — must stay in sync with `.opencode/skills/` |
| `.codex/skills/openspec-*/` | Codex skill mirrors — must stay in sync with `.opencode/skills/` |
| `openspec/schemas/` | Schema definitions (gitlab-tracked, github-tracked) |
| `openspec/config.yaml` | Project-level config (schema, isolation, context) |
| `schemas/skill-meta.schema.json` | JSON Schema for validating `skill.meta.json` |
| `tools/ds-skills/` | Node CLI for skill validation + dependency graphing |
| `install-skills.sh` | Installs user-level skills to `~/.claude/skills/` and `~/.config/opencode/skill/` |

## Commands

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
- `openspec-gh-*` skills are GitHub variants; unprefixed `openspec-*` are GitLab or universal.

## Three-directory sync obligation

`.opencode/skills/`, `.claude/skills/`, and `.codex/skills/` must contain equivalent skill content. When editing a skill, update all three directories. The `.opencode/skills/` version is canonical.

## No CI

There are no CI workflows. Validation is manual via `ds-skills validate`.

## Config

- `openspec/config.yaml` controls which schema (`gitlab-tracked` or `github-tracked`) is active and optional worktree isolation settings.
- `.opencode/package.json` only declares `@opencode-ai/plugin` — this enables skill discovery in OpenCode sessions.

## Conventions

- Markdown skill files reference tool names generically. Platform-specific tool mapping is handled at runtime by each AI platform.
- The workflow is checkpoint-based: propose -> apply (one Task Group at a time) -> review -> archive.
- Delta specs use ADDED/MODIFIED/REMOVED/RENAMED operations.
