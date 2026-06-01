# Verify: Verification Steps and Procedures

Use this procedure during the verify phase, after the change and group are selected.

These steps are fully automated. No human gate is required. All detection is best-effort — skip gracefully if the expected infrastructure is not found.

## 1. Test Execution Procedures

### Detection and Execution Matrix

| Detection Condition | Framework | Execute Command | Failure Handling |
|---------------------|-----------|----------------|-----------------|
| `tests/` directory + `pytest.ini` or `pyproject.toml` with `[tool.pytest]` | pytest | `python -m pytest -v` | Failures → 🟡 Important, do not block |
| `package.json` with `"test"` script | npm | `npm test` | Failures → 🟡 Important, do not block |
| `bunfig.toml` or `bun.lockb` + test scripts | bun | `bun test` | Failures → 🟡 Important, do not block |
| `go.mod` + `*_test.go` files | Go | `go test ./...` | Failures → 🟡 Important, do not block |
| `Cargo.toml` + `#[test]` | Rust | `cargo test` | Failures → 🟡 Important, do not block |
| `Makefile` with `test` target | Make | `make test` | Failures → 🟡 Important, do not block |
| None of the above | — | Report "No test infrastructure detected" | Mark ⚠️, do not block |

### Detection Procedure (by priority)

1. **Check for pytest infrastructure**: Look for `tests/` directory. Check for `pytest.ini`, `pyproject.toml` (with `[tool.pytest]` section), or `setup.cfg` (with `[tool:pytest]`). If found, run `python -m pytest -v`.
2. **Check for npm/bun**: Look for `package.json`. If it has a `"test"` script, run `npm test`. If `bunfig.toml` or `bun.lockb` exists, prefer `bun test`.
3. **Check for Go**: Look for `go.mod`. If found and `*_test.go` files exist, run `go test ./...`.
4. **Check for Rust**: Look for `Cargo.toml`. If found, run `cargo test`.
5. **Check for Make**: Look for `Makefile`. If it has a `test` target, run `make test`.
6. **Fallback**: If none detected, note "No test infrastructure detected".

### Test Result Capture

- Capture the FULL output (stdout + stderr) of the test command
- Extract key metrics: total tests, passed, failed, skipped, errors
- Format: `✅ N passed / ❌ N failed / ⚠️ N skipped`
- If the command itself fails to execute (not a test failure — an infra error like "pytest not found"): report the error message and continue. Mark ℹ️.

## 2. Spec Coverage Verification Procedure

### Locating the Spec

1. Read the change's spec from `openspec/changes/<name>/specs/<capability>/spec.md`
2. If multiple capability specs exist, read ALL of them
3. If no specs exist at all: report "No spec found for this group", mark ℹ️, skip the rest of this section

### Requirement-by-Requirement Analysis

For each requirement in the spec (look for `## Requirements` section, then individual `### REQ-*` entries):

1. **Extract**: Requirement ID, description, and Scenario blocks (WHEN/THEN statements)
2. **Search**: For each scenario, search the implementation files for corresponding logic
   - Look in files produced by the group (from the apply Rich Summary)
   - Also check the broader codebase if the spec references existing modules
3. **Classify**:
   - **✅ Full**: ALL scenarios for this requirement have corresponding implementation code. Provide specific file:function references as evidence.
   - **⚠️ Partial**: Some scenarios covered, some missing or untestable. Note which scenarios are uncovered.
   - **❌ Missing**: No implementation found for ANY scenario of this requirement.

### Coverage Calculation

- Count requirements: total, fully covered, partially covered, missing
- Coverage rate = fully covered / total × 100%
- Report in format: `✅ N/N fully covered | ⚠️ N partial | ❌ N missing`
- Partially and missing requirements → each marked with appropriate severity:
  - Missing: 🟡 Important (spec says it should exist, but doesn't)
  - Partial: 🔵 Suggestion (most cases covered, minor gaps)

## 3. Lint / Build Verification Procedures

### Lint Detection

| Condition | Linter | Command | Notes |
|-----------|--------|---------|-------|
| `.ruff.toml` or `[tool.ruff]` in `pyproject.toml` | ruff | `ruff check` | Python linter, very common |
| `.eslintrc.*` (any format) or `"eslintConfig"` in `package.json` | ESLint | `npx eslint .` | JS/TS linter |
| `tsconfig.json` | TypeScript | `npx tsc --noEmit` | Type check only, no emit |
| `.flake8` or `[tool.flake8]` | flake8 | `flake8 .` | Legacy Python linter |
| `.golangci.yml` | golangci-lint | `golangci-lint run` | Go linter |
| None detected | — | Skip | Mark ℹ️ |

### Build Detection

| Condition | Build System | Command | Notes |
|-----------|-------------|---------|-------|
| `package.json` with `"build"` script | npm | `npm run build` | Common in JS/TS projects |
| `pyproject.toml` with `[build-system]` | pip/setuptools | `python -m build` | Python package build |
| `Makefile` with `build` target | Make | `make build` | Generic build |
| `go.mod` (main package) | Go | `go build ./...` | Build without test files |
| None detected | — | Skip | Mark ℹ️ |

### Result Handling

- **Lint passes**: ✅ captured, continue
- **Lint warnings**: capture warning summary, mark 🟡 Important, continue
- **Lint errors**: capture error summary, mark 🟡 Important, continue (does not block)
- **Build fails**: capture error output, mark ❌ FAIL (build failure is critical — verify verdict = FAIL)
- **No config detected**: mark ℹ️, note in report, continue

### Output Format

For the verify report, present lint/build results as:

```
### Lint / Build
✅ ruff: no errors | ✅ Build: success
(or)
⚠️ eslint: 3 warnings | ⚠️ No build config found
(or)
❌ Build: FAILED — dependency resolution error
```

## 4. Report Composition

### Assembling the Verify Report

After all evidence is gathered (Sections 1-3 above), assemble the final verify report following this structure:

```markdown
## Verify Report: Group N, {group name}

### Test Results
✅ N passed / ❌ N failed / ⚠️ N skipped

<test output or "No test infrastructure detected">

### Spec Coverage
| Requirement | Coverage | Evidence |
|-------------|----------|----------|
| REQ-1: name | ✅ Full | Implemented in path/file.py:funcName() |
| REQ-2: name | ⚠️ Partial | Happy path covered in path/file.py. Missing: edge case X |
| REQ-3: name | ❌ Missing | No implementation found in codebase |

**Summary**: ✅ N/N fully covered | ⚠️ N partial | ❌ N missing

### Lint / Build
✅ ruff: no errors | ✅ Build: success

### Verdict
{✅ PASS | ⚠️ PASS WITH WARNINGS | ❌ FAIL} — {next-steps guidance}
```

### Verdict Logic

Determine verdict based on accumulated results:

- **✅ PASS**: All detected checks pass —
  - Tests: all passing (or no test infra → skip)
  - Spec coverage: all requirements fully covered (or no spec → skip)
  - Lint: no errors or no linter config
  - Build: no errors or no build config
  - No 🟡 Important or 🔴 Critical severity items found

- **⚠️ PASS WITH WARNINGS**: Non-blocking issues found —
  - Test failures (individual test failures, not infra failure)
  - Partial or missing spec coverage
  - Lint warnings or errors (not build failures)
  - Any 🟡 Important items present
  - Guidance: "N warnings found. These are noted in the report but do not block review."

- **❌ FAIL**: Critical issues that must block review —
  - Build failure (cannot verify non-building code)
  - 🔴 Critical security concerns detected (from security checklist if used)
  - Core spec requirements completely missing (not just partial)
  - Any issue that makes the code fundamentally untestable
  - Guidance: "N critical issues found. Fix these before review. Run /corgi-apply to address them."

### Post-Report Actions

1. If tracking file exists (`.gitlab.yaml` / `.github.yaml`):
   - GitLab: `glab issue note <child_iid> --message "$VERIFY_REPORT"`
   - GitHub: `gh issue comment <child_number> --body "$VERIFY_REPORT"`
2. If no tracking file: display the report in terminal only
3. Print the next-steps guidance based on verdict
4. NEVER change labels, close issues, or create new issues
