# Fix: /corgi-loop Cannot Find Openspec Content in Worktrees

## TL;DR

> **Quick Summary**: Two bugs in `corgispec-loop`: (1) no worktree discovery — can't find change content in worktrees, and (2) verify/review phases are silently suppressed from issue trackers — no intermediate feedback on GitHub/GitLab issues during loop execution. The fix adds worktree discovery AND restores full issue sync parity with standalone apply/verify/review, replacing the human gate with automatic approve-or-fix-loop based on finding severity.
> 
> **Deliverables**:
> - `references/worktree-discovery.md` added to corgispec-loop compound (2 platforms)
> - Updated corgispec-loop SKILL.md with worktree discovery + issue sync parity (2 platforms)
> - Updated corgispec-review-loop SKILL.md with worktree acceptance + issue posting + auto-approve/reject (2 platforms)
> - All 18 worktree-discovery.md copies updated to list "loop" in "When This Applies"
> - Loop verify phase restored: posts verify report to child issue (matching standalone /corgi-verify)
> - Loop review phase restored: posts review report to child issue + auto-approve or auto-fix (matching standalone /corgi-review minus human gate)
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 2 → Task 4 → F1-F4

---

## Context

### Original Request
User reported two issues: (1) starting /corgi-loop cannot find openspec content in the current worktree, unlike /corgi-apply, and (2) during loop execution, verify and review phases do not post reports to GitHub/GitLab issues — only the apply closeout posts a summary. The user expects loop execution to have issue sync parity with standalone apply+verify+review, with the human gate replaced by automatic approve-or-fix-loop based on finding severity.

### Interview Summary
**Key Discussions**:
- Bug confirmed: loop skill has no worktree discovery mechanism
- Loop delegates to apply, verify, and review-loop — apply and verify have independent discovery, but review-loop has zero worktree awareness
- Fix scope: skill definition text only — no runtime code changes

**Research Findings**:
- 27 copies of worktree-discovery.md exist across 9 molecule skills × 3 platforms
- Two versions: 81-line canonical (24 copies) and 82-line verify variant (3 copies, adds "verify" to list)
- corgispec-loop has NO references/ directory in any platform
- `.claude/` loop SKILL.md is 59 lines shorter than `.opencode/` — **intentionally** (omits self-driving sections for Claude Code)
- `.codex/skills/` directory is completely empty (no skill files at all)
- review-loop SKILL.md has ZERO mentions of worktree — Context Gate only checks: change name, group number, platform, loop state dir

### Metis Review
**Identified Gaps** (addressed):
- Loop Context Gate checks "worktree valid" but never reads `isolation.mode` from config.yaml → Added isolation.mode reading to Context Gate task
- review-loop should only accept worktree context (not discover independently) → Guardrail added
- `.claude/` SKILL.md is platform-adapted (intentionally omits self-driving) → Guardrail: sync only worktree changes, preserve platform differences
- Section 3.4 (review-loop delegation) doesn't pass worktreePath → Added to update task
- Compaction recovery (Section 4) doesn't re-validate worktree → Added worktree existence check to Section 3.1
- `.claude/` review-loop mirror also needs updating → Added separate task

---

## Work Objectives

### Core Objective
Two goals:
1. Make `/corgi-loop` correctly discover and use worktree-isolated change content, matching the behavior of `/corgi-apply`.
2. Restore full issue sync parity — loop execution should produce the same issue artifacts (verify reports, review reports, label changes, commit/push, parent updates) as running `/corgi-apply` + `/corgi-verify` + `/corgi-review` separately. The only difference: the human gate in review is replaced by automatic approve (no critical/important findings) or automatic fix loop (critical/important findings found).

### Concrete Deliverables
- `references/worktree-discovery.md` in `.opencode/skills/compounds/corgispec-loop/` and `.claude/skills/compounds/corgispec-loop/`
- Updated loop SKILL.md in `.opencode/` and `.claude/` with worktree discovery logic
- Updated review-loop SKILL.md in `.opencode/` and `.claude/` with worktree path acceptance
- All 18 worktree-discovery.md files updated to list "loop" as a consumer

### Definition of Done
- [x] Loop initialization populates `worktreePath` in state.json with actual path (not `<path-or-null>`)
- [x] Loop passes `worktreePath` to ALL three delegates (apply, verify, review-loop)
- [x] Review-loop accepts `worktreePath` as input and resolves file paths relative to it
- [x] All worktree-discovery.md files list "loop" in "When This Applies"
- [x] `.opencode/` and `.claude/` versions both updated, preserving platform-specific differences
- [x] No changes to TypeScript/CLI code — skill definition text only
- [x] Verify phase posts verify report to child issue (matching standalone /corgi-verify Step 7)
- [x] Review phase posts review report to child issue (matching standalone /corgi-review Step 4)
- [x] Review phase auto-approves when no critical/important findings: commit + push + label done + parent update
- [x] Review phase auto-enters fix loop when critical/important findings exist (existing Section 3.6b/3.6c)
- [x] Issue sync uses correct platform CLI (gh for github-tracked, glab for gitlab-tracked)

### Must Have
**Worktree discovery:**
- Worktree discovery runs ONCE during loop initialization (Section 2)
- `isolation.mode` read from `openspec/config.yaml` in loop's Context Gate
- `worktreePath` passed to all delegates including review-loop (Section 3.4)
- Review-loop Context Gate updated to accept `worktreePath` as a context field
- Review-loop resolves file paths relative to `worktreePath` when provided
- Worktree existence re-check in Section 3.1 (Read State) for compaction recovery
- Both `.opencode/` and `.claude/` versions receive identical worktree additions

**Issue sync parity (NEW):**
- Verify phase (Section 3.3) MUST post verify report to child issue — remove the "only produce evidence" suppression instruction. The verify delegate runs its full Step 7 including issue comment posting.
- Review phase (Section 3.4) MUST post review report to child issue — add a step after writing review.json to post the report via `gh issue comment` or `glab issue note`.
- Review phase MUST implement auto-approve: when `review.json` has zero critical AND zero important findings → execute approve actions (commit + push + label child issue `done` + update parent progress)
- Review phase MUST implement auto-fix-loop: when `review.json` has any critical or important findings → enter the existing fixing phase (Section 3.6b/3.6c) which implements fixes and re-runs verify + review
- Label changes use correct platform CLI: `gh` for github-tracked, `glab` for gitlab-tracked
- Commit + push only after review report is posted to issue (same ordering as standalone /corgi-review)
- Parent issue progress updated after each group completes (approve) or resets (fix loop)
- Review-loop Forbidden Actions updated: remove "NEVER mutate issue labels or post to issue trackers", replace with "NEVER skip posting review report to child issue" and "NEVER ask for human approval — approval is automatic based on severity" 

### Must NOT Have (Guardrails)
- NO self-driving sections added to `.claude/` SKILL.md (intentionally omitted for Claude Code)
- NO independent worktree discovery in review-loop (it only accepts context from caller)
- NO de-duplication of worktree-discovery.md files (separate cleanup change)
- NO full `.codex/` mirror creation (`.codex/skills/` is empty — out of scope)
- NO modifications to molecule skills other than review-loop
- NO changes to TypeScript/CLI code or hook code (loop-check.ts) — all changes are skill definition text
- NO changes to test files or build configuration
- NO human gate in loop review — approval is fully automatic based on finding severity
- NO generating fix tasks into tasks.md during review — fixes are implemented directly in the fix loop (Section 3.6c)
- NO closing issues — only label changes (same as standalone review)
- NO verify suppression — the "only produce evidence" instruction in Section 3.3 is REMOVED

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: N/A (skill definition text only)
- **Automated tests**: None (text-only change)
- **Framework**: N/A

### QA Policy
Every task includes agent-executed QA scenarios using grep/diff/read commands.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Text verification**: Use Bash (grep/diff) — verify content patterns across files
- **Cross-platform consistency**: Use Bash (diff) — compare `.opencode/` vs `.claude/` versions
- **File existence**: Use Bash (ls/cat) — verify new files created correctly

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — start immediately):
├── Task 1: Add references/worktree-discovery.md to loop compound (.opencode/) [quick]
└── Task 6: Update all 18 worktree-discovery.md "When This Applies" sections [quick]

Wave 2 (Core changes — after Wave 1):
├── Task 2: Update .opencode/ loop SKILL.md with worktree discovery [unspecified-high]
├── Task 3: Update .opencode/ review-loop SKILL.md with worktree acceptance [unspecified-high]
├── Task 5: Update .claude/ review-loop SKILL.md with worktree acceptance [unspecified-high]
└── Task 7: Create .claude/ copy of worktree-discovery.md for loop compound [quick]

Wave 3 (After Task 2 — .claude/ loop depends on Task 2 pattern):
└── Task 4: Update .claude/ loop SKILL.md with worktree discovery (no self-driving) [unspecified-high]

Wave FINAL (After ALL tasks — parallel review):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Cross-platform consistency check (unspecified-high)
├── Task F3: Scope fidelity check (unspecified-high)
└── Task F4: Content verification — all patterns present (unspecified-high)
→ Present results → Get explicit user okay

Critical Path: Task 1 → Task 2 → Task 4 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 4 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 2, 7 |
| 2 | 1 | 4, F1-F4 |
| 3 | — | F1-F4 |
| 4 | 2 | F1-F4 |
| 5 | — | F1-F4 |
| 6 | — | F1-F4 |
| 7 | 1 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `quick`, T6 → `quick`
- **Wave 2**: 4 tasks — T2 → `unspecified-high`, T3 → `unspecified-high`, T5 → `unspecified-high`, T7 → `quick`
- **Wave 3**: 1 task — T4 → `unspecified-high`
- **Wave FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `unspecified-high`

---

## TODOs

- [x] 1. Add `references/worktree-discovery.md` to corgispec-loop compound (.opencode/)

  **What to do**:
  - Create directory: `.opencode/skills/compounds/corgispec-loop/references/`
  - Copy the canonical worktree-discovery.md (81 lines, from `.opencode/skills/molecules/corgispec-apply-change/references/worktree-discovery.md`)
  - Add "- **loop** — to find which change to loop over" to the "When This Applies" section (after "explore", before "Always use this procedure")

  **Must NOT do**:
  - Do NOT create a different version — use the canonical 81-line template as base
  - Do NOT de-duplicate or create shared references

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file copy with one line addition
  - **Skills**: []
    - No specialized skills needed for file copying

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 6)
  - **Blocks**: Tasks 2, 4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `.opencode/skills/molecules/corgispec-apply-change/references/worktree-discovery.md` — Canonical worktree-discovery.md (81 lines). Copy this file verbatim, then add "loop" to the "When This Applies" section.
  - `.opencode/skills/molecules/corgispec-verify/references/worktree-discovery.md` — Divergent version (82 lines) that adds "verify" to "When This Applies". Note the pattern: each skill adds its own name to the list.

  **API/Type References**: N/A

  **Test References**: N/A

  **External References**: N/A

  **WHY Each Reference Matters**:
  - The apply-change copy is the canonical template (81 lines, used by 8 of 9 molecule skills). Copy it exactly to maintain consistency.
  - The verify copy shows the pattern for adding a skill name to "When This Applies" — follow this pattern to add "loop".

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: File exists with correct content
    Tool: Bash (grep)
    Preconditions: File created
    Steps:
      1. ls .opencode/skills/compounds/corgispec-loop/references/worktree-discovery.md
      2. grep -c "When This Applies" .opencode/skills/compounds/corgispec-loop/references/worktree-discovery.md
      3. grep "loop" .opencode/skills/compounds/corgispec-loop/references/worktree-discovery.md
    Expected Result: File exists, contains "When This Applies" section, includes "loop" in the list
    Failure Indicators: File missing, "When This Applies" count is 0, "loop" not found
    Evidence: .sisyphus/evidence/task-1-file-exists.txt

  Scenario: File matches canonical pattern
    Tool: Bash (diff)
    Preconditions: Canonical file exists at apply-change/references/
    Steps:
      1. diff <(grep -v "loop" .opencode/skills/compounds/corgispec-loop/references/worktree-discovery.md) <(cat .opencode/skills/molecules/corgispec-apply-change/references/worktree-discovery.md)
    Expected Result: No diff (identical except for the added "loop" line)
    Failure Indicators: Diff shows unexpected differences
    Evidence: .sisyphus/evidence/task-1-canonical-diff.txt
  ```

  **Commit**: NO (groups with all tasks)

- [x] 2. Update `.opencode/` loop SKILL.md with worktree discovery

  **What to do**:
  - Read current file: `.opencode/skills/compounds/corgispec-loop/SKILL.md` (516 lines)

  **Worktree changes:**
  - **Step 1 (Context Gate)**: Add `isolation.mode` reading from `openspec/config.yaml`. After checking "config.yaml valid" and before "Change directory exists", add:
    - Read `openspec/config.yaml` and check `isolation.mode`
    - If `isolation.mode: worktree`: follow `references/worktree-discovery.md` for the full discovery procedure
    - If `isolation.mode: none` or missing: normal operation
  - **Step 2 (Initialization, Section 2.4)**: After counting task groups (2.1), add a new sub-step "2.1b Resolve worktree path" that:
    - If `isolation.mode: worktree`: runs discovery, populates `worktreePath` in state.json with the actual absolute path
    - If `isolation.mode: none`: sets `worktreePath: null`
    - Never leaves `worktreePath` as the literal string `<path-or-null>`
  - **Step 3.1 (Read State)**: Add worktree existence re-check after reading state.json
  - **Step 3.2 (Apply Phase)**: No change needed — already passes `state.worktreePath`
  - **Step 3.3 (Verify Phase)**: REMOVE the instruction that says "only produce evidence — no SEPARATE issue posting — issue sync is handled by the apply delegate's closeout, not by verify." Replace with: "The verify delegate runs its full normal flow including posting the verify report to the child issue (if tracked). Do NOT suppress issue posting. The verify report is evidence for both the issue tracker AND the loop artifacts."
  - **Step 3.3 (Verify Phase)**: Remove the `--loop-mode` flag from "Input to delegate" — it was used to suppress issue posting.
  - **Step 3.4 (Review-Evidence Phase)**: Add `worktreePath: state.worktreePath` to "Input to delegate".

  **Issue sync changes (NEW):**
  - **Step 3.4 (Review-Evidence Phase)**: After the review-loop delegate writes review.json, add a new sub-step "Post review report to child issue":
    - Assemble a review report from `review.json` findings (same format as standalone /corgi-review)
    - Post to child issue via platform CLI: `gh issue comment <child_number> --body "$REVIEW_REPORT"` or `glab issue note <child_iid> --message "$REVIEW_REPORT"`
    - Read tracking file (.github.yaml or .gitlab.yaml) to get child issue number
  - **Step 3.4 (Review-Evidence Phase)**: Add auto-approve/auto-reject logic AFTER posting review report:
    - **Auto-approve** (zero critical AND zero important in review.json): execute approve actions — commit all changes, push, change child issue label to `done`, update parent issue progress
    - **Auto-reject / fix loop** (any critical or important findings): enter the existing fixing phase (Section 3.6b/3.6c). The fixing phase implements fixes directly and re-runs verify + review.
    - This replaces the human gate. The decision is automatic based on severity counts in review.json.
  - **Section 3.6c (Direct Fix Implementation)**: Update Step 6 to include posting fix results back to the child issue after the fix loop resolves (post a "Fix applied" note with what was fixed)
  - **Forbidden Actions**: Remove "NEVER make lifecycle decisions" — the skill now makes automatic approve/reject decisions based on finding severity. Replace with "NEVER ask for human approval — approve/reject is automatic based on review.json severity counts" 

  **Must NOT do**:
  - Do NOT add self-driving sections (they already exist in .opencode/ version)
  - Do NOT change any other sections unrelated to worktree or issue sync
  - Do NOT modify the state.json schema (it already has worktreePath — just populate it correctly)
  - Do NOT add a human gate to the review phase — approval is automatic based on severity
  - Do NOT generate fix tasks into tasks.md during the fix loop — fixes are implemented directly (existing Section 3.6c behavior)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires careful text editing of a 516-line file with multiple insertion points
  - **Skills**: []
    - No specialized skills needed for text editing

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 3, after Task 1)
  - **Parallel Group**: Wave 2 (with Tasks 3, 5, 7)
  - **Blocks**: Task 4, F1-F4
  - **Blocked By**: Task 1 (needs worktree-discovery.md reference to exist)

  **References**:

  **Pattern References** (existing code to follow):
  - `.opencode/skills/molecules/corgispec-apply-change/SKILL.md` lines 32-46 — Apply's Context Gate with worktree discovery. Follow this exact pattern for the loop's Context Gate: read config.yaml, check isolation.mode, reference worktree-discovery.md, set workdir.
  - `.opencode/skills/molecules/corgispec-verify/SKILL.md` lines 34-48 — Verify's Context Gate. Same pattern, shows how to handle the Context Gate short-circuit when session context already has worktree info.
  - `.opencode/skills/compounds/corgispec-loop/SKILL.md` — The file being modified. Read the entire file to understand current structure before making changes.

  **API/Type References**: N/A

  **Test References**: N/A

  **External References**: N/A

  **WHY Each Reference Matters**:
  - Apply's Context Gate (lines 32-46) is the proven pattern for worktree discovery in this codebase. Copy its structure for the loop's Context Gate.
  - The current loop SKILL.md needs to be read in full to find the exact insertion points for each change (Context Gate, Initialization, Section 3.1, Section 3.4).

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Context Gate reads isolation.mode
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -n "isolation.mode" .opencode/skills/compounds/corgispec-loop/SKILL.md
      2. grep -n "worktree-discovery" .opencode/skills/compounds/corgispec-loop/SKILL.md
    Expected Result: Both patterns found, isolation.mode appears in Step 1 section, worktree-discovery appears as a reference
    Failure Indicators: Either pattern not found
    Evidence: .sisyphus/evidence/task-2-context-gate.txt

  Scenario: Initialization populates worktreePath
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -n "worktreePath" .opencode/skills/compounds/corgispec-loop/SKILL.md
      2. Verify the initialization section mentions populating worktreePath (not just the state.json template)
    Expected Result: worktreePath appears in initialization section with instructions to populate it from discovery, not just "<path-or-null>"
    Failure Indicators: Only the state.json template mentions worktreePath with no population logic
    Evidence: .sisyphus/evidence/task-2-init-path.txt

  Scenario: Section 3.4 passes worktreePath to review-loop
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. Read Section 3.4 "Review-Evidence Phase" of the modified SKILL.md
      2. Check "Input to delegate" includes worktreePath
    Expected Result: worktreePath or state.worktreePath listed in the delegate input for Section 3.4
    Failure Indicators: Section 3.4 only passes changeName, group, platformRoot (no worktreePath)
    Evidence: .sisyphus/evidence/task-2-section34.txt

  Scenario: Worktree existence re-check in Section 3.1
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. Read Section 3.1 "Read State" of the modified SKILL.md
      2. Check for worktree directory existence validation
    Expected Result: Section 3.1 includes a check like "If worktreePath is non-null, verify the directory still exists"
    Failure Indicators: No worktree validation in Section 3.1
    Evidence: .sisyphus/evidence/task-2-section31.txt

  Scenario: Verify suppression removed (issue sync parity)
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -c "only produce evidence" .opencode/skills/compounds/corgispec-loop/SKILL.md
      2. grep -c "loop-mode" .opencode/skills/compounds/corgispec-loop/SKILL.md
    Expected Result: 0 for both — the suppression instructions and --loop-mode flag are removed
    Failure Indicators: Count > 0 means suppression instructions remain
    Evidence: .sisyphus/evidence/task-2-no-suppress.txt

  Scenario: Review report posting added
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -c "review report to child issue\|Post review report" .opencode/skills/compounds/corgispec-loop/SKILL.md
    Expected Result: >= 1 — review report posting instruction exists
    Failure Indicators: Count = 0 means review posting was not added
    Evidence: .sisyphus/evidence/task-2-review-post.txt

  Scenario: Auto-approve/reject logic added
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -c "auto-approve\|Auto-approve\|automatic approve\|severity" .opencode/skills/compounds/corgispec-loop/SKILL.md
      2. grep -c "commit.*push.*label.*done\|approve actions" .opencode/skills/compounds/corgispec-loop/SKILL.md
    Expected Result: >= 1 for both — auto-approve logic and approve actions (commit+push+label) are present
    Failure Indicators: No auto-approve logic means human gate wasn't properly replaced
    Evidence: .sisyphus/evidence/task-2-auto-approve.txt
  ```

  **Commit**: NO (groups with all tasks)

- [x] 3. Update `.opencode/` review-loop SKILL.md with worktree acceptance

  **What to do**:
  - Read current file: `.opencode/skills/molecules/corgispec-review-loop/SKILL.md`

  **Worktree changes:**
  - **Context Gate (Step 1)**: Add `worktreePath` (or its absence) to the Context Gate checklist. Currently checks: "change name, group number, platform, and the loop state directory path". Add: "worktree path (if isolation.mode is worktree)"
  - **File Path Resolution**: After the Context Gate, add logic: "If `worktreePath` is provided, resolve all file paths (tasks.md, spec files, implementation files) relative to `worktreePath` instead of the current working directory"
  - **Delegation Input Documentation**: Add a note that when called from corgispec-loop, the caller provides `worktreePath` as an input parameter

  **Issue sync changes (NEW):**
  - **Forbidden Actions**: REMOVE "NEVER mutate issue labels or post to issue trackers". Replace with:
    - "NEVER ask for human approval — approval is automatic based on finding severity"
    - "NEVER skip posting the review report to the child issue (if tracked)"
    - "NEVER commit or push changes" (keep this — commit/push is the loop's responsibility, not review-loop's)
  - **New Step (after Step 3 — Write review.json)**: Add "Step 3b: Post review report to child issue":
    - Assemble a review report from `finding_details[]` in the same format as standalone /corgi-review (code quality table, architecture check, spec coverage, performance, severity summary)
    - Post to child issue via platform CLI: `gh issue comment` or `glab issue note`
    - Read the tracking file (.github.yaml or .gitlab.yaml) to get the child issue number
    - If no tracking file exists, skip issue posting silently
  - **New Step (Step 3c: Severity-based decision output)**: After posting, output a decision recommendation based on severity counts:
    - If `finding_details` has zero critical AND zero important → output `{ "decision": "approve" }` (the loop will commit + push + label)
    - If any critical or important → output `{ "decision": "fix" }` (the loop will enter fixing phase)
    - This is a recommendation only — the loop skill reads review.json directly and makes the final decision
  - **Postconditions**: Add: "Review report was posted to child issue (if tracked)" 

  **Must NOT do**:
  - Do NOT add independent worktree discovery — review-loop only accepts context from its caller
  - Do NOT read `openspec/config.yaml` — it trusts the caller to provide correct context
  - Do NOT add `references/worktree-discovery.md` — not needed for a context-acceptor
  - Do NOT commit or push — that's the loop skill's responsibility, not review-loop's
  - Do NOT ask for human approval — the decision is automatic based on severity counts
  - Do NOT close issues — only label changes (same as standalone review)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Careful text editing of a skill file with precise insertion points
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 5, 7)
  - **Blocks**: F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `.opencode/skills/molecules/corgispec-review-loop/SKILL.md` — The file being modified. Read the full file to understand the current Context Gate structure and where to add worktree path acceptance.

  **API/Type References**: N/A

  **Test References**: N/A

  **External References**: N/A

  **WHY Each Reference Matters**:
  - The review-loop file must be read in full to find the exact Context Gate checklist and determine where to add worktreePath as an accepted context field.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Review-loop Context Gate mentions worktreePath
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -n "worktreePath" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
      2. grep -n "worktree" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
    Expected Result: worktreePath found in Context Gate section, worktree awareness present
    Failure Indicators: "worktree" not found at all (zero mentions)
    Evidence: .sisyphus/evidence/task-3-context-gate.txt

  Scenario: Review-loop resolves paths relative to worktreePath
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -A5 "worktreePath" .opencode/skills/molecules/corgispec-review-loop/SKILL.md | grep -i "resolve\|path\|relative"
    Expected Result: Instructions to resolve file paths relative to worktreePath when provided
    Failure Indicators: No path resolution logic after worktreePath mention
    Evidence: .sisyphus/evidence/task-3-path-resolution.txt

  Scenario: Review-loop does NOT have independent discovery
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -c "worktree-discovery" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
      2. grep -c "openspec/config.yaml" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
    Expected Result: 0 for both — review-loop does NOT discover worktrees independently
    Failure Indicators: Count > 0 means independent discovery was added (violates guardrail)
    Evidence: .sisyphus/evidence/task-3-no-discovery.txt

  Scenario: Review-loop posts to issue tracker
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -c "issue comment\|issue note\|Post review report" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
    Expected Result: >= 1 — review-loop now posts review reports to child issues
    Failure Indicators: Count = 0 means issue posting step was not added
    Evidence: .sisyphus/evidence/task-3-issue-posting.txt

  Scenario: Review-loop Forbidden Actions updated
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep "NEVER mutate issue labels or post to issue trackers" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
      2. grep -c "NEVER ask for human approval" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
    Expected Result: First grep returns empty (old forbidden removed). Second grep >= 1 (new auto-approve guardrail added)
    Failure Indicators: Old forbidden action still present, or no human-approval prohibition
    Evidence: .sisyphus/evidence/task-3-forbidden-actions.txt
  ```

  **Commit**: NO (groups with all tasks)

- [x] 4. Update `.claude/` loop SKILL.md with worktree discovery (no self-driving)

  **What to do**:
  - Read current file: `.claude/skills/compounds/corgispec-loop/SKILL.md` (457 lines, Claude Code version)
  - Apply the SAME worktree AND issue sync changes as Task 2, but to this file:
    - **Step 1 (Context Gate)**: Add `isolation.mode` reading and worktree discovery reference (same as Task 2)
    - **Step 2 (Initialization)**: Add worktree path population (same as Task 2)
    - **Step 3.1 (Read State)**: Add worktree existence re-check (same as Task 2)
    - **Step 3.3 (Verify Phase)**: REMOVE "only produce evidence" suppression — restore full issue posting (same as Task 2)
    - **Step 3.4 (Review-Evidence Phase)**: Add worktreePath to delegate input + review report posting + auto-approve/reject (same as Task 2)
    - **Forbidden Actions**: Same changes as Task 2
  - **CRITICAL**: Do NOT add the self-driving evaluation loop (Sections 3.6b, 3.6c) — these are intentionally omitted from the Claude Code version. But DO include the issue sync changes and auto-approve/reject logic (those apply to both platforms).

  **Must NOT do**:
  - Do NOT add self-driving sections (3.6b, 3.6c) — Claude Code version intentionally lacks them
  - Do NOT copy the entire `.opencode/` version over `.claude/` — they have intentional platform differences
  - Do NOT add OpenCode-specific paths or references

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires careful platform-specific editing — must mirror Task 2's worktree changes without copying the self-driving sections
  - **Skills**: []
    - No specialized skills needed

  **Parallelization**:
  - **Can Run In Parallel**: NO (must run after Task 2)
  - **Parallel Group**: Wave 3 (sequential after Task 2)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 2 (mirrors Task 2's worktree changes to .claude/ version)

  **References**:

  **Pattern References** (existing code to follow):
  - `.claude/skills/compounds/corgispec-loop/SKILL.md` — The file being modified. Read the full file to understand the Claude Code-specific structure.
  - `.opencode/skills/compounds/corgispec-loop/SKILL.md` (after Task 2 modifies it) — The `.opencode/` version with worktree changes applied. Mirror ONLY the worktree-related changes (Context Gate isolation.mode, initialization worktreePath, Section 3.1 re-check, Section 3.4 worktreePath pass-through). Read this file to see the exact worktree patterns to replicate in the `.claude/` version.

  **API/Type References**: N/A

  **Test References**: N/A

  **External References**: N/A

  **WHY Each Reference Matters**:
  - The `.claude/` version has a different structure (no self-driving sections, different platform paths like `.claude/corgi-loop/` instead of `.opencode/corgi-loop/`). Must read it fully to find correct insertion points.
  - Task 2's output provides the exact text to mirror for worktree changes.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Worktree changes present in .claude/ version
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -n "isolation.mode" .claude/skills/compounds/corgispec-loop/SKILL.md
      2. grep -n "worktree-discovery" .claude/skills/compounds/corgispec-loop/SKILL.md
      3. grep -n "worktreePath" .claude/skills/compounds/corgispec-loop/SKILL.md
    Expected Result: All three patterns found in .claude/ version
    Failure Indicators: Any pattern missing
    Evidence: .sisyphus/evidence/task-4-worktree-present.txt

  Scenario: No self-driving sections in .claude/ version
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -c "3.6b Self-Driving" .claude/skills/compounds/corgispec-loop/SKILL.md
      2. grep -c "3.6c Direct Fix" .claude/skills/compounds/corgispec-loop/SKILL.md
    Expected Result: 0 for both — self-driving sections are NOT in the Claude Code version
    Failure Indicators: Count > 0 means self-driving was accidentally added
    Evidence: .sisyphus/evidence/task-4-no-self-driving.txt

  Scenario: Section 3.4 passes worktreePath in .claude/ version
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. Read Section 3.4 of the modified .claude/ SKILL.md
      2. Check "Input to delegate" includes worktreePath
    Expected Result: worktreePath listed in delegate input
    Failure Indicators: No worktreePath in Section 3.4
    Evidence: .sisyphus/evidence/task-4-section34.txt
  ```

  **Commit**: NO (groups with all tasks)

- [x] 5. Update `.claude/` review-loop SKILL.md with worktree acceptance

  **What to do**:
  - Read current file: `.claude/skills/molecules/corgispec-review-loop/SKILL.md`
  - Apply the SAME worktree AND issue sync changes as Task 3:
    - **Context Gate (Step 1)**: Add `worktreePath` to accepted context fields
    - **File Path Resolution**: Add logic to resolve file paths relative to `worktreePath` when provided
    - **Forbidden Actions**: Same changes as Task 3 (remove "NEVER post to issue trackers", add auto-approve constraints)
    - **New Step 3b**: Post review report to child issue (same as Task 3)
    - **New Step 3c**: Severity-based decision output (same as Task 3)
    - **Postconditions**: Same additions as Task 3
  - Ensure changes are IDENTICAL to Task 3's output (both platforms must have the same review-loop changes)

  **Must NOT do**:
  - Do NOT add independent worktree discovery (same guardrail as Task 3)
  - Do NOT diverge from Task 3's changes — both platforms must be identical for review-loop

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mirror of Task 3's changes to another file
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 3, 4)
  - **Blocks**: F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `.claude/skills/molecules/corgispec-review-loop/SKILL.md` — The file being modified. Read to understand current structure.
  - Task 3's output — The `.opencode/` version after modification. Mirror the exact same changes.

  **API/Type References**: N/A
  **Test References**: N/A
  **External References**: N/A

  **WHY Each Reference Matters**:
  - Task 3's output is the authoritative pattern — mirror it exactly to ensure cross-platform consistency.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: .claude/ review-loop has same worktree patterns as .opencode/
    Tool: Bash (grep + diff on specific sections)
    Preconditions: Both files modified (Task 3 and Task 5 complete)
    Steps:
      1. grep -c "worktreePath" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
      2. grep -c "worktreePath" .claude/skills/molecules/corgispec-review-loop/SKILL.md
      3. diff <(grep -A3 "worktreePath" .opencode/skills/molecules/corgispec-review-loop/SKILL.md) <(grep -A3 "worktreePath" .claude/skills/molecules/corgispec-review-loop/SKILL.md)
    Expected Result: Both files have the same count of worktreePath mentions. The diff of worktreePath context lines shows no differences (worktree handling is identical across platforms).
    Failure Indicators: worktreePath count differs between platforms, or diff shows different worktree handling text
    Evidence: .sisyphus/evidence/task-5-cross-platform-patterns.txt

  Scenario: .claude/ review-loop has worktreePath awareness
    Tool: Bash (grep)
    Preconditions: File modified
    Steps:
      1. grep -c "worktreePath" .claude/skills/molecules/corgispec-review-loop/SKILL.md
      2. grep -c "worktree" .claude/skills/molecules/corgispec-review-loop/SKILL.md
    Expected Result: worktreePath found, worktree mentions > 0
    Failure Indicators: No worktree mentions
    Evidence: .sisyphus/evidence/task-5-worktree-present.txt
  ```

  **Commit**: NO (groups with all tasks)

- [x] 6. Update all 18 worktree-discovery.md "When This Applies" sections

  **What to do**:
  - Add "- **loop** — to find which change to loop over" to the "When This Applies" section of ALL existing worktree-discovery.md files
  - Files to update (18 total across .opencode/ and .claude/):

  **`.opencode/` copies (9 files)**:
  - `.opencode/skills/molecules/corgispec-apply-change/references/worktree-discovery.md`
  - `.opencode/skills/molecules/corgispec-verify/references/worktree-discovery.md`
  - `.opencode/skills/molecules/corgispec-review/references/worktree-discovery.md`
  - `.opencode/skills/molecules/corgispec-archive-change/references/worktree-discovery.md`
  - `.opencode/skills/molecules/corgispec-explore/references/worktree-discovery.md`
  - `.opencode/skills/molecules/corgispec-gh-apply/references/worktree-discovery.md`
  - `.opencode/skills/molecules/corgispec-gh-review/references/worktree-discovery.md`
  - `.opencode/skills/molecules/corgispec-gh-archive/references/worktree-discovery.md`
  - `.opencode/skills/molecules/corgispec-gh-explore/references/worktree-discovery.md`

  **`.claude/` copies (9 files)**:
  - `.claude/skills/molecules/corgispec-apply-change/references/worktree-discovery.md`
  - `.claude/skills/molecules/corgispec-verify/references/worktree-discovery.md`
  - `.claude/skills/molecules/corgispec-review/references/worktree-discovery.md`
  - `.claude/skills/molecules/corgispec-archive-change/references/worktree-discovery.md`
  - `.claude/skills/molecules/corgispec-explore/references/worktree-discovery.md`
  - `.claude/skills/molecules/corgispec-gh-apply/references/worktree-discovery.md`
  - `.claude/skills/molecules/corgispec-gh-review/references/worktree-discovery.md`
  - `.claude/skills/molecules/corgispec-gh-archive/references/worktree-discovery.md`
  - `.claude/skills/molecules/corgispec-gh-explore/references/worktree-discovery.md`

  - Insert the new line after the "explore" bullet and before "Always use this procedure":
    ```
    - **loop** — to find which change to loop over
    ```
  - Also add the same line to the 2 NEW files created by Task 1 (`.opencode/` and `.claude/` loop copies) — but Task 1 already includes this, so only update the 18 EXISTING files.

  **Must NOT do**:
  - Do NOT change any other content in these files
  - Do NOT de-duplicate or restructure the files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical find-and-replace across 18 files with identical change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: F1-F4
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `.opencode/skills/molecules/corgispec-apply-change/references/worktree-discovery.md` — Lines 72-80 show the "When This Applies" section. Insert the new "loop" bullet after "explore" (line 79) and before "Always use this procedure" (line 81).

  **API/Type References**: N/A
  **Test References**: N/A
  **External References**: N/A

  **WHY Each Reference Matters**:
  - The apply-change copy is the canonical template. Use it to find the exact insertion point.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All worktree-discovery.md files mention loop
    Tool: Bash (grep + find)
    Preconditions: All 18 files updated
    Steps:
      1. find .opencode .claude -name "worktree-discovery.md" -exec grep -l "loop" {} \; | wc -l
      2. find .opencode .claude -name "worktree-discovery.md" | wc -l
    Expected Result: Both counts should be 20 (18 existing + 2 new from Task 1). Every file contains "loop".
    Failure Indicators: Count mismatch means some files were missed
    Evidence: .sisyphus/evidence/task-6-all-have-loop.txt

  Scenario: Only "loop" line added, no other changes
    Tool: Bash (diff)
    Preconditions: One file checked
    Steps:
      1. Pick any updated file and verify only one line was added (the "loop" bullet)
    Expected Result: Exactly one new line containing "- **loop** — to find which change to loop over"
    Failure Indicators: Additional changes detected
    Evidence: .sisyphus/evidence/task-6-minimal-diff.txt
  ```

  **Commit**: NO (groups with all tasks)

- [x] 7. Create `.claude/` copy of worktree-discovery.md for loop compound

  **What to do**:
  - Create directory: `.claude/skills/compounds/corgispec-loop/references/`
  - Copy the file created in Task 1 (`.opencode/skills/compounds/corgispec-loop/references/worktree-discovery.md`) to this location
  - Ensure it's byte-identical to the `.opencode/` version

  **Must NOT do**:
  - Do NOT create a different version — must be identical to the .opencode/ copy

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file copy
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 2, 3, 5)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 1 (needs the .opencode/ version to exist first)

  **References**:

  **Pattern References** (existing code to follow):
  - `.opencode/skills/compounds/corgispec-loop/references/worktree-discovery.md` — File created by Task 1. Copy this exactly.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: .claude/ copy is byte-identical to .opencode/ copy
    Tool: Bash (diff)
    Preconditions: Both files exist
    Steps:
      1. diff .opencode/skills/compounds/corgispec-loop/references/worktree-discovery.md .claude/skills/compounds/corgispec-loop/references/worktree-discovery.md
    Expected Result: No output (files identical)
    Failure Indicators: Diff output shows differences
    Evidence: .sisyphus/evidence/task-7-identical.txt
  ```

  **Commit**: NO (groups with all tasks)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify the change exists in the files (read file, grep for patterns). For each "Must NOT Have": search modified files for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Cross-Platform Consistency Check** — `unspecified-high`
  Diff `.opencode/` and `.claude/` versions of both modified skills. Verify: worktree-related content is identical between platforms. Self-driving sections exist ONLY in `.opencode/` version. Review-loop changes are identical across platforms. All worktree-discovery.md files have "loop" in "When This Applies".
  Output: `Loop .opencode vs .claude [MATCH/MISMATCH] | Review-loop .opencode vs .claude [MATCH/MISMATCH] | When This Applies [N/N have loop] | VERDICT`

- [x] F3. **Scope Fidelity Check** — `unspecified-high`
  For each task: read "What to do", check actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

- [x] F4. **Content Verification — All Patterns Present** — `unspecified-high`
  Grep all modified SKILL.md files for required patterns: `isolation.mode`, `worktree-discovery`, `worktreePath`, `references/worktree-discovery.md`. Verify review-loop's Context Gate mentions worktreePath. Verify loop's Section 3.4 passes worktreePath. Verify loop's initialization populates worktreePath. Report any missing patterns.
  Output: `Patterns [N/N found] | Missing [NONE or list] | VERDICT`

---

## Commit Strategy

- **Single commit**: `fix(loop): add worktree discovery + restore issue sync parity in loop pipeline`
  - All modified files
  - Pre-commit: `grep -r "worktreePath" .opencode/skills/compounds/corgispec-loop/ .claude/skills/compounds/corgispec-loop/ .opencode/skills/molecules/corgispec-review-loop/ .claude/skills/molecules/corgispec-review-loop/`

---

## Success Criteria

### Verification Commands
```bash
# === Worktree discovery ===

# 1. Loop has worktree-discovery reference
ls .opencode/skills/compounds/corgispec-loop/references/worktree-discovery.md
# Expected: file exists

# 2. Loop SKILL.md mentions worktree discovery
grep -c "worktree-discovery" .opencode/skills/compounds/corgispec-loop/SKILL.md
# Expected: >= 1

# 3. Review-loop accepts worktreePath
grep -c "worktreePath" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
# Expected: >= 1

# 4. All worktree-discovery.md files mention loop
find .opencode .claude -name "worktree-discovery.md" -exec grep -l "loop" {} \; | wc -l
# Expected: 20 (18 original + 2 new loop copies)

# === Issue sync parity ===

# 5. Loop SKILL.md does NOT suppress verify issue posting
grep -c "only produce evidence" .opencode/skills/compounds/corgispec-loop/SKILL.md
# Expected: 0 (the suppression instruction is removed)

# 6. Loop SKILL.md has review report posting instruction
grep -c "review report to child issue" .opencode/skills/compounds/corgispec-loop/SKILL.md
# Expected: >= 1

# 7. Loop SKILL.md has auto-approve logic
grep -c "auto-approve\|Auto-approve\|automatic approve" .opencode/skills/compounds/corgispec-loop/SKILL.md
# Expected: >= 1

# 8. Review-loop SKILL.md posts to issue tracker
grep -c "issue comment\|issue note\|Post review report" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
# Expected: >= 1

# 9. Review-loop Forbidden Actions updated (no longer forbids issue posting)
grep "NEVER mutate issue labels or post to issue trackers" .opencode/skills/molecules/corgispec-review-loop/SKILL.md
# Expected: empty (this line is removed)

# === Platform consistency ===

# 10. .claude/ loop does NOT have self-driving sections
grep -c "3.6b Self-Driving" .claude/skills/compounds/corgispec-loop/SKILL.md
# Expected: 0 (self-driving is OpenCode-only)

# 11. Both platforms have issue sync changes
grep -c "auto-approve\|auto-approve\|automatic approve" .claude/skills/compounds/corgispec-loop/SKILL.md
# Expected: >= 1 (Claude Code version also has auto-approve)
```

### Final Checklist
- [x] All "Must Have" present (worktree + issue sync)
- [x] All "Must NOT Have" absent
- [x] Both platform variants updated consistently
- [x] No accidental self-driving additions to .claude/
- [x] Verify phase issue posting restored in both platforms
- [x] Review phase posts report + auto-approves/rejects in both platforms
- [x] Review-loop no longer forbids issue posting
- [x] All evidence files captured
