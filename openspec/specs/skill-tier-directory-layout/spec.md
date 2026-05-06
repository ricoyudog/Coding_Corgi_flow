## ADDED Requirements

### Requirement: Tier-based directory structure
Skill directories SHALL be organized into tier-based subdirectories (`atoms/`, `molecules/`, `compounds/`) under each platform's skills root, matching the `tier` field declared in each skill's `skill.meta.json`.

#### Scenario: Atoms reside in atoms/ subdirectory
- **WHEN** a skill has `"tier": "atom"` in its skill.meta.json
- **THEN** the skill directory is located at `<skills-root>/atoms/<skill-name>/`
- **THEN** this applies to all platform directories (`.opencode/skills/`, `.claude/skills/`, `.codex/skills/`, `packages/corgispec/assets/skills/`)

#### Scenario: Molecules reside in molecules/ subdirectory
- **WHEN** a skill has `"tier": "molecule"` in its skill.meta.json
- **THEN** the skill directory is located at `<skills-root>/molecules/<skill-name>/`

#### Scenario: Compounds reside in compounds/ subdirectory
- **WHEN** a skill has `"tier": "compound"` in its skill.meta.json
- **THEN** the skill directory is located at `<skills-root>/compounds/<skill-name>/`

### Requirement: base_path includes tier prefix
The `base_path` field in `skill.meta.json` SHALL include the tier subdirectory prefix, reflecting the actual filesystem location relative to the skills root.

#### Scenario: Atom base_path has atoms/ prefix
- **WHEN** `corgispec-memory-init` (atom) has its base_path read
- **THEN** the value is `"atoms/corgispec-memory-init"`

#### Scenario: Molecule base_path has molecules/ prefix
- **WHEN** `corgispec-propose` (molecule) has its base_path read
- **THEN** the value is `"molecules/corgispec-propose"`

### Requirement: Codex symlinks reflect tier structure
The `.codex/skills/` symlinks SHALL point to the tier-prefixed paths in `.claude/skills/`, maintaining the same tier-based directory layout.

#### Scenario: Codex symlinks resolve through tier subdirectories
- **WHEN** Codex reads `atoms/corgispec-memory-init/SKILL.md` via `.codex/skills/`
- **THEN** the resolved path is `.claude/skills/atoms/corgispec-memory-init/SKILL.md`

### Requirement: ds-skills loader discovers skills via tier directories
The `discoverSkills()` function SHALL discover skills by scanning tier subdirectories first, falling back to flat root only when tier directories do not exist.

#### Scenario: Loader finds skills in tier directories
- **WHEN** `discoverSkills()` scans a skills root with `atoms/` and `molecules/` subdirectories
- **THEN** all skills in those subdirectories are discovered
- **THEN** the skill's resolved path matches its `base_path`

### Requirement: Blueprint spec reconciliation
The composable skill hierarchy design spec (`2026-04-27-composable-skill-hierarchy-design.md`) SHALL be updated to reflect the implemented format, removing the never-implemented `type: capability | composite | playbook` field from its SKILL.md frontmatter example.

#### Scenario: Blueprint spec matches implementation
- **WHEN** the design spec's SKILL.md example is read
- **THEN** the frontmatter fields shown are `name`, `description`, `license`, `compatibility`, `metadata`
- **THEN** no `type` field appears in the example
- **THEN** a note explains that tier information is conveyed via `skill.meta.json`'s `tier` field
