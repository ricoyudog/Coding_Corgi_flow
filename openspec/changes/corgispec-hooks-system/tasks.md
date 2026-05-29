<!-- Task Groups (## headings) are checkpoint units. Each group becomes a child GitLab issue. Apply executes one group at a time. -->

## 1. Hook CLI Foundation

- [x] 1.1 Create `packages/corgispec/src/lib/hooks.ts` with shared utilities: config reader, context formatter, active changes scanner, worktree path resolver, `CORGISPEC_HOOKS_DISABLE` check
- [x] 1.2 Create `packages/corgispec/src/commands/hooks/session-start.ts` — reads config + changes, emits `hookSpecificOutput` JSON to stdout
- [x] 1.3 Create `packages/corgispec/src/commands/hooks/post-compact.ts` — reuses session-start context formatting, emits identical JSON structure
- [x] 1.4 Create `packages/corgispec/src/commands/hooks/pre-write.ts` — reads stdin JSON, validates file_path against isolation mode and worktree paths, exits 0/2
- [x] 1.5 Create `packages/corgispec/src/commands/hooks/pre-bash.ts` — reads stdin JSON, matches command against dangerous patterns list (rm -rf /, force push to main), exits 0/2
- [x] 1.6 Create `packages/corgispec/src/commands/hooks/post-write.ts` — reads stdin JSON, triggers `corgispec validate` async when file is in a change directory, always exits 0
- [x] 1.7 Create `packages/corgispec/src/commands/hooks/stop-check.ts` — reads stdin JSON, checks current group task completion and artifact existence, exits 0/2
- [x] 1.8 Register all hook subcommands in `packages/corgispec/src/bin/corgispec.ts` under `corgispec hook <name>` subcommand group

## 2. Hook Config Generation

- [x] 2.1 Create `packages/corgispec/src/commands/hooks/generate.ts` — `corgispec hooks generate [--platform <name>] [--output <path>] [--force] [--deep]`
- [x] 2.2 Implement Claude Code config generation: output hooks key for `.claude/settings.json` mapping each event to `corgispec hook <name>`
- [x] 2.3 Implement OpenCode config generation: default outputs Claude Code format (bridge-compatible); `--deep` flag outputs TypeScript plugin code for `.opencode/plugins/corgispec-deep.ts`
- [x] 2.4 Implement Codex config generation: output `.codex/config.toml` entries + `.codex/hooks/*.py` wrapper scripts (each ~10 lines, subprocess-calling corgispec)
- [x] 2.5 Implement platform listing: `corgispec hooks generate` without `--platform` shows supported platforms and config locations
- [x] 2.6 Implement binary path resolution: `which corgispec` at generate time, fallback to `npx corgispec`

## 3. Status & Install Integration

- [x] 3.1 Update `packages/corgispec/src/commands/status.ts` to detect and report hook configuration status (configured/not configured + active events list)
- [x] 3.2 Update `packages/corgispec/src/commands/install.ts` to append hooks tip message: `💡 Tip: Run corgispec hooks generate to enable auto context injection & security guards.`
- [x] 3.3 Add `hooks` field to `corgispec doctor` output showing hook config presence and platform detection

## 4. Skill Step 1 Gating

- [x] 4.1 Define canonical gate text block (3 lines, platform-neutral, deterministic field list) in a reference document
- [x] 4.2 Add Step 1 gate to `.opencode/skills/molecules/corgispec-apply/SKILL.md` — insert before existing config-reading step
- [x] 4.3 Add Step 1 gate to `.opencode/skills/molecules/corgispec-archive/SKILL.md`
- [x] 4.4 Add Step 1 gate to `.opencode/skills/molecules/corgispec-verify/SKILL.md`
- [x] 4.5 Add Step 1 gate to `.opencode/skills/molecules/corgispec-review/SKILL.md`
- [x] 4.6 Add Step 1 gate to `.opencode/skills/molecules/corgispec-propose/SKILL.md`
- [x] 4.7 Add Step 1 gate to `.opencode/skills/molecules/corgispec-explore/SKILL.md`
- [x] 4.8 Add Step 1 gate to `.opencode/skills/molecules/corgispec-ask/SKILL.md`
- [x] 4.9 Add Step 1 gate to `.opencode/skills/molecules/corgispec-lint/SKILL.md`
- [x] 4.10 Add Step 1 gate to `.opencode/skills/molecules/corgispec-install/SKILL.md`
- [x] 4.11 Add Step 1 gate to `.opencode/skills/molecules/corgispec-memory-migrate/SKILL.md`
- [x] 4.12 Add Step 1 gate to `.opencode/skills/source-command-corgi-apply/SKILL.md` (project-level command wrapper)
- [x] 4.13 Sync all gated skill files to `.claude/skills/` and `.codex/skills/` (three-directory sync)

## 5. Tests

- [x] 5.1 Create `packages/corgispec/test/hooks/session-start.test.ts` — covers: project with worktree, project with no isolation, no config, hooks disabled
- [x] 5.2 Create `packages/corgispec/test/hooks/pre-write.test.ts` — covers: write to worktree allowed, write to main blocked, isolation none allowed, hooks disabled
- [x] 5.3 Create `packages/corgispec/test/hooks/pre-bash.test.ts` — covers: dangerous commands blocked, safe commands allowed, hooks disabled
- [x] 5.4 Create `packages/corgispec/test/hooks/post-write.test.ts` — covers: triggers validation on change file, skips on unrelated file
- [x] 5.5 Create `packages/corgispec/test/hooks/stop-check.test.ts` — covers: all tasks complete, incomplete tasks blocked, no active change passes
- [x] 5.6 Create `packages/corgispec/test/hooks/post-compact.test.ts` — covers: context matches session-start format
- [x] 5.7 Create `packages/corgispec/test/hooks/generate.test.ts` — covers: Claude Code format, OpenCode format, Codex format, platform listing, existing config warning
- [x] 5.8 Add `corgispec validate` gate check: verify all skill files with Step 1 contain the canonical gate text pattern
