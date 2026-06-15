# Fix Missing Claude Code Commands (`/corgi:human-qa`, `/corgi:ask`, `/corgi:memory-init`, `/corgi:migrate`)

## TL;DR

> **Quick Summary**: Create 4 missing Claude Code command dispatch files that were never added alongside their OpenCode equivalents, restoring full `/corgi:*` command parity.
>
> **Deliverables**:
> - `packages/corgispec/assets/commands/claude/corgi/human-qa.md`
> - `packages/corgispec/assets/commands/claude/corgi/ask.md`
> - `packages/corgispec/assets/commands/claude/corgi/memory-init.md`
> - `packages/corgispec/assets/commands/claude/corgi/migrate.md`
>
> **Estimated Effort**: Quick (4 small files, each ~20-40 lines, all following existing patterns)
> **Parallel Execution**: YES — 1 wave of 4 independent tasks
> **Critical Path**: None (all tasks independent)

---

## Context

### Original Request
User reported that `/corgi:human-qa` is missing from Claude Code commands.

### Investigation Findings
The `packages/corgispec/assets/commands/claude/corgi/` directory has only 8 command files while the OpenCode equivalent (`packages/corgispec/assets/commands/opencode/`) has 12. Four commands were added to OpenCode but never mirrored into the Claude assets:

| Missing Claude Command | OpenCode Equivalent | Skill Dispatch Target |
|---|---|---|
| `human-qa.md` | `corgi-human-qa.md` | `corgispec-human-qa` |
| `ask.md` | `corgi-ask.md` | `corgispec-ask` |
| `memory-init.md` | `corgi-memory-init.md` | `corgispec-memory-init` |
| `migrate.md` | `corgi-migrate.md` | `corgispec-memory-migrate` |

All 4 target skills already exist in `.claude/skills/`. Only the command dispatch `.md` files are missing.

### Metis Review
**Identified Gaps** (all addressed):
- Two distinct Claude command patterns exist: **Full** (platform + isolation + postconditions) vs **Minimal** (dispatch only). `human-qa` needs Full pattern; the other 3 need Minimal.
- `migrate.md` needs a precondition check (`memory/` + `wiki/` must exist).
- Frontmatter must use Claude-specific fields (`name`, `description`, `category`, `tags`) — NOT copy OpenCode's simpler frontmatter.

---

## Work Objectives

### Core Objective
Add 4 missing Claude command files to achieve parity with OpenCode commands (8 → 12).

### Concrete Deliverables
- 4 new `.md` files in `packages/corgispec/assets/commands/claude/corgi/`

### Definition of Done
- [x] `ls packages/corgispec/assets/commands/claude/corgi/ | wc -l` outputs 12
- [x] Each new file has proper Claude frontmatter (`name`, `description`, `category`, `tags`)
- [x] Each new file dispatches to the correct skill
- [x] `human-qa.md` contains isolation check
- [x] `migrate.md` contains precondition check
- [x] No existing files modified (`git diff --name-only` shows only 4 new files)

### Must Have
- All 4 command files created with correct structure
- `human-qa.md` follows the Full pattern (like `verify.md`)
- `ask.md`, `memory-init.md`, `migrate.md` follow the Minimal pattern (like `install.md`)

### Must NOT Have (Guardrails)
- Do NOT modify any existing files in `.claude/`, `.opencode/`, or `packages/corgispec/src/`
- Do NOT copy OpenCode frontmatter format (Claude commands use different metadata)
- Do NOT add platform-specific forks (all 4 dispatch to universal skills)
- Do NOT change `bootstrap.ts` or `install-assets.ts` (they already read directory dynamically)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: N/A (markdown files, no code tests)
- **Automated tests**: None needed
- **Framework**: N/A

### QA Policy
Every task includes agent-executed QA scenarios using Bash for file/content verification.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — all independent):
├── Task 1: Create human-qa.md (Full pattern) [quick]
├── Task 2: Create ask.md (Minimal pattern) [quick]
├── Task 3: Create memory-init.md (Minimal pattern) [quick]
└── Task 4: Create migrate.md (Minimal + preconditions) [quick]

Wave FINAL (After ALL tasks):
├── Task F1: Count verification (12 files) [quick]
├── Task F2: Content verification (frontmatter, dispatch, isolation, preconditions) [quick]
└── Task F3: Git diff check (only 4 new files, no modifications) [quick]
-> Present results -> Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks |
|---|---|---|
| 1 | — | F1, F2 |
| 2 | — | F1, F2 |
| 3 | — | F1, F2 |
| 4 | — | F1, F2 |
| F1 | 1, 2, 3, 4 | user okay |
| F2 | 1, 2, 3, 4 | user okay |
| F3 | 1, 2, 3, 4 | user okay |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks — all `quick`
- **FINAL**: 3 tasks — all `quick`

---

## TODOs

- [x] 1. Create `packages/corgispec/assets/commands/claude/corgi/human-qa.md`

  **What to do**:
  - Create a new file following the **Full pattern** (like `verify.md`)
  - Add Claude frontmatter: `name: "Corgi: Human QA"`, `description: Run human QA session with structured evidence collection and pass/fail verdict`, `category: Workflow`, `tags: [workflow, qa, experimental]`
  - Steps: (1) Determine platform from `config.yaml` (2) Check isolation mode — CRITICAL, same as verify (3) Dispatch to `corgispec-human-qa` skill (universal, no platform fork) (4) Pass through all input (5) Verify postconditions: `qa-report.md` exists with PASS/FAIL status, evidence present, report posted to child issue if tracked, next-steps guidance printed

  **Must NOT do**:
  - Do NOT add platform-specific skill fork (the skill is universal)
  - Do NOT skip the isolation check

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file creation following an exact existing pattern
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `corgispec-human-qa`: The task creates the command wrapper, not the skill itself

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: F1, F2
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/corgispec/assets/commands/claude/corgi/verify.md` — **PRIMARY TEMPLATE**. Copy this structure exactly: frontmatter style, step numbering, isolation check block, postconditions block. Only change: skill name and description.

  **API/Type References** (contracts to implement against):
  - `packages/corgispec/assets/commands/opencode/corgi-human-qa.md` — OpenCode equivalent. Use for the business logic steps (platform detection, isolation check, dispatch target, postconditions). Adapt the frontmatter to Claude format.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: File created with correct frontmatter
    Tool: Bash
    Preconditions: Task not yet started
    Steps:
      1. Run: test -f packages/corgispec/assets/commands/claude/corgi/human-qa.md && echo "EXISTS" || echo "MISSING"
      2. Run: head -6 packages/corgispec/assets/commands/claude/corgi/human-qa.md
      3. Assert output contains 'name: "Corgi: Human QA"'
      4. Assert output contains 'description: Run human QA'
      5. Assert output contains 'category: Workflow'
    Expected Result: File exists with all 4 frontmatter fields
    Failure Indicators: "MISSING" or missing frontmatter fields
    Evidence: .sisyphus/evidence/task-1-frontmatter.txt

  Scenario: Contains isolation check and dispatch to correct skill
    Tool: Bash
    Preconditions: File exists
    Steps:
      1. Run: grep -c "isolation" packages/corgispec/assets/commands/claude/corgi/human-qa.md
      2. Assert count > 0 (isolation check present)
      3. Run: grep -c "corgispec-human-qa" packages/corgispec/assets/commands/claude/corgi/human-qa.md
      4. Assert count > 0 (dispatch target correct)
      5. Run: grep -c "qa-report" packages/corgispec/assets/commands/claude/corgi/human-qa.md
      6. Assert count > 0 (postconditions present)
    Expected Result: All grep counts > 0
    Failure Indicators: Any count = 0
    Evidence: .sisyphus/evidence/task-1-content-check.txt
  ```

  **Commit**: YES (groups with Tasks 2, 3, 4)
  - Message: `fix(commands): add 4 missing Claude Code command dispatch files`
  - Files: `packages/corgispec/assets/commands/claude/corgi/human-qa.md`
  - Pre-commit: none

- [x] 2. Create `packages/corgispec/assets/commands/claude/corgi/ask.md`

  **What to do**:
  - Create a new file following the **Minimal pattern** (like `install.md`)
  - Add Claude frontmatter: `name: "Corgi: Ask"`, `description: Answer human questions from vault context using early-stop retrieval`, `category: Workflow`, `tags: [workflow, ask, experimental]`
  - Steps: (1) Dispatch to `corgispec-ask` skill (2) Pass through all input

  **Must NOT do**:
  - Do NOT add platform determination or isolation check (not a pipeline command)
  - Do NOT copy OpenCode frontmatter format

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single small file, exact pattern copy
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: F1, F2
  - **Blocked By**: None

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/corgispec/assets/commands/claude/corgi/install.md` — **PRIMARY TEMPLATE**. Copy this minimal structure: frontmatter with `name`/`description`/`category`/`tags`, one-liner description, dispatch step, pass-through step.

  **API/Type References**:
  - `packages/corgispec/assets/commands/opencode/corgi-ask.md` — OpenCode equivalent. Reference for the input description and dispatch target.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: File created with correct structure
    Tool: Bash
    Preconditions: Task not yet started
    Steps:
      1. Run: test -f packages/corgispec/assets/commands/claude/corgi/ask.md && echo "EXISTS" || echo "MISSING"
      2. Run: head -6 packages/corgispec/assets/commands/claude/corgi/ask.md
      3. Assert output contains 'name: "Corgi: Ask"'
      4. Assert output contains 'description: Answer human questions'
    Expected Result: File exists with correct frontmatter
    Failure Indicators: "MISSING" or wrong frontmatter
    Evidence: .sisyphus/evidence/task-2-frontmatter.txt

  Scenario: Dispatches to correct skill
    Tool: Bash
    Preconditions: File exists
    Steps:
      1. Run: grep -c "corgispec-ask" packages/corgispec/assets/commands/claude/corgi/ask.md
      2. Assert count > 0
    Expected Result: Dispatch target found
    Failure Indicators: count = 0
    Evidence: .sisyphus/evidence/task-2-content-check.txt
  ```

  **Commit**: YES (groups with Tasks 1, 3, 4)
  - Message: (shared commit — see Task 1)
  - Files: `packages/corgispec/assets/commands/claude/corgi/ask.md`
  - Pre-commit: none

- [x] 3. Create `packages/corgispec/assets/commands/claude/corgi/memory-init.md`

  **What to do**:
  - Create a new file following the **Minimal pattern** (like `install.md`)
  - Add Claude frontmatter: `name: "Corgi: Memory Init"`, `description: Initialize the 3-layer memory structure (memory/ + wiki/) for cross-session AI continuity`, `category: Workflow`, `tags: [workflow, memory, experimental]`
  - Steps: (1) Dispatch to `corgispec-memory-init` skill (2) Pass through all input

  **Must NOT do**:
  - Do NOT add platform determination or isolation check
  - Do NOT copy OpenCode frontmatter format

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single small file, exact pattern copy
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: F1, F2
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `packages/corgispec/assets/commands/claude/corgi/install.md` — **PRIMARY TEMPLATE**. Same minimal structure.

  **API/Type References**:
  - `packages/corgispec/assets/commands/opencode/corgi-memory-init.md` — OpenCode equivalent. Reference for input description.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: File created with correct structure
    Tool: Bash
    Preconditions: Task not yet started
    Steps:
      1. Run: test -f packages/corgispec/assets/commands/claude/corgi/memory-init.md && echo "EXISTS" || echo "MISSING"
      2. Run: head -6 packages/corgispec/assets/commands/claude/corgi/memory-init.md
      3. Assert output contains 'name: "Corgi: Memory Init"'
      4. Assert output contains 'description: Initialize the 3-layer memory'
    Expected Result: File exists with correct frontmatter
    Failure Indicators: "MISSING" or wrong frontmatter
    Evidence: .sisyphus/evidence/task-3-frontmatter.txt

  Scenario: Dispatches to correct skill
    Tool: Bash
    Preconditions: File exists
    Steps:
      1. Run: grep -c "corgispec-memory-init" packages/corgispec/assets/commands/claude/corgi/memory-init.md
      2. Assert count > 0
    Expected Result: Dispatch target found
    Failure Indicators: count = 0
    Evidence: .sisyphus/evidence/task-3-content-check.txt
  ```

  **Commit**: YES (groups with Tasks 1, 2, 4)
  - Message: (shared commit — see Task 1)
  - Files: `packages/corgispec/assets/commands/claude/corgi/memory-init.md`
  - Pre-commit: none

- [x] 4. Create `packages/corgispec/assets/commands/claude/corgi/migrate.md`

  **What to do**:
  - Create a new file following the **Minimal + preconditions pattern**
  - Add Claude frontmatter: `name: "Corgi: Migrate"`, `description: Migrate existing project knowledge into memory/wiki structure from docs, archived changes, agent configs, and vault files`, `category: Workflow`, `tags: [workflow, memory, migrate, experimental]`
  - Steps: (1) Check preconditions — verify `memory/` and `wiki/` directories exist; if not, instruct user to run `/corgi:memory-init` first (2) Dispatch to `corgispec-memory-migrate` skill (3) Pass through all input

  **Must NOT do**:
  - Do NOT add platform determination or isolation check
  - Do NOT skip the precondition check

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single small file with one extra step (precondition check)
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: F1, F2
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `packages/corgispec/assets/commands/claude/corgi/install.md` — **PRIMARY TEMPLATE** for the minimal structure.

  **API/Type References**:
  - `packages/corgispec/assets/commands/opencode/corgi-migrate.md` — OpenCode equivalent. **MUST reference** for the precondition check wording: `Verify \`memory/\` and \`wiki/\` directories exist. If not, instruct the user to run \`/corgi-memory-init\` first.` Adapt to Claude syntax (`/corgi:memory-init`).

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: File created with correct structure and precondition check
    Tool: Bash
    Preconditions: Task not yet started
    Steps:
      1. Run: test -f packages/corgispec/assets/commands/claude/corgi/migrate.md && echo "EXISTS" || echo "MISSING"
      2. Run: head -6 packages/corgispec/assets/commands/claude/corgi/migrate.md
      3. Assert output contains 'name: "Corgi: Migrate"'
      4. Run: grep -c "memory" packages/corgispec/assets/commands/claude/corgi/migrate.md
      5. Assert count > 0 (precondition check references memory/)
      6. Run: grep -c "corgispec-memory-migrate" packages/corgispec/assets/commands/claude/corgi/migrate.md
      7. Assert count > 0 (correct dispatch target)
    Expected Result: File exists with frontmatter, precondition check, and correct dispatch
    Failure Indicators: "MISSING" or missing precondition/dispatch
    Evidence: .sisyphus/evidence/task-4-content-check.txt

  Scenario: References correct Claude command for fallback
    Tool: Bash
    Preconditions: File exists
    Steps:
      1. Run: grep -c "corgi:memory-init" packages/corgispec/assets/commands/claude/corgi/migrate.md
      2. Assert count > 0 (uses Claude syntax `/corgi:memory-init`, not OpenCode `/corgi-memory-init`)
    Expected Result: Claude command syntax used in fallback instruction
    Failure Indicators: count = 0 or uses OpenCode syntax
    Evidence: .sisyphus/evidence/task-4-claude-syntax.txt
  ```

  **Commit**: YES (groups with Tasks 1, 2, 3)
  - Message: (shared commit — see Task 1)
  - Files: `packages/corgispec/assets/commands/claude/corgi/migrate.md`
  - Pre-commit: none

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 3 review checks run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **File Count Verification** — `quick`
  Run `ls packages/corgispec/assets/commands/claude/corgi/ | wc -l` → must be 12. List all files for visual confirmation.
  Output: `Count [12/12] | VERDICT: APPROVE/REJECT`

- [x] F2. **Content Verification** — `quick`
  For each of the 4 new files, verify: (1) frontmatter has `name:`, `description:`, `category:`, `tags:` (2) dispatch target matches expected skill name (3) `human-qa.md` contains isolation check (4) `migrate.md` contains precondition check and uses Claude syntax `/corgi:memory-init`.
  Output: `human-qa [OK/FAIL] | ask [OK/FAIL] | memory-init [OK/FAIL] | migrate [OK/FAIL] | VERDICT`

- [x] F3. **Git Cleanliness Check** — `quick`
  Run `git diff --name-only` and `git diff --stat`. Verify exactly 4 new files appear, zero modifications to existing files.
  Output: `New files [4] | Modified files [0] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

- **Single commit** after all 4 tasks complete:
  - Message: `fix(commands): add 4 missing Claude Code command dispatch files`
  - Files: `packages/corgispec/assets/commands/claude/corgi/human-qa.md`, `ask.md`, `memory-init.md`, `migrate.md`
  - Pre-commit: `ls packages/corgispec/assets/commands/claude/corgi/ | wc -l` (expect 12)

---

## Success Criteria

### Verification Commands
```bash
ls packages/corgispec/assets/commands/claude/corgi/ | wc -l    # Expected: 12
grep -l "corgispec-human-qa" packages/corgispec/assets/commands/claude/corgi/*.md    # Expected: human-qa.md
grep -l "corgispec-ask" packages/corgispec/assets/commands/claude/corgi/*.md         # Expected: ask.md
grep -l "corgispec-memory-init" packages/corgispec/assets/commands/claude/corgi/*.md # Expected: memory-init.md
grep -l "corgispec-memory-migrate" packages/corgispec/assets/commands/claude/corgi/*.md # Expected: migrate.md
git diff --name-only    # Expected: exactly 4 new files
```

### Final Checklist
- [x] All 4 new files created in `packages/corgispec/assets/commands/claude/corgi/`
- [x] Each file has Claude frontmatter (`name`, `description`, `category`, `tags`)
- [x] `human-qa.md` has isolation check (Full pattern)
- [x] `migrate.md` has precondition check (Minimal + preconditions)
- [x] `ask.md` and `memory-init.md` follow Minimal pattern
- [x] No existing files modified
- [x] Total command count: 12 (matching OpenCode's 12)
