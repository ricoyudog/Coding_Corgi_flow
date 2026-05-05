## ADDED Requirements

### Requirement: Marketplace manifest for team distribution
The project SHALL provide a `.claude-plugin/marketplace.json` file that serves as a marketplace registry supporting both Claude Code (`/plugin marketplace add`) and Codex (repo-scoped marketplace priority 3) installation workflows.

#### Scenario: marketplace.json is valid for Claude Code
- **WHEN** a team member runs `/plugin marketplace add owner/repo`
- **THEN** the marketplace.json is readable and lists the `corgispec` plugin entry
- **THEN** the plugin entry includes `name`, `source` (with `source`, `repo`, and `ref` fields), and `category`

#### Scenario: marketplace.json is readable by Codex
- **WHEN** Codex scans marketplace priority sources for the repo
- **THEN** Codex discovers and parses `.claude-plugin/marketplace.json` at priority 3
- **THEN** the plugin appears in the Codex plugin list

#### Scenario: Plugin version is pinned
- **WHEN** marketplace.json references the plugin source
- **THEN** the `ref` field uses a git tag or commit SHA (e.g., `"v2.0.0"`), not a branch name
- **THEN** team members always get the pinned version until explicitly updated

### Requirement: Claude Code team auto-install configuration
The project SHALL provide a `.claude/settings.json` file that enables team members to auto-install the CorgiSpec plugin by including it in the repository.

#### Scenario: settings.json enables marketplace and plugin
- **WHEN** a team member clones the repository
- **THEN** `.claude/settings.json` exists with `extraKnownMarketplaces` referencing the CorgiSpec marketplace
- **THEN** `.claude/settings.json` includes `enabledPlugins` with `"corgispec@corgispec": true`

#### Scenario: Plugin is suggested but not forced
- **WHEN** `.claude/settings.json` is evaluated by Claude Code
- **THEN** the plugin is available for installation (not strictly enforced)
- **THEN** team members can choose to disable or override the plugin if needed

### Requirement: Codex repo-scoped marketplace configuration
The project SHALL provide a `.agents/plugins/marketplace.json` file enabling Codex repo-scoped plugin discovery with policy controls.

#### Scenario: Plugin is installed by default in the repo
- **WHEN** a developer opens the repository in Codex
- **THEN** `.agents/plugins/marketplace.json` is detected as a repo-scoped marketplace
- **THEN** the `corgispec` plugin entry has `policy.installation` set to `INSTALLED_BY_DEFAULT`

#### Scenario: Plugin supports git-subdir remote source
- **WHEN** marketplace.json specifies a `git-subdir` source type
- **THEN** the `url` points to the project's canonical Git remote
- **THEN** the `ref` field pins a specific version tag
- **THEN** Codex can install the plugin from the remote source without a local copy

#### Scenario: Authentication policy is on-install
- **WHEN** the plugin is installed
- **THEN** the `policy.authentication` is set to `ON_INSTALL`, meaning authentication is checked once at install time

### Requirement: Cross-platform marketplace compatibility
The marketplace configuration SHALL be structured so that updates to plugin metadata propagate to both platforms without duplication.

#### Scenario: Single marketplace.json update reaches both platforms
- **WHEN** the `.claude-plugin/marketplace.json` is updated with a new plugin version
- **THEN** Claude Code installs the new version after `plugin marketplace upgrade`
- **THEN** Codex discovers the new version through its marketplace read priority
- **THEN** no separate update is needed in a Codex-specific marketplace file

#### Scenario: Plugin category is consistent across platforms
- **WHEN** the plugin is listed in any marketplace
- **THEN** the category field (e.g., `"Workflow"`) is identical across all marketplace files
- **THEN** search and filtering behavior is consistent on both platforms
