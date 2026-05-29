## ADDED Requirements

### Requirement: Doctor command MUST work on Node 18+
The `doctor` command SHALL not use APIs unavailable in Node 18 (the minimum supported version per package.json `engines` field). Specifically, `import.meta.dirname` (Node 21+) SHALL be replaced with the portable `path.dirname(fileURLToPath(import.meta.url))` pattern.

#### Scenario: Doctor runs successfully on Node 18
- **WHEN** the user runs `corgispec doctor` on Node 18.x
- **THEN** the command SHALL execute without ReferenceError or undefined values
- **AND** schema discovery SHALL locate schema files correctly

#### Scenario: Schema path resolution uses portable API
- **WHEN** the doctor command resolves bundled schema file paths
- **THEN** path resolution SHALL use `path.dirname(fileURLToPath(import.meta.url))` or equivalent Node 18-compatible method
- **AND** SHALL NOT use `import.meta.dirname`

### Requirement: Doctor schema validation MUST target JSON Schema files
The doctor command's schema validation check SHALL validate that JSON Schema files (`.schema.json` or `schema.yaml` defining artifacts) are well-formed. It SHALL NOT attempt to validate arbitrary YAML config files as if they were schemas.

#### Scenario: Doctor validates schema definition file
- **WHEN** the doctor command runs its schema validation check
- **THEN** it SHALL locate and validate the schema definition file (e.g., `openspec/schemas/<name>/schema.yaml`)
- **AND** it SHALL verify the schema contains required fields (`name`, `version`, `artifacts`)

#### Scenario: Doctor does not validate config.yaml as a schema
- **WHEN** the doctor command runs schema validation
- **THEN** it SHALL NOT treat `openspec/config.yaml` as a schema to validate
- **AND** config validation SHALL be a separate check from schema validation
