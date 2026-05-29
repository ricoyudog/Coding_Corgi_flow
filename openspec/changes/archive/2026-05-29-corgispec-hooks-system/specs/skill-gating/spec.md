## ADDED Requirements

### Requirement: Step 1 explicit context gate
Every skill file SHALL include a deterministic conditional check at Step 1 that tests whether the session context already contains all required fields (isolation.mode, active changes with worktree paths, current branch). If all fields are present, the agent SHALL skip to Step 2 without performing manual discovery.

#### Scenario: Context pre-loaded by SessionStart hook
- **WHEN** session context contains all of: isolation mode value, active changes list with worktree paths, and current branch name
- **THEN** the agent skips config file reading and proceeds directly to Step 2

#### Scenario: Context not pre-loaded (no hooks)
- **WHEN** session context does not contain isolation mode, active changes, or branch information
- **THEN** the agent reads `openspec/config.yaml`, scans worktrees via CLI, and performs full discovery before proceeding

#### Scenario: Partial context present
- **WHEN** session context contains isolation mode but is missing active changes list
- **THEN** the agent enters fallback and performs full discovery

### Requirement: Gate text is platform-neutral
The gating text SHALL NOT reference specific hook names, platform names, or assume any particular hook mechanism. It SHALL use only platform-neutral language such as "If context already contains..."

#### Scenario: Gate text reviewed for platform neutrality
- **WHEN** a skill file's Step 1 gate text is checked
- **THEN** it contains no references to "SessionStart hook", "Claude Code", "OpenCode", "Codex", or any platform-specific mechanism name

### Requirement: Gate logic uses deterministic conditional
The gate SHALL be a deterministic conditional statement with explicit field names, not a hint or suggestion that relies on agent reasoning. The text SHALL use the form "If context already contains ALL of: <field list> → SKIP to Step 2."

#### Scenario: Gate uses explicit field list
- **WHEN** a skill file's Step 1 gate is examined
- **THEN** it lists exact field names: `isolation.mode`, active changes with worktree paths, and `current branch` — with an explicit "SKIP to Step 2" instruction on match

### Requirement: Stop constraints retain original text
All "STOP. Do not auto-continue." text in skill files SHALL NOT be modified to add "Hook-enforced" or "Guard-enforced" markers. The original text constraint SHALL remain unchanged.

#### Scenario: Stop constraint text unchanged
- **WHEN** a skill file containing "STOP. Do not auto-continue." is reviewed after gating is added
- **THEN** the STOP text is identical to the pre-change version with no additional enforcement markers

### Requirement: Three-directory sync maintained
When Step 1 gating text is added to any skill file, the same text SHALL be synchronized across all three skill directories (`.opencode/skills/`, `.claude/skills/`, `.codex/skills/`).

#### Scenario: Gating added to one skill
- **WHEN** gating text is added to `.opencode/skills/molecules/corgispec-apply/SKILL.md`
- **THEN** identical gating text exists in `.claude/skills/molecules/corgispec-apply/SKILL.md` and `.codex/skills/molecules/corgispec-apply/SKILL.md`
