## ADDED Requirements

### Requirement: Memory structure initialization
The system SHALL create a complete memory directory structure when `corgispec-memory-init` is invoked, producing `memory/` (3 files) and `wiki/` (7 subdirectories with index files) without overwriting any existing files.

#### Scenario: Fresh project initialization
- **WHEN** user runs `corgispec-memory-init` on a project with no existing `memory/` or `wiki/` directories
- **THEN** system creates `memory/MEMORY.md`, `memory/session-bridge.md`, `memory/pitfalls.md`, and `wiki/` with subdirectories `architecture/`, `patterns/`, `research/`, `sessions/`, `decisions/`, `questions/`, `meta/` each containing an `_index.md`, plus `wiki/hot.md` and `wiki/index.md`

#### Scenario: Existing files are not overwritten
- **WHEN** user runs `corgispec-memory-init` on a project where `memory/session-bridge.md` already exists
- **THEN** system skips that file, creates all other missing files, and reports which files were skipped due to conflicts

#### Scenario: Project identity extraction
- **WHEN** user runs `corgispec-memory-init` on a project that has `CLAUDE.md` or `README.md`
- **THEN** system extracts project name, tech stack, and hard constraints from those files and populates `memory/MEMORY.md` accordingly

### Requirement: Session Memory Protocol injection
The system SHALL inject a `## Session Memory Protocol` section into the project's agent configuration file (CLAUDE.md, AGENTS.md) that instructs agents on startup reads, retrieval budget, file size limits, shutdown writes, and compaction triggers.

#### Scenario: CLAUDE.md injection
- **WHEN** `corgispec-memory-init` runs and `CLAUDE.md` exists
- **THEN** system appends the Session Memory Protocol section after existing content, specifying: startup reads (3 files), per-question budget (max 2 wiki pages), file size hard caps, shutdown write procedure, and compaction triggers

#### Scenario: Idempotent injection
- **WHEN** `corgispec-memory-init` runs and `CLAUDE.md` already contains `## Session Memory Protocol`
- **THEN** system does not duplicate the section and reports it already exists

### Requirement: Install integration
The system SHALL invoke `corgispec-memory-init` as part of `corgispec-install` by default, with an opt-out mechanism.

#### Scenario: Default install includes memory
- **WHEN** user runs `corgispec-install` without flags
- **THEN** system completes standard install AND runs `corgispec-memory-init`

#### Scenario: Opt-out via flag
- **WHEN** user runs `corgispec-install --no-memory`
- **THEN** system completes standard install WITHOUT running `corgispec-memory-init`
