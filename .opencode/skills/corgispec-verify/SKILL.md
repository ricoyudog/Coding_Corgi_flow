---
name: corgispec-verify
description: Automated verification gate between apply and review — runs tests, checks spec coverage, validates lint/build. No human gate required.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.0"
---

Run automated verification on a completed Task Group before review. Verify assures the code works; review judges if it's good enough.

## Preconditions (VERIFY BEFORE STARTING)

- [ ] Change exists in `openspec/changes/<name>/`
- [ ] If tracked: `.gitlab.yaml` or `.github.yaml` exists with group issue numbers
- [ ] If `isolation.mode` is `worktree`: worktree exists for this change (error if not)
- [ ] At least one Task Group has all tasks complete (verify needs something to check)

## Forbidden Actions

- NEVER ask for human input — verify is fully automated
- NEVER implement fixes — flag issues, do not resolve them
- NEVER create or close issues — only post a report note to existing child issues
- NEVER change issue labels or workflow state
- NEVER fabricate test results or evidence
- NEVER add Playwright/UI screenshots (those belong in review, not verify)

---

## Steps

### 1. Discover: select change and resolve worktree

Read `openspec/config.yaml` for schema (gitlab-tracked / github-tracked) and `isolation` settings.

**If `isolation.mode: worktree`**: Changes live inside worktrees. Read `references/worktree-discovery.md` for the full discovery procedure. Quick summary:
1. `openspec list --json`, if it returns changes, use them
2. If empty: scan `<isolation.root>/` directories, verify each with `git worktree list` and check `openspec/changes/<name>/` exists inside
3. Auto-select if one found, prompt if multiple
4. ALL subsequent work uses the worktree as workdir

**If no isolation**: `openspec list --json` directly. Auto-select if one, prompt if multiple.

If name provided by user, use it directly.

### 2. Discover: select completed Task Group

Parse `tasks.md` to find all Task Groups (`## N.` headings). Identify which groups have ALL tasks marked `[x]`. These are the completed groups eligible for verification.

If tracked: read the tracking file (`.gitlab.yaml` / `.github.yaml`) for group names and issue numbers.

Default to the first completed group that hasn't been verified yet. If no completed groups exist, guidance: "No completed groups found. Run `/corgi-apply` first."

### 3. Automated Test Execution

Detect the project's test infrastructure and run the test suite. All detection is best-effort — skip gracefully if nothing is found.

Use the detection table in `references/verification-steps.md` for detailed detection conditions and commands. Summary:

| Detection Condition | Run Command | Failure Handling |
|---------------------|-------------|-----------------|
| `tests/` + `pytest.ini` / `pyproject.toml` with `[tool.pytest]` | `python -m pytest -v` | If tests fail → mark 🟡 Important, do NOT block |
| `package.json` with `"test"` script | `npm test` | Same as above |
| `bun test` exists or `bunfig.toml` | `bun test` | Same as above |
| `go.mod` + `_test.go` files | `go test ./...` | Same as above |
| No test infrastructure | Report "No test infrastructure detected", mark ⚠️, do not block |

**Test result handling**:
- All tests pass → ✅ output captured, continue
- Some tests fail → capture failure output, mark 🟡 Important, continue
- No test infrastructure → mark ⚠️, note in report, continue

Tests are evidence. Failure is a signal, not a gate.

### 4. Spec Coverage Verification

Compare the change's spec requirements against the actual implementation.

Steps:
1. Read the spec file(s) from `openspec/changes/<name>/specs/<capability>/spec.md`
2. If no spec exists: note "No spec found for this group", mark ℹ️, skip
3. For each Requirement in the spec, check:
   - Is there corresponding implementation code that fulfills this requirement?
   - Do the Scenario behaviors map to actual code paths?
4. Classify each requirement:
   - **✅ Full**: Implementation covers all scenarios with evidence (specific file:function references)
   - **⚠️ Partial**: Some scenarios covered, some missing or untestable
   - **❌ Missing**: No implementation found for this requirement

Output format follows the spec in `references/verification-steps.md`.

### 5. Lint / Build Verification

Check for project-level lint and build configuration. Run what's available.

**Lint detection**:
| Condition | Command |
|-----------|---------|
| `.ruff.toml` or `[tool.ruff]` in `pyproject.toml` | `ruff check` |
| `.eslintrc.*` or `eslint` in `package.json` | `npx eslint .` (or configured path) |
| `tsconfig.json` | `npx tsc --noEmit` |
| No linter found | Skip, mark ℹ️ |

**Build detection**:
| Condition | Command |
|-----------|---------|
| `package.json` with `"build"` script | `npm run build` |
| `Makefile` with `build` target | `make build` |
| No build config | Skip, mark ℹ️ |

**Result handling**:
- Lint/build passes → ✅ captured, continue
- Lint/build fails → capture output, mark 🟡 Important, continue
- No config found → mark ℹ️, note, continue

### 6. Generate Verify Report

Assemble all verification results into a structured report. Read `references/verification-steps.md` for detailed report composition guidance.

Report format (for terminal display and issue posting):

```markdown
## Verify Report: Group N, {group name}

### Test Results
✅ 12 passed / ❌ 0 failed / ⚠️ 2 skipped

<test output or "No test infrastructure detected">

### Spec Coverage
| Requirement | Coverage | Evidence |
|-------------|----------|----------|
| REQ-1: User login | ✅ Full | Implemented in auth/login.py:login() |
| REQ-2: Error handling | ⚠️ Partial | Happy path covered, null input not handled |
| REQ-3: Rate limiting | ❌ Missing | No rate limiting found in codebase |

**Summary**: ✅ 2/3 fully covered | ⚠️ 1 partial | ❌ 0 missing

### Lint / Build
✅ ruff: no errors | ✅ Build: success

### Verdict
✅ **PASS** — Ready for review
```

#### Verdict Determination

- **✅ PASS**: All detectable checks passed (tests pass, spec fully covered, lint clean, build successful)
- **⚠️ PASS WITH WARNINGS**: Some checks have warnings (partial spec coverage, test failures, lint warnings) — not blocking, but noted
- **❌ FAIL**: Critical issues found that MUST be fixed before review (e.g., build broken, zero spec coverage for core requirements, security red flags from security checklist)

### 7. Gate Decision and Next-Steps Guidance

Based on the verdict from Step 6:

**If ✅ PASS or ⚠️ PASS WITH WARNINGS**:
- Post the verify report to the child issue (if tracked):
  - GitLab: `glab issue note <child_iid> --message "$VERIFY_REPORT"`
  - GitHub: `gh issue comment <child_number> --body "$VERIFY_REPORT"`
- Print guidance: `Run /corgi-review to review this group.`
- If warnings present, also print: `N warnings were found. They are noted in the report but do not block review.`

**If ❌ FAIL**:
- Post the verify report to the child issue (if tracked)
- Print guidance: `N critical issues found. Fix these before review. Run /corgi-apply to address them.`
- List the specific failure items for the user

**Verify cannot replace review**. Verify proves the code works. Review judges if the code is good enough. The human gate in review is always required after verify passes.

## Guardrails

- Verify is fully automated — no human gate, no confirmation dialogs
- Evidence gathering is best-effort — skip gracefully if detection fails
- Test/lint/build failures are signals, not gates (except build failure = FAIL)
- Verify never implements fixes, changes labels, or creates/close issues
- Verify posts only a report note to the existing child issue (if tracked)
- Platform detection: read `openspec/config.yaml` schema field, use `glab` for gitlab-tracked, `gh` for github-tracked
- If no tracking file exists: produce the report to terminal only, no issue posting
- If no completed groups found: stop with guidance, do not proceed

## Postconditions (VERIFY BEFORE REPORTING DONE)

- [ ] Change discovered and selected
- [ ] Completed Task Group identified
- [ ] Tests executed (or gracefully skipped with note)
- [ ] Spec coverage assessed (or gracefully skipped if no spec)
- [ ] Lint/build checked (or gracefully skipped if no config)
- [ ] Verify report generated with explicit verdict
- [ ] Report posted to child issue (if tracked)
- [ ] Next-steps guidance printed for user

**If you reached postconditions without producing an explicit PASS/PASS WITH WARNINGS/FAIL verdict, you violated the contract. Stop and determine the verdict.**
