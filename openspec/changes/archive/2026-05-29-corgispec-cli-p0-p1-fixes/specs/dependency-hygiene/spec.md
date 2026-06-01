## ADDED Requirements

### Requirement: package.json MUST only contain used dependencies
The `package.json` SHALL not list dependencies that are not imported or required by any source file. Specifically, the `glob` package (unused) and platform-specific optional dependencies like `@rollup/rollup-linux-x64-gnu` (build artifact, not a runtime dependency) SHALL be removed.

#### Scenario: No unused dependencies in package.json
- **WHEN** the package.json `dependencies` or `devDependencies` are audited
- **THEN** every listed package SHALL have at least one import/require in the source tree
- **AND** platform-specific build artifacts SHALL NOT appear as explicit dependencies

#### Scenario: glob dependency removed
- **WHEN** the source tree is searched for `import.*glob` or `require.*glob`
- **THEN** no imports of the `glob` package SHALL be found
- **AND** `glob` SHALL NOT appear in `package.json` dependencies

### Requirement: loadWorkflowSchema MUST validate loaded schema shape at runtime
The `loadWorkflowSchema()` function SHALL validate that the loaded YAML/JSON has the expected shape (at minimum: `name`, `version`, `artifacts` array) before returning it. Invalid shapes SHALL throw a descriptive error rather than returning malformed data.

#### Scenario: Valid schema passes shape validation
- **WHEN** `loadWorkflowSchema()` loads a file with valid `name`, `version`, and `artifacts` fields
- **THEN** it SHALL return the parsed schema object without error

#### Scenario: Missing required field triggers error
- **WHEN** `loadWorkflowSchema()` loads a file missing the `artifacts` field
- **THEN** it SHALL throw an error with a message identifying the missing field
- **AND** SHALL NOT return a partial/malformed schema object

#### Scenario: Non-object input triggers error
- **WHEN** `loadWorkflowSchema()` loads a file that parses to a non-object (e.g., string, null, array)
- **THEN** it SHALL throw an error indicating the schema must be an object
