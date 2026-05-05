## ADDED Requirements

### Requirement: Canonical skill source in Claude Code directory
All 17 CorgiSpec Agent Skills SHALL reside as physical files in `.claude/skills/`, which serves as the single canonical source of truth for all platforms.

#### Scenario: Skills exist in canonical location
- **WHEN** any platform reads skills
- **THEN** the physical skill files (SKILL.md + skill.meta.json) exist in `.claude/skills/<skill-name>/`
- **THEN** `.claude/skills/` contains exactly 17 skill directories matching the skill inventory

#### Scenario: No platform reads skills from a copy
- **WHEN** skills are modified
- **THEN** the change is visible to all platforms immediately without running a sync tool
- **THEN** no stale copies exist in non-canonical directories

### Requirement: Codex skill directory symlinks to canonical source
The `.codex/skills/` directory SHALL be a symlink (or contain per-skill symlinks) pointing to `.claude/skills/`, eliminating physical copies that cause sync drift.

#### Scenario: .codex/skills symlinks resolve correctly
- **WHEN** Codex reads skills from `.codex/skills/<skill-name>/SKILL.md`
- **THEN** the resolved path is `.claude/skills/<skill-name>/SKILL.md`
- **THEN** the content read is identical to reading the canonical file directly

#### Scenario: Existing .codex/skills physical copies are migrated
- **WHEN** setup.sh is run on a repo with existing `.codex/skills/` physical copies
- **THEN** the existing physical copies are backed up or removed
- **THEN** symlinks are created in their place
- **THEN** no skill content is lost during migration

### Requirement: Codex agent skills path symlinks to canonical source
The `.agents/skills/` directory SHALL be a symlink (or contain per-skill symlinks) pointing to `.claude/skills/`, enabling skill discovery through Codex's newer agent skills path.

#### Scenario: .agents/skills symlinks resolve correctly
- **WHEN** Codex reads skills from `.agents/skills/<skill-name>/SKILL.md`
- **THEN** the resolved path is `.claude/skills/<skill-name>/SKILL.md`

#### Scenario: Both Codex paths point to same canonical source
- **WHEN** Codex reads a skill via either `.codex/skills/` or `.agents/skills/`
- **THEN** the same file content is returned regardless of the path used

### Requirement: Symlink direction respects Claude Code cache limitation
Symlinks SHALL point FROM Codex paths TO the Claude Code canonical source, never the reverse. The skill body MUST physically reside in `.claude/skills/`.

#### Scenario: Claude Code can cache plugin without losing skill content
- **WHEN** Claude Code runs `/plugin install` or its equivalent caching operation
- **THEN** the cached copy contains the full skill content
- **THEN** no skills are silently empty due to unresolved symlinks

#### Scenario: Reverse symlink direction is preventable
- **WHEN** setup.sh creates symlinks
- **THEN** the script enforces that symlink targets resolve to `.claude/skills/`
- **THEN** if the reverse direction is detected (Claude Code path pointing elsewhere), the script reports an error and does not proceed

### Requirement: Graceful degradation on Windows
On Windows systems where `mklink /D` is unavailable, the system SHALL provide a documented fallback path without blocking the setup entirely.

#### Scenario: setup.sh reports Windows limitation
- **WHEN** setup.sh runs on Windows without symlink support
- **THEN** the script detects the limitation and prints a clear message
- **THEN** the script advises enabling Developer Mode or using a manual copy alternative
- **THEN** the script does not exit with an error for non-symlink platforms

### Requirement: install-skills.sh supports Codex symlinks
The existing `install-skills.sh` SHALL be extended to optionally create Codex symlinks during its user-level installation flow, alongside the existing OpenCode and Claude Code copying.

#### Scenario: install-skills.sh creates Codex symlinks when requested
- **WHEN** install-skills.sh runs with Codex support enabled
- **THEN** symlinks are created from User Codex skill paths to the canonical `.claude/skills/`
- **THEN** the existing OpenCode and Claude Code installation behavior is unchanged

#### Scenario: install-skills.sh skips symlinks when Codex support is disabled
- **WHEN** install-skills.sh runs without Codex support (default or flag-disabled)
- **THEN** only OpenCode and Claude Code skills are installed
- **THEN** no Codex paths are created or modified
