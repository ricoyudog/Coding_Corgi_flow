## ADDED Requirements

### Requirement: Claude Code plugin manifest
The project SHALL provide a `.claude-plugin/plugin.json` manifest that declares the plugin identity, version, and metadata for Claude Code's plugin system.

#### Scenario: Plugin manifest exists and is valid
- **WHEN** Claude Code loads the repository as a plugin source
- **THEN** the `.claude-plugin/plugin.json` file is present and parsable as valid JSON
- **THEN** the manifest includes `name`, `version`, `description`, and `author` fields
- **THEN** the `author` field is an object (not a string), `version` is a string, and `keywords` is an array

#### Scenario: Claude Code auto-discovers skills
- **WHEN** Claude Code loads the plugin
- **THEN** skills from `.claude/skills/` are automatically discovered and available without explicit declaration in plugin.json

#### Scenario: Plugin version is semantically versioned
- **WHEN** a new version of the plugin is released
- **THEN** the `version` field in plugin.json reflects the correct semantic version string (e.g., `"2.0.0"`)

### Requirement: Codex plugin manifest with interface block
The project SHALL provide a `.codex-plugin/plugin.json` manifest that includes the Codex-specific `interface` block for marketplace display and an explicit `skills` path declaration.

#### Scenario: Plugin manifest includes interface block
- **WHEN** Codex reads the plugin manifest
- **THEN** the `interface` block is present with at minimum: `displayName`, `shortDescription`, `longDescription`, `developerName`, `category`, `capabilities`, and `brandColor`

#### Scenario: Skills path is explicitly declared
- **WHEN** Codex loads the plugin
- **THEN** the `skills` field in plugin.json points to the skills directory (e.g., `"./skills/"` or equivalent)
- **THEN** skills are loaded from the declared path

#### Scenario: Valid plugin.json format enforcement
- **WHEN** the plugin.json is validated
- **THEN** `name` matches directory name, `version` is a semver string, `keywords` is an array, and `repository` is a valid URL string

### Requirement: Plugin directory convention
Each platform's plugin files SHALL reside in platform-specific directories to avoid collision and match platform conventions.

#### Scenario: Platform directories are separate
- **WHEN** the project structure is inspected
- **THEN** `.claude-plugin/` directory exists with Claude Code plugin files
- **THEN** `.codex-plugin/` directory exists with Codex plugin files
- **THEN** no cross-contamination between the two plugin directories

#### Scenario: Plugin directories are Git-tracked
- **WHEN** changes are committed to the repository
- **THEN** both `.claude-plugin/` and `.codex-plugin/` directories and their contents are included in version control
