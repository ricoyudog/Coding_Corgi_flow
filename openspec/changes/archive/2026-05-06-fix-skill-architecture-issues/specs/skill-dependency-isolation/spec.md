## ADDED Requirements

### Requirement: Self-contained skill references
Each skill's `references/` directory SHALL contain all reference documents that the skill's SKILL.md instructs the agent to read. No SKILL.md SHALL reference a file located in another skill's directory.

#### Scenario: Verify skill reads worktree-discovery locally
- **WHEN** corgispec-verify instructs the agent to read worktree-discovery.md
- **THEN** the file exists at `corgispec-verify/references/worktree-discovery.md`
- **THEN** the agent does NOT need to navigate to another skill's directory

#### Scenario: No cross-skill file references exist
- **WHEN** any SKILL.md contains a "Read references/" instruction
- **THEN** the referenced file exists within that same skill's own `references/` subdirectory
- **THEN** no instruction text contains phrases like "from the X skill" or "from another skill"

### Requirement: Declared dependencies match actual references
If a skill reads files from another skill (even as a shared reference), the dependency SHALL be declared in `skill.meta.json`'s `depends_on` array. Alternatively, the referenced file SHALL be copied into the consuming skill's own `references/` directory to eliminate the dependency entirely.

#### Scenario: skill.meta.json reflects all runtime file dependencies
- **WHEN** `ds-skills validate` runs
- **THEN** every cross-skill file reference found in SKILL.md text has a corresponding entry in `depends_on`
- **THEN** OR the reference has been internalized into the skill's own `references/` directory

#### Scenario: Molecule-to-molecule implicit dependency is eliminated
- **WHEN** corgispec-verify (molecule) previously referenced corgispec-review (molecule) file
- **THEN** the reference is replaced by a local copy in corgispec-verify's own references/
- **THEN** corgispec-verify's `depends_on` remains empty (no molecule-to-molecule dependency)

### Requirement: worktree-discovery consumer list accuracy
The `worktree-discovery.md` file SHALL accurately list all skills that consume its content, either as separate copies or as the canonical source.

#### Scenario: Consumer list reflects actual usage
- **WHEN** worktree-discovery.md lists its consumers
- **THEN** every skill that has a copy of this file is listed
- **THEN** corgispec-verify is included in the consumer list
