## MODIFIED Requirements

### Requirement: Package assets include complete skill set
The `packages/corgispec/assets/skills/` directory SHALL contain all 17 CorgiSpec skills, matching the canonical count in `.claude/skills/` and `.opencode/skills/`. No skill SHALL be omitted from the package.

#### Scenario: corgispec-verify is present in package assets
- **WHEN** the package assets skills directory is listed
- **THEN** `corgispec-verify/` exists with both `SKILL.md` and `skill.meta.json`
- **THEN** the total skill count matches 17

#### Scenario: Package skill count matches canonical directories
- **WHEN** `packages/corgispec/assets/skills/` is compared to `.claude/skills/`
- **THEN** both directories contain the same set of skill names
- **THEN** no skill is present in canonical but missing from package

#### Scenario: Package skills use tier-based layout
- **WHEN** package assets are inspected after restructuring
- **THEN** skills are organized in `atoms/` and `molecules/` subdirectories
- **THEN** the structure mirrors the canonical `.claude/skills/` layout
