## Why

CorgiSpec skills contain ~540 lines of repeated configuration-reading and safety-check text across ~11 skill files. Every session, agents waste 20-40 seconds manually discovering project context (isolation mode, active changes, branch, worktree paths). Worse, safety constraints ("NEVER work in main checkout", "STOP. Do not auto-continue") rely solely on text instructions that agents can ignore. Platform hooks (SessionStart, PreToolUse, Stop, PostCompact) can automate context injection, enforce write guards, and block auto-continue — but only if we build the bridge. The decision has been made: hooks augment skills, not replace them. Skill files retain all steps as fallback; hooks provide deterministic acceleration and enforcement where available.

## What Changes

- **New `corgispec hook` CLI subcommands**: `session-start`, `pre-write`, `pre-bash`, `post-write`, `stop-check`, `post-compact`, and a top-level `hooks generate` command for platform config output
- **Platform-specific hook configuration generation**: `corgispec hooks generate --platform <claude|opencode|codex>` writes the appropriate config files (`.claude/settings.json` hooks key, `.codex/config.toml` + Python scripts, etc.)
- **Skill Step 1 explicit gating**: All ~11 skill files get a deterministic conditional check at Step 1 — "If context already contains isolation.mode + active changes + branch → SKIP to Step 2" — no agent reasoning required
- **SessionStart context format contract**: A standardized JSON structure emitted by `corgispec hook session-start` that all platforms consume identically
- **Emergency bypass**: `CORGISPEC_HOOKS_DISABLE=1` environment variable disables all hooks

## Capabilities

### New Capabilities

- `hook-cli`: Hook CLI subcommands (session-start, pre-write, pre-bash, post-write, stop-check, post-compact) that read project state from `openspec/config.yaml` and active change directories, emitting standardized JSON or exit codes
- `hooks-generate`: Platform config generation command that outputs hook configuration files for Claude Code (settings.json), OpenCode (opencode-cc-hooks bridge), and Codex (config.toml + Python scripts)
- `skill-gating`: Explicit Step 1 conditional gate added to all skill files — deterministic context check that skips manual discovery when hook-injected context is present, falls back to CLI-based discovery otherwise
- `session-context-format`: Standardized SessionStart context JSON contract and the context-injection pipeline that bridges hook output to agent-visible context

### Modified Capabilities

_(No existing spec-level behavior changes. All modifications are additive gating logic.)_

## Impact

- **`packages/corgispec/src/commands/`**: New `hooks/` directory with 7 TypeScript command files + `generate.ts`
- **`packages/corgispec/src/lib/`**: New `hooks.ts` library for config parsing, context formatting, and platform detection
- **`packages/corgispec/test/hooks/`**: Unit tests for each hook subcommand
- **`.opencode/skills/`**, **`.claude/skills/`**, **`.codex/skills/`**: All ~11 skill files get ~3 lines added at Step 1 (three-directory sync)
- **`.claude/settings.json`**: Template for hooks key (generated, not committed)
- **`.codex/`**: New `config.toml` template and `hooks/*.py` scripts (generated, not committed)
- **`corgispec install` output**: Tip message about `corgispec hooks generate`
- **`corgispec status`**: New hooks configuration status line
- **Dependencies**: No new npm dependencies; hooks run as subprocesses of the existing corgispec CLI

## GitLab Issue

<!-- This section will be filled automatically by the propose skill with the parent issue link. -->
