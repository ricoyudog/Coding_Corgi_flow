## ADDED Requirements

### Requirement: Stool entry records color
The system SHALL require each new stool observation entry to include a stool color selected from a predefined supported set.

#### Scenario: Capture a valid stool color
- **WHEN** a user records a stool observation and selects a supported stool color value
- **THEN** the system stores that stool color with the stool entry

#### Scenario: Reject an unsupported stool color
- **WHEN** a user submits a stool observation with a stool color value outside the supported set
- **THEN** the system rejects the submission and explains that a supported stool color must be provided

### Requirement: Stool entry records duration
The system SHALL require each new stool observation entry to include the duration of the bowel movement as a positive whole-minute value.

#### Scenario: Capture a valid duration
- **WHEN** a user records a stool observation with a positive whole-minute duration
- **THEN** the system stores that duration with the stool entry

#### Scenario: Reject a missing or invalid duration
- **WHEN** a user submits a stool observation without a positive whole-minute duration
- **THEN** the system rejects the submission and explains that a valid duration is required

### Requirement: Stool entry surfaces preserve new attributes
The system SHALL return stool color and stool duration anywhere it returns stool-entry details for history, review, or reporting.

#### Scenario: Show color and duration in entry details
- **WHEN** a user views a previously saved stool observation entry
- **THEN** the system shows the saved stool color and stool duration alongside the rest of the stool-entry data

#### Scenario: Include color and duration in reports
- **WHEN** the system generates a stool-entry report or summary that includes individual entries
- **THEN** each included stool entry contains its recorded stool color and stool duration
