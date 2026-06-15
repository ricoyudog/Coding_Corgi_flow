# Corgispec Bootstrap Installer Upgrade

## TL;DR

> **Quick Summary**: Upgrade the corgispec bootstrap installer to add platform selection and install scope options, with both interactive prompts and CLI flags for best UX.
>
> **Deliverables**:
> - New `--platform` flag to select specific coding CLIs (claude, opencode, codex)
> - New `--scope` flag to choose install scope (global, local, both)
> - Interactive prompts when flags not provided
> - Updated documentation (INSTALL.md, README)
> - Comprehensive test coverage (TDD approach)
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 4 → Task 7 → Task 10 → Task 12

---

## Context

### Original Request
User wants to upgrade the corgispec bootstrap installer to provide options similar to openspec/speckit installers:
1. Choose which coding CLI to install for (claude, opencode, codex)
2. Choose global install vs local/current directory install
3. Both interactive prompts and CLI flags for best UX

### Interview Summary
**Key Discussions**:
- **Platform Selection**: Support claude, opencode, codex (all three currently in codebase)
- **Install Scope**: Offer choice between global, local, or both
- **UX Style**: Both interactive prompts and CLI flags
- **Test Strategy**: TDD approach (tests first)
- **Backward Compatibility**: Default behavior remains unchanged (all platforms, global scope)

**Research Findings**:
- Current code has Platform type in `packages/corgispec/src/lib/platform.ts`
- Bootstrap currently installs to all platforms unconditionally
- `installSkillsTo()` function handles skill installation
- BootstrapContext tracks actions and checks
- Platform detection logic already exists

### Metis Review
**Identified Gaps** (addressed):
- Need to validate platform selection input
- Need to handle edge cases (empty platform list, invalid platforms)
- Need to update documentation alongside code changes
- Need to ensure backward compatibility

---

## Work Objectives

### Core Objective
Upgrade the corgispec bootstrap installer to provide platform selection and install scope options, with both interactive prompts and CLI flags for best UX.

### Concrete Deliverables
- New `--platform <platforms>` CLI option (comma-separated)
- New `--scope <scope>` CLI option (global, local, both)
- Interactive prompts when flags not provided
- Updated INSTALL.md with new options
- Updated README.md quick start section
- Comprehensive test coverage

### Definition of Done
- [x] `corgispec bootstrap --platform claude,opencode --scope local` works correctly
- [x] Interactive prompts appear when flags not provided
- [x] Default behavior unchanged (all platforms, global scope)
- [x] All existing tests pass
- [x] New tests cover platform and scope options
- [x] Documentation updated

### Must Have
- Platform selection via `--platform` flag
- Scope selection via `--scope` flag
- Interactive prompts when flags not provided
- Backward compatibility (default behavior unchanged)
- Input validation for platforms and scope
- TDD approach (tests first)

### Must NOT Have (Guardrails)
- No new platform support (cursor, ampcode) - future work
- No changes to existing bootstrap modes (auto, fresh, update, legacy, verify)
- No breaking changes to existing CLI interface
- No changes to install manifest format
- No changes to report format

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: TDD
- **Framework**: vitest
- **TDD approach**: RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI**: Use Bash - Run commands, validate output, check exit codes
- **Library/Module**: Use Bash (node REPL) - Import, call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - foundation):
├── Task 1: Add --platform option to bootstrap command [quick]
├── Task 2: Add --scope option to bootstrap command [quick]
├── Task 3: Add platform validation logic [quick]
├── Task 4: Add scope validation logic [quick]
└── Task 5: Write tests for platform option (TDD RED) [quick]

Wave 2 (After Wave 1 - core implementation):
├── Task 6: Implement platform selection in bootstrap [unspecified-high]
├── Task 7: Implement scope selection in bootstrap [unspecified-high]
├── Task 8: Add interactive prompts for platform selection [unspecified-high]
├── Task 9: Add interactive prompts for scope selection [unspecified-high]
└── Task 10: Write tests for scope option (TDD RED) [quick]

Wave 3 (After Wave 2 - integration and docs):
├── Task 11: Update INSTALL.md with new options [writing]
├── Task 12: Update README.md quick start section [writing]
├── Task 13: Integration tests for platform+scope combinations [unspecified-high]
└── Task 14: Final verification and cleanup [quick]

Critical Path: Task 1 → Task 6 → Task 11 → Task 14
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 5 (Wave 1)
```

### Dependency Matrix

- **1-5**: - - 6-10
- **6**: 1, 3, 5 - 11, 13
- **7**: 2, 4, 10 - 12, 13
- **8**: 6 - 13
- **9**: 7 - 13
- **11**: 6 - 14
- **12**: 7 - 14
- **13**: 6, 7, 8, 9 - 14
- **14**: 11, 12, 13 - -

### Agent Dispatch Summary

- **Wave 1**: 5 tasks - T1-T4 → `quick`, T5 → `quick`
- **Wave 2**: 5 tasks - T6-T7 → `unspecified-high`, T8-T9 → `unspecified-high`, T10 → `quick`
- **Wave 3**: 4 tasks - T11-T12 → `writing`, T13 → `unspecified-high`, T14 → `quick`

---

## TODOs

- [x] 1. Add --platform option to bootstrap command

  **What to do**:
  - Add `--platform <platforms>` option to createBootstrapCommand() in packages/corgispec/src/commands/bootstrap.ts
  - Parse comma-separated platform values (claude,opencode,codex)
  - Pass platform array to BootstrapOptions interface
  - Update BootstrapOptions interface to include platforms field

  **Must NOT do**:
  - Do not change default behavior (all platforms if not specified)
  - Do not add new platform types yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `packages/corgispec/src/commands/bootstrap.ts:82-106` - Existing option parsing pattern
  - `packages/corgispec/src/lib/platform.ts:8` - Platform type definition
  - `packages/corgispec/src/lib/bootstrap.ts:33-42` - BootstrapOptions interface

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Parse --platform flag with valid values
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --help
      2. Verify output contains "--platform <platforms>"
      3. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude,opencode --mode verify --json
      4. Parse JSON output
      5. Verify status is "success"
    Expected Result: CLI accepts --platform flag and processes it
    Evidence: .sisyphus/evidence/task-1-platform-flag-help.txt

  Scenario: Reject invalid platform values
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform invalid --mode verify
      2. Check exit code is 1
      3. Verify output contains "Invalid platform"
    Expected Result: CLI rejects invalid platform with error message
    Evidence: .sisyphus/evidence/task-1-invalid-platform-error.txt
  ```

  **Commit**: YES
  - Message: `feat(bootstrap): add --platform option for CLI selection`
  - Files: `packages/corgispec/src/commands/bootstrap.ts`
  - Pre-commit: `npm test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

 - [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

 - [x] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

 - [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (features working together, not isolation). Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

 - [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(bootstrap): add --platform and --scope options` - bootstrap.ts, tests
- **Wave 2**: `feat(bootstrap): implement platform/scope selection with prompts` - bootstrap.ts, lib/bootstrap.ts
- **Wave 3**: `docs: update INSTALL.md and README with new bootstrap options` - INSTALL.md, README.md

---

## Success Criteria

### Verification Commands
```bash
# Test --platform flag
node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude,opencode --mode verify --json

# Test --scope flag
node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --scope local --mode verify --json

# Test interactive prompts (when flags not provided)
echo -e "claude,opencode\nlocal" | node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --mode verify

# Run all tests
cd packages/corgispec && npm test
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] All tests pass
- [x] Documentation updated
- [x] Backward compatibility maintained

- [x] 2. Add --scope option to bootstrap command

  **What to do**:
  - Add `--scope <scope>` option to createBootstrapCommand() in packages/corgispec/src/commands/bootstrap.ts
  - Parse scope values (global, local, both)
  - Pass scope to BootstrapOptions interface
  - Update BootstrapOptions interface to include scope field

  **Must NOT do**:
  - Do not change default behavior (global scope if not specified)
  - Do not add new scope types yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5)
  - **Blocks**: Task 7
  - **Blocked By**: None

  **References**:
  - `packages/corgispec/src/commands/bootstrap.ts:82-106` - Existing option parsing pattern
  - `packages/corgispec/src/lib/bootstrap.ts:33-42` - BootstrapOptions interface

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Parse --scope flag with valid values
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --help
      2. Verify output contains "--scope <scope>"
      3. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --scope local --mode verify --json
      4. Parse JSON output
      5. Verify status is "success"
    Expected Result: CLI accepts --scope flag and processes it
    Evidence: .sisyphus/evidence/task-2-scope-flag-help.txt

  Scenario: Reject invalid scope values
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --scope invalid --mode verify
      2. Check exit code is 1
      3. Verify output contains "Invalid scope"
    Expected Result: CLI rejects invalid scope with error message
    Evidence: .sisyphus/evidence/task-2-invalid-scope-error.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(bootstrap): add --scope option for install scope selection`
  - Files: `packages/corgispec/src/commands/bootstrap.ts`
  - Pre-commit: `npm test`

- [x] 3. Add platform validation logic

  **What to do**:
  - Add validation function for platform values in packages/corgispec/src/commands/bootstrap.ts
  - Validate that platform values are valid (claude, opencode, codex)
  - Return meaningful error messages for invalid platforms
  - Support comma-separated platform lists

  **Must NOT do**:
  - Do not add new platform types yet
  - Do not change existing validation patterns

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4, 5)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `packages/corgispec/src/commands/bootstrap.ts:82-106` - Existing validation pattern
  - `packages/corgispec/src/lib/platform.ts:8` - Platform type definition

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Validate single platform
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
    Expected Result: Single platform accepted
    Evidence: .sisyphus/evidence/task-3-single-platform.txt

  Scenario: Validate multiple platforms
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude,opencode,codex --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
    Expected Result: Multiple platforms accepted
    Evidence: .sisyphus/evidence/task-3-multiple-platforms.txt

  Scenario: Reject invalid platform in list
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude,invalid --mode verify
      2. Check exit code is 1
      3. Verify output contains "Invalid platform"
    Expected Result: Invalid platform in list rejected
    Evidence: .sisyphus/evidence/task-3-invalid-in-list.txt
  ```

  **Commit**: YES (groups with Tasks 1, 2)
  - Message: `feat(bootstrap): add platform validation logic`
  - Files: `packages/corgispec/src/commands/bootstrap.ts`
  - Pre-commit: `npm test`

- [x] 4. Add scope validation logic

  **What to do**:
  - Add validation function for scope values in packages/corgispec/src/commands/bootstrap.ts
  - Validate that scope values are valid (global, local, both)
  - Return meaningful error messages for invalid scopes

  **Must NOT do**:
  - Do not add new scope types yet
  - Do not change existing validation patterns

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 5)
  - **Blocks**: Task 7
  - **Blocked By**: None

  **References**:
  - `packages/corgispec/src/commands/bootstrap.ts:82-106` - Existing validation pattern

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Validate global scope
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --scope global --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
    Expected Result: Global scope accepted
    Evidence: .sisyphus/evidence/task-4-global-scope.txt

  Scenario: Validate local scope
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --scope local --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
    Expected Result: Local scope accepted
    Evidence: .sisyphus/evidence/task-4-local-scope.txt

  Scenario: Validate both scope
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --scope both --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
    Expected Result: Both scope accepted
    Evidence: .sisyphus/evidence/task-4-both-scope.txt

  Scenario: Reject invalid scope
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --scope invalid --mode verify
      2. Check exit code is 1
      3. Verify output contains "Invalid scope"
    Expected Result: Invalid scope rejected
    Evidence: .sisyphus/evidence/task-4-invalid-scope.txt
  ```

  **Commit**: YES (groups with Tasks 1, 2, 3)
  - Message: `feat(bootstrap): add scope validation logic`
  - Files: `packages/corgispec/src/commands/bootstrap.ts`
  - Pre-commit: `npm test`

- [x] 5. Write tests for platform option (TDD RED)

  **What to do**:
  - Write failing tests for platform option in packages/corgispec/test/bootstrap.test.ts
  - Test platform validation (valid/invalid platforms)
  - Test platform selection in bootstrap flow
  - Test default behavior (all platforms when not specified)

  **Must NOT do**:
  - Do not implement the feature yet (TDD RED phase)
  - Do not modify existing tests

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:
  - `packages/corgispec/test/bootstrap.test.ts` - Existing test patterns
  - `packages/corgispec/src/lib/platform.ts:8` - Platform type definition

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Tests fail before implementation (TDD RED)
    Tool: Bash
    Preconditions: Write test cases
    Steps:
      1. Run: cd packages/corgispec && npm test -- --grep "platform"
      2. Verify tests fail (expected behavior in TDD RED phase)
    Expected Result: Tests fail because feature not implemented yet
    Evidence: .sisyphus/evidence/task-5-tdd-red.txt

  Scenario: Test cases cover valid platforms
    Tool: Bash
    Preconditions: Review test cases
    Steps:
      1. Verify test cases exist for: claude, opencode, codex
      2. Verify test cases exist for comma-separated lists
    Expected Result: Comprehensive test coverage for platform option
    Evidence: .sisyphus/evidence/task-5-test-coverage.txt
  ```

  **Commit**: YES
  - Message: `test(bootstrap): add TDD RED tests for platform option`
  - Files: `packages/corgispec/test/bootstrap.test.ts`
  - Pre-commit: `npm test`

- [x] 6. Implement platform selection in bootstrap

  **What to do**:
  - Modify runBootstrap() in packages/corgispec/src/lib/bootstrap.ts to accept platforms parameter
  - Filter platform installation based on selected platforms
  - Update installUserSkills() to only install to selected platforms
  - Maintain backward compatibility (all platforms when not specified)

  **Must NOT do**:
  - Do not change default behavior (all platforms when not specified)
  - Do not add new platform types yet

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 7, 8, 9, 10)
  - **Blocks**: Task 11, Task 13
  - **Blocked By**: Task 1, Task 3, Task 5

  **References**:
  - `packages/corgispec/src/lib/bootstrap.ts:322-342` - installUserSkills() function
  - `packages/corgispec/src/lib/bootstrap.ts:33-42` - BootstrapOptions interface
  - `packages/corgispec/src/lib/platform.ts:8` - Platform type definition

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Install to selected platforms only
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude,opencode --scope global --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
      4. Verify actions contain "installed user-level skills"
    Expected Result: Bootstrap installs only to selected platforms
    Evidence: .sisyphus/evidence/task-6-selected-platforms.txt

  Scenario: Default behavior when no platform specified
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --scope global --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
      4. Verify actions contain "installed user-level skills"
    Expected Result: Bootstrap installs to all platforms by default
    Evidence: .sisyphus/evidence/task-6-default-platforms.txt
  ```

  **Commit**: YES
  - Message: `feat(bootstrap): implement platform selection in bootstrap flow`
  - Files: `packages/corgispec/src/lib/bootstrap.ts`
  - Pre-commit: `npm test`

- [x] 7. Implement scope selection in bootstrap

  **What to do**:
  - Modify runBootstrap() in packages/corgispec/src/lib/bootstrap.ts to accept scope parameter
  - Implement scope logic:
    - `global`: Install to user-level directories only
    - `local`: Install to project-local directories only
    - `both`: Install to both (current behavior)
  - Update syncManagedProjectFiles() and installUserSkills() based on scope

  **Must NOT do**:
  - Do not change default behavior (global scope when not specified)
  - Do not add new scope types yet

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 8, 9, 10)
  - **Blocks**: Task 12, Task 13
  - **Blocked By**: Task 2, Task 4, Task 10

  **References**:
  - `packages/corgispec/src/lib/bootstrap.ts:352-376` - syncManagedProjectFiles() function
  - `packages/corgispec/src/lib/bootstrap.ts:322-342` - installUserSkills() function
  - `packages/corgispec/src/lib/bootstrap.ts:33-42` - BootstrapOptions interface

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Global scope installs to user-level only
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude --scope global --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
      4. Verify actions contain "installed user-level skills"
      5. Verify actions do NOT contain "synced managed project files"
    Expected Result: Global scope installs only to user-level directories
    Evidence: .sisyphus/evidence/task-7-global-scope.txt

  Scenario: Local scope installs to project-local only
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude --scope local --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
      4. Verify actions contain "synced managed project files"
      5. Verify actions do NOT contain "installed user-level skills"
    Expected Result: Local scope installs only to project-local directories
    Evidence: .sisyphus/evidence/task-7-local-scope.txt

  Scenario: Both scope installs to both locations
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude --scope both --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
      4. Verify actions contain "installed user-level skills"
      5. Verify actions contain "synced managed project files"
    Expected Result: Both scope installs to both locations
    Evidence: .sisyphus/evidence/task-7-both-scope.txt
  ```

  **Commit**: YES
  - Message: `feat(bootstrap): implement scope selection in bootstrap flow`
  - Files: `packages/corgispec/src/lib/bootstrap.ts`
  - Pre-commit: `npm test`

- [x] 8. Add interactive prompts for platform selection

  **What to do**:
  - Add interactive prompt when --platform flag not provided
  - Prompt: "Which platforms to install for? (claude, opencode, codex)"
  - Allow comma-separated selection
  - Default to all platforms if user presses Enter without input

  **Must NOT do**:
  - Do not add prompts when --platform flag is provided
  - Do not change default behavior for non-interactive mode

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 9, 10)
  - **Blocks**: Task 13
  - **Blocked By**: Task 6

  **References**:
  - `packages/corgispec/src/commands/bootstrap.ts:34-62` - Existing action handler
  - Node.js readline module for interactive prompts

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Prompt appears when --platform not provided
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: echo -e "claude,opencode" | node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --scope global --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
    Expected Result: Prompt appears and user input is processed
    Evidence: .sisyphus/evidence/task-8-prompt-appears.txt

  Scenario: Default to all platforms on empty input
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: echo -e "" | node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --scope global --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
    Expected Result: Empty input defaults to all platforms
    Evidence: .sisyphus/evidence/task-8-default-all.txt
  ```

  **Commit**: YES
  - Message: `feat(bootstrap): add interactive prompts for platform selection`
  - Files: `packages/corgispec/src/commands/bootstrap.ts`
  - Pre-commit: `npm test`

- [x] 9. Add interactive prompts for scope selection

  **What to do**:
  - Add interactive prompt when --scope flag not provided
  - Prompt: "Install scope? (global, local, both)"
  - Default to "global" if user presses Enter without input

  **Must NOT do**:
  - Do not add prompts when --scope flag is provided
  - Do not change default behavior for non-interactive mode

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8, 10)
  - **Blocks**: Task 13
  - **Blocked By**: Task 7

  **References**:
  - `packages/corgispec/src/commands/bootstrap.ts:34-62` - Existing action handler
  - Node.js readline module for interactive prompts

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Prompt appears when --scope not provided
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: echo -e "local" | node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
    Expected Result: Prompt appears and user input is processed
    Evidence: .sisyphus/evidence/task-9-prompt-appears.txt

  Scenario: Default to global on empty input
    Tool: Bash
    Preconditions: Build corgispec CLI
    Steps:
      1. Run: echo -e "" | node packages/corgispec/dist/bin.js bootstrap --target /tmp/test --platform claude --mode verify --json
      2. Parse JSON output
      3. Verify status is "success"
    Expected Result: Empty input defaults to global scope
    Evidence: .sisyphus/evidence/task-9-default-global.txt
  ```

  **Commit**: YES
  - Message: `feat(bootstrap): add interactive prompts for scope selection`
  - Files: `packages/corgispec/src/commands/bootstrap.ts`
  - Pre-commit: `npm test`

- [x] 10. Write tests for scope option (TDD RED)

  **What to do**:
  - Write failing tests for scope option in packages/corgispec/test/bootstrap.test.ts
  - Test scope validation (valid/invalid scopes)
  - Test scope selection in bootstrap flow
  - Test default behavior (global scope when not specified)

  **Must NOT do**:
  - Do not implement the feature yet (TDD RED phase)
  - Do not modify existing tests

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8, 9)
  - **Blocks**: Task 7
  - **Blocked By**: None

  **References**:
  - `packages/corgispec/test/bootstrap.test.ts` - Existing test patterns

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Tests fail before implementation (TDD RED)
    Tool: Bash
    Preconditions: Write test cases
    Steps:
      1. Run: cd packages/corgispec && npm test -- --grep "scope"
      2. Verify tests fail (expected behavior in TDD RED phase)
    Expected Result: Tests fail because feature not implemented yet
    Evidence: .sisyphus/evidence/task-10-tdd-red.txt

  Scenario: Test cases cover all scopes
    Tool: Bash
    Preconditions: Review test cases
    Steps:
      1. Verify test cases exist for: global, local, both
      2. Verify test cases exist for invalid scope values
    Expected Result: Comprehensive test coverage for scope option
    Evidence: .sisyphus/evidence/task-10-test-coverage.txt
  ```

  **Commit**: YES
  - Message: `test(bootstrap): add TDD RED tests for scope option`
  - Files: `packages/corgispec/test/bootstrap.test.ts`
  - Pre-commit: `npm test`

- [x] 11. Update INSTALL.md with new options

  **What to do**:
  - Update .opencode/INSTALL.md to document new --platform and --scope options
  - Add examples for different platform and scope combinations
  - Document interactive prompt behavior
  - Document default behavior

  **Must NOT do**:
  - Do not change the overall structure of INSTALL.md
  - Do not remove existing documentation

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 12, 13, 14)
  - **Blocks**: Task 14
  - **Blocked By**: Task 6

  **References**:
  - `.opencode/INSTALL.md` - Current install documentation
  - `packages/corgispec/src/commands/bootstrap.ts` - New CLI options

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: INSTALL.md contains --platform documentation
    Tool: Bash
    Preconditions: Update INSTALL.md
    Steps:
      1. Read .opencode/INSTALL.md
      2. Verify it contains "--platform" option
      3. Verify it contains examples for platform selection
    Expected Result: INSTALL.md documents --platform option
    Evidence: .sisyphus/evidence/task-11-install-md-platform.txt

  Scenario: INSTALL.md contains --scope documentation
    Tool: Bash
    Preconditions: Update INSTALL.md
    Steps:
      1. Read .opencode/INSTALL.md
      2. Verify it contains "--scope" option
      3. Verify it contains examples for scope selection
    Expected Result: INSTALL.md documents --scope option
    Evidence: .sisyphus/evidence/task-11-install-md-scope.txt

  Scenario: INSTALL.md documents interactive prompts
    Tool: Bash
    Preconditions: Update INSTALL.md
    Steps:
      1. Read .opencode/INSTALL.md
      2. Verify it mentions interactive prompts
      3. Verify it documents default behavior
    Expected Result: INSTALL.md documents interactive behavior
    Evidence: .sisyphus/evidence/task-11-install-md-interactive.txt
  ```

  **Commit**: YES
  - Message: `docs: update INSTALL.md with new bootstrap options`
  - Files: `.opencode/INSTALL.md`
  - Pre-commit: N/A

- [x] 12. Update README.md quick start section

  **What to do**:
  - Update README.md quick start section to show new options
  - Add examples for different platform and scope combinations
  - Keep it concise and focused on common use cases

  **Must NOT do**:
  - Do not change the overall structure of README.md
  - Do not remove existing documentation

  **Recommended Agent Profile**:
  - **Category**: `writing`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11, 13, 14)
  - **Blocks**: Task 14
  - **Blocked By**: Task 7

  **References**:
  - `README.md` - Current README documentation
  - `packages/corgispec/src/commands/bootstrap.ts` - New CLI options

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: README.md shows new options in quick start
    Tool: Bash
    Preconditions: Update README.md
    Steps:
      1. Read README.md
      2. Verify quick start section shows --platform option
      3. Verify quick start section shows --scope option
    Expected Result: README.md quick start shows new options
    Evidence: .sisyphus/evidence/task-12-readme-quick-start.txt

  Scenario: README.md has examples for common use cases
    Tool: Bash
    Preconditions: Update README.md
    Steps:
      1. Read README.md
      2. Verify examples exist for:
         - Install for specific platform
         - Install to local scope
         - Interactive mode
    Expected Result: README.md has practical examples
    Evidence: .sisyphus/evidence/task-12-readme-examples.txt
  ```

  **Commit**: YES
  - Message: `docs: update README.md with new bootstrap options`
  - Files: `README.md`
  - Pre-commit: N/A

- [x] 13. Integration tests for platform+scope combinations

  **What to do**:
  - Write integration tests for different platform+scope combinations
  - Test all valid combinations (3 platforms × 3 scopes = 9 combinations)
  - Test edge cases (empty platform list, invalid combinations)
  - Test interactive mode with different inputs

  **Must NOT do**:
  - Do not test individual features (already covered in Tasks 5, 10)
  - Do not modify existing tests

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11, 12, 14)
  - **Blocks**: Task 14
  - **Blocked By**: Task 6, Task 7, Task 8, Task 9

  **References**:
  - `packages/corgispec/test/bootstrap.test.ts` - Existing test patterns
  - `packages/corgispec/src/commands/bootstrap.ts` - New CLI options

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Test all platform+scope combinations
    Tool: Bash
    Preconditions: Write integration tests
    Steps:
      1. Run: cd packages/corgispec && npm test -- --grep "integration"
      2. Verify all tests pass
    Expected Result: All platform+scope combinations work correctly
    Evidence: .sisyphus/evidence/task-13-integration-tests.txt

  Scenario: Test edge cases
    Tool: Bash
    Preconditions: Write edge case tests
    Steps:
      1. Verify tests exist for empty platform list
      2. Verify tests exist for invalid combinations
      3. Verify tests exist for interactive mode
    Expected Result: Edge cases are covered
    Evidence: .sisyphus/evidence/task-13-edge-cases.txt
  ```

  **Commit**: YES
  - Message: `test(bootstrap): add integration tests for platform+scope combinations`
  - Files: `packages/corgispec/test/bootstrap.test.ts`
  - Pre-commit: `npm test`

- [x] 14. Final verification and cleanup

  **What to do**:
  - Run all tests to ensure everything passes
  - Verify all acceptance criteria are met
  - Clean up any temporary files or code
  - Ensure documentation is consistent

  **Must NOT do**:
  - Do not add new features
  - Do not change existing behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (after all other tasks)
  - **Blocks**: None
  - **Blocked By**: Task 11, Task 12, Task 13

  **References**:
  - All previous tasks

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: All tests pass
    Tool: Bash
    Preconditions: Complete all tasks
    Steps:
      1. Run: cd packages/corgispec && npm test
      2. Verify all tests pass
    Expected Result: All tests pass
    Evidence: .sisyphus/evidence/task-14-all-tests-pass.txt

  Scenario: Documentation is consistent
    Tool: Bash
    Preconditions: Complete all documentation tasks
    Steps:
      1. Read .opencode/INSTALL.md
      2. Read README.md
      3. Verify consistency between documentation and implementation
    Expected Result: Documentation matches implementation
    Evidence: .sisyphus/evidence/task-14-docs-consistent.txt

  Scenario: No temporary files remain
    Tool: Bash
    Preconditions: Complete cleanup
    Steps:
      1. Check for any temporary files
      2. Verify no debug code remains
    Expected Result: Clean codebase
    Evidence: .sisyphus/evidence/task-14-clean-codebase.txt
  ```

  **Commit**: YES
  - Message: `chore(bootstrap): final verification and cleanup`
  - Files: N/A
  - Pre-commit: `npm test`
