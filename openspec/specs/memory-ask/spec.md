## ADDED Requirements

### Requirement: Question answering from vault context
The system SHALL answer questions written in `wiki/questions/*.md` files by retrieving context from the vault using early-stop retrieval priority: session-bridge → hot → index → domain page → docs/ → specs/.

#### Scenario: Question answered from hot.md
- **WHEN** user creates `wiki/questions/how-auth-works.md` with `status: pending` and the answer is available in `wiki/hot.md`
- **THEN** system writes the answer into the question file's `## Answer` section, sets `status: answered`, and does NOT read additional domain pages

#### Scenario: Question requires domain page
- **WHEN** a pending question cannot be answered from session-bridge or hot.md alone
- **THEN** system follows index.md links to find the relevant domain page (max 2 pages), then writes the answer

#### Scenario: Deep session flag
- **WHEN** answering a question would require reading more than 5 wiki/docs pages
- **THEN** system writes `status: needs-deep-session` and explains what information is missing rather than attempting an incomplete answer

### Requirement: Batch pending mode
The system SHALL support scanning all `wiki/questions/*.md` files for `status: pending` and presenting them as a list for sequential processing.

#### Scenario: Multiple pending questions
- **WHEN** user runs `corgispec-ask --pending` and 3 question files have `status: pending`
- **THEN** system lists all 3 questions and processes them in order, writing answers to each

#### Scenario: No pending questions
- **WHEN** user runs `corgispec-ask --pending` and no question files have `status: pending`
- **THEN** system reports "No pending questions found" and exits

### Requirement: Knowledge writeback
The system SHALL update wiki/ or memory/ files when an answer reveals information that should be persisted, following the same write conventions as other memory skills.

#### Scenario: Answer reveals new pitfall
- **WHEN** answering a question uncovers a pitfall not yet recorded
- **THEN** system appends the pitfall to `memory/pitfalls.md` with a source link to the question file

#### Scenario: Answer reveals architecture insight
- **WHEN** answering a question surfaces an implicit contract or architecture pattern
- **THEN** system appends to `wiki/architecture/implicit-contracts.md` with a source link

### Requirement: Retrieval budget enforcement
The system SHALL NOT read more than 2 wiki pages per question before attempting an answer, and SHALL NOT read more than 5 total pages before flagging as deep-session.

#### Scenario: Budget respected
- **WHEN** system retrieves 2 domain pages and still cannot answer
- **THEN** system attempts an answer with available context rather than reading more pages

#### Scenario: Budget exceeded threshold
- **WHEN** the question topic spans 6+ files across wiki/ and docs/
- **THEN** system stops at 5 pages, flags `needs-deep-session`, and lists the files it would need
