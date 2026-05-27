---
type: memory
created: 2026-05-01
---

# MEMORY — Hard Constraints

> AI agent must obey these every session. Never expires.

## Project Identity
- **Name**: Corgi GitFlow
- **Purpose**: Turn AI coding assistants into structured engineering workflows with schema-driven planning, checkpoint-based implementation, and full issue tracking on GitLab or GitHub.
- **Stack**: Markdown skill definitions, JSON schema metadata, Node.js CLIs (`corgispec`, `ds-skills`), Corgi schemas/config, OpenCode, Claude Code, Codex, GitHub/GitLab CLI integrations

## Hard Constraints
- `.opencode/skills/`, `.claude/skills/`, and `.codex/skills/` must contain equivalent skill content.
- The `.opencode/skills/` version is canonical.
- Each skill directory must contain exactly `SKILL.md` and `skill.meta.json`.
- `skill.meta.json` must validate against `schemas/skill-meta.schema.json`.
- There is no application code to build or deploy; the product is the skills and metadata.

## Preferences
- Prefer `corgispec` over the legacy `ds-skills` CLI and `install-skills.sh` when possible.
- Keep markdown skill files tool-generic; platform-specific mapping happens at runtime.
- Follow the checkpoint-based workflow: propose -> apply -> review -> archive.
- Use manual validation via `corgispec validate` or `ds-skills validate` because there is no CI.
