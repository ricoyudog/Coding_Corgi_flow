## ADDED Requirements

### Requirement: Generate Claude Code hooks config
The `corgispec hooks generate --platform claude` command SHALL output a hooks configuration block compatible with `.claude/settings.json` that registers all six hook events (SessionStart, PreToolUse for Write, PreToolUse for Bash, PostToolUse for Write, Stop, PostCompact) pointing to `corgispec hook <subcommand>` commands.

#### Scenario: Generate for Claude Code with default output
- **WHEN** `corgispec hooks generate --platform claude` runs in a configured project
- **THEN** stdout contains a JSON object with a `hooks` key mapping each event to the corresponding `corgispec hook` subcommand, using the project-local corgispec binary path

#### Scenario: Generate with --output flag
- **WHEN** `corgispec hooks generate --platform claude --output .claude/settings.json` runs
- **THEN** the hooks configuration is written to the specified file, merging with existing settings without overwriting unrelated keys

#### Scenario: Claude Code settings.json already has hooks
- **WHEN** `.claude/settings.json` already contains a `hooks` key
- **THEN** the command prints a warning and exits non-zero unless `--force` flag is provided

### Requirement: Generate OpenCode hooks config
The `corgispec hooks generate --platform opencode` command SHALL output hooks configuration compatible with OpenCode's `opencode-cc-hooks` bridge or the deep plugin format.

#### Scenario: Generate lightweight bridge config
- **WHEN** `corgispec hooks generate --platform opencode` runs
- **THEN** stdout contains the same Claude Code format hooks config (OpenCode uses the same bridge format)

#### Scenario: Generate deep plugin format
- **WHEN** `corgispec hooks generate --platform opencode --deep` runs
- **THEN** stdout contains TypeScript plugin code for `.opencode/plugins/corgispec-deep.ts` that registers equivalent hooks natively

### Requirement: Generate Codex hooks config
The `corgispec hooks generate --platform codex` command SHALL output a Codex-compatible configuration: `.codex/config.toml` hook entries and Python wrapper scripts in `.codex/hooks/`.

#### Scenario: Generate for Codex with default output
- **WHEN** `corgispec hooks generate --platform codex` runs
- **THEN** stdout contains TOML config entries and Python script content for all six hook events, each Python script subprocess-calling `corgispec hook <subcommand>`

#### Scenario: Generate with --output flag for Codex
- **WHEN** `corgispec hooks generate --platform codex --output .codex` runs
- **THEN** `.codex/config.toml` is updated with hook entries and `.codex/hooks/*.py` scripts are created for each hook event

### Requirement: List available platforms
The `corgispec hooks generate` command without `--platform` SHALL list supported platforms and their config locations.

#### Scenario: Run without platform flag
- **WHEN** `corgispec hooks generate` runs without `--platform`
- **THEN** stdout lists `claude`, `opencode`, and `codex` with their config file locations and a help message to specify `--platform`

### Requirement: Detect hook configuration status
The `corgispec status` command SHALL report whether hooks are configured and which events are active.

#### Scenario: Hooks not configured
- **WHEN** `corgispec status` runs and no platform hooks config exists
- **THEN** output includes `Hooks: ❌ not configured → run corgispec hooks generate`

#### Scenario: Hooks configured
- **WHEN** `corgispec status` runs and a valid hooks config is detected for any platform
- **THEN** output includes `Hooks: ✅ configured (SessionStart, PreToolUse, PostToolUse, Stop, PostCompact)` listing the active events
