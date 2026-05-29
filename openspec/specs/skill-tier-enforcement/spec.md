## ADDED Requirements

### Requirement: Molecule skills MUST only depend on atom-tier skills
The skill dependency resolver SHALL enforce that molecule-tier skills can only declare dependencies on atom-tier skills. Any molecule declaring a dependency on another molecule or compound SHALL be rejected with an explicit validation error.

#### Scenario: Valid molecule with atom dependencies
- **WHEN** a molecule-tier skill declares dependencies on atom-tier skills only
- **THEN** the dependency resolver SHALL accept the skill as valid

#### Scenario: Invalid molecule with molecule dependency
- **WHEN** a molecule-tier skill declares a dependency on another molecule-tier skill
- **THEN** the dependency resolver SHALL reject the skill
- **AND** SHALL report an error message identifying the invalid cross-tier dependency

#### Scenario: Invalid molecule with compound dependency
- **WHEN** a molecule-tier skill declares a dependency on a compound-tier skill
- **THEN** the dependency resolver SHALL reject the skill
- **AND** SHALL report an error message identifying the invalid upward dependency

#### Scenario: Atom skills have no tier constraint on dependencies
- **WHEN** an atom-tier skill is validated
- **THEN** the resolver SHALL verify it has zero dependencies (atoms depend on nothing)
- **AND** SHALL reject any atom that declares dependencies
