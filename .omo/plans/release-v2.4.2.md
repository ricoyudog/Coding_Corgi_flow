# Release v2.4.2 — corgi-loop to Master + npm + GitHub

## TL;DR

> **Quick Summary**: Release corgi-loop feature by cleaning the branch, squash merging to master, publishing v2.4.2 to npm, and creating a GitHub Release.
> 
> **Deliverables**:
> - Clean `loop-corgi` branch (no `.worktrees/` in git tracking)
> - Updated CHANGELOG.md with v2.4.2 entry
> - Version bumped to 2.4.2 in package.json + package-lock.json
> - Squash merge to master (single clean commit, no vault backups)
> - Git tag `v2.4.2` on master
> - Published `corgispec@2.4.2` on npm
> - GitHub Release `v2.4.2` with changelog notes
> 
> **Estimated Effort**: Medium (8 sequential steps, ~20 min)
> **Parallel Execution**: NO — strictly sequential (release pipeline)
> **Critical Path**: Cleanup → Version bump → Test → Build → Merge → Tag → Publish → Release

---

## Context

### Original Request
User completed corgi-loop initial development on `loop-corgi` branch and wants to merge to master, then release v2.4.2 to npm and GitHub.

### Interview Summary
**Key Discussions**:
- Tests already passing on branch: confirmed by user
- CHANGELOG update: YES, include v2.4.2 entry
- Merge strategy: SQUASH merge (user chose explicitly)
- Vault backup commits: user does NOT want them in master history

**Research Findings**:
- `.worktrees/` has 199 tracked files on `loop-corgi` — MUST clean before merge
- Active git worktree `.worktrees/loop-corgi-edit` exists — MUST remove before merge
- v2.4.1 tag exists on master but was never published to npm (latest on npm is 2.4.0)
- CHANGELOG is at `packages/corgispec/CHANGELOG.md`, NOT repo root
- `prepublishOnly` script: `npm run build && node scripts/bundle-assets.js`

### Metis Review
**Identified Gaps** (addressed):
- `.worktrees/` cleanup: Added as mandatory pre-merge step (Task 1)
- v2.4.1 npm gap: v2.4.2 CHANGELOG will naturally cover all changes since 2.4.0
- package-lock.json sync: Added explicit `npm install --package-lock-only` after version bump
- Active worktree removal: Added to cleanup task
- stop-check.ts and generate.ts changes: Included in CHANGELOG content

---

## Work Objectives

### Core Objective
Release the corgi-loop feature (self-driving fix-retry cycle + loop-check/stop-check hooks) as v2.4.2 via a clean squash merge to master, npm publish, and GitHub Release.

### Concrete Deliverables
- `.worktrees/` removed from git tracking + added to `.gitignore`
- `packages/corgispec/CHANGELOG.md` updated with v2.4.2 entry
- `packages/corgispec/package.json` version = `2.4.2`
- `packages/corgispec/package-lock.json` version synced
- Single squash commit on master
- Git tag `v2.4.2` on master HEAD
- `corgispec@2.4.2` published on npm
- GitHub Release `v2.4.2` created

### Definition of Done
- [ ] `npm view corgispec@2.4.2 version` returns `2.4.2`
- [ ] `gh release view v2.4.2` shows the release
- [ ] `git log --oneline master -1` shows single clean squash commit
- [ ] `git ls-tree -r master --name-only | grep '.worktrees' | wc -l` returns `0`

### Must Have
- `.worktrees/` files MUST NOT be in master history
- Vault backup commits MUST NOT appear in master history
- Version MUST be exactly `2.4.2`
- Tag `v2.4.2` MUST be on master, not on loop-corgi
- npm publish MUST include new dist files (loop-check.js, stop-check.js)

### Must NOT Have (Guardrails)
- NO `.worktrees/` files in master git tree
- NO vault backup commit messages in master log
- NO version tag on non-master branch
- NO force push to master
- NO skipping the test/build verification before publish

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: YES (tests-after, run before merge as gate)
- **Framework**: vitest

### QA Policy
Every task includes agent-executed QA scenarios with evidence capture.

---

## Execution Strategy

### Parallel Execution Waves

> This is a release pipeline — strictly sequential. Each step depends on the previous.

```
Step 1 → Step 2 → Step 3 → Step 4 → Step 5 → Step 6 → Step 7
Cleanup   Version   Test/     Merge      Tag       Publish    GH Release
                    Build
```

No parallelism possible — each step requires the previous to complete.

### Dependency Matrix

| Step | Depends On | Blocks |
|------|-----------|--------|
| 1. Cleanup | — | 2 |
| 2. Version bump | 1 | 3 |
| 3. Test + Build | 2 | 4 |
| 4. Squash merge | 3 | 5 |
| 5. Git tag | 4 | 6 |
| 6. npm publish | 5 | 7 |
| 7. GitHub Release | 6 | — |

### Agent Dispatch Summary

- Steps 1-7: `quick` (sequential git/npm/gh operations)
- Step 8 (Final Verification): `quick` (verification commands)

---

## TODOs

- [x] 1. Pre-merge Cleanup: Remove `.worktrees/` from git + Remove Active Worktree

  **What to do**:
  - Remove the active git worktree: `git worktree remove .worktrees/loop-corgi-edit`
  - Add `.worktrees/` to `.gitignore` (if not already present)
  - Remove all `.worktrees/` files from git tracking: `git rm -r --cached .worktrees/`
  - Commit on `loop-corgi` branch: `git commit -m "chore: remove .worktrees from git tracking, add to .gitignore"`

  **Must NOT do**:
  - Do NOT delete the `.worktrees/` directory itself (just untrack from git)
  - Do NOT merge to master yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Step 1)
  - **Blocks**: Steps 2-7
  - **Blocked By**: None

  **References**:
  **Pattern References**:
  - `.gitignore` — Add `.worktrees/` entry at appropriate location
  - Active worktree at `.worktrees/loop-corgi-edit` on branch `loop-corgi-edit` — must remove before merge

  **Acceptance Criteria**:
  - [ ] `git worktree list` shows only the main working tree
  - [ ] `git ls-tree -r HEAD --name-only | grep '.worktrees' | wc -l` returns `0`
  - [ ] `grep '.worktrees' .gitignore` returns a match

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Verify .worktrees/ fully untracked
    Tool: Bash
    Preconditions: On loop-corgi branch, cleanup commit done
    Steps:
      1. Run: git ls-tree -r HEAD --name-only | grep '.worktrees' | wc -l
      2. Run: git worktree list
      3. Run: grep '.worktrees' .gitignore
    Expected Result: 0 tracked files, only 1 worktree listed, .gitignore contains .worktrees
    Evidence: .sisyphus/evidence/task-1-worktrees-cleanup.txt

  Scenario: Verify worktree removed
    Tool: Bash
    Preconditions: git worktree remove completed
    Steps:
      1. Run: git worktree list
    Expected Result: Single line showing only main working tree
    Failure Indicators: Two lines listed (worktree still exists)
    Evidence: .sisyphus/evidence/task-1-worktree-removed.txt
  ```

  **Commit**: YES
  - Message: `chore: remove .worktrees from git tracking, add to .gitignore`
  - Files: `.gitignore`, 199 `.worktrees/` files (removed from tracking)

- [x] 2. Version Bump + CHANGELOG Update

  **What to do**:
  - Update `packages/corgispec/package.json`: change `"version": "2.4.1"` to `"version": "2.4.2"`
  - Run `npm install --package-lock-only` in `packages/corgispec/` to sync package-lock.json
  - Update `packages/corgispec/CHANGELOG.md` with v2.4.2 entry following the existing Keep a Changelog format

  **CHANGELOG content for v2.4.2** (add ABOVE the existing `## [0.1.0]` section):
  ```markdown
  ## [2.4.2] - 2026-06-12

  ### Added

  - **corgi-loop**: Self-driving fix-retry cycle — runs apply→verify→review bundles automatically per Task Group, with loop-check/stop-check hooks for lifecycle control
  - `corgispec hook loop-check` — Evaluates loop state (task completion, verify results, review decisions) and outputs next action for AI agents
  - `corgispec hook stop-check` — Detects active loops and defers stop decisions to loop-check pipeline
  - Loop state management: `lib/loop-state.ts` — state discovery, transition, and persistence across hook invocations
  - Loop types: `lib/loop-types.ts` — TypeScript interfaces for LoopState, VerifyArtifact, ReviewArtifact
  - Loop validation: `lib/loop-validation.ts` — spec coverage checks, verify result parsing, review decision extraction
  - `corgispec hooks generate` now registers loop-check and stop-check hooks in generated config
  - **corgispec-loop** compound skill (`.opencode/skills/compounds/corgispec-loop/`) — end-to-end loop orchestration
  - **corgispec-review-loop** molecule skill (`.opencode/skills/molecules/corgispec-review-loop/`) — automated loop review with quality checks
  - Worktree discovery in loop pipeline — automatically locates project root from worktree contexts

  ### Changed

  - `stop-check` hook now detects active corgi-loop sessions and defers to loop-check pipeline
  - Hook generation output includes loop-check and stop-check entries

  ### Tests

  - 763 lines of loop-check tests (unit + integration)
  - 1223 lines of loop-validation tests
  - Total: +1986 lines of new test coverage
  ```

  **Must NOT do**:
  - Do NOT change version in any other file
  - Do NOT modify the existing `[0.1.0]` CHANGELOG entry

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Step 2)
  - **Blocks**: Steps 3-7
  - **Blocked By**: Step 1

  **References**:
  **Pattern References**:
  - `packages/corgispec/CHANGELOG.md` — Existing format: Keep a Changelog, sections are `### Added`, `### Changed`, etc. New version goes ABOVE `## [0.1.0]`
  - `packages/corgispec/package.json` — Version field at line 3, currently `"version": "2.4.1"`

  **Acceptance Criteria**:
  - [ ] `node -e "console.log(require('./packages/corgispec/package.json').version)"` returns `2.4.2`
  - [ ] `node -e "const p=require('./packages/corgispec/package-lock.json'); console.log(p.version || p.packages[''].version)"` returns `2.4.2`
  - [ ] CHANGELOG.md contains `## [2.4.2] - 2026-06-12`
  - [ ] CHANGELOG.md contains `corgi-loop` and `loop-check` entries

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Verify version bump
    Tool: Bash
    Preconditions: Version bump and npm install completed
    Steps:
      1. Run: node -e "console.log(require('./packages/corgispec/package.json').version)"
      2. Run: node -e "const p=require('./packages/corgispec/package-lock.json'); console.log(p.version || p.packages[''].version)"
    Expected Result: Both output "2.4.2"
    Evidence: .sisyphus/evidence/task-2-version-bump.txt

  Scenario: Verify CHANGELOG content
    Tool: Bash
    Preconditions: CHANGELOG.md updated
    Steps:
      1. Run: head -5 packages/corgispec/CHANGELOG.md
      2. Run: grep -c "2.4.2" packages/corgispec/CHANGELOG.md
      3. Run: grep -c "corgi-loop" packages/corgispec/CHANGELOG.md
    Expected Result: First line after header is "## [2.4.2]", at least 1 match for "2.4.2" and "corgi-loop"
    Evidence: .sisyphus/evidence/task-2-changelog.txt
  ```

  **Commit**: YES
  - Message: `chore(release): bump version to 2.4.2, update CHANGELOG`
  - Files: `packages/corgispec/package.json`, `packages/corgispec/package-lock.json`, `packages/corgispec/CHANGELOG.md`

- [x] 3. Test + Build Verification

  **What to do**:
  - Run tests: `cd packages/corgispec && npm test`
  - Run build: `cd packages/corgispec && npm run build`
  - Run asset bundling: `cd packages/corgispec && node scripts/bundle-assets.js`
  - Verify new dist files exist:
    - `packages/corgispec/dist/commands/hooks/loop-check.js`
    - `packages/corgispec/dist/commands/hooks/stop-check.js`
  - Verify dist/corgispec.js exists (the main CLI entry point)

  **Must NOT do**:
  - Do NOT publish yet
  - Do NOT commit the dist/ directory (it's likely in .gitignore)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Step 3)
  - **Blocks**: Steps 4-7
  - **Blocked By**: Step 2

  **References**:
  **Pattern References**:
  - `packages/corgispec/package.json` — scripts: `"build": "tsup"`, `"test": "vitest run"`, `"prepublishOnly": "npm run build && node scripts/bundle-assets.js"`
  - `packages/corgispec/tsup.config.ts` — Build configuration
  - `packages/corgispec/scripts/bundle-assets.js` — Asset bundling script

  **Acceptance Criteria**:
  - [ ] `npm test` exits with code 0 (all tests pass)
  - [ ] `npm run build` exits with code 0
  - [ ] `node scripts/bundle-assets.js` exits with code 0
  - [ ] `dist/commands/hooks/loop-check.js` exists
  - [ ] `dist/commands/hooks/stop-check.js` exists
  - [ ] `dist/corgispec.js` exists

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Full test suite passes
    Tool: Bash
    Preconditions: On loop-corgi branch with version 2.4.2
    Steps:
      1. cd packages/corgispec && npm test 2>&1
    Expected Result: Exit code 0, all test suites pass, 0 failures
    Failure Indicators: Exit code non-zero, any test failures
    Evidence: .sisyphus/evidence/task-3-test-results.txt

  Scenario: Build produces expected dist files
    Tool: Bash
    Preconditions: Tests pass
    Steps:
      1. cd packages/corgispec && npm run build 2>&1
      2. node scripts/bundle-assets.js 2>&1
      3. ls -la dist/commands/hooks/loop-check.js dist/commands/hooks/stop-check.js dist/corgispec.js
    Expected Result: All three files exist and have non-zero size
    Failure Indicators: Missing files or zero-size files
    Evidence: .sisyphus/evidence/task-3-build-output.txt
  ```

  **Commit**: NO (dist/ is build output, not committed)

- [x] 4. Squash Merge to Master

  **What to do**:
  - Checkout master: `git checkout master`
  - Pull latest: `git pull origin master`
  - Squash merge: `git merge --squash loop-corgi`
  - Commit with clean message: `git commit -m "feat(loop): add corgi-loop self-driving cycle with loop-check/stop-check hooks (v2.4.2)"`
  - Verify `.worktrees/` not in master tree: `git ls-tree -r HEAD --name-only | grep '.worktrees' | wc -l`

  **Must NOT do**:
  - Do NOT push to origin yet (do that after tag)
  - Do NOT use regular merge (must be squash)
  - Do NOT include vault backup commit messages in the squash commit

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Step 4)
  - **Blocks**: Steps 5-7
  - **Blocked By**: Step 3

  **References**:
  **Pattern References**:
  - Current branch: `loop-corgi` with 13+ commits ahead of master
  - After cleanup in Step 1, only code changes should remain (no `.worktrees/`)

  **Acceptance Criteria**:
  - [ ] `git branch --show-current` returns `master`
  - [ ] `git log --oneline -1` shows the squash commit message
  - [ ] `git ls-tree -r HEAD --name-only | grep '.worktrees' | wc -l` returns `0`

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Verify squash merge on master
    Tool: Bash
    Preconditions: Squash merge completed
    Steps:
      1. Run: git branch --show-current
      2. Run: git log --oneline -1
      3. Run: git ls-tree -r HEAD --name-only | grep '.worktrees' | wc -l
    Expected Result: "master", single squash commit with v2.4.2 message, 0 .worktrees files
    Evidence: .sisyphus/evidence/task-4-squash-merge.txt

  Scenario: Verify no vault backup in commit message
    Tool: Bash
    Preconditions: On master after squash merge
    Steps:
      1. Run: git log --oneline -1
    Expected Result: Message does NOT contain "vault backup"
    Failure Indicators: "vault backup" appears in commit message
    Evidence: .sisyphus/evidence/task-4-no-vault-backup.txt
  ```

  **Commit**: YES (squash merge creates a new commit on master)
  - Message: `feat(loop): add corgi-loop self-driving cycle with loop-check/stop-check hooks (v2.4.2)`

- [x] 5. Git Tag v2.4.2

  **What to do**:
  - Verify on master: `git branch --show-current` must return `master`
  - Create annotated tag: `git tag -a v2.4.2 -m "Release v2.4.2: corgi-loop self-driving cycle"`
  - Verify tag: `git log --oneline v2.4.2 -1` should show same commit as master HEAD
  - Push master + tag: `git push origin master --tags`

  **Must NOT do**:
  - Do NOT tag on loop-corgi branch
  - Do NOT push before tagging
  - Do NOT use lightweight tag (use annotated `-a`)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Step 5)
  - **Blocks**: Steps 6-7
  - **Blocked By**: Step 4

  **References**:
  - Existing tags follow pattern: `v2.3.1`, `v2.3.2`, `v2.3.3`, `v2.4.0`, `v2.4.1`

  **Acceptance Criteria**:
  - [ ] `git log --oneline v2.4.2 -1` shows same commit as `git log --oneline master -1`
  - [ ] `git push origin master --tags` succeeds
  - [ ] `git tag -l v2.4.2` returns `v2.4.2`

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Verify tag on master HEAD
    Tool: Bash
    Preconditions: Tag created, on master
    Steps:
      1. Run: git log --oneline v2.4.2 -1
      2. Run: git log --oneline master -1
    Expected Result: Both show the same commit hash
    Evidence: .sisyphus/evidence/task-5-tag-verification.txt

  Scenario: Verify push succeeded
    Tool: Bash
    Preconditions: git push origin master --tags completed
    Steps:
      1. Run: git ls-remote origin refs/tags/v2.4.2
    Expected Result: Shows the tag hash
    Failure Indicators: Empty output (tag not pushed)
    Evidence: .sisyphus/evidence/task-5-push-verification.txt
  ```

  **Commit**: NO (tag only)

- [x] 6. npm Publish

  **What to do**:
  - Dry run first: `cd packages/corgispec && npm publish --dry-run`
  - Verify dry run output shows correct files (dist/, assets/, bin entry)
  - If dry run OK, publish for real: `npm publish`
  - Verify: `npm view corgispec@2.4.2 version`

  **Must NOT do**:
  - Do NOT skip the dry run
  - Do NOT publish from repo root (must be in `packages/corgispec/`)
  - Do NOT use `--force` or `--tag` (use default = latest)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Step 6)
  - **Blocks**: Step 7
  - **Blocked By**: Step 5

  **References**:
  **Pattern References**:
  - `packages/corgispec/package.json` — `"prepublishOnly": "npm run build && node scripts/bundle-assets.js"` runs automatically
  - npm logged in as `ricoyudog`
  - Current published version: 2.4.0 (2.4.2 will be the new latest)

  **Acceptance Criteria**:
  - [ ] `npm publish --dry-run` exits with code 0
  - [ ] Dry run shows `dist/` and `assets/` in package tarball
  - [ ] `npm publish` exits with code 0
  - [ ] `npm view corgispec@2.4.2 version` returns `2.4.2`

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: npm dry run succeeds
    Tool: Bash
    Preconditions: On master, version 2.4.2
    Steps:
      1. cd packages/corgispec && npm publish --dry-run 2>&1
    Expected Result: Exit code 0, shows package size, lists dist/ and assets/ files
    Failure Indicators: Exit code non-zero, missing files in tarball listing
    Evidence: .sisyphus/evidence/task-6-dry-run.txt

  Scenario: npm publish succeeds and package is installable
    Tool: Bash
    Preconditions: npm publish completed
    Steps:
      1. npm view corgispec@2.4.2 version
      2. npm view corgispec@2.4.2 bin
    Expected Result: version = "2.4.2", bin = { corgispec: './dist/corgispec.js' }
    Failure Indicators: Version not found or 404
    Evidence: .sisyphus/evidence/task-6-publish-verified.txt
  ```

  **Commit**: NO

- [x] 7. GitHub Release

  **What to do**:
  - Create release notes file (use the CHANGELOG v2.4.2 content)
  - Create GitHub Release: `gh release create v2.4.2 --title "v2.4.2" --notes-file /tmp/release-notes-v2.4.2.md`
  - Verify: `gh release view v2.4.2 --json tagName,name,body`

  **Release notes content** (save to `/tmp/release-notes-v2.4.2.md`):
  ```markdown
  ## What's New in v2.4.2

  ### corgi-loop: Self-Driving Fix-Retry Cycle

  The headline feature: **corgi-loop** runs full Task Group bundles (apply -> verify -> review) automatically, with AI-driven lifecycle decisions and retry logic.

  ### New Features

  - **corgi-loop** compound skill — end-to-end loop orchestration for autonomous Task Group execution
  - **corgispec hook loop-check** — evaluates loop state and outputs next action for AI agents
  - **corgispec hook stop-check** — detects active loops and defers to loop-check pipeline
  - **Loop state management** (`lib/loop-state.ts`) — state discovery, transition, and persistence
  - **Loop types** (`lib/loop-types.ts`) — TypeScript interfaces for LoopState, VerifyArtifact, ReviewArtifact
  - **Loop validation** (`lib/loop-validation.ts`) — spec coverage checks, verify result parsing
  - **corgispec-review-loop** molecule skill — automated loop review with quality checks
  - Worktree discovery in loop pipeline — auto-locates project root from worktree contexts

  ### Changed

  - `stop-check` hook now detects active corgi-loop sessions
  - `corgispec hooks generate` includes loop-check and stop-check entries

  ### Tests

  - +1986 lines of new test coverage (loop-check + loop-validation)

  **Full Changelog**: https://github.com/ricoyudog/openspec_gitflow_modified/compare/v2.4.1...v2.4.2
  ```

  **Must NOT do**:
  - Do NOT create release on wrong tag
  - Do NOT mark as prerelease or draft (this is a stable release)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Step 7)
  - **Blocks**: None (last implementation step)
  - **Blocked By**: Step 6

  **References**:
  - Remote: `github.com/ricoyudog/openspec_gitflow_modified`
  - gh authed as `ricoyudog`
  - Tag `v2.4.2` already pushed to origin

  **Acceptance Criteria**:
  - [ ] `gh release view v2.4.2 --json tagName` returns `v2.4.2`
  - [ ] Release body contains "corgi-loop" and "loop-check"
  - [ ] Release is NOT marked as draft or prerelease

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: GitHub Release created successfully
    Tool: Bash
    Preconditions: Tag v2.4.2 pushed to origin
    Steps:
      1. gh release view v2.4.2 --json tagName,name,isDraft,isPrerelease 2>&1
    Expected Result: tagName="v2.4.2", isDraft=false, isPrerelease=false
    Failure Indicators: Release not found, or isDraft=true
    Evidence: .sisyphus/evidence/task-7-github-release.txt

  Scenario: Release notes contain key features
    Tool: Bash
    Preconditions: Release created
    Steps:
      1. gh release view v2.4.2 --json body -q ".body" | grep -c "corgi-loop"
    Expected Result: At least 1 match
    Evidence: .sisyphus/evidence/task-7-release-content.txt
  ```

  **Commit**: NO

---

## Final Verification

- [x] F1. **Release Verification** — `quick`
  Run all verification commands to confirm the complete release pipeline succeeded:
  ```bash
  # npm published
  npm view corgispec@2.4.2 version  # Expected: 2.4.2
  # GitHub release exists
  gh release view v2.4.2 --json tagName  # Expected: v2.4.2
  # master is clean
  git log --oneline master -1  # Expected: single squash commit
  git ls-tree -r master --name-only | grep '.worktrees' | wc -l  # Expected: 0
  # tag on master
  git log --oneline v2.4.2 -1  # Expected: same as master HEAD
  ```
  Output: `npm [OK/FAIL] | GitHub [OK/FAIL] | master [OK/FAIL] | tag [OK/FAIL] | VERDICT`

---

## Commit Strategy

| Step | Commit | Message | Files |
|------|--------|---------|-------|
| 1 | YES (on loop-corgi) | `chore: remove .worktrees from git tracking, add to .gitignore` | `.gitignore`, 199 `.worktrees/` files removed |
| 2 | YES (on loop-corgi) | `chore(release): bump version to 2.4.2, update CHANGELOG` | `package.json`, `package-lock.json`, `CHANGELOG.md` |
| 4 | YES (squash to master) | `feat(loop): add corgi-loop self-driving cycle with loop-check/stop-check hooks (v2.4.2)` | All changes from loop-corgi |
| 5 | NO (tag only) | — | — |

---

## Success Criteria

### Verification Commands
```bash
# Version check
node -e "console.log(require('./packages/corgispec/package.json').version)"
# Expected: 2.4.2

# npm published
npm view corgispec@2.4.2 version
# Expected: 2.4.2

# GitHub release
gh release view v2.4.2 --json tagName,name
# Expected: tagName="v2.4.2"

# No .worktrees in master
git ls-tree -r master --name-only | grep '.worktrees' | wc -l
# Expected: 0

# Clean master history
git log --oneline master -1
# Expected: single squash commit, no vault backup messages

# Tag on master
git log --oneline v2.4.2 -1
# Expected: same commit as master HEAD
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] npm package @2.4.2 installable (`npm install -g corgispec@2.4.2`)
- [ ] GitHub Release visible at repo releases page
- [ ] `corgispec hook loop-check --help` works after install
