# Review: Quality Checks and Evidence Gathering

Use this procedure during the review phase, after the group is selected and before the human gate.

These checks gather evidence for the review report. They inform the user's decision, but they do not decide the outcome.

Do not change labels, close issues, update parent progress, or append repair tasks here.

## 1. Code Quality Review

- Read all files produced by this group (from the child issue Rich Summary's file table)
- Check: code structure, obvious bugs or anti-patterns, naming and style consistency
- Produce: a short comment per file with status

## 2. Spec Verification

- Read `specs/<capability>/spec.md` from the change directory
- If no specs exist: note "No spec found for this group", skip
- Check each Requirement against the actual implementation
- Produce: coverage status per requirement

## 3. Functional Verification

Detect project type and gather evidence. All detection is best-effort, skip gracefully.

- **Test infrastructure**: Check for `tests/` + `pytest.ini` / `pyproject.toml` with `[tool.pytest]`. If found: run `python -m pytest`, capture output.
- **UI**: Check for `.html`, `.tsx`, `.vue`, `.jsx`. If found: use Playwright to screenshot. Upload to GitLab: `glab api --method POST "projects/:id/uploads" -F "file=@screenshot.png"`
- **CLI**: Check for CLI entry points in `pyproject.toml` `[project.scripts]`. If found: run basic commands, capture output.
- **Fallback**: Try importing or executing the core function.

## 4. Review Report Format

```markdown
## Review Report: Group N, {group name}

### Code Quality
| File | Comment | Status |
|------|---------|--------|
| path/file.py | Clean structure | ✅ |

### Spec Coverage
| Requirement | Status | Note |
|-------------|--------|------|
| REQ-1: Basic functionality | ✅ | Implemented and tested |

### Functional Verification
| Item | Result | Note |
|------|--------|------|
| core function works | ✅ Pass | See output |

### Test Results
{pytest output or "No test infrastructure detected"}

### Summary
✅ N passed | ⚠️ N need attention | ❌ N not met
```

## 5. Post evidence to GitLab

```bash
glab issue note <child_iid> --message "$REVIEW_REPORT"
```

If screenshots were taken, upload first to get URLs, then embed in the report.

Posting the report records evidence only. Approval, rejection, and repair-side mutations happen later in `references/review-decisions.md`.
