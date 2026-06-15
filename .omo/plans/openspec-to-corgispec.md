# Fix `openspec` → `corgispec` CLI References in Skill Files

## TL;DR

> **Quick Summary**: Replace all `openspec` CLI command invocations in skill files with their correct `corgispec` equivalents. The `corgispec` CLI has different syntax for some commands, so simple `s/openspec/corgispec/` is insufficient.
>
> **Deliverables**:
> - 44 files updated: 22 unique files in `.opencode/skills/` + 22 mirrors in `.claude/skills/`
>   - 12 SKILL.md files (6 simple-rename + 6 complex) per directory
>   - 9 `worktree-discovery.md` reference files per directory
>   - 1 `artifact-creation.md` reference file per directory
> - All `openspec` CLI invocations replaced with verified `corgispec` equivalents
> - Directory paths (`openspec/`) preserved as-is (CLI is hardcoded to this directory)
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: None (all files independent)

---

## Context

### Original Request
User discovered skill files reference the `openspec` CLI binary, but the correct binary is `corgispec`. The skill files are the source of truth that gets distributed/installed into other projects via `corgispec bootstrap`.

### Interview Summary
**Key Discussions**:
- **Only CLI commands change**: Replace `openspec` command invocations; keep `openspec/` directory paths as-is (the CLI is hardcoded to look for `openspec/config.yaml`)
- **Both skill directories**: Update both `.opencode/skills/` (source of truth) and `.claude/skills/` (mirror)
- **Manual edit per file**: Use Edit tool for precise replacements, not sed
- **User-level skill excluded**: `/root/.config/opencode/skill/corgispec-gh-apply/SKILL.md` is not in scope

**Research Findings**:
- `corgispec` v2.3.2 is installed ✓
- `openspec` v1.3.1 exists but is legacy
- The `corgispec` CLI has different command syntax than `openspec` (verified by running actual commands)

### Verified Command Mappings

| # | Old (openspec) | New (corgispec) | Type |
|---|---|---|---|
| 1 | `openspec list --json` | `corgispec list --json` | Simple rename |
| 2 | `openspec status --change "<name>" --json` | `corgispec status "<name>" --json` | Syntax change (positional arg) |
| 3 | `openspec status --change "<name>"` | `corgispec status "<name>"` | Syntax change (no --json) |
| 4 | `openspec status --json` | `corgispec status --json` | Simple rename |
| 5 | `openspec new change "<name>"` | `corgispec propose <name>` | Different command name |
| 6 | `openspec instructions apply --change "<name>" --json` | `corgispec apply <name> --json` | Different command name |
| 7 | `openspec instructions <artifact-id> --change "<name>" --json` | `corgispec instructions <artifact-id> --change <name> --json` | Simple rename |

**Prose references** (in explanatory text, not code blocks):
| 8 | `openspec list` (in prose) | `corgispec list` | Simple rename |
| 9 | `openspec instructions` (in prose) | `corgispec instructions` | Simple rename |

---

## Work Objectives

### Core Objective
Replace all `openspec` CLI command invocations in skill files with their correct `corgispec` equivalents, preserving directory path references (`openspec/config.yaml`, `openspec/changes/`, etc.).

### Concrete Deliverables
- 44 files updated across `.opencode/skills/` and `.claude/skills/` (22 unique + 22 mirrors)
- Zero remaining `openspec` CLI command invocations in skill files
- All `openspec/` directory path references preserved

### Definition of Done
- [ ] `grep -rn 'openspec list\|openspec status\|openspec new\|openspec instructions apply\|openspec propose' .opencode/skills/ .claude/skills/` returns zero results
- [ ] `grep -rn 'openspec/config.yaml\|openspec/changes/\|openspec/schemas/\|openspec/specs/' .opencode/skills/ .claude/skills/` still returns results (preserved)

### Must Have
- All 6 command mappings applied correctly across all files
- Directory path references preserved

### Must NOT Have (Guardrails)
- Do NOT change `openspec/` directory paths (`openspec/config.yaml`, `openspec/changes/`, `openspec/schemas/`, `openspec/specs/`)
- Do NOT change `openspec` in package names or URLs (e.g., `github.com/Fission-AI/OpenSpec`)
- Do NOT modify files outside `.opencode/skills/` and `.claude/skills/`
- Do NOT rename the `openspec/` directory on disk

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (bash-based grep verification)
- **Automated tests**: None (documentation-only change)
- **Framework**: N/A

### QA Policy
Every task includes Agent-Executed QA Scenarios using bash grep to verify the changes.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.txt`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — simple rename files, MAX PARALLEL):
├── Task 1: Simple-rename SKILL.md files in .opencode/skills/ (6 files)
├── Task 2: Simple-rename SKILL.md files in .claude/skills/ (6 files)
├── Task 3: worktree-discovery.md reference files in .opencode/skills/ (9 files)
└── Task 4: worktree-discovery.md reference files in .claude/skills/ (9 files)

Wave 2 (After Wave 1 — complex command changes, MAX PARALLEL):
├── Task 5: corgispec-apply-change + corgispec-gh-apply SKILL.md (2 files, .opencode)
├── Task 6: corgispec-apply-change + corgispec-gh-apply SKILL.md (2 files, .claude)
├── Task 7: corgispec-archive-change + corgispec-gh-archive SKILL.md (2 files, .opencode)
├── Task 8: corgispec-archive-change + corgispec-gh-archive SKILL.md (2 files, .claude)
├── Task 9: corgispec-propose + corgispec-gh-propose SKILL.md (2 files, .opencode)
├── Task 10: corgispec-propose + corgispec-gh-propose SKILL.md (2 files, .claude)
├── Task 11: artifact-creation.md reference file (1 file, .opencode)
└── Task 12: artifact-creation.md reference file (1 file, .claude)

Wave 3 (After Wave 2 — verification):
├── Task 13: Global verification — grep for remaining openspec CLI refs
└── Task 14: Global verification — confirm directory paths preserved

Critical Path: None (all files independent)
Parallel Speedup: ~90% faster than sequential
Max Concurrent: 11 (Waves 1 & 2)
```

### Agent Dispatch Summary

- **Wave 1**: 4 tasks → `quick` (simple find-replace)
- **Wave 2**: 8 tasks → `quick` (precise edit per file)
- **Wave 3**: 2 tasks → `quick` (grep verification)

---

## TODOs

---

## Final Verification Wave

- [x] F1. **CLI References Clean** — `quick`
  Run `grep -rn 'openspec list\|openspec status\|openspec new\|openspec instructions apply\|openspec propose' .opencode/skills/ .claude/skills/`. Must return zero results.
  Output: `Remaining: [N] | VERDICT: PASS/FAIL`

- [x] F2. **Directory Paths Preserved** — `quick`
  Run `grep -rn 'openspec/config.yaml\|openspec/changes/' .opencode/skills/ .claude/skills/`. Must still return results (paths preserved).
  Output: `Preserved refs: [N] | VERDICT: PASS/FAIL`

---

## Commit Strategy

- **Single commit**: `fix(skills): replace openspec CLI references with corgispec equivalents`
  - All 44 files
  - Pre-commit: `grep -rn 'openspec list\|openspec status\|openspec new\|openspec instructions apply' .opencode/skills/ .claude/skills/` must return empty

---

## Success Criteria

### Verification Commands
```bash
# Must return ZERO results
grep -rn 'openspec list\|openspec status\|openspec new\|openspec instructions apply\|openspec propose' .opencode/skills/ .claude/skills/

# Must still return results (paths preserved)
grep -rn 'openspec/config.yaml\|openspec/changes/\|openspec/schemas/' .opencode/skills/ .claude/skills/ | wc -l
```

### Final Checklist
- [ ] All `openspec` CLI invocations replaced with correct `corgispec` equivalents
- [ ] All `openspec/` directory path references preserved
- [ ] Mirror consistency maintained between `.opencode/skills/` and `.claude/skills/`

- [x] 1. Simple rename: `.opencode/skills/` SKILL.md files (6 files)

  **What to do**:
  - In each file, replace `openspec list --json` with `corgispec list --json`
  - Also replace `openspec list` in prose (e.g., "via `openspec list`") with `corgispec list`
  - Files: `corgispec-explore/SKILL.md`, `corgispec-gh-explore/SKILL.md`, `corgispec-verify/SKILL.md`, `corgispec-review/SKILL.md`, `corgispec-gh-review/SKILL.md`, `corgispec-human-qa/SKILL.md`
  - Do NOT change `openspec/config.yaml`, `openspec/changes/`, or other directory paths

  **Must NOT do**:
  - Do NOT change `openspec/` in directory paths
  - Do NOT change `openspec` in package names or URLs

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Simple find-and-replace across 6 files, no complex logic

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec list' .opencode/skills/molecules/corgispec-explore/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list' .opencode/skills/molecules/corgispec-gh-explore/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list' .opencode/skills/molecules/corgispec-verify/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list' .opencode/skills/molecules/corgispec-review/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list' .opencode/skills/molecules/corgispec-gh-review/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list' .opencode/skills/molecules/corgispec-human-qa/SKILL.md` returns zero results
  - [ ] `grep -rn 'corgispec list'` on each file returns expected matches
  - [ ] Directory paths (`openspec/config.yaml`, `openspec/changes/`) still present in each file

  **QA Scenarios**:

  ```
  Scenario: Verify no openspec list references remain in all 6 files
    Tool: Bash (grep)
    Preconditions: All 6 files edited
    Steps:
      1. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-explore/SKILL.md
      2. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-gh-explore/SKILL.md
      3. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-verify/SKILL.md
      4. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-review/SKILL.md
      5. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-gh-review/SKILL.md
      6. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-human-qa/SKILL.md
    Expected Result: Zero matches in all 6 files (empty output for each)
    Failure Indicators: Any line containing "openspec list" in output
    Evidence: .sisyphus/evidence/task-1-openspec-list-gone.txt

  Scenario: Verify directory paths preserved in all 6 files
    Tool: Bash (grep)
    Preconditions: All 6 files edited
    Steps:
      1. grep -c 'openspec/config.yaml' .opencode/skills/molecules/corgispec-explore/SKILL.md
      2. grep -c 'openspec/config.yaml' .opencode/skills/molecules/corgispec-gh-explore/SKILL.md
      3. grep -c 'openspec/config.yaml' .opencode/skills/molecules/corgispec-verify/SKILL.md
      4. grep -c 'openspec/config.yaml' .opencode/skills/molecules/corgispec-review/SKILL.md
      5. grep -c 'openspec/config.yaml' .opencode/skills/molecules/corgispec-gh-review/SKILL.md
      6. grep -c 'openspec/config.yaml' .opencode/skills/molecules/corgispec-human-qa/SKILL.md
    Expected Result: All counts >= 1 (paths preserved, not changed)
    Failure Indicators: Zero count in any file (would mean paths were accidentally changed)
    Evidence: .sisyphus/evidence/task-1-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 1 tasks)
  - Message: `fix(skills): replace openspec list with corgispec list in simple-rename files`
  - Files: All 6 .opencode/skills/ files

- [x] 2. Simple rename: `.claude/skills/` SKILL.md files (6 files)

  **What to do**:
  - Mirror of Task 1 for `.claude/skills/` directory
  - Same files: `corgispec-explore/SKILL.md`, `corgispec-gh-explore/SKILL.md`, `corgispec-verify/SKILL.md`, `corgispec-review/SKILL.md`, `corgispec-gh-review/SKILL.md`, `corgispec-human-qa/SKILL.md`
  - Replace `openspec list --json` with `corgispec list --json`
  - Replace `openspec list` in prose with `corgispec list`

  **Must NOT do**:
  - Same guardrails as Task 1

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Same as Task 1, different directory

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec list' .claude/skills/molecules/corgispec-explore/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list' .claude/skills/molecules/corgispec-gh-explore/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list' .claude/skills/molecules/corgispec-verify/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list' .claude/skills/molecules/corgispec-review/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list' .claude/skills/molecules/corgispec-gh-review/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list' .claude/skills/molecules/corgispec-human-qa/SKILL.md` returns zero results
  - [ ] Directory paths preserved

  **QA Scenarios**:

  ```
  Scenario: Verify no openspec list references remain in all 6 .claude files
    Tool: Bash (grep)
    Preconditions: All 6 files edited
    Steps:
      1. grep -rn 'openspec list' .claude/skills/molecules/corgispec-explore/SKILL.md
      2. grep -rn 'openspec list' .claude/skills/molecules/corgispec-gh-explore/SKILL.md
      3. grep -rn 'openspec list' .claude/skills/molecules/corgispec-verify/SKILL.md
      4. grep -rn 'openspec list' .claude/skills/molecules/corgispec-review/SKILL.md
      5. grep -rn 'openspec list' .claude/skills/molecules/corgispec-gh-review/SKILL.md
      6. grep -rn 'openspec list' .claude/skills/molecules/corgispec-human-qa/SKILL.md
    Expected Result: Zero matches in all 6 files
    Evidence: .sisyphus/evidence/task-2-openspec-list-gone.txt

  Scenario: Verify directory paths preserved in all 6 .claude files
    Tool: Bash (grep)
    Preconditions: All 6 files edited
    Steps:
      1. grep -c 'openspec/config.yaml' .claude/skills/molecules/corgispec-explore/SKILL.md
      2. grep -c 'openspec/config.yaml' .claude/skills/molecules/corgispec-gh-explore/SKILL.md
      3. grep -c 'openspec/config.yaml' .claude/skills/molecules/corgispec-verify/SKILL.md
      4. grep -c 'openspec/config.yaml' .claude/skills/molecules/corgispec-review/SKILL.md
      5. grep -c 'openspec/config.yaml' .claude/skills/molecules/corgispec-gh-review/SKILL.md
      6. grep -c 'openspec/config.yaml' .claude/skills/molecules/corgispec-human-qa/SKILL.md
    Expected Result: All counts >= 1
    Evidence: .sisyphus/evidence/task-2-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 1 tasks)
  - Files: All 6 .claude/skills/ files

- [x] 3. Simple rename: `.opencode/skills/` references/worktree-discovery.md (9 files)

  **What to do**:
  - In each file, replace `openspec list` with `corgispec list` (both in code blocks and prose)
  - Files: worktree-discovery.md under:
    - `corgispec-apply-change/references/`
    - `corgispec-archive-change/references/`
    - `corgispec-explore/references/`
    - `corgispec-gh-apply/references/`
    - `corgispec-gh-archive/references/`
    - `corgispec-gh-explore/references/`
    - `corgispec-gh-review/references/`
    - `corgispec-review/references/`
    - `corgispec-verify/references/`
  - Do NOT change `openspec/` in paths like `openspec/config.yaml`, `openspec/changes/`

  **Must NOT do**:
  - Do NOT change `openspec/` in directory paths

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Simple find-and-replace in 9 identical reference files

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec list' .opencode/skills/molecules/*/references/worktree-discovery.md` returns zero results
  - [ ] `grep -rn 'corgispec list' .opencode/skills/molecules/*/references/worktree-discovery.md` returns matches
  - [ ] Directory paths preserved

  **QA Scenarios**:

  ```
  Scenario: Verify no openspec list in worktree-discovery files
    Tool: Bash (grep)
    Preconditions: All 9 files edited
    Steps:
      1. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-apply-change/references/worktree-discovery.md
      2. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-archive-change/references/worktree-discovery.md
      3. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-explore/references/worktree-discovery.md
      4. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-gh-apply/references/worktree-discovery.md
      5. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-gh-archive/references/worktree-discovery.md
      6. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-gh-explore/references/worktree-discovery.md
      7. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-gh-review/references/worktree-discovery.md
      8. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-review/references/worktree-discovery.md
      9. grep -rn 'openspec list' .opencode/skills/molecules/corgispec-verify/references/worktree-discovery.md
    Expected Result: Zero matches for every grep command
    Evidence: .sisyphus/evidence/task-3-worktree-discovery-clean.txt

  Scenario: Verify directory paths preserved in worktree-discovery files
    Tool: Bash (grep)
    Preconditions: All 9 files edited
    Steps:
      1. grep -c 'openspec/config.yaml' .opencode/skills/molecules/corgispec-apply-change/references/worktree-discovery.md
    Expected Result: Count >= 1 (directory paths still present)
    Evidence: .sisyphus/evidence/task-3-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 1 tasks)
  - Files: All 9 worktree-discovery.md files in .opencode/skills/

- [x] 4. Simple rename: `.claude/skills/` references/worktree-discovery.md (9 files)

  **What to do**:
  - Mirror of Task 3 for `.claude/skills/` directory
  - Same 9 worktree-discovery.md files under same molecule directories
  - Replace `openspec list` with `corgispec list`

  **Must NOT do**:
  - Same guardrails as Task 3

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Same as Task 3, different directory

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec list' .claude/skills/molecules/*/references/worktree-discovery.md` returns zero results
  - [ ] `grep -rn 'corgispec list' .claude/skills/molecules/*/references/worktree-discovery.md` returns matches
  - [ ] Directory paths preserved

  **QA Scenarios**:

  ```
  Scenario: Verify no openspec list in .claude worktree-discovery files (all 9)
    Tool: Bash (grep)
    Preconditions: All 9 files edited
    Steps:
      1. grep -rn 'openspec list' .claude/skills/molecules/corgispec-apply-change/references/worktree-discovery.md
      2. grep -rn 'openspec list' .claude/skills/molecules/corgispec-archive-change/references/worktree-discovery.md
      3. grep -rn 'openspec list' .claude/skills/molecules/corgispec-explore/references/worktree-discovery.md
      4. grep -rn 'openspec list' .claude/skills/molecules/corgispec-gh-apply/references/worktree-discovery.md
      5. grep -rn 'openspec list' .claude/skills/molecules/corgispec-gh-archive/references/worktree-discovery.md
      6. grep -rn 'openspec list' .claude/skills/molecules/corgispec-gh-explore/references/worktree-discovery.md
      7. grep -rn 'openspec list' .claude/skills/molecules/corgispec-gh-review/references/worktree-discovery.md
      8. grep -rn 'openspec list' .claude/skills/molecules/corgispec-review/references/worktree-discovery.md
      9. grep -rn 'openspec list' .claude/skills/molecules/corgispec-verify/references/worktree-discovery.md
    Expected Result: Zero matches for every grep command
    Evidence: .sisyphus/evidence/task-4-worktree-discovery-clean.txt

  Scenario: Verify directory paths preserved
    Tool: Bash (grep)
    Preconditions: All 9 files edited
    Steps:
      1. grep -c 'openspec/config.yaml' .claude/skills/molecules/corgispec-apply-change/references/worktree-discovery.md
    Expected Result: Count >= 1
    Evidence: .sisyphus/evidence/task-4-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 1 tasks)
  - Files: All 9 worktree-discovery.md files in .claude/skills/

- [x] 5. Complex changes: `corgispec-apply-change` + `corgispec-gh-apply` SKILL.md in `.opencode/skills/` (2 files)

  **What to do**:
  - In both files, apply these replacements:
    1. `openspec list --json` → `corgispec list --json`
    2. `openspec status --change "<name>" --json` → `corgispec status "<name>" --json` (positional arg, no `--change`)
    3. `openspec instructions apply --change "<name>" --json` → `corgispec apply <name> --json`
  - Also replace `openspec list` in prose with `corgispec list`
  - Files: `corgispec-apply-change/SKILL.md`, `corgispec-gh-apply/SKILL.md`

  **Must NOT do**:
  - Do NOT change `openspec/config.yaml`, `openspec/changes/`, `openspec/specs/` — these are directory paths
  - Do NOT change `openspec` in package names or URLs

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Precise string replacements in 2 files, verified commands

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6-12)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec list\|openspec status\|openspec instructions apply' .opencode/skills/molecules/corgispec-apply-change/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list\|openspec status\|openspec instructions apply' .opencode/skills/molecules/corgispec-gh-apply/SKILL.md` returns zero results
  - [ ] `grep 'corgispec list\|corgispec status\|corgispec apply'` on each file returns expected matches
  - [ ] Directory paths (`openspec/config.yaml`, `openspec/changes/`) still present

  **QA Scenarios**:

  ```
  Scenario: Verify all openspec CLI refs removed from corgispec-apply-change/SKILL.md
    Tool: Bash (grep)
    Preconditions: File edited
    Steps:
      1. grep -rn 'openspec list\|openspec status\|openspec instructions apply' .opencode/skills/molecules/corgispec-apply-change/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-5a-apply-change-clean.txt

  Scenario: Verify all openspec CLI refs removed from corgispec-gh-apply/SKILL.md
    Tool: Bash (grep)
    Preconditions: File edited
    Steps:
      1. grep -rn 'openspec list\|openspec status\|openspec instructions apply' .opencode/skills/molecules/corgispec-gh-apply/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-5b-gh-apply-clean.txt

  Scenario: Verify correct corgispec commands present in both files
    Tool: Bash (grep)
    Preconditions: Both files edited
    Steps:
      1. grep 'corgispec list --json' .opencode/skills/molecules/corgispec-apply-change/SKILL.md
      2. grep 'corgispec status "<name>" --json' .opencode/skills/molecules/corgispec-apply-change/SKILL.md
      3. grep 'corgispec apply <name> --json' .opencode/skills/molecules/corgispec-apply-change/SKILL.md
      4. grep 'corgispec list --json' .opencode/skills/molecules/corgispec-gh-apply/SKILL.md
      5. grep 'corgispec status "<name>" --json' .opencode/skills/molecules/corgispec-gh-apply/SKILL.md
      6. grep 'corgispec apply <name> --json' .opencode/skills/molecules/corgispec-gh-apply/SKILL.md
    Expected Result: All 6 grep commands return matches
    Evidence: .sisyphus/evidence/task-5-corgispec-commands.txt

  Scenario: Verify directory paths preserved in both files
    Tool: Bash (grep)
    Preconditions: Both files edited
    Steps:
      1. grep -c 'openspec/config.yaml' .opencode/skills/molecules/corgispec-apply-change/SKILL.md
      2. grep -c 'openspec/config.yaml' .opencode/skills/molecules/corgispec-gh-apply/SKILL.md
    Expected Result: Both counts >= 1
    Evidence: .sisyphus/evidence/task-5-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 2 tasks)
  - Files: Both SKILL.md files in .opencode/skills/

- [x] 6. Complex changes: `corgispec-apply-change` + `corgispec-gh-apply` SKILL.md in `.claude/skills/` (2 files)

  **What to do**:
  - Mirror of Task 5 for `.claude/skills/` directory
  - Same replacements in `corgispec-apply-change/SKILL.md` and `corgispec-gh-apply/SKILL.md`

  **Must NOT do**:
  - Same guardrails as Task 5

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Same as Task 5, different directory

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 7-12)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec list\|openspec status\|openspec instructions apply' .claude/skills/molecules/corgispec-apply-change/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list\|openspec status\|openspec instructions apply' .claude/skills/molecules/corgispec-gh-apply/SKILL.md` returns zero results
  - [ ] Correct `corgispec` commands present in both files
  - [ ] Directory paths preserved

  **QA Scenarios**:

  ```
  Scenario: Verify all openspec CLI refs removed from .claude apply-change SKILL.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec list\|openspec status\|openspec instructions apply' .claude/skills/molecules/corgispec-apply-change/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-6a-apply-change-clean.txt

  Scenario: Verify all openspec CLI refs removed from .claude gh-apply SKILL.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec list\|openspec status\|openspec instructions apply' .claude/skills/molecules/corgispec-gh-apply/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-6b-gh-apply-clean.txt

  Scenario: Verify correct corgispec commands present in both .claude files
    Tool: Bash (grep)
    Steps:
      1. grep 'corgispec list --json' .claude/skills/molecules/corgispec-apply-change/SKILL.md
      2. grep 'corgispec status "<name>" --json' .claude/skills/molecules/corgispec-apply-change/SKILL.md
      3. grep 'corgispec apply <name> --json' .claude/skills/molecules/corgispec-apply-change/SKILL.md
      4. grep 'corgispec list --json' .claude/skills/molecules/corgispec-gh-apply/SKILL.md
      5. grep 'corgispec status "<name>" --json' .claude/skills/molecules/corgispec-gh-apply/SKILL.md
      6. grep 'corgispec apply <name> --json' .claude/skills/molecules/corgispec-gh-apply/SKILL.md
    Expected Result: All 6 grep commands return matches
    Evidence: .sisyphus/evidence/task-6-corgispec-commands.txt

  Scenario: Verify directory paths preserved in both .claude files
    Tool: Bash (grep)
    Steps:
      1. grep -c 'openspec/config.yaml' .claude/skills/molecules/corgispec-apply-change/SKILL.md
      2. grep -c 'openspec/config.yaml' .claude/skills/molecules/corgispec-gh-apply/SKILL.md
    Expected Result: Both counts >= 1
    Evidence: .sisyphus/evidence/task-6-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 2 tasks)
  - Files: Both SKILL.md files in .claude/skills/

- [x] 7. Complex changes: `corgispec-archive-change` + `corgispec-gh-archive` SKILL.md in `.opencode/skills/` (2 files)

  **What to do**:
  - In both files, apply these replacements:
    1. `openspec list --json` → `corgispec list --json`
    2. `openspec status --change "<name>" --json` → `corgispec status "<name>" --json`
    3. `openspec status --json` → `corgispec status --json`
  - Files: `corgispec-archive-change/SKILL.md`, `corgispec-gh-archive/SKILL.md`

  **Must NOT do**:
  - Do NOT change `openspec/changes/`, `openspec/config.yaml` — directory paths

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Precise string replacements in 2 files

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 8-12)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec list\|openspec status' .opencode/skills/molecules/corgispec-archive-change/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list\|openspec status' .opencode/skills/molecules/corgispec-gh-archive/SKILL.md` returns zero results
  - [ ] `corgispec list --json`, `corgispec status "<name>" --json`, `corgispec status --json` present in both files
  - [ ] Directory paths preserved

  **QA Scenarios**:

  ```
  Scenario: Verify all openspec CLI refs removed from corgispec-archive-change/SKILL.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec list\|openspec status' .opencode/skills/molecules/corgispec-archive-change/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-7a-archive-clean.txt

  Scenario: Verify all openspec CLI refs removed from corgispec-gh-archive/SKILL.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec list\|openspec status' .opencode/skills/molecules/corgispec-gh-archive/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-7b-gh-archive-clean.txt

  Scenario: Verify correct corgispec commands present in both files
    Tool: Bash (grep)
    Steps:
      1. grep 'corgispec list --json' .opencode/skills/molecules/corgispec-archive-change/SKILL.md
      2. grep 'corgispec status' .opencode/skills/molecules/corgispec-archive-change/SKILL.md
      3. grep 'corgispec list --json' .opencode/skills/molecules/corgispec-gh-archive/SKILL.md
      4. grep 'corgispec status' .opencode/skills/molecules/corgispec-gh-archive/SKILL.md
    Expected Result: All 4 grep commands return matches
    Evidence: .sisyphus/evidence/task-7-corgispec-commands.txt

  Scenario: Verify directory paths preserved in both files
    Tool: Bash (grep)
    Steps:
      1. grep -c 'openspec/changes/' .opencode/skills/molecules/corgispec-archive-change/SKILL.md
      2. grep -c 'openspec/changes/' .opencode/skills/molecules/corgispec-gh-archive/SKILL.md
    Expected Result: Both counts >= 1
    Evidence: .sisyphus/evidence/task-7-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 2 tasks)
  - Files: Both SKILL.md files in .opencode/skills/

- [x] 8. Complex changes: `corgispec-archive-change` + `corgispec-gh-archive` SKILL.md in `.claude/skills/` (2 files)

  **What to do**:
  - Mirror of Task 7 for `.claude/skills/` directory

  **Must NOT do**:
  - Same guardrails as Task 7

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Same as Task 7, different directory

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5-7, 9-12)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec list\|openspec status' .claude/skills/molecules/corgispec-archive-change/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec list\|openspec status' .claude/skills/molecules/corgispec-gh-archive/SKILL.md` returns zero results
  - [ ] Correct `corgispec` commands present in both files
  - [ ] Directory paths preserved

  **QA Scenarios**:

  ```
  Scenario: Verify all openspec CLI refs removed from .claude archive-change SKILL.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec list\|openspec status' .claude/skills/molecules/corgispec-archive-change/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-8a-archive-clean.txt

  Scenario: Verify all openspec CLI refs removed from .claude gh-archive SKILL.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec list\|openspec status' .claude/skills/molecules/corgispec-gh-archive/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-8b-gh-archive-clean.txt

  Scenario: Verify correct corgispec commands present in both .claude files
    Tool: Bash (grep)
    Steps:
      1. grep 'corgispec list --json' .claude/skills/molecules/corgispec-archive-change/SKILL.md
      2. grep 'corgispec status' .claude/skills/molecules/corgispec-archive-change/SKILL.md
      3. grep 'corgispec list --json' .claude/skills/molecules/corgispec-gh-archive/SKILL.md
      4. grep 'corgispec status' .claude/skills/molecules/corgispec-gh-archive/SKILL.md
    Expected Result: All 4 grep commands return matches
    Evidence: .sisyphus/evidence/task-8-corgispec-commands.txt

  Scenario: Verify directory paths preserved in both .claude files
    Tool: Bash (grep)
    Steps:
      1. grep -c 'openspec/changes/' .claude/skills/molecules/corgispec-archive-change/SKILL.md
      2. grep -c 'openspec/changes/' .claude/skills/molecules/corgispec-gh-archive/SKILL.md
    Expected Result: Both counts >= 1
    Evidence: .sisyphus/evidence/task-8-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 2 tasks)
  - Files: Both SKILL.md files in .claude/skills/

- [x] 9. Complex changes: `corgispec-propose` + `corgispec-gh-propose` SKILL.md in `.opencode/skills/` (2 files)

  **What to do**:
  - In both files, apply these replacements:
    1. `openspec new change "<name>"` → `corgispec propose <name>`
    2. `openspec status --change "<name>" --json` → `corgispec status "<name>" --json`
    3. `openspec status --change "<name>"` → `corgispec status "<name>"` (no --json variant)
    4. `openspec instructions <artifact-id> --change "<name>" --json` → `corgispec instructions <artifact-id> --change <name> --json`
  - Also replace `openspec instructions` in prose (e.g., "from `openspec instructions`") with `corgispec instructions`
  - Also replace `openspec status` in prose with `corgispec status`
  - Files: `corgispec-propose/SKILL.md`, `corgispec-gh-propose/SKILL.md`

  **Must NOT do**:
  - Do NOT change `openspec/changes/`, `openspec/config.yaml` — directory paths
  - Do NOT change `openspec` in references to the OpenSpec project (e.g., "built on OpenSpec")

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Most complex replacements (4 patterns), but still straightforward string edits

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5-8, 10-12)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec new change\|openspec status --change\|openspec instructions' .opencode/skills/molecules/corgispec-propose/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec new change\|openspec status --change\|openspec instructions' .opencode/skills/molecules/corgispec-gh-propose/SKILL.md` returns zero results
  - [ ] `corgispec propose`, `corgispec status "<name>"`, `corgispec instructions <artifact>` present in both files
  - [ ] Directory paths preserved

  **QA Scenarios**:

  ```
  Scenario: Verify all openspec CLI refs removed from corgispec-propose/SKILL.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec new change\|openspec status --change\|openspec instructions' .opencode/skills/molecules/corgispec-propose/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-9a-propose-clean.txt

  Scenario: Verify all openspec CLI refs removed from corgispec-gh-propose/SKILL.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec new change\|openspec status --change\|openspec instructions' .opencode/skills/molecules/corgispec-gh-propose/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-9b-gh-propose-clean.txt

  Scenario: Verify correct corgispec commands present in both files
    Tool: Bash (grep)
    Steps:
      1. grep 'corgispec propose' .opencode/skills/molecules/corgispec-propose/SKILL.md
      2. grep 'corgispec status' .opencode/skills/molecules/corgispec-propose/SKILL.md
      3. grep 'corgispec instructions' .opencode/skills/molecules/corgispec-propose/SKILL.md
      4. grep 'corgispec propose' .opencode/skills/molecules/corgispec-gh-propose/SKILL.md
      5. grep 'corgispec status' .opencode/skills/molecules/corgispec-gh-propose/SKILL.md
      6. grep 'corgispec instructions' .opencode/skills/molecules/corgispec-gh-propose/SKILL.md
    Expected Result: All 6 grep commands return matches
    Evidence: .sisyphus/evidence/task-9-corgispec-commands.txt

  Scenario: Verify directory paths preserved in both files
    Tool: Bash (grep)
    Steps:
      1. grep -c 'openspec/changes/' .opencode/skills/molecules/corgispec-propose/SKILL.md
      2. grep -c 'openspec/changes/' .opencode/skills/molecules/corgispec-gh-propose/SKILL.md
    Expected Result: Both counts >= 1
    Evidence: .sisyphus/evidence/task-9-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 2 tasks)
  - Files: Both SKILL.md files in .opencode/skills/

- [x] 10. Complex changes: `corgispec-propose` + `corgispec-gh-propose` SKILL.md in `.claude/skills/` (2 files)

  **What to do**:
  - Mirror of Task 9 for `.claude/skills/` directory

  **Must NOT do**:
  - Same guardrails as Task 9

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Same as Task 9, different directory

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5-9, 11-12)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec new change\|openspec status --change\|openspec instructions' .claude/skills/molecules/corgispec-propose/SKILL.md` returns zero results
  - [ ] `grep -rn 'openspec new change\|openspec status --change\|openspec instructions' .claude/skills/molecules/corgispec-gh-propose/SKILL.md` returns zero results
  - [ ] Correct `corgispec` commands present in both files
  - [ ] Directory paths preserved

  **QA Scenarios**:

  ```
  Scenario: Verify all openspec CLI refs removed from .claude propose SKILL.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec new change\|openspec status --change\|openspec instructions' .claude/skills/molecules/corgispec-propose/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-10a-propose-clean.txt

  Scenario: Verify all openspec CLI refs removed from .claude gh-propose SKILL.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec new change\|openspec status --change\|openspec instructions' .claude/skills/molecules/corgispec-gh-propose/SKILL.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-10b-gh-propose-clean.txt

  Scenario: Verify correct corgispec commands present in both .claude files
    Tool: Bash (grep)
    Steps:
      1. grep 'corgispec propose' .claude/skills/molecules/corgispec-propose/SKILL.md
      2. grep 'corgispec status' .claude/skills/molecules/corgispec-propose/SKILL.md
      3. grep 'corgispec instructions' .claude/skills/molecules/corgispec-propose/SKILL.md
      4. grep 'corgispec propose' .claude/skills/molecules/corgispec-gh-propose/SKILL.md
      5. grep 'corgispec status' .claude/skills/molecules/corgispec-gh-propose/SKILL.md
      6. grep 'corgispec instructions' .claude/skills/molecules/corgispec-gh-propose/SKILL.md
    Expected Result: All 6 grep commands return matches
    Evidence: .sisyphus/evidence/task-10-corgispec-commands.txt

  Scenario: Verify directory paths preserved in both .claude files
    Tool: Bash (grep)
    Steps:
      1. grep -c 'openspec/changes/' .claude/skills/molecules/corgispec-propose/SKILL.md
      2. grep -c 'openspec/changes/' .claude/skills/molecules/corgispec-gh-propose/SKILL.md
    Expected Result: Both counts >= 1
    Evidence: .sisyphus/evidence/task-10-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 2 tasks)
  - Files: Both SKILL.md files in .claude/skills/

- [x] 11. Complex changes: `references/artifact-creation.md` in `.opencode/skills/corgispec-propose/` (1 file)

  **What to do**:
  - File: `.opencode/skills/molecules/corgispec-propose/references/artifact-creation.md`
  - Note: `.opencode/skills/molecules/corgispec-gh-propose/references/` does NOT contain `artifact-creation.md` (verified)
  - Apply these replacements:
    1. `openspec status --change "<name>" --json` → `corgispec status "<name>" --json`
    2. `openspec instructions <artifact-id> --change "<name>" --json` → `corgispec instructions <artifact-id> --change <name> --json`
    3. `openspec status` in prose → `corgispec status`
    4. `openspec instructions` in prose → `corgispec instructions`

  **Must NOT do**:
  - Do NOT change `openspec/` in directory paths

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Single file with 2 command patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5-10, 12)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec status\|openspec instructions' .opencode/skills/molecules/corgispec-propose/references/artifact-creation.md` returns zero results
  - [ ] `grep 'corgispec status' .opencode/skills/molecules/corgispec-propose/references/artifact-creation.md` returns matches
  - [ ] `grep 'corgispec instructions' .opencode/skills/molecules/corgispec-propose/references/artifact-creation.md` returns matches

  **QA Scenarios**:

  ```
  Scenario: Verify all openspec CLI refs removed from artifact-creation.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec status\|openspec instructions' .opencode/skills/molecules/corgispec-propose/references/artifact-creation.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-11-artifact-creation-clean.txt

  Scenario: Verify correct corgispec commands present
    Tool: Bash (grep)
    Steps:
      1. grep 'corgispec status' .opencode/skills/molecules/corgispec-propose/references/artifact-creation.md
      2. grep 'corgispec instructions' .opencode/skills/molecules/corgispec-propose/references/artifact-creation.md
    Expected Result: Both return matches
    Evidence: .sisyphus/evidence/task-11-corgispec-commands.txt

  Scenario: Verify directory paths preserved in artifact-creation.md
    Tool: Bash (grep)
    Steps:
      1. grep -c 'openspec/' .opencode/skills/molecules/corgispec-propose/references/artifact-creation.md
    Expected Result: Count >= 1 (paths reference still present)
    Evidence: .sisyphus/evidence/task-11-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 2 tasks)
  - Files: artifact-creation.md in .opencode/skills/corgispec-propose/references/

- [x] 12. Complex changes: `references/artifact-creation.md` in `.claude/skills/corgispec-propose/` (1 file)

  **What to do**:
  - Mirror of Task 11 for `.claude/skills/` directory
  - File: `.claude/skills/molecules/corgispec-propose/references/artifact-creation.md`
  - Same replacements

  **Must NOT do**:
  - Same guardrails as Task 11

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: Same as Task 11, different directory

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5-11)
  - **Blocks**: None
  - **Blocked By**: None

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec status\|openspec instructions' .claude/skills/molecules/corgispec-propose/references/artifact-creation.md` returns zero results
  - [ ] `grep 'corgispec status' .claude/skills/molecules/corgispec-propose/references/artifact-creation.md` returns matches
  - [ ] `grep 'corgispec instructions' .claude/skills/molecules/corgispec-propose/references/artifact-creation.md` returns matches

  **QA Scenarios**:

  ```
  Scenario: Verify all openspec CLI refs removed from .claude artifact-creation.md
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec status\|openspec instructions' .claude/skills/molecules/corgispec-propose/references/artifact-creation.md
    Expected Result: Zero matches
    Evidence: .sisyphus/evidence/task-12-artifact-creation-clean.txt

  Scenario: Verify correct corgispec commands present in .claude file
    Tool: Bash (grep)
    Steps:
      1. grep 'corgispec status' .claude/skills/molecules/corgispec-propose/references/artifact-creation.md
      2. grep 'corgispec instructions' .claude/skills/molecules/corgispec-propose/references/artifact-creation.md
    Expected Result: Both return matches
    Evidence: .sisyphus/evidence/task-12-corgispec-commands.txt

  Scenario: Verify directory paths preserved in .claude artifact-creation.md
    Tool: Bash (grep)
    Steps:
      1. grep -c 'openspec/' .claude/skills/molecules/corgispec-propose/references/artifact-creation.md
    Expected Result: Count >= 1
    Evidence: .sisyphus/evidence/task-12-paths-preserved.txt
  ```

  **Commit**: YES (groups with all Wave 2 tasks)
  - Files: artifact-creation.md in .claude/skills/corgispec-propose/references/

- [x] 13. Global verification: No remaining `openspec` CLI refs

  **What to do**:
  - Run comprehensive grep across both `.opencode/skills/` and `.claude/skills/` for all known `openspec` CLI patterns
  - Verify zero results for: `openspec list`, `openspec status`, `openspec new change`, `openspec instructions apply`, `openspec propose`
  - If any found, identify the file and fix it

  **Must NOT do**:
  - Do NOT flag `openspec/` directory paths as failures

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: grep-based verification only

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 14)
  - **Blocks**: None
  - **Blocked By**: All Wave 1 and Wave 2 tasks

  **Acceptance Criteria**:
  - [ ] `grep -rn 'openspec list\|openspec status\|openspec new change\|openspec instructions apply\|openspec propose' .opencode/skills/` returns zero results
  - [ ] `grep -rn 'openspec list\|openspec status\|openspec new change\|openspec instructions apply\|openspec propose' .claude/skills/` returns zero results

  **QA Scenarios**:

  ```
  Scenario: Global scan for remaining openspec CLI refs in .opencode/skills/
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec list\|openspec status\|openspec new change\|openspec instructions apply\|openspec propose' .opencode/skills/
    Expected Result: Zero matches (empty output)
    Failure Indicators: Any line of output = a missed reference
    Evidence: .sisyphus/evidence/task-13a-opencode-clean.txt

  Scenario: Global scan for remaining openspec CLI refs in .claude/skills/
    Tool: Bash (grep)
    Steps:
      1. grep -rn 'openspec list\|openspec status\|openspec new change\|openspec instructions apply\|openspec propose' .claude/skills/
    Expected Result: Zero matches (empty output)
    Failure Indicators: Any line of output = a missed reference
    Evidence: .sisyphus/evidence/task-13b-claude-clean.txt
  ```

  **Commit**: NO (verification only)

- [x] 14. Global verification: Directory paths preserved

  **What to do**:
  - Run grep to confirm `openspec/` directory paths are still present in skill files
  - Verify files like `openspec/config.yaml`, `openspec/changes/`, `openspec/schemas/`, `openspec/specs/` are still referenced
  - This confirms we didn't accidentally change directory paths

  **Must NOT do**:
  - Don't worry about counts - just confirm they exist

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
  - Reason: grep-based verification only

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 13)
  - **Blocks**: None
  - **Blocked By**: All Wave 1 and Wave 2 tasks

  **Acceptance Criteria**:
  - [ ] `grep -rlc 'openspec/config.yaml' .opencode/skills/ .claude/skills/ | wc -l` returns > 0
  - [ ] `grep -rlc 'openspec/changes/' .opencode/skills/ .claude/skills/ | wc -l` returns > 0

  **QA Scenarios**:

  ```
  Scenario: Verify directory paths preserved - config.yaml references
    Tool: Bash (grep)
    Steps:
      1. grep -rlc 'openspec/config.yaml' .opencode/skills/ | wc -l
      2. grep -rlc 'openspec/config.yaml' .claude/skills/ | wc -l
    Expected Result: Both counts > 0 (paths preserved across multiple files)
    Evidence: .sisyphus/evidence/task-14a-config-paths.txt

  Scenario: Verify directory paths preserved - changes/ references
    Tool: Bash (grep)
    Steps:
      1. grep -rlc 'openspec/changes/' .opencode/skills/ | wc -l
      2. grep -rlc 'openspec/changes/' .claude/skills/ | wc -l
    Expected Result: Both counts > 0
    Evidence: .sisyphus/evidence/task-14b-changes-paths.txt
  ```

  **Commit**: NO (verification only)
