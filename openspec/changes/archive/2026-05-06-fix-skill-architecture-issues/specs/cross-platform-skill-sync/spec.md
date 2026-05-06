## MODIFIED Requirements

### Requirement: Canonical skill source in Claude Code directory
All 17 CorgiSpec Agent Skills SHALL reside as physical files in `.claude/skills/`, which serves as the single canonical source of truth for all platforms. Skills SHALL be organized in tier-based subdirectories (`atoms/`, `molecules/`).

#### Scenario: Skills exist in canonical location with tier structure
- **WHEN** any platform reads skills
- **THEN** the physical skill files (SKILL.md + skill.meta.json) exist in `.claude/skills/<tier>/<skill-name>/`
- **THEN** `.claude/skills/` contains exactly 2 atom directories and 15 molecule directories matching the skill inventory

#### Scenario: No platform reads skills from a copy
- **WHEN** skills are modified
- **THEN** the change is visible to all platforms immediately without running a sync tool
- **THEN** no stale copies exist in non-canonical directories

### Requirement: Codex skill directory symlinks to canonical source
The `.codex/skills/` directory SHALL contain per-skill symlinks pointing to `.claude/skills/<tier>/<skill-name>/`, preserving the tier-based directory layout.

#### Scenario: .codex/skills symlinks resolve correctly with tier paths
- **WHEN** Codex reads skills from `.codex/skills/<tier>/<skill-name>/SKILL.md`
- **THEN** the resolved path is `.claude/skills/<tier>/<skill-name>/SKILL.md`
- **THEN** the content read is identical to reading the canonical file directly
