## ADDED Requirements

### Requirement: Health check execution
The system SHALL perform 11 defined health checks against the memory and wiki directories, producing a structured report with severity levels (error, warning, info).

#### Scenario: Full lint pass on healthy project
- **WHEN** user runs `corgispec-lint` on a project where all memory files are fresh, within size caps, and have valid wikilinks
- **THEN** system reports 0 errors, 0 warnings, and outputs a clean lint report to `wiki/meta/lint-report-YYYY-MM-DD.md`

#### Scenario: Lint detects stale session-bridge
- **WHEN** `memory/session-bridge.md` has not been updated in more than 30 days
- **THEN** system reports a warning for check #1 (session-bridge freshness) with recommendation to update or mark as stale

#### Scenario: Lint detects oversized hot.md
- **WHEN** `wiki/hot.md` exceeds 600 words
- **THEN** system reports a warning for check #9 (hot.md size) with recommendation to trim oldest entries

### Requirement: Broken wikilink detection
The system SHALL validate all `[[wikilink]]` references in memory/ and wiki/ files, reporting any links that point to non-existent files as errors.

#### Scenario: Broken link found
- **WHEN** `wiki/hot.md` contains `[[wiki/patterns/stale-pattern]]` but that file does not exist
- **THEN** system reports an error for check #3 with the source file, line, and broken target

#### Scenario: Valid links pass
- **WHEN** all wikilinks in memory/ and wiki/ resolve to existing files
- **THEN** check #3 passes with no errors

### Requirement: Size cap validation
The system SHALL check file sizes against defined hard caps: hot.md (600 words), index.md (80 lines), pitfalls.md (20 active entries), session-bridge.md (50 lines).

#### Scenario: Multiple size violations
- **WHEN** both `wiki/hot.md` exceeds 600 words AND `wiki/index.md` exceeds 80 lines
- **THEN** system reports warnings for both check #9 and check #10 independently

### Requirement: CLAUDE.md protocol presence check
The system SHALL verify that the agent configuration file contains the Session Memory Protocol section, reporting an error if missing.

#### Scenario: Protocol missing
- **WHEN** `CLAUDE.md` exists but does not contain `## Session Memory Protocol`
- **THEN** system reports an error for check #8 with auto-fix suggestion to run `corgispec-memory-init`

### Requirement: Extraction completeness check
The system SHALL verify that recently archived changes have corresponding entries in `wiki/patterns/` or `wiki/sessions/`, reporting info-level findings for gaps.

#### Scenario: Archive without extraction
- **WHEN** a change was archived in the last 3 archive cycles but has no corresponding `wiki/sessions/<change-name>.md`
- **THEN** system reports an info-level finding for check #7 suggesting extraction

### Requirement: Orphan page detection
The system SHALL identify wiki pages that have no incoming wikilinks from any other memory/ or wiki/ file.

#### Scenario: Orphan wiki page found
- **WHEN** `wiki/research/old-topic.md` exists but no other file links to it
- **THEN** system reports a warning for check #6 suggesting the page be added to an index or removed

### Requirement: Pitfall source link validation
The system SHALL verify that each active entry in `memory/pitfalls.md` includes a source link to the originating change.

#### Scenario: Pitfall without source
- **WHEN** an entry in pitfalls.md Active section has no wikilink or change reference
- **THEN** system reports a warning for check #4 identifying the entry

### Requirement: Lint report persistence
The system SHALL write the full lint report to `wiki/meta/lint-report-YYYY-MM-DD.md` after each run, overwriting any same-day report.

#### Scenario: Report written
- **WHEN** lint completes with any combination of findings
- **THEN** a report file exists at `wiki/meta/lint-report-YYYY-MM-DD.md` with today's date, containing all findings grouped by severity
