## ADDED Requirements

### Requirement: One-command symlink initialization
The project SHALL provide a `setup.sh` script that creates all required symlinks and validates the plugin structure in a single invocation.

#### Scenario: setup.sh creates all required symlinks
- **WHEN** `./setup.sh` is executed in the repository root
- **THEN** `.codex/skills/` becomes a symlink (or per-skill symlinks) resolving to `.claude/skills/`
- **THEN** `.agents/skills/` becomes a symlink (or per-skill symlinks) resolving to `.claude/skills/`
- **THEN** the script reports success with a summary of created symlinks

#### Scenario: setup.sh is idempotent
- **WHEN** `./setup.sh` is run on a repo where symlinks already exist and are correct
- **THEN** the script detects existing symlinks and skips creation
- **THEN** the script reports "Already configured" for each existing symlink
- **THEN** the exit code is 0 (success)

#### Scenario: setup.sh detects and backs up physical copies
- **WHEN** `./setup.sh` is run on a repo with existing `.codex/skills/` physical copies
- **THEN** the script detects the physical directories
- **THEN** the script prompts for confirmation before replacing with symlinks
- **THEN** if confirmed, physical copies are moved to a backup location before symlink creation

### Requirement: Plugin structure validation
The `setup.sh` SHALL validate the plugin structure after creating symlinks to ensure the setup is correct and complete.

#### Scenario: Validation checks plugin.json existence
- **WHEN** `./setup.sh` runs validation
- **THEN** the script checks that `.claude-plugin/plugin.json` exists and is valid JSON
- **THEN** the script checks that `.codex-plugin/plugin.json` exists and is valid JSON

#### Scenario: Validation checks skill count
- **WHEN** `./setup.sh` runs validation
- **THEN** the script counts skills in `.claude/skills/` and reports the count
- **THEN** the script verifies that `.codex/skills/` and `.agents/skills/` resolve to the same skill set

#### Scenario: Validation reports failures clearly
- **WHEN** validation detects a missing or broken symlink
- **THEN** the script reports which path is broken and the expected target
- **THEN** the script exits with a non-zero exit code
- **THEN** the error message includes remediation instructions

### Requirement: Help and dry-run options
The `setup.sh` SHALL support `--help` for usage documentation and `--dry-run` for previewing changes without modifying files.

#### Scenario: --help shows usage
- **WHEN** setup.sh is invoked with `--help` or `-h`
- **THEN** the script prints a usage summary including available flags
- **THEN** the script exits with code 0

#### Scenario: --dry-run previews changes
- **WHEN** setup.sh is invoked with `--dry-run`
- **THEN** the script prints what actions it would take (which symlinks to create, which files to back up)
- **THEN** no filesystem changes are made
- **THEN** the script exits with code 0

### Requirement: Integration with install-skills.sh
The `install-skills.sh` script SHALL be extended with a flag or option to include Codex symlink creation during user-level skill installation.

#### Scenario: install-skills.sh with --codex flag creates user-level Codex symlinks
- **WHEN** install-skills.sh is run with `--codex` (or equivalent flag)
- **THEN** after installing OpenCode and Claude Code skills, the script also creates symlinks from user-level Codex skill paths to the canonical `.claude/skills/` directory
- **THEN** the existing behavior without the flag is unchanged

#### Scenario: install-skills.sh preserves backward compatibility
- **WHEN** install-skills.sh is run without any new flags
- **THEN** only OpenCode and Claude Code skills are installed
- **THEN** the output format and exit codes are identical to the current version
