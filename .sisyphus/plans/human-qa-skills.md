# Human QA Skills Implementation

## TL;DR

> **Quick Summary**: Create a Human QA phase (1 molecule + 6 atoms + 1 command wrapper) that slots between `review` and `archive` in the Corgi workflow, plus modify 2 archive skills to gate on QA status.
> 
> **Deliverables**:
> - Command wrapper: `/corgi-human-qa`
> - Molecule skill: `corgispec-human-qa`
> - 6 Atom skills: `qa-smoke`, `qa-ui`, `qa-backend`, `qa-api`, `qa-cli`, `qa-exploratory`
> - Archive gate modification (GitLab + GitHub)
> - Research sources reference doc
> - All synced across `.opencode/`, `.claude/`, `.codex/`
> 
> **Estimated Effort**: Large (~6h)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Atoms → Molecule → Archive mods → Sync + Validate

---

## Context

### Original Request
Implement the Human QA phase as designed in `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md`. This inserts a structured QA gate between `review` and `archive` using SBTM, HTSM, and Test Tours methodologies.

### Design Source
The implementation plan is fully specified in the wiki decision document. Key architectural choices:
- Molecule routes to atoms based on change type classification
- Risk assessment (HTSM heuristics) determines QA depth
- SBTM framework for exploratory testing
- 12 Test Tours for guided exploration
- Conversational test case collection protocol
- `qa-report.md` as the authoritative local artifact

### Metis Review
**Identified Gaps** (addressed):
- Schema compatibility: Verified — `schemas/skill-meta.schema.json` supports all planned fields
- 3-directory sync: `.claude/skills/` uses real file copies, `.codex/skills/` uses directory symlinks to `.claude/`
- `installation` field: Confirmed required in schema, plan's meta.json is compliant
- SKILL.md language: Must be English (existing convention), despite Chinese design doc
- Archive path confirmed: `.opencode/skills/molecules/corgispec-archive-change/SKILL.md`

---

## Work Objectives

### Core Objective
Add a Human QA phase to the Corgi workflow pipeline, implemented as composable skills following Skill Graph 2.0 architecture.

### Concrete Deliverables
- 16 new files (7 skills × 2 files each + 1 command + 1 reference)
- 2 modified files (archive skills with QA gate)
- All new skills synced to 3 platform directories

### Definition of Done
- [ ] `node tools/ds-skills/bin/ds-skills.js validate --path .` exits 0
- [ ] All 7 new skills appear in `node tools/ds-skills/bin/ds-skills.js list --path .`
- [ ] `node tools/ds-skills/bin/ds-skills.js graph --path .` shows molecule → 6 atoms
- [ ] Files identical across `.opencode/`, `.claude/`, `.codex/` for all new skills
- [ ] Both archive SKILL.md files contain QA gate logic

### Must Have
- All SKILL.md content in English
- skill.meta.json validates against `schemas/skill-meta.schema.json`
- Molecule depends_on lists all 6 atom slugs
- Archive gate: passed → continue, failed → stop, skipped → continue with note, missing → warn + confirm
- qa-smoke acts as hard gate (failure aborts remaining atoms)

### Must NOT Have (Guardrails)
- DO NOT add Phase 2 atoms (database, security, accessibility, performance, e2e) — even as stubs
- DO NOT modify `schemas/skill-meta.schema.json`
- DO NOT modify `packages/corgispec/` source code
- DO NOT update README.md or pipeline diagrams
- DO NOT create new test files (rely on existing `ds-skills validate`)
- DO NOT touch any existing skills except the 2 archive skills
- DO NOT add `workflow::qa` labels or tracker state changes (Phase 2)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (`tools/ds-skills` with validate/list/graph commands)
- **Automated tests**: None (skill files are validated via schema, not unit tested)
- **Framework**: `ds-skills validate` (JSON Schema validation + tier/cycle checks)

### QA Policy
Every task verified by running `ds-skills validate` and checking file existence/content.
Evidence saved to `.sisyphus/evidence/task-{N}-*.txt`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 6 atom skills, fully parallel):
├── Task 1: corgispec-qa-smoke atom [quick]
├── Task 2: corgispec-qa-ui atom [quick]
├── Task 3: corgispec-qa-backend atom [quick]
├── Task 4: corgispec-qa-api atom [quick]
├── Task 5: corgispec-qa-cli atom [quick]
└── Task 6: corgispec-qa-exploratory atom [unspecified-high]

Wave 2 (After Wave 1 — molecule + command + reference):
├── Task 7: corgispec-human-qa molecule (depends: 1-6) [unspecified-high]
├── Task 8: Command wrapper corgi-human-qa.md (depends: 7) [quick]
└── Task 9: Research sources reference doc [quick]

Wave 3 (After Wave 2 — archive mods + sync):
├── Task 10: Archive gate — GitLab (depends: 7) [quick]
├── Task 11: Archive gate — GitHub (depends: 7) [quick]
├── Task 12: 3-directory sync all new skills [unspecified-high]
└── Task 13: Final validation run [quick]

Wave FINAL (After ALL — review):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Validation + sync check QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Tasks 1-6 → Task 7 → Task 10-11 → Task 12 → Task 13 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 6 (Wave 1)
```

### Dependency Matrix

| Task | Blocked By | Blocks |
|------|-----------|--------|
| 1-5 | None | 7, 12 |
| 6 | None | 7, 12 |
| 7 | 1-6 | 8, 10, 11, 12 |
| 8 | 7 | 12 |
| 9 | None | 12 |
| 10 | 7 | 12 |
| 11 | 7 | 12 |
| 12 | 1-11 | 13 |
| 13 | 12 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: 6 tasks → all `quick` except Task 6 (`unspecified-high`)
- **Wave 2**: 3 tasks → T7 `unspecified-high`, T8-9 `quick`
- **Wave 3**: 4 tasks → T12 `unspecified-high`, T10-11-13 `quick`
- **FINAL**: 4 tasks → F1 `oracle`, F2-F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. Create `corgispec-qa-smoke` atom skill

  **What to do**:
  - Create `.opencode/skills/atoms/corgispec-qa-smoke/SKILL.md` with English walkthrough instructions
  - Create `.opencode/skills/atoms/corgispec-qa-smoke/skill.meta.json`
  - SKILL.md content: "Does it even launch?" gate — app starts, critical paths accessible, no runtime errors, build version correct
  - If smoke fails → abort QA, output failure reason
  - Include section for reading `qa-testcases.md` if it exists (assigned cases)
  - meta.json: `slug: corgispec-qa-smoke`, `tier: atom`, `platform: universal`, `depends_on: []`, `tags: ["qa","smoke","gate"]`, `installation: {targets:["opencode","claude","codex"], base_path:"atoms/corgispec-qa-smoke"}`

  **Must NOT do**:
  - No Phase 2 content
  - No Chinese in SKILL.md

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`writing-skills`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2-6)
  - **Blocks**: Task 7, Task 12
  - **Blocked By**: None

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:393-429` — Full smoke atom spec with walkthrough contract and meta.json
  - `.opencode/skills/atoms/corgispec-memory-extract/SKILL.md` — Example atom SKILL.md structure
  - `.opencode/skills/atoms/corgispec-memory-extract/skill.meta.json` — Example atom meta.json
  - `schemas/skill-meta.schema.json` — Schema to validate against

  **Acceptance Criteria**:
  - [ ] File exists: `.opencode/skills/atoms/corgispec-qa-smoke/SKILL.md`
  - [ ] File exists: `.opencode/skills/atoms/corgispec-qa-smoke/skill.meta.json`
  - [ ] meta.json is valid JSON and conforms to schema

  **QA Scenarios**:
  ```
  Scenario: Validate skill files exist and pass schema
    Tool: Bash
    Steps:
      1. Run: test -f .opencode/skills/atoms/corgispec-qa-smoke/skill.meta.json && echo "EXISTS"
      2. Assert "EXISTS"
      3. Run: test -f .opencode/skills/atoms/corgispec-qa-smoke/SKILL.md && echo "EXISTS"
      4. Assert "EXISTS"
      5. Run (workdir: tools/ds-skills): node bin/ds-skills.js validate --path ../..
      6. Assert exit code 0
    Expected Result: Files exist and validation passes
    Evidence: .sisyphus/evidence/task-1-schema-validate.txt

  Scenario: SKILL.md is English and non-empty
    Tool: Bash
    Steps:
      1. Run: wc -l .opencode/skills/atoms/corgispec-qa-smoke/SKILL.md
      2. Assert line count > 20
      3. Run: grep -cP "[\x{4e00}-\x{9fff}]" .opencode/skills/atoms/corgispec-qa-smoke/SKILL.md || echo "0"
      4. Assert count is 0 (no Chinese characters)
    Expected Result: File has >20 lines, 0 Chinese characters
    Evidence: .sisyphus/evidence/task-1-english-check.txt
  ```

  **Commit**: NO (groups with final commit)

- [x] 2. Create `corgispec-qa-ui` atom skill

  **What to do**:
  - Create `.opencode/skills/atoms/corgispec-qa-ui/SKILL.md` — UI walkthrough from real user perspective
  - Create `.opencode/skills/atoms/corgispec-qa-ui/skill.meta.json`
  - SKILL.md content: Real page navigation, user path operation, component states (loading/empty/error/edge), screenshots (3+ key states), error paths, responsive boundaries, keyboard navigation, cross-browser
  - Include section for reading `qa-testcases.md` assigned cases
  - meta.json: `slug: corgispec-qa-ui`, `tier: atom`, `platform: universal`, `depends_on: []`, `tags: ["qa","ui","walkthrough"]`, `installation: {targets:["opencode","claude","codex"], base_path:"atoms/corgispec-qa-ui"}`

  **Must NOT do**: No Phase 2 content (accessibility is separate atom in Phase 2)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`writing-skills`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3-6)
  - **Blocks**: Task 7, Task 12
  - **Blocked By**: None

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:433-472` — Full UI atom spec with walkthrough contract
  - `.opencode/skills/atoms/corgispec-memory-extract/SKILL.md` — Atom structure example

  **Acceptance Criteria**:
  - [ ] File exists: `.opencode/skills/atoms/corgispec-qa-ui/SKILL.md`
  - [ ] File exists: `.opencode/skills/atoms/corgispec-qa-ui/skill.meta.json`
  - [ ] meta.json valid against schema

  **QA Scenarios**:
  ```
  Scenario: Validate skill files exist and pass schema
    Tool: Bash
    Steps:
      1. Run: test -f .opencode/skills/atoms/corgispec-qa-ui/skill.meta.json && echo "EXISTS"
      2. Assert "EXISTS"
      3. Run: test -f .opencode/skills/atoms/corgispec-qa-ui/SKILL.md && echo "EXISTS"
      4. Assert "EXISTS"
      5. Run (workdir: tools/ds-skills): node bin/ds-skills.js validate --path ../..
      6. Assert exit code 0
    Expected Result: Files exist and full validation passes
    Evidence: .sisyphus/evidence/task-2-schema-validate.txt
  ```

  **Commit**: NO (groups with final commit)

- [x] 3. Create `corgispec-qa-backend` atom skill

  **What to do**:
  - Create `.opencode/skills/atoms/corgispec-qa-backend/SKILL.md` — Backend logic walkthrough
  - Create `.opencode/skills/atoms/corgispec-qa-backend/skill.meta.json`
  - SKILL.md: Trace from root function/entry to target logic, record input params + return values, happy path + error path, DB write/read verification, 3-layer call chain depth, auth pyramid
  - meta.json: `slug: corgispec-qa-backend`, `tier: atom`, `platform: universal`, `depends_on: []`, `tags: ["qa","backend","walkthrough"]`, `installation: {targets:["opencode","claude","codex"], base_path:"atoms/corgispec-qa-backend"}`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`writing-skills`]

  **Parallelization**: Wave 1, parallel with Tasks 1-2, 4-6. Blocks: 7, 12. Blocked By: None.

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:476-512` — Backend atom spec

  **Acceptance Criteria**:
  - [ ] Both files exist and meta.json validates against schema

  **QA Scenarios**:
  ```
  Scenario: Schema validation
    Tool: Bash
    Steps:
      1. Run: test -f .opencode/skills/atoms/corgispec-qa-backend/skill.meta.json && echo "EXISTS"
      2. Assert "EXISTS"
      3. Run (workdir: tools/ds-skills): node bin/ds-skills.js validate --path ../..
      4. Assert exit code 0
    Expected Result: File exists and validation passes
    Evidence: .sisyphus/evidence/task-3-schema-validate.txt
  ```

  **Commit**: NO

- [x] 4. Create `corgispec-qa-api` atom skill

  **What to do**:
  - Create `.opencode/skills/atoms/corgispec-qa-api/SKILL.md` — API endpoint walkthrough
  - Create `.opencode/skills/atoms/corgispec-qa-api/skill.meta.json`
  - SKILL.md: Real HTTP client/curl calls, full request/response recording, auth pyramid (unauth→auth→insufficient→admin), CRUD per role, 2xx+4xx+5xx coverage, response format vs spec, boundary tests (empty body, large payload, special chars)
  - meta.json: `slug: corgispec-qa-api`, `tier: atom`, `platform: universal`, `depends_on: []`, `tags: ["qa","api","walkthrough"]`, `installation: {targets:["opencode","claude","codex"], base_path:"atoms/corgispec-qa-api"}`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`writing-skills`]

  **Parallelization**: Wave 1. Blocks: 7, 12. Blocked By: None.

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:516-554` — API atom spec

  **Acceptance Criteria**:
  - [ ] Both files exist and meta.json validates

  **QA Scenarios**:
  ```
  Scenario: Schema validation
    Tool: Bash
    Steps:
      1. Run: test -f .opencode/skills/atoms/corgispec-qa-api/skill.meta.json && echo "EXISTS"
      2. Assert "EXISTS"
      3. Run (workdir: tools/ds-skills): node bin/ds-skills.js validate --path ../..
      4. Assert exit code 0
    Expected Result: File exists and validation passes
    Evidence: .sisyphus/evidence/task-4-schema-validate.txt
  ```

  **Commit**: NO

- [x] 5. Create `corgispec-qa-cli` atom skill

  **What to do**:
  - Create `.opencode/skills/atoms/corgispec-qa-cli/SKILL.md` — CLI walkthrough
  - Create `.opencode/skills/atoms/corgispec-qa-cli/skill.meta.json`
  - SKILL.md: Execute commands/subcommands, flag combos (required/optional/conflicting), stdout/stderr recording, --help completeness, success + error input, exit codes, env var overrides
  - meta.json: `slug: corgispec-qa-cli`, `tier: atom`, `platform: universal`, `depends_on: []`, `tags: ["qa","cli","walkthrough"]`, `installation: {targets:["opencode","claude","codex"], base_path:"atoms/corgispec-qa-cli"}`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`writing-skills`]

  **Parallelization**: Wave 1. Blocks: 7, 12. Blocked By: None.

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:558-598` — CLI atom spec

  **Acceptance Criteria**:
  - [ ] Both files exist and meta.json validates

  **QA Scenarios**:
  ```
  Scenario: Validate skill files exist and pass schema
    Tool: Bash
    Steps:
      1. Run: test -f .opencode/skills/atoms/corgispec-qa-cli/skill.meta.json && echo "EXISTS"
      2. Assert "EXISTS"
      3. Run: test -f .opencode/skills/atoms/corgispec-qa-cli/SKILL.md && echo "EXISTS"
      4. Assert "EXISTS"
      5. Run (workdir: tools/ds-skills): node bin/ds-skills.js validate --path ../..
      6. Assert exit code 0
    Expected Result: Files exist and validation passes
    Evidence: .sisyphus/evidence/task-5-schema-validate.txt

  Scenario: SKILL.md is English and non-empty
    Tool: Bash
    Steps:
      1. Run: wc -l .opencode/skills/atoms/corgispec-qa-cli/SKILL.md
      2. Assert line count > 20
      3. Run: grep -cP "[\x{4e00}-\x{9fff}]" .opencode/skills/atoms/corgispec-qa-cli/SKILL.md || echo "0"
      4. Assert count is 0
    Expected Result: >20 lines, 0 Chinese characters
    Evidence: .sisyphus/evidence/task-5-english-check.txt
  ```

  **Commit**: NO

- [x] 6. Create `corgispec-qa-exploratory` atom skill

  **What to do**:
  - Create `.opencode/skills/atoms/corgispec-qa-exploratory/SKILL.md` — SBTM exploratory testing session
  - Create `.opencode/skills/atoms/corgispec-qa-exploratory/skill.meta.json`
  - SKILL.md (richest atom): Full SBTM session structure (Charter 5min → Explore 30-55min → Note continuous → Debrief 10-15min), 12 Test Tours table with descriptions and "when to recommend", session report structure, findings format (severity/evidence/reproducible/test_case_result)
  - meta.json: `slug: corgispec-qa-exploratory`, `tier: atom`, `platform: universal`, `depends_on: []`, `tags: ["qa","exploratory","sbtm"]`, `installation: {targets:["opencode","claude","codex"], base_path:"atoms/corgispec-qa-exploratory"}`

  **Must NOT do**: Don't over-engineer — this is instruction text, not runtime code

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Richest atom — requires careful structuring of SBTM methodology into actionable AI instructions
  - **Skills**: [`writing-skills`]

  **Parallelization**: Wave 1. Blocks: 7, 12. Blocked By: None.

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:600-667` — Full exploratory atom spec with SBTM structure and 12 tours

  **Acceptance Criteria**:
  - [ ] Both files exist and meta.json validates
  - [ ] SKILL.md contains all 12 Test Tours

  **QA Scenarios**:
  ```
  Scenario: Schema validation + tour coverage
    Tool: Bash
    Steps:
      1. Run: test -f .opencode/skills/atoms/corgispec-qa-exploratory/skill.meta.json && echo "EXISTS"
      2. Assert "EXISTS"
      3. Run (workdir: tools/ds-skills): node bin/ds-skills.js validate --path ../..
      4. Assert exit code 0
      5. Run: grep -c "Tour" .opencode/skills/atoms/corgispec-qa-exploratory/SKILL.md
      6. Assert count >= 12
    Expected Result: File exists, validation passes, >=12 tour references
    Evidence: .sisyphus/evidence/task-6-validate.txt
  ```

  **Commit**: NO

- [x] 7. Create `corgispec-human-qa` molecule skill

  **What to do**:
  - Create `.opencode/skills/molecules/corgispec-human-qa/SKILL.md` — The orchestrator molecule
  - Create `.opencode/skills/molecules/corgispec-human-qa/skill.meta.json`
  - SKILL.md must contain ALL 8 steps from the design:
    1. Select change + resolve worktree (reuse existing context gate pattern)
    2. Risk assessment (HTSM heuristics table: Complex/New/Changed/Critical/Popular/Buggy)
    3. Classify change type & route to atoms (routing table by file extensions)
    4. Collect human test cases (conversational protocol, structured sheet, confirmation)
    5. Execute atoms in sequence (smoke gate → type-specific → exploratory)
    6. Assemble qa-report.md (full SBTM debrief format template)
    7. Post summary to tracker (glab/gh)
    8. Gate output (passed/failed/skipped)
  - Include: Preconditions, Forbidden Actions, routing table, qa-report.md template
  - meta.json: `slug: corgispec-human-qa`, `tier: molecule`, `platform: universal`, `depends_on: ["corgispec-qa-smoke","corgispec-qa-ui","corgispec-qa-backend","corgispec-qa-api","corgispec-qa-cli","corgispec-qa-exploratory"]`, `tags: ["lifecycle","qa","human-gate"]`, `installation: {targets:["opencode","claude","codex"], base_path:"molecules/corgispec-human-qa"}`

  **Must NOT do**:
  - NEVER auto-pass QA
  - NEVER skip without explicit human reason
  - NEVER fabricate evidence
  - NEVER implement fixes during QA
  - NEVER change issue labels/workflow state

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Complex molecule with 8 steps, routing logic, conversational protocol, report template
  - **Skills**: [`writing-skills`]

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (sequential after Wave 1)
  - **Blocks**: Tasks 8, 10, 11, 12
  - **Blocked By**: Tasks 1-6

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:105-385` — Complete molecule spec (Steps 1-8, routing table, report format, gate output)
  - `.opencode/skills/molecules/corgispec-verify/SKILL.md` — Closest analog (universal platform, gate output, worktree resolution)
  - `.opencode/skills/molecules/corgispec-archive-change/SKILL.md` — Context gate pattern to reuse

  **Acceptance Criteria**:
  - [ ] Both files exist
  - [ ] meta.json validates and `depends_on` contains exactly 6 atom slugs
  - [ ] SKILL.md contains all 8 steps
  - [ ] Routing table present with all change types (UI/Backend/API/CLI/Full-stack/Config/Mixed)

  **QA Scenarios**:
  ```
  Scenario: Schema + dependency validation
    Tool: Bash
    Steps:
      1. Run: test -f .opencode/skills/molecules/corgispec-human-qa/skill.meta.json && echo "EXISTS"
      2. Assert "EXISTS"
      3. Run (workdir: tools/ds-skills): node bin/ds-skills.js validate --path ../..
      4. Assert exit code 0
      5. Run: node -e "const m=JSON.parse(require('fs').readFileSync('.opencode/skills/molecules/corgispec-human-qa/skill.meta.json'));console.log(m.depends_on.length===6?'PASS':'FAIL:'+m.depends_on.length)"
      6. Assert "PASS"
    Expected Result: Schema valid, exactly 6 dependencies
    Evidence: .sisyphus/evidence/task-7-validate.txt

  Scenario: All 8 steps present
    Tool: Bash
    Steps:
      1. Run: grep -c "Step [0-9]" .opencode/skills/molecules/corgispec-human-qa/SKILL.md
      2. Assert output number >= 8
    Expected Result: At least 8 step references
    Evidence: .sisyphus/evidence/task-7-steps.txt
  ```

  **Commit**: NO

- [x] 8. Create command wrapper `corgi-human-qa.md`

  **What to do**:
  - Create `.opencode/commands/corgi-human-qa.md`
  - Content: Read `openspec/config.yaml` → check schema field → check isolation mode → dispatch to `corgispec-human-qa` molecule → verify postconditions (qa-report.md exists, status clear, evidence present)
  - Follow pattern of existing `corgi-verify.md` wrapper

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`writing-skills`]

  **Parallelization**: Wave 2. Blocks: 12. Blocked By: 7.

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:91-101` — Command wrapper spec
  - `.opencode/commands/corgi-verify.md` — Pattern to follow (universal wrapper)

  **Acceptance Criteria**:
  - [ ] File exists: `.opencode/commands/corgi-human-qa.md`
  - [ ] References `corgispec-human-qa` skill

  **QA Scenarios**:
  ```
  Scenario: Command wrapper exists and references molecule
    Tool: Bash
    Steps:
      1. Run: test -f .opencode/commands/corgi-human-qa.md && echo "EXISTS"
      2. Assert output is "EXISTS"
      3. Run: grep -l "corgispec-human-qa" .opencode/commands/corgi-human-qa.md && echo "FOUND"
      4. Assert output contains "FOUND"
    Expected Result: File exists and contains molecule reference
    Evidence: .sisyphus/evidence/task-8-command.txt
  ```

  **Commit**: NO

- [x] 9. Create research sources reference doc

  **What to do**:
  - Create `.opencode/skills/molecules/corgispec-human-qa/references/research-sources.md`
  - Content: QA methodology sources (SBTM, HTSM, Risk-Based Testing, Test Tours, Manual Testing standards, Bug Report standards)
  - Copy from design doc section (Phase 5)
  - NOTE: While AGENTS.md states "exactly two files" per skill, the repo already has `references/` subdirectories in multiple existing skills (e.g., `corgispec-verify/references/`, `corgispec-review/references/`). This is an established pattern. The `ds-skills validate` tool does not flag reference files.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**: Wave 2 (no deps, but logically groups with molecule). Blocks: 12. Blocked By: None.

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:710-736` — Exact content
  - `.opencode/skills/molecules/corgispec-verify/references/` — Existing precedent for references/ subdir

  **Acceptance Criteria**:
  - [ ] File exists at specified path

  **QA Scenarios**:
  ```
  Scenario: File exists
    Tool: Bash
    Steps:
      1. Run: test -f .opencode/skills/molecules/corgispec-human-qa/references/research-sources.md && echo "PASS"
      2. Assert output is "PASS"
    Expected Result: Reference file exists
    Evidence: .sisyphus/evidence/task-9-reference.txt
  ```

  **Commit**: NO

- [x] 10. Add QA gate to GitLab archive skill

  **What to do**:
  - Modify `.opencode/skills/molecules/corgispec-archive-change/SKILL.md`
  - Insert new step after task completion check, before delta spec sync
  - Logic: Read `openspec/changes/<name>/qa-report.md`. If exists: passed→continue, failed→STOP with message, skipped→continue with note. If not exists: WARN + user confirm (not a hard block for backward compat)
  - Keep modification minimal and surgical

  **Must NOT do**: Don't restructure or rewrite other parts of the archive skill

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**: Wave 3. Blocks: 12. Blocked By: 7.

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:675-699` — Exact QA gate logic
  - `.opencode/skills/molecules/corgispec-archive-change/SKILL.md` — File to modify

  **Acceptance Criteria**:
  - [ ] `grep "qa-report" .opencode/skills/molecules/corgispec-archive-change/SKILL.md` returns match
  - [ ] Contains all 3 gate states: passed, failed, skipped

  **QA Scenarios**:
  ```
  Scenario: QA gate present with all states
    Tool: Bash
    Steps:
      1. grep -c "qa-report" .opencode/skills/molecules/corgispec-archive-change/SKILL.md
      2. grep -c "passed\|failed\|skipped" .opencode/skills/molecules/corgispec-archive-change/SKILL.md
      3. Assert both counts > 0
    Expected Result: qa-report referenced, all 3 states present
    Evidence: .sisyphus/evidence/task-10-gate.txt
  ```

  **Commit**: NO

- [x] 11. Add QA gate to GitHub archive skill

  **What to do**:
  - Modify `.opencode/skills/molecules/corgispec-gh-archive/SKILL.md` (canonical path — confirmed exists)
  - Insert identical QA gate logic as Task 10
  - Note: `.agents/skills/molecules/corgispec-gh-archive/SKILL.md` is another mirror — will be synced in Task 12

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**: Wave 3, parallel with Task 10. Blocks: 12. Blocked By: 7.

  **References**:
  - `wiki/decisions/2026-05-29/pre-archive-human-qa-implementation.md:700-707` — Same gate logic
  - `.opencode/skills/molecules/corgispec-gh-archive/SKILL.md` — File to modify (confirmed path)
  - Task 10's implementation — copy the same gate step

  **Acceptance Criteria**:
  - [ ] `.opencode/skills/molecules/corgispec-gh-archive/SKILL.md` contains QA gate with all 3 states

  **QA Scenarios**:
  ```
  Scenario: QA gate present with all states in gh-archive
    Tool: Bash
    Steps:
      1. grep -c "qa-report" .opencode/skills/molecules/corgispec-gh-archive/SKILL.md
      2. Assert count > 0
      3. grep -c "passed" .opencode/skills/molecules/corgispec-gh-archive/SKILL.md
      4. Assert count > 0
      5. grep -c "failed" .opencode/skills/molecules/corgispec-gh-archive/SKILL.md
      6. Assert count > 0
      7. grep -c "skipped" .opencode/skills/molecules/corgispec-gh-archive/SKILL.md
      8. Assert count > 0
    Expected Result: qa-report referenced, all 3 gate states present
    Evidence: .sisyphus/evidence/task-11-gate.txt
  ```

  **Commit**: NO

- [x] 12. Sync all new skills to `.claude/` and `.codex/` directories

  **What to do**:
  - Copy all 7 new skill directories from `.opencode/skills/` to `.claude/skills/` (real copies)
  - Atoms go to `.claude/skills/atoms/` and molecule to `.claude/skills/molecules/`
  - For `.codex/skills/`: Create **directory symlinks** pointing to `.claude/` (matches existing pattern)
    - Example: `ln -s ../../../.claude/skills/atoms/corgispec-qa-smoke .codex/skills/atoms/corgispec-qa-smoke`
    - Verify: existing `.codex/skills/atoms/corgispec-memory-extract` is a symlink to `../../../.claude/skills/atoms/corgispec-memory-extract`
  - Also sync archive modifications: copy updated SKILL.md to `.claude/` and verify `.codex/` symlinks still resolve
  - For `.agents/skills/molecules/corgispec-gh-archive/`: copy updated SKILL.md there too (this is a separate mirror, NOT part of the 3-dir sync obligation — it's specific to the `.agents` tooling and only needs the gh-archive modification synced)
  - NOTE: The 3-directory sync obligation (AGENTS.md) covers `.opencode/` → `.claude/` → `.codex/` only. The `.agents/` directory is an additional mirror that exists for some skills. For NEW skills, only create them in the 3 obligatory dirs. For MODIFIED skills (gh-archive), sync to `.agents/` as well since it already exists there.

  **Must NOT do**: Don't create real file copies in `.codex/` — use symlinks (matches existing pattern)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Many files to copy/symlink and verify across directories
  - **Skills**: []

  **Parallelization**: Wave 3 (after all content is finalized). Blocks: 13. Blocked By: 1-11.

  **References**:
  - AGENTS.md "Three-directory sync obligation" section
  - `.codex/skills/atoms/corgispec-memory-extract` — Example: symlink to `../../../.claude/skills/atoms/corgispec-memory-extract`
  - `.claude/skills/` — Real file copies (target of codex symlinks)

  **Acceptance Criteria**:
  - [ ] All 7 skill directories exist in `.claude/skills/` as real copies
  - [ ] All 7 skill directories exist in `.codex/skills/` as symlinks to `.claude/`
  - [ ] `diff -r .opencode/skills/atoms/corgispec-qa-smoke .claude/skills/atoms/corgispec-qa-smoke` returns empty
  - [ ] `readlink .codex/skills/atoms/corgispec-qa-smoke` returns `../../../.claude/skills/atoms/corgispec-qa-smoke`

  **QA Scenarios**:
  ```
  Scenario: Claude directory has real copies
    Tool: Bash
    Steps:
      1. Run: diff -r .opencode/skills/atoms/corgispec-qa-smoke .claude/skills/atoms/corgispec-qa-smoke
      2. Assert empty output (identical)
      3. Run: diff -r .opencode/skills/molecules/corgispec-human-qa .claude/skills/molecules/corgispec-human-qa
      4. Assert empty output
    Expected Result: All .claude copies match .opencode originals
    Evidence: .sisyphus/evidence/task-12-claude-sync.txt

  Scenario: Codex directory has correct symlinks
    Tool: Bash
    Steps:
      1. Run: readlink .codex/skills/atoms/corgispec-qa-smoke
      2. Assert output is "../../../.claude/skills/atoms/corgispec-qa-smoke"
      3. Run: readlink .codex/skills/molecules/corgispec-human-qa
      4. Assert output is "../../../.claude/skills/molecules/corgispec-human-qa"
      5. Run: test -f .codex/skills/atoms/corgispec-qa-smoke/SKILL.md && echo "RESOLVES"
      6. Assert "RESOLVES" (symlink resolves correctly)
    Expected Result: Symlinks exist and resolve
    Evidence: .sisyphus/evidence/task-12-codex-sync.txt

  Scenario: Archive skill sync to .claude and .agents
    Tool: Bash
    Steps:
      1. Run: diff .opencode/skills/molecules/corgispec-archive-change/SKILL.md .claude/skills/molecules/corgispec-archive-change/SKILL.md
      2. Assert empty (identical)
      3. Run: diff .opencode/skills/molecules/corgispec-gh-archive/SKILL.md .claude/skills/molecules/corgispec-gh-archive/SKILL.md
      4. Assert empty
      5. Run: diff .opencode/skills/molecules/corgispec-gh-archive/SKILL.md .agents/skills/molecules/corgispec-gh-archive/SKILL.md
      6. Assert empty
    Expected Result: All archive modifications synced
    Evidence: .sisyphus/evidence/task-12-archive-sync.txt
  ```

  **Commit**: NO

- [x] 13. Final validation run

  **What to do**:
  - Run `cd tools/ds-skills && node bin/ds-skills.js validate --path ../..`
  - Run `node bin/ds-skills.js list --path ../..` and verify 7 new skills appear
  - Run `node bin/ds-skills.js graph --path ../..` and verify molecule→atom edges
  - Fix any validation errors found

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**: Wave 3 (final). Blocks: F1-F4. Blocked By: 12.

  **References**:
  - `tools/ds-skills/bin/ds-skills.js` — Validation CLI

  **Acceptance Criteria**:
  - [ ] `validate` exits with 0 errors
  - [ ] `list` shows all 7 new skills
  - [ ] `graph` shows `corgispec-human-qa` depending on 6 atoms

  **QA Scenarios**:
  ```
  Scenario: Full validation suite
    Tool: Bash (workdir: tools/ds-skills)
    Steps:
      1. Run: node bin/ds-skills.js validate --path ../..
      2. Assert exit code 0 (no errors in output)
      3. Run: node bin/ds-skills.js list --path ../.. | grep "corgispec-qa"
      4. Assert output contains all 7 skill slugs: qa-smoke, qa-ui, qa-backend, qa-api, qa-cli, qa-exploratory, human-qa
      5. Run: node bin/ds-skills.js graph --path ../.. | grep "corgispec-human-qa"
      6. Assert output shows dependency arrows to 6 atoms
    Expected Result: 0 errors, 7 new skills listed, graph shows correct deps
    Evidence: .sisyphus/evidence/task-13-validate.txt
  ```

  **Commit**: YES
  - Message: `feat(skills): add human-qa phase — molecule + 6 atoms + archive gate`
  - Files: All new + modified files
  - Pre-commit: `cd tools/ds-skills && node bin/ds-skills.js validate --path ../..`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check all 16 new files exist. Verify archive mods contain QA gate.

  **QA Scenarios**:
  ```
  Scenario: Must Have verification
    Tool: Bash
    Steps:
      1. Run: test -f .opencode/skills/molecules/corgispec-human-qa/SKILL.md && echo "PASS"
      2. Run: test -f .opencode/skills/atoms/corgispec-qa-smoke/SKILL.md && echo "PASS"
      3. Run: grep -l "qa-report" .opencode/skills/molecules/corgispec-archive-change/SKILL.md && echo "PASS"
      4. Run: grep -l "qa-report" .opencode/skills/molecules/corgispec-gh-archive/SKILL.md && echo "PASS"
      5. Assert all 4 return "PASS"
    Expected Result: All must-haves present
    Evidence: .sisyphus/evidence/F1-compliance.txt

  Scenario: Must NOT Have verification
    Tool: Bash
    Steps:
      1. Run: test ! -d .opencode/skills/atoms/corgispec-qa-database && echo "PASS"
      2. Run: test ! -d .opencode/skills/atoms/corgispec-qa-security && echo "PASS"
      3. Run: git diff --name-only HEAD -- schemas/ packages/ tools/ | wc -l
      4. Assert count is 0
    Expected Result: No Phase 2 atoms, no infra changes
    Evidence: .sisyphus/evidence/F1-guardrails.txt
  ```
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run validation. Review SKILL.md files for: English content, no placeholder text, consistent formatting.

  **QA Scenarios**:
  ```
  Scenario: Full validation pass
    Tool: Bash (workdir: tools/ds-skills)
    Steps:
      1. Run: node bin/ds-skills.js validate --path ../..
      2. Assert exit code 0, no "error" in output
    Expected Result: All skills validate successfully
    Evidence: .sisyphus/evidence/F2-validate.txt

  Scenario: No Chinese in any new SKILL.md
    Tool: Bash
    Steps:
      1. Run: grep -rPl "[\x{4e00}-\x{9fff}]" .opencode/skills/atoms/corgispec-qa-*/ .opencode/skills/molecules/corgispec-human-qa/ 2>/dev/null || echo "NONE"
      2. Assert output is "NONE"
    Expected Result: Zero Chinese characters in new skill files
    Evidence: .sisyphus/evidence/F2-english.txt
  ```
  Output: `Validate [PASS/FAIL] | English [PASS/FAIL] | VERDICT`

- [x] F3. **Validation + Sync QA** — `unspecified-high`
  For each of 7 new skills: diff `.opencode/skills/` vs `.claude/skills/` vs `.codex/skills/`. All must be identical.

  **QA Scenarios**:
  ```
  Scenario: 3-directory sync verification
    Tool: Bash
    Steps:
      1. For each atom skill slug in [corgispec-qa-smoke, corgispec-qa-ui, corgispec-qa-backend, corgispec-qa-api, corgispec-qa-cli, corgispec-qa-exploratory]:
         diff -r .opencode/skills/atoms/$slug .claude/skills/atoms/$slug
         readlink .codex/skills/atoms/$slug (assert symlink to ../../../.claude/...)
      2. For molecule:
         diff -r .opencode/skills/molecules/corgispec-human-qa .claude/skills/molecules/corgispec-human-qa
         readlink .codex/skills/molecules/corgispec-human-qa
      3. Assert ALL diffs empty and ALL symlinks resolve
    Expected Result: .claude has real copies, .codex has working symlinks
    Evidence: .sisyphus/evidence/F3-sync.txt

  Scenario: Graph shows correct molecule→atom edges
    Tool: Bash (workdir: tools/ds-skills)
    Steps:
      1. Run: node bin/ds-skills.js graph --path ../..
      2. Assert output contains "corgispec-human-qa" with arrows to all 6 atom slugs
    Expected Result: Dependency graph correct
    Evidence: .sisyphus/evidence/F3-graph.txt
  ```
  Output: `Sync [N/N identical] | Graph [correct/incorrect] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  Verify ONLY expected files were touched. No Phase 2 atoms. No schema/package changes.

  **QA Scenarios**:
  ```
  Scenario: Only expected files changed
    Tool: Bash
    Steps:
      1. Run: git status --porcelain | grep -v "opencode/skills\|claude/skills\|codex/skills\|agents/skills\|opencode/commands\|sisyphus"
      2. Assert output is empty (no unexpected files)
    Expected Result: All changes within expected scope
    Evidence: .sisyphus/evidence/F4-scope.txt

  Scenario: No schema or package changes
    Tool: Bash
    Steps:
      1. Run: git diff --name-only HEAD -- schemas/ packages/ tools/ | wc -l
      2. Assert count is 0
    Expected Result: Zero changes to schemas, packages, or tools
    Evidence: .sisyphus/evidence/F4-no-infra.txt
  ```
  Output: `Files [expected/actual] | Scope [CLEAN/CREEP] | VERDICT`

---

## Commit Strategy

Single commit after all tasks complete:
- Message: `feat(skills): add human-qa phase — molecule + 6 atoms + archive gate`
- Pre-commit: `cd tools/ds-skills && node bin/ds-skills.js validate --path ../..`

---

## Success Criteria

### Verification Commands
```bash
cd tools/ds-skills && npm install && node bin/ds-skills.js validate --path ../..  # Expected: 0 errors
node bin/ds-skills.js list --path ../.. | grep "qa"  # Expected: 7 new skills listed
node bin/ds-skills.js graph --path ../.. | grep "corgispec-human-qa"  # Expected: shows deps
diff <(ls .opencode/skills/atoms/corgispec-qa-smoke/) <(ls .claude/skills/atoms/corgispec-qa-smoke/)  # Expected: empty
diff <(ls .opencode/skills/atoms/corgispec-qa-smoke/) <(ls .codex/skills/atoms/corgispec-qa-smoke/)  # Expected: empty
grep -l "qa-report" .opencode/skills/molecules/corgispec-archive-change/SKILL.md  # Expected: match
grep -l "qa-report" .opencode/skills/molecules/corgispec-gh-archive/SKILL.md  # Expected: match
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] Validation passes with 0 errors
- [ ] 3-directory sync verified
