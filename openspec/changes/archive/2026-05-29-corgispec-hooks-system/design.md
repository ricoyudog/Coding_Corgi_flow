## Context

CorgiSpec is a workflow toolkit shipping as an npm CLI (`corgispec`) and AI skills across three platforms: Claude Code, OpenCode, and Codex. Each platform supports hooks/events that run before or after agent actions. The current state has zero hook integration — every session starts from scratch, with agents manually reading `openspec/config.yaml`, scanning worktrees, and relying solely on text instructions for safety constraints.

The decision document (`wiki/decisions/2026-05-26/hooks-augment-not-replace-skills.md`) establishes the core principle: **hooks augment skills, not replace them**. Skill files retain all fallback steps; hooks provide acceleration and enforcement as a layer on top.

The existing corgispec CLI (`packages/corgispec/src/commands/`) already handles config parsing (`lib/config.ts`), change management (`lib/changes.ts`), and platform detection (`lib/platform.ts`). Hook subcommands extend this existing infrastructure.

## Goals / Non-Goals

**Goals:**
- Implement 6 hook CLI subcommands that agents and platforms can call as subprocesses
- Implement `corgispec hooks generate` for 3 platforms (Claude Code, OpenCode, Codex)
- Add deterministic Step 1 gating to all ~11 skill files with three-directory sync
- Define a standardized session context JSON format consumed by all platforms
- Provide `CORGISPEC_HOOKS_DISABLE=1` emergency bypass
- Update `corgispec status` to report hook configuration state
- Update `corgispec install` to show hooks tip

**Non-Goals:**
- Removing any existing text-based safety constraints from skill files
- Auto-installing hooks during `corgispec install` (hooks require explicit `corgispec hooks generate`)
- Building a platform-specific plugin (hooks run as corgispec CLI subprocesses, no new runtimes)
- Modifying the OpenSpec core engine (all changes are in the corgispec CLI layer and skill text)
- Phase 4 "Skill file simplification" (deferred per decision document)

## Unknowns & Investigation

1. **Codex Stop hook blocking capability**: Codex docs indicate Stop event doesn't support exit code 2 blocking. Confirmed in decision document — Codex Stop hooks are advisory only. Conclusion: `stop-check` subcommand still exits 2 on failure for consistency, but Codex ignores the block. No code change needed.

2. **OpenCode hook transport format**: OpenCode's `opencode-cc-hooks` bridge reuses Claude Code's settings.json format. Deep plugin mode uses TypeScript. Conclusion: `hooks generate --platform opencode` defaults to Claude Code format; `--deep` flag generates TypeScript plugin code.

3. **Corgispec binary path resolution in generated configs**: Hook configs need the absolute path to the `corgispec` binary. Investigated: `which corgispec` at generate time, or `npx corgispec` as fallback. Conclusion: use `which corgispec` at generate time and embed the resolved path; fall back to `npx corgispec` if not found globally.

4. **Skill file count requiring gating**: Checked `.opencode/skills/` — there are ~11 molecule-level skill files that have Step 1 config-reading logic. Atoms don't need gating (they're leaf operations without discovery steps). Conclusion: gate only molecule and compound skills.

## Decisions

### 1. Hook subcommands as separate CLI entry points

**Decision:** Each hook event (session-start, pre-write, etc.) is a separate subcommand under `corgispec hook <name>`, not a single command with event flag.

**Rationale:** Platform hook configs need one command per event. A single command with `--event` flag would require wrapper scripts anyway. Separate subcommands are simpler, testable independently, and map 1:1 to platform hook configs.

**Alternatives:** Single `corgispec hook --event session-start` — rejected because it complicates platform config generation and testing.

### 2. Stdin/stdout protocol for PreToolUse hooks

**Decision:** PreToolUse hooks (pre-write, pre-bash) read JSON from stdin and exit 0/2. No stdout required on block (just stderr message).

**Rationale:** Claude Code and Codex both pass tool input as JSON on stdin. Exit code 2 = block is the standard convention. Stderr for human-readable rejection message.

**Alternatives:** Writing a response file — rejected as unnecessary IPC overhead.

### 3. Deterministic gate text format

**Decision:** Skill Step 1 gate uses the exact pattern: `If session context already contains ALL of: isolation.mode, active changes with worktree paths, current branch → Gate passed. SKIP to Step 2. Otherwise, read openspec/config.yaml and proceed with discovery.`

**Rationale:** This is a conditional branch, not a suggestion. The explicit field list makes it deterministic across all models. The "Otherwise" fallback ensures no-path-left-behind.

**Alternatives:** "Context should be pre-loaded..." — rejected as non-deterministic (relies on agent reasoning).

### 4. Codex Python wrapper scripts

**Decision:** `hooks generate --platform codex` generates thin Python wrappers in `.codex/hooks/` that subprocess-call `corgispec hook <name>`.

**Rationale:** Codex hooks require Python scripts, not shell commands. The wrappers are ~10 lines each and delegate all logic to the corgispec CLI.

**Alternatives:** Reimplementing hook logic in Python — rejected as DRY violation and maintenance burden.

### 5. No Stop-related "Hook-enforced" markers in skill text

**Decision:** STOP constraints in skill files retain original text. No "Hook-enforced" or "Guard-enforced" prefix on Stop-related instructions.

**Rationale:** Codex Stop hook doesn't support blocking (exit code 2 is ignored). Adding "Hook-enforced" would create a false sense of platform enforcement on Codex, weakening the text-only constraint that is Codex's only mechanism.

**Alternatives:** Mark all constraints as "Guard-enforced" — rejected per decision document's explicit prohibition.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Skill file drift across 3 directories when adding gates | `corgispec validate` checks gate consistency; three-directory sync enforced per convention |
| Hook binary path breaks after npm update | `hooks generate` resolves path at generation time; re-run after corgispec updates |
| Codex Stop hook advisory-only weakens enforcement | Original text constraint retained as primary mechanism; hook provides parallel enforcement on CC/OC |
| ~60 extra tokens per skill file from gate text | Acceptable: gate is 3 lines, agent evaluates condition in one inference step |
| Generated Python wrappers for Codex become stale | Wrappers are ~10 lines each, subprocess-call only; no logic to drift |
| 26+ files need sync on config.yaml structure change | `corgispec lint` validates consistency; changes are infrequent |

## Data Model

Not applicable — no data model or persistence changes in this change. All state is read from filesystem (`openspec/config.yaml`, change directories, worktrees).

## API Contracts

### Hook CLI Subcommand Contracts

| Subcommand | stdin | stdout | Exit codes |
|---|---|---|---|
| `session-start` | none | `{ hookSpecificOutput: { additionalContext: "..." } }` | 0 = success; non-zero = skip silently |
| `pre-write` | `{ tool_name, tool_input: { file_path } }` | `{ continue: true }` on allow | 0 = allow; 2 = block |
| `pre-bash` | `{ tool_name, tool_input: { command } }` | `{ continue: true }` on allow | 0 = allow; 2 = block |
| `post-write` | `{ tool_name, tool_input: { file_path } }` | none (async) | 0 = done |
| `stop-check` | `{ stop_reason }` | `{ decision: "block" }` on block | 0 = pass; 2 = block |
| `post-compact` | `{ compact_trigger }` | `{ hookSpecificOutput: { additionalContext: "..." } }` | 0 = success; non-zero = skip |
| `generate` | `--platform <name> [--output <path>] [--force]` | Platform config to stdout or file | 0 = success; non-zero = error |

### Session Context JSON Contract

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "## CorgiSpec Project Context\n- **Schema**: <schema-name>\n- **Isolation mode**: <none|worktree>\n- **Active changes**:\n  - <change-name> → <worktree-path> (<group-status>)\n- **Current branch**: <branch-name>\n- **Worktree path**: <path-or-N/A>\n- **Hooks active**: SessionStart, PreToolUse, PostToolUse, Stop, PostCompact"
  }
}
```

Not applicable — no HTTP API surface changes. All contracts are CLI subprocess protocols.
