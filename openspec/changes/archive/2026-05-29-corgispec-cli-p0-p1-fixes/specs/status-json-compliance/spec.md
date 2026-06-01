## ADDED Requirements

### Requirement: status --json output MUST include applyRequires field
The `status --json` command output SHALL include an `applyRequires` field containing the list of artifact IDs that must be completed before `apply` can proceed. This field is part of the documented output contract.

#### Scenario: status --json includes applyRequires
- **WHEN** the user runs `corgispec status --change <name> --json`
- **THEN** the JSON output SHALL contain an `applyRequires` field
- **AND** the field SHALL be an array of artifact ID strings (e.g., `["tasks"]`)

#### Scenario: applyRequires reflects schema definition
- **WHEN** the active schema defines `apply.requires: ["tasks"]`
- **THEN** `status --json` output's `applyRequires` field SHALL contain `["tasks"]`

#### Scenario: applyRequires is empty when no artifacts are required
- **WHEN** the active schema defines no apply requirements
- **THEN** `status --json` output's `applyRequires` field SHALL be an empty array `[]`
