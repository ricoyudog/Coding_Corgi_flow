---
name: openspec-ask
description: Answer human questions from Obsidian vault using early-stop retrieval with token budget enforcement.
license: MIT
compatibility: Requires memory/ and wiki/ directories (created by openspec-memory-init).
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.0.0"
---

Answer questions from vault context with budget-aware early-stop retrieval.

## Overview

Provides a Q&A channel between humans (via Obsidian) and AI agents. Humans write questions as markdown files in `wiki/questions/`. The AI answers by searching the vault with a strict retrieval budget, writing answers back into the question file.

Key design principle: **answer with minimum context**. Stop retrieving as soon as sufficient information is found. This prevents runaway token consumption.

## When to Use

- When a human has created a question file in `wiki/questions/` with `status: pending`
- Via `/opsx-ask wiki/questions/<filename>.md` for a specific question
- Via `/opsx-ask --pending` to process all pending questions in batch

Do not use this skill to create questions (humans do that in Obsidian), initialize memory, or run lint checks.

## Preconditions

- [ ] `memory/` directory exists with `session-bridge.md`
- [ ] `wiki/` directory exists with `hot.md` and `index.md`
- [ ] At least one question file exists in `wiki/questions/` (for single-question mode), or `--pending` flag is used

## Modes

### Mode A: Single Question

Triggered by: `/opsx-ask wiki/questions/<filename>.md`

### Mode B: Batch Pending

Triggered by: `/opsx-ask --pending`

---

## Steps

### 1. Determine mode and select question(s)

**If a specific file path is provided (Mode A)**:
1. Read the specified question file
2. Verify it has `status: pending` in frontmatter
3. If status is not `pending` → report "Question already answered (status: {status})" and stop

**If `--pending` flag is used (Mode B)**:
1. Scan all `.md` files in `wiki/questions/` (excluding `_index.md`)
2. Read each file's frontmatter, collect those with `status: pending`
3. If none found → report "No pending questions found" and stop
4. Present the list to the user:
   ```
   Found N pending questions:
   1. <filename> — "<question title or first line>"
   2. <filename> — "<question title or first line>"
   ...
   Processing in order.
   ```
5. Process each question sequentially using Steps 2-5

### 2. Parse the question

Read the question file. Extract:
- **Question text**: from the `## Question` section
- **Tags**: from frontmatter `tags` field (used to guide retrieval)
- **Context hints**: any `## Context` section the human provided

### 3. Execute early-stop retrieval

Retrieve context using this priority chain. **Stop as soon as sufficient context is found** to answer the question.

```
Priority 1: memory/session-bridge.md
    ↓ (if insufficient)
Priority 2: wiki/hot.md
    ↓ (if insufficient)
Priority 3: wiki/index.md (scan for relevant domain links)
    ↓ (if insufficient)
Priority 4: One domain page from wiki/ (follow relevant index link)
    ↓ (if insufficient)
Priority 5: Second domain page from wiki/ OR a page from docs/
    ↓ (if insufficient)
Priority 6: A file from specs/ (if question is about requirements)
```

**Budget rules**:
- Maximum 2 wiki/domain pages per question (Priorities 4-5)
- Maximum 5 total file reads before answering
- If you reach Priority 6 and still cannot answer → flag as `needs-deep-session`

**Early-stop decision at each priority level**:
- Can I answer the question confidently with what I have? → STOP and answer
- Do I have a strong lead on where the answer is? → Follow that lead (next priority)
- Am I guessing where to look? → STOP and answer with available context, noting uncertainty

### 4. Write the answer

Update the question file:

1. Set frontmatter `status: answered` and `answered: <today's date>`
2. Write the answer in the `## Answer` section
3. Add a `## Sources` section listing which files were consulted:
   ```markdown
   ## Sources
   - `memory/session-bridge.md` — current session state
   - `wiki/hot.md` — project pulse
   ```

**If insufficient context** (reached budget limit without confident answer):
1. Set frontmatter `status: needs-deep-session`
2. Write a partial answer explaining what is known
3. Add a `## Needs` section listing what additional information would help:
   ```markdown
   ## Needs
   - Access to `src/auth/` source code
   - Full reading of `docs/architecture/auth-flow.md`
   - This question spans 6+ files — requires a dedicated deep session
   ```

### 5. Knowledge writeback

After answering, check if the answer reveals information that should be persisted:

**Check for new pitfall**:
- Did the answer reveal a common mistake or gotcha?
- If yes → append to `memory/pitfalls.md` Active section with format:
  ```
  - <pitfall description> (source: [[wiki/questions/<filename>]])
  ```

**Check for architecture insight**:
- Did the answer reveal an implicit contract or architectural pattern?
- If yes → append to `wiki/architecture/implicit-contracts.md` with format:
  ```
  ### <Contract Name>
  - **Rule**: <what must be true>
  - **Breaks if**: <what happens when violated>
  - **Source**: [[wiki/questions/<filename>]]
  ```

**Check for index update**:
- If the question and answer cover a topic not yet in `wiki/index.md`:
  - Consider adding a reference (but only if index is under 80 lines)

### 6. Report results

For Mode A (single question):
```
## Question Answered

**File**: wiki/questions/<filename>.md
**Status**: answered | needs-deep-session
**Sources consulted**: N files
**Writeback**: <what was written back, or "none">
```

For Mode B (batch):
```
## Batch Complete

**Processed**: N questions
**Answered**: M
**Needs deep session**: K
**Writeback actions**: L

| # | Question | Status | Sources |
|---|----------|--------|---------|
| 1 | <title> | answered | 2 files |
| 2 | <title> | needs-deep-session | 5 files |
```

---

## Question File Format

Questions must follow this structure:

```markdown
---
type: question
status: pending
created: YYYY-MM-DD
tags: [relevant, topic, tags]
---

# <Question Title>

## Question

<The actual question text. Can be multiple paragraphs.>

## Context

<Optional: additional context the human wants to provide>

## Answer

<Filled by AI — leave empty when creating>

## Sources

<Filled by AI — leave empty when creating>
```

Valid status values: `pending`, `answered`, `needs-deep-session`

---

## Common Mistakes

- Reading more than 2 wiki pages per question (violates budget)
- Forgetting to check `status: pending` before answering (may re-answer)
- Writing answers without listing sources (traceability lost)
- Auto-creating questions (only humans create questions in Obsidian)
- Modifying the question text (only add to Answer/Sources/Needs sections)
- Writing back to pitfalls without a source link
- Exceeding 5 total file reads without flagging needs-deep-session
