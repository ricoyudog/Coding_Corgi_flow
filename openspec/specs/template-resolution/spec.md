## ADDED Requirements

### Requirement: Template variables MUST be resolved at generation time
The `instructions` command SHALL resolve all template variables (e.g., `{{changeName}}`, `{{outputPath}}`) in the instruction and template text before returning them to the consumer. Consumers SHALL receive final text with no unresolved `{{...}}` placeholders.

#### Scenario: Instructions output contains no unresolved variables
- **WHEN** the user runs `corgispec instructions <artifact> --change <name>`
- **THEN** the returned `instruction` field SHALL contain no `{{...}}` template variable syntax
- **AND** the returned `template` field SHALL contain no `{{...}}` template variable syntax

#### Scenario: Change name variable is resolved
- **WHEN** a template contains `{{changeName}}`
- **THEN** the instructions output SHALL replace it with the actual change name string

#### Scenario: Unknown variables are replaced with empty string
- **WHEN** a template contains a `{{variableName}}` that has no defined value
- **THEN** the variable SHALL be replaced with an empty string
- **AND** a warning SHALL be emitted to stderr indicating the unresolved variable name
