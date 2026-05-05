## ADDED Requirements

### Requirement: Pattern extraction from completed changes
The system SHALL extract reusable patterns from a completed change's history and write them to `wiki/patterns/<pattern-name>.md` with structured metadata.

#### Scenario: Pattern identified during archive
- **WHEN** `corgispec-memory-extract` runs for a completed change that introduced a reusable approach (e.g., "retry with backoff for API calls")
- **THEN** system creates `wiki/patterns/<pattern-name>.md` with sections: Context, Pattern, When to Use, Example, and a source link to the originating change

#### Scenario: No patterns identified
- **WHEN** `corgispec-memory-extract` runs for a change that was purely mechanical (e.g., dependency version bump)
- **THEN** system skips pattern creation and reports "No reusable patterns identified"

### Requirement: Session summary extraction
The system SHALL create a session summary for the completed change at `wiki/sessions/<change-name>.md` capturing what was done, key decisions, and lessons learned.

#### Scenario: Summary created
- **WHEN** `corgispec-memory-extract` runs for change `add-user-auth`
- **THEN** system creates `wiki/sessions/add-user-auth.md` with sections: Overview, Timeline (from session-bridge history), Key Decisions, Pitfalls Encountered, and Outcome

#### Scenario: Summary already exists
- **WHEN** `wiki/sessions/<change-name>.md` already exists
- **THEN** system reports the summary already exists and does not overwrite

### Requirement: Hot.md lifecycle update
The system SHALL move the change from "Active Changes" to "Recently Shipped" in `wiki/hot.md` when extraction completes.

#### Scenario: Change moved to shipped
- **WHEN** extraction completes for change `add-user-auth` which is listed under Active Changes in hot.md
- **THEN** system removes it from Active Changes and adds it to Recently Shipped with completion date

#### Scenario: Change not in hot.md
- **WHEN** extraction runs but the change is not listed in hot.md Active Changes
- **THEN** system adds it directly to Recently Shipped without error

### Requirement: Session-bridge reset
The system SHALL reset `memory/session-bridge.md` to clean state after extraction, clearing Done/Waiting/Pitfalls sections related to the archived change.

#### Scenario: Bridge cleaned after archive
- **WHEN** extraction completes and session-bridge contains entries about the archived change
- **THEN** system removes those entries, keeping entries for other active changes intact

### Requirement: Index update
The system SHALL add links to newly created wiki pages (patterns, sessions) in `wiki/index.md` under the appropriate section.

#### Scenario: New pattern added to index
- **WHEN** extraction creates `wiki/patterns/retry-backoff.md`
- **THEN** system adds `- [[wiki/patterns/retry-backoff|Retry Backoff]]` under the Patterns section of index.md

#### Scenario: Index size check
- **WHEN** adding to index.md would exceed 80 lines
- **THEN** system trims oldest completed-change entries from the Sessions section before adding new ones

### Requirement: Archive integration
The system SHALL be invoked by `corgispec-archive` before the change is closed, as the final knowledge extraction step.

#### Scenario: Archive calls extract
- **WHEN** user runs `corgispec-archive` for a completed change
- **THEN** system invokes `corgispec-memory-extract` before closing issues and merging delta specs
