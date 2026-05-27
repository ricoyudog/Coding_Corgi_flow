## ADDED Requirements

### Requirement: session-start subcommand
The `corgispec hook session-start` command SHALL read project state from `openspec/config.yaml` and active change directories, then emit a standardized JSON context blob to stdout with exit code 0. If the project has no config or hooks are disabled via `CORGISPEC_HOOKS_DISABLE=1`, it SHALL exit non-zero and produce no output.

#### Scenario: Project with worktree isolation and active changes
- **WHEN** `corgispec hook session-start` runs in a project with `isolation.mode: worktree` and one active change at `.worktrees/feat-foo`
- **THEN** stdout contains JSON with `hookSpecificOutput.additionalContext` including schema name, isolation mode, active change names with worktree paths, and current branch name; exit code is 0

#### Scenario: Project with no isolation and no active changes
- **WHEN** `corgispec hook session-start` runs in a project with `isolation.mode: none` and zero active changes
- **THEN** stdout contains JSON with `hookSpecificOutput.additionalContext` including schema name, isolation mode `none`, empty active changes list, and current branch name; exit code is 0

#### Scenario: Hooks disabled by environment variable
- **WHEN** `CORGISPEC_HOOKS_DISABLE=1` is set and `corgispec hook session-start` runs
- **THEN** the command exits with non-zero code and produces no stdout output

#### Scenario: Project has no openspec config
- **WHEN** `corgispec hook session-start` runs in a directory without `openspec/config.yaml`
- **THEN** the command exits with non-zero code and produces no stdout output

### Requirement: pre-write subcommand
The `corgispec hook pre-write` command SHALL read a JSON object from stdin containing `tool_input.file_path`, validate that the write target is legal (not inside main checkout when isolation is active, not a protected path), and exit 0 to allow or exit 2 to block.

#### Scenario: Write to worktree path when isolation is worktree
- **WHEN** isolation mode is `worktree`, current worktree is `.worktrees/feat-foo`, and `file_path` is `.worktrees/feat-foo/src/new.ts`
- **THEN** command exits 0 and stdout contains `{ "continue": true }`

#### Scenario: Write to main checkout when isolation is worktree
- **WHEN** isolation mode is `worktree` and `file_path` is `src/existing.ts` (outside the worktree)
- **THEN** command exits 2 and stderr contains a descriptive rejection message

#### Scenario: Write when isolation is none
- **WHEN** isolation mode is `none` and `file_path` is `src/new.ts`
- **THEN** command exits 0 and stdout contains `{ "continue": true }`

#### Scenario: Hooks disabled
- **WHEN** `CORGISPEC_HOOKS_DISABLE=1` is set
- **THEN** command exits 0 regardless of file_path

### Requirement: pre-bash subcommand
The `corgispec hook pre-bash` command SHALL read a JSON object from stdin containing `tool_input.command`, detect dangerous bash commands (e.g., `rm -rf /`, force push to main), and exit 2 to block or exit 0 to allow.

#### Scenario: Dangerous rm -rf command
- **WHEN** stdin contains `{ "tool_input": { "command": "rm -rf /" } }`
- **THEN** command exits 2 and stderr contains a rejection message

#### Scenario: Normal git commit command
- **WHEN** stdin contains `{ "tool_input": { "command": "git commit -m 'feat: add hooks'" } }`
- **THEN** command exits 0 and stdout contains `{ "continue": true }`

#### Scenario: Force push to main branch
- **WHEN** stdin contains `{ "tool_input": { "command": "git push --force origin main" } }`
- **THEN** command exits 2 and stderr contains a rejection message about force-pushing to main

#### Scenario: Hooks disabled
- **WHEN** `CORGISPEC_HOOKS_DISABLE=1` is set
- **THEN** command exits 0 regardless of command content

### Requirement: post-write subcommand
The `corgispec hook post-write` command SHALL read a JSON object from stdin containing `tool_input.file_path` and run validation asynchronously. It SHALL always exit 0 (non-blocking).

#### Scenario: After write to a managed file
- **WHEN** a file within the change directory is written
- **THEN** command triggers `corgispec validate` asynchronously and exits 0 immediately

#### Scenario: After write to an unrelated file
- **WHEN** a file outside any change directory is written
- **THEN** command exits 0 without triggering validation

### Requirement: stop-check subcommand
The `corgispec hook stop-check` command SHALL read a JSON object from stdin containing `stop_reason`, verify that Task Group postconditions are met, and exit 0 if passed or exit 2 to block (advisory on Codex). It SHALL check: all task checkboxes in the current group are marked complete, no `lsp_diagnostics` errors on changed files, and change artifacts exist.

#### Scenario: All postconditions met
- **WHEN** all tasks in the current group are checked, no diagnostic errors exist, and change artifacts are present
- **THEN** command exits 0

#### Scenario: Incomplete tasks in current group
- **WHEN** the current group has unchecked task items
- **THEN** command exits 2 and stderr lists the incomplete tasks

#### Scenario: No active change
- **WHEN** there is no active change in the current directory
- **THEN** command exits 0 (no postconditions to check)

#### Scenario: Hooks disabled
- **WHEN** `CORGISPEC_HOOKS_DISABLE=1` is set
- **THEN** command exits 0 regardless of postcondition state

### Requirement: post-compact subcommand
The `corgispec hook post-compact` command SHALL re-emit the session context JSON (same format as session-start) to restore context lost during compaction. It SHALL exit 0.

#### Scenario: After compaction event
- **WHEN** a compaction event occurs and `corgispec hook post-compact` runs
- **THEN** stdout contains the same `hookSpecificOutput.additionalContext` structure as session-start with current project state; exit code is 0

#### Scenario: Hooks disabled
- **WHEN** `CORGISPEC_HOOKS_DISABLE=1` is set
- **THEN** command exits with non-zero code and produces no output
