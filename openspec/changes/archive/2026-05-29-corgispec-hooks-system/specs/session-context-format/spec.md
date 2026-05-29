## ADDED Requirements

### Requirement: Standardized context JSON format
The `corgispec hook session-start` command SHALL emit a JSON object with a `hookSpecificOutput` top-level key containing `hookEventName: "SessionStart"` and `additionalContext: string`. The `additionalContext` string SHALL be a Markdown-formatted block with structured key-value pairs.

#### Scenario: Context output structure
- **WHEN** `corgispec hook session-start` runs successfully
- **THEN** stdout is valid JSON with `hookSpecificOutput.hookEventName` equal to `"SessionStart"` and `hookSpecificOutput.additionalContext` containing a Markdown string with sections for Schema, Isolation mode, Active changes, Current branch, Worktree path, and Hooks active

### Requirement: Context fields match gate check fields
The keys in the `additionalContext` Markdown block SHALL correspond one-to-one with the field names used in skill Step 1 gate conditions, ensuring deterministic matching.

#### Scenario: Field name correspondence
- **WHEN** `additionalContext` contains `**Isolation mode**: worktree`
- **THEN** the skill gate checks for a field named `isolation.mode` or `isolation mode` and matches the value `worktree`

### Requirement: Context includes schema name
The `additionalContext` SHALL include a `**Schema**:` line with the schema name from `openspec/config.yaml`.

#### Scenario: Schema in context
- **WHEN** config has `schema: gitlab-tracked`
- **THEN** `additionalContext` includes `**Schema**: gitlab-tracked`

### Requirement: Context includes active changes with status
The `additionalContext` SHALL include an `**Active changes**:` section listing each active change with its worktree path and current group status.

#### Scenario: One active change in progress
- **WHEN** there is one active change `feat-foo` at `.worktrees/feat-foo` with Group 2 in-progress
- **THEN** `additionalContext` includes `  - feat-foo → .worktrees/feat-foo (Group 2 in-progress)`

#### Scenario: No active changes
- **WHEN** there are no active change directories
- **THEN** `additionalContext` includes `**Active changes**: (none)`

### Requirement: Context is platform-agnostic
The JSON structure and `additionalContext` format SHALL be identical across all platforms (Claude Code, OpenCode, Codex). Platform adapters SHALL transform the transport format but not the content.

#### Scenario: Same context on different platforms
- **WHEN** `corgispec hook session-start` runs on Claude Code and OpenCode in the same project
- **THEN** the `additionalContext` string content is identical; only the outer JSON wrapper structure may differ per platform convention

### Requirement: Context restored after compaction
The `corgispec hook post-compact` command SHALL emit the identical context format as `session-start`, ensuring context continuity after agent context compaction events.

#### Scenario: Post-compact context matches session-start
- **WHEN** `corgispec hook post-compact` runs after `corgispec hook session-start`
- **THEN** both commands' `additionalContext` output contains the same field set and values (reflecting current state at time of call)
