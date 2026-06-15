# F4 Scope Fidelity — Issues

## 1. Stray backup file
- **File**: packages/corgispec/test/hooks/loop-check.test.ts.bak
- **Issue**: This backup file appears in the git history (HEAD~5..HEAD diff) but is not part of any task deliverable. It's a stray artifact from development.
- **Recommendation**: Remove with `git rm` or add to `.gitignore`.
- **Severity**: Low (harmless but untidy).
