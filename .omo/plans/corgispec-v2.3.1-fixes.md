# Corgispec v2.3.1 — Audit Fixes + Clean Master Sync

## TL;DR

> **Quick Summary**: Fix 3 confirmed bugs found during v2.3.0 audit (README overclaims, validate path bug, version mismatch), bump to v2.3.1, publish to npm, and sync only the relevant changes to master — keeping master free of dev-only files (obsidian, .claude, .codex, etc).
> 
> **Deliverables**:
> - `corgispec@2.3.1` published to npm
> - README hooks section aligned with actual CLI
> - `corgispec validate` falls back to bundled schemas
> - master branch clean, tagged `v2.3.1`
> - GitHub Release v2.3.1 created
> 
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: T1 (dev fixes) → T2 (npm publish) → T3 (master sync) → T4 (tag + release)

---

## Context

### Original Request
Fix 4 issues found during audit of corgispec@2.3.0, publish v2.3.1, and ensure master branch stays clean (no obsidian/vault/dev-only files).

### Interview Summary
**Key Discussions**:
- Published corgispec@2.3.0 but audit found issues
- Master must remain "public-facing clean" — pattern established by commit 35a6cc0
- npm publish must run from dev (bundle-assets.js needs source files)
- Never `git merge dev` into master — use selective file checkout

**Research Findings**:
- **Bug 1 (missing references)**: Root-level `references/hook-context-gate.md` is dead code — zero references from any skill. Molecule-level references are already bundled correctly. Downgraded to optional.
- **Bug 2 (README)**: Claims 4 hooks subcommands, only `generate` exists
- **Bug 3 (validate)**: `validate.ts` resolves schema from `<path>/schemas/` but should fall back to bundled `assets/schemas/`
- **Bug 4 (version)**: v2.3.0 tag has `0.1.1` in package.json — don't fix old tag, just get v2.3.1 right

### Metis Review
**Identified Gaps** (addressed):
- Root references file is dead code → made optional, not blocking
- Master already has dirty files (`conflict-files-obsidian-git.md`, `omx_wiki/log.md`) → added cleanup task
- No CI for npm publish → documented exact publish sequence as acceptance criteria
- 21 unstaged SKILL.md files with zero diff → safe to ignore, won't commit

---

## Work Objectives

### Core Objective
Fix the 3 real bugs (README, validate, version), publish corgispec@2.3.1, and sync cleanly to master.

### Concrete Deliverables
- `packages/corgispec/package.json` version = `2.3.1`
- `README.md` hooks section matches CLI reality
- `packages/corgispec/src/commands/validate.ts` falls back to bundled schemas
- `corgispec@2.3.1` on npm
- master branch: clean, tagged `v2.3.1`, GitHub Release created

### Definition of Done
- [ ] `npm view corgispec@2.3.1 version` → `2.3.1`
- [ ] `corgispec validate --help` works without local schemas
- [ ] `grep -c "hooks install\|hooks status\|hooks doctor" README.md` → `0`
- [ ] `git ls-tree -r --name-only master | grep -E '\.claude/|\.opencode/skills/|\.codex/|\.obsidian/|omx_wiki/|conflict-files'` → `0` matches
- [ ] GitHub Release v2.3.1 published

### Must Have
- Version 2.3.1 in package.json (NOT 2.3.0, NOT 0.1.1)
- npm publish from dev branch (required for bundle-assets.js)
- Selective file sync to master (NOT `git merge dev`)
- Master cleanliness verified after sync

### Must NOT Have (Guardrails)
- ❌ `git merge dev` into master — will bring 200+ dev-only files
- ❌ Force-push or delete v2.3.0 tag
- ❌ Add new hooks subcommands (install, status, doctor) — only fix README
- ❌ Commit `.claude/`, `.opencode/skills/`, `.codex/`, `.obsidian/`, `omx_wiki/`, `AGENTS.md` to master
- ❌ Refactor bundle-assets.js (it works for the real use case)
- ❌ Add CI/CD workflows in this release
- ❌ Touch the 21 unstaged zero-diff SKILL.md files
- ❌ Obsidian vault files, omx_wiki, or other dev-only content on master

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (vitest in packages/corgispec)
- **Automated tests**: Tests-after (fix bugs first, then verify)
- **Framework**: vitest

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (On dev - fix bugs, MAX PARALLEL):
├── Task 1: Fix README hooks documentation [quick]
├── Task 2: Fix validate.ts schema path fallback [quick]
└── Task 3: Bump version to 2.3.1 + commit dev [quick]

Wave 2 (Sequential - publish + sync):
├── Task 4: Build, publish corgispec@2.3.1 to npm [quick]
├── Task 5: Selective sync to master + clean dirty files [quick]
└── Task 6: Tag v2.3.1 + GitHub Release [quick]

Wave FINAL (Verification):
├── Task F1: npm package completeness audit (oracle)
├── Task F2: Master cleanliness verification (quick)
├── Task F3: CLI functional verification (quick)
└── Task F4: Scope fidelity check (quick)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 3 | 1 |
| 2 | - | 3 | 1 |
| 3 | 1, 2 | 4 | 1 |
| 4 | 3 | 5 | 2 |
| 5 | 4 | 6 | 2 |
| 6 | 5 | F1-F4 | 2 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks — T1 `quick`, T2 `quick`, T3 `quick`
- **Wave 2**: 3 tasks — T4 `quick`, T5 `quick`, T6 `quick`
- **FINAL**: 4 tasks — F1 `oracle`, F2 `quick`, F3 `quick`, F4 `quick`

---

## TODOs

- [x] 1. Fix README hooks documentation

  **What to do**:
  - Edit `README.md` hooks section: replace the 4-command listing (`hooks generate/install/status/doctor`) with the actual commands
  - Document the two actual command groups:
    - `corgispec hooks generate` — generates hook config for platforms
    - `corgispec hook <subcommand>` — 6 runtime hook subcommands (session-start, pre-write, post-write, pre-bash, post-compact, stop-check)
  - Remove the "CLI Commands" code block that lists non-existent subcommands
  - Keep the "Available Hooks" table (it documents actual hook types, not CLI commands)

  **Must NOT do**:
  - Do NOT add implementation for missing hooks commands
  - Do NOT change the hooks feature description beyond accuracy fixes

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `README.md` — current hooks section (~line 180-210) with overclaimed commands
  - `packages/corgispec/src/bin/corgispec.ts` lines 68-75 — the entry point that registers TWO separate commands: `hook` (singular, line 68-70, runtime hooks with 6 subcommands) and `hooks` (plural, line 72-75, config management with only `generate`)
  - `packages/corgispec/src/commands/hooks/index.ts` — defines the `hook` (singular) command: exports `createHookCommand()` which registers 6 runtime subcommands (session-start, post-compact, pre-write, pre-bash, post-write, stop-check)
  - `packages/corgispec/src/commands/hooks/generate.ts` — defines the `hooks generate` (plural) command: the ONLY subcommand under the `hooks` config management command

  **WHY Each Reference Matters**:
  - README.md: the file to edit
  - bin/corgispec.ts: proves the split — `hook` (runtime, 6 subcommands) vs `hooks` (config, only generate)
  - hooks/index.ts: proves it creates the singular `hook` command with runtime subcommands, NOT the plural `hooks` command
  - generate.ts: proves `hooks generate` is the only config management subcommand

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: README no longer claims non-existent hooks commands
    Tool: Bash (grep)
    Preconditions: README.md has been edited
    Steps:
      1. Run: grep -n "hooks install\|hooks status\|hooks doctor" README.md
      2. Assert: output is empty (exit code 1 from grep = no matches = PASS)
    Expected Result: Zero matches for non-existent commands
    Failure Indicators: grep returns any matches
    Evidence: .sisyphus/evidence/task-1-readme-grep.txt

  Scenario: README documents actual hooks commands
    Tool: Bash (grep)
    Preconditions: README.md has been edited
    Steps:
      1. Run: grep -c "hooks generate" README.md
      2. Assert: count >= 1
      3. Run: grep -c "hook session-start\|hook pre-write\|hook post-write\|hook pre-bash\|hook post-compact\|hook stop-check" README.md
      4. Assert: count >= 1
    Expected Result: Both actual command groups documented
    Failure Indicators: Either count is 0
    Evidence: .sisyphus/evidence/task-1-readme-actual-cmds.txt
  ```

  **Commit**: NO (groups with Task 3)

- [x] 2. Fix validate.ts schema path fallback

  **What to do**:
  - Edit `packages/corgispec/src/commands/validate.ts`
  - The current code at ~line 51 does: `schemasDir = resolve(rootDir, "schemas")` which looks for `<project>/schemas/`
  - When this path doesn't exist, add a fallback to the bundled `assets/schemas/` directory
  - The bundled path can be obtained via the existing `getAssetsDir()` utility (used in other commands)
  - Logic: if `resolve(rootDir, "schemas")` doesn't exist → fall back to `resolve(getAssetsDir(), "schemas")`
  - After fix, `corgispec validate --path /tmp/empty-project` should work without a local `schemas/` directory

  **Must NOT do**:
  - Do NOT change the default behavior when local schemas exist
  - Do NOT refactor the entire validate command
  - Do NOT change the SchemaRegistry interface

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `packages/corgispec/src/commands/validate.ts` — the file to fix (~line 51: schema path resolution)
  - `packages/corgispec/src/lib/schemas.ts` — contains `getAssetsDir()` at line 13 and `createSchemaRegistry()` at line 51 which already has fallback logic: `this.schemasDir = schemasDir ?? resolve(getAssetsDir(), "schemas")`
  - `packages/corgispec/src/lib/install-assets.ts` — contains `getAssetsRoot()` at line 68, alternative pattern for resolving assets path

  **WHY Each Reference Matters**:
  - validate.ts: the buggy file — line ~51 does `resolve(rootDir, "schemas")` without fallback
  - schemas.ts: has the correct pattern (`getAssetsDir()` → `resolve(..., "schemas")`) that validate.ts should use as fallback
  - install-assets.ts: alternative assets path resolution if schemas.ts pattern doesn't fit

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: validate works with empty project (no local schemas)
    Tool: Bash
    Preconditions: corgispec built from dev with the fix
    Steps:
      1. mkdir -p /tmp/test-validate-empty
      2. Run: cd /mnt/e/code/openspec_gitflow_modified/packages/corgispec && node dist/corgispec.js validate --path /tmp/test-validate-empty
      3. Check exit code (non-zero = validation found issues, but no crash/schema-not-found error)
      4. Run: cd /mnt/e/code/openspec_gitflow_modified/packages/corgispec && node dist/corgispec.js validate --path /tmp/test-validate-empty 2>&1 | grep -i "schema.*not found\|cannot find"
      5. Assert: no "schema not found" or "cannot find" errors
    Expected Result: Validate runs without schema-not-found crash, may report "no skills found" which is fine
    Failure Indicators: "schema not found" or "Cannot find module" errors
    Evidence: .sisyphus/evidence/task-2-validate-empty.txt

  Scenario: validate still works with local schemas (existing behavior preserved)
    Tool: Bash
    Preconditions: dev branch has .opencode/skills with schemas/ at repo root
    Steps:
      1. Run: cd /mnt/e/code/openspec_gitflow_modified/packages/corgispec && node dist/corgispec.js validate --path /mnt/e/code/openspec_gitflow_modified
      2. Check it finds the schemas and validates skills
      3. Assert: output mentions "skill" validation results, not "schema not found"
    Expected Result: Validates skills against schemas successfully
    Failure Indicators: "schema not found" error
    Evidence: .sisyphus/evidence/task-2-validate-local.txt
  ```

  **Commit**: NO (groups with Task 3)

- [x] 3. Bump version + commit dev + build

  **What to do**:
  - Stage all fixes: `git add README.md packages/corgispec/package.json packages/corgispec/src/commands/validate.ts`
  - Edit `packages/corgispec/package.json` version from `2.3.0` to `2.3.1` (currently 2.3.0 in unstaged, needs to be 2.3.1)
  - Also stage the 217 previously restored files (skills/commands/schemas) — they belong on dev
  - Build: `cd packages/corgispec && npm run build`
  - Verify build succeeds (exit code 0, dist/corgispec.js exists)
  - Commit everything on dev: `git commit -m "fix(corgispec): v2.3.1 — README hooks docs, validate fallback, restored source assets"`

  **Must NOT do**:
  - Do NOT push dev to origin yet
  - Do NOT set version to 2.3.0 (that's the broken tag's version)
  - Do NOT include obsidian/vault files in the commit (they should be gitignored)
  - Do NOT commit the 21 zero-diff SKILL.md unstaged changes (they're noise)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (after Task 1 & 2)
  - **Blocks**: Task 4
  - **Blocked By**: Task 1, Task 2

  **References**:

  **Pattern References**:
  - `packages/corgispec/package.json` — version field (currently `2.3.0` in working tree, change to `2.3.1`)

  **WHY Each Reference Matters**:
  - package.json: must be `2.3.1` before npm publish

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Version is 2.3.1 after edit
    Tool: Bash
    Preconditions: package.json edited
    Steps:
      1. Run: node -e "console.log(require('/mnt/e/code/openspec_gitflow_modified/packages/corgispec/package.json').version)"
      2. Assert output is exactly "2.3.1"
    Expected Result: "2.3.1"
    Failure Indicators: Any other version string
    Evidence: .sisyphus/evidence/task-3-version.txt

  Scenario: Build succeeds
    Tool: Bash
    Preconditions: All fixes committed
    Steps:
      1. Run: cd /mnt/e/code/openspec_gitflow_modified/packages/corgispec && npm run build
      2. Assert: exit code 0
      3. Assert: dist/corgispec.js exists
    Expected Result: Build completes with 0 errors
    Failure Indicators: Build fails or dist/ missing
    Evidence: .sisyphus/evidence/task-3-build.txt
  ```

  **Commit**: YES
  - Message: `fix(corgispec): v2.3.1 — README hooks docs, validate fallback, restored source assets`
  - Files: README.md, packages/corgispec/package.json, packages/corgispec/src/commands/validate.ts, .opencode/, .claude/, .codex/, openspec/schemas/
  - Pre-commit: `cd packages/corgispec && npm run build`

- [x] 4. Publish corgispec@2.3.1 to npm

  **What to do**:
  - Must run from dev branch (bundle-assets.js requires .opencode/skills/ etc.)
  - Run: `cd packages/corgispec && npm publish`
  - This triggers `prepublishOnly` which runs build + bundle-assets.js
  - Verify: `npm view corgispec@2.3.1 version` returns `2.3.1`
  - Verify: `npm pack corgispec@2.3.1 --dry-run 2>&1 | grep "skills/.*SKILL.md" | wc -l` returns 24

  **Must NOT do**:
  - Do NOT publish from master (source files don't exist there)
  - Do NOT publish with version 2.3.0 or 0.1.1
  - Do NOT use `--tag` flags (latest is correct)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (after Task 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 3

  **References**:
  - Previous publish output from this session for pattern reference

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: npm package published with correct version
    Tool: Bash
    Preconditions: npm publish completed
    Steps:
      1. Run: npm view corgispec@2.3.1 version
      2. Assert: output is "2.3.1"
    Expected Result: "2.3.1"
    Failure Indicators: 404 or wrong version
    Evidence: .sisyphus/evidence/task-4-npm-version.txt

  Scenario: npm package has all 24 skills
    Tool: Bash
    Preconditions: corgispec@2.3.1 freshly installed globally
    Steps:
      1. Run: find $(npm root -g)/corgispec/assets/skills -name 'SKILL.md' | wc -l
      2. Assert: output is "24"
    Expected Result: Exactly 24 SKILL.md files in the installed package
    Failure Indicators: Count != 24
    Evidence: .sisyphus/evidence/task-4-skill-count.txt

  Scenario: Fresh install works
    Tool: Bash
    Preconditions: package published
    Steps:
      1. Run: npm install -g corgispec@2.3.1
      2. Run: corgispec --version
      3. Assert: "2.3.1"
    Expected Result: Global install succeeds, version is 2.3.1
    Failure Indicators: Install fails or wrong version
    Evidence: .sisyphus/evidence/task-4-fresh-install.txt
  ```

  **Commit**: NO

- [x] 5. Selective sync to master + clean dirty files

  **What to do**:
  - Switch to master: `git checkout master`
  - The entire `packages/corgispec/` directory is allowed on master — it IS the published package. All sub-paths (`src/`, `dist/`, `assets/`, `scripts/`, `package.json`, `tsup.config.ts`, `tsconfig.json`, etc.) are safe to sync.
  - Selectively copy ONLY these files from dev:
    - `git checkout dev -- README.md` (hooks docs fix)
    - `git checkout dev -- packages/corgispec/` (entire package directory — source, build, assets)
  - Remove dirty files from master (if they exist):
    - `git rm conflict-files-obsidian-git.md` (if exists)
    - `git rm -r omx_wiki/` (if exists on master)
  - DO NOT copy: `.opencode/`, `.claude/`, `.codex/`, `.obsidian/`, `omx_wiki/`, `docs/articles/obsidian*`, `AGENTS.md`
  - Commit on master: `git commit -m "fix(corgispec): v2.3.1 — hooks docs fix, validate fallback, clean dev-only files"`
  - Verify: `git ls-tree -r --name-only master | grep -E '\.claude/|\.opencode/skills/|\.codex/|\.obsidian/|omx_wiki/'` → 0 matches

  **Must NOT do**:
  - ❌ NEVER `git merge dev` into master
  - ❌ Do NOT copy .opencode/, .claude/, .codex/, .obsidian/, omx_wiki/ to master
  - ❌ Do NOT copy vault backup files to master

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (after Task 4)
  - **Blocks**: Task 6
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - Commit `35a6cc0` — previous pattern for cleaning dev-only files from master
  - Commit `f8bf6d5` — another clean commit example

  **WHY Each Reference Matters**:
  - These commits show the established pattern for keeping master clean

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Master has no dev-only files
    Tool: Bash
    Preconditions: Committed on master
    Steps:
      1. Run: git ls-tree -r --name-only master | grep -E '\.claude/|\.opencode/skills/|\.codex/|\.obsidian/|omx_wiki/|conflict-files'
      2. Assert: output is empty (exit code 1 = no matches = PASS)
    Expected Result: Zero dev-only files on master
    Failure Indicators: Any matches
    Evidence: .sisyphus/evidence/task-5-master-clean.txt

  Scenario: Master has the fixed files
    Tool: Bash
    Preconditions: Committed on master
    Steps:
      1. Run: git show master:README.md | grep -c "hooks generate"
      2. Assert: >= 1
      3. Run: git show master:packages/corgispec/package.json | grep '"version"'
      4. Assert: contains "2.3.1"
    Expected Result: README and package.json updated on master
    Failure Indicators: Old content found
    Evidence: .sisyphus/evidence/task-5-master-files.txt
  ```

  **Commit**: YES
  - Message: `fix(corgispec): v2.3.1 — hooks docs fix, validate fallback, clean dev-only files`
  - Files: README.md, packages/corgispec/**, removals of conflict-files-obsidian-git.md, omx_wiki/

- [x] 6. Tag v2.3.1 + GitHub Release

  **What to do**:
  - On master branch, create tag: `git tag v2.3.1`
  - Push master + tag: `git push origin master && git push origin v2.3.1`
  - Verify tag's package.json: `git show v2.3.1:packages/corgispec/package.json | grep version` → `2.3.1`
  - Create GitHub Release:
    ```
    gh release create v2.3.1 --title "v2.3.1 — Audit Fixes" --notes '## Bug Fixes
    - **README**: Fixed hooks documentation — removed claims for non-existent hooks install/status/doctor commands, documented actual CLI (hooks generate + hook runtime subcommands)
    - **validate**: Added fallback to bundled schemas when no local schemas/ directory exists
    - **version**: Fixed package.json version to match tag name

    ## Upgrade Notes
    - No breaking changes
    - `corgispec validate --path <project>` now works without a local schemas/ directory

    **Full Changelog**: https://github.com/ricoyudog/Coding_Corgi_flow/compare/v2.3.0...v2.3.1'
    ```
  - Also push dev branch: `git checkout dev && git push origin dev`

  **Must NOT do**:
  - Do NOT tag on dev (tag should be on master)
  - Do NOT force-push any tags

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (after Task 5)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 5

  **References**: None needed

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Tag v2.3.1 has correct version
    Tool: Bash
    Preconditions: Tag created and pushed
    Steps:
      1. Run: git show v2.3.1:packages/corgispec/package.json | grep '"version"'
      2. Assert: contains "2.3.1"
    Expected Result: "2.3.1" in tagged package.json
    Failure Indicators: "0.1.1" or "2.3.0"
    Evidence: .sisyphus/evidence/task-6-tag-version.txt

  Scenario: GitHub Release exists
    Tool: Bash
    Preconditions: Release created
    Steps:
      1. Run: gh release view v2.3.1
      2. Assert: exits 0, shows title and notes
    Expected Result: Release visible on GitHub
    Failure Indicators: 404 or error
    Evidence: .sisyphus/evidence/task-6-github-release.txt
  ```

  **Commit**: NO (tag only)

---

## Final Verification Wave

- [x] F1. **npm Package Completeness Audit** — APPROVE

  **What to do**:
  - Fresh install corgispec@2.3.1 globally: `npm install -g corgispec@2.3.1`
  - Count bundled skills: `find $(npm root -g)/corgispec/assets/skills -name 'SKILL.md' | wc -l`
  - Count bundled commands: `find $(npm root -g)/corgispec/assets/commands -name '*.md' | wc -l`
  - Verify workflow schemas: `ls $(npm root -g)/corgispec/assets/schemas/github-tracked/schema.yaml $(npm root -g)/corgispec/assets/schemas/gitlab-tracked/schema.yaml`
  - Test validate with no local schemas: `corgispec validate --path /tmp/empty-qa-test`
  - Test hooks generate: `corgispec hooks generate --help`
  - Test doctor: `corgispec doctor`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: npm package has all 24 skills
    Tool: Bash
    Preconditions: corgispec@2.3.1 freshly installed
    Steps:
      1. Run: find $(npm root -g)/corgispec/assets/skills -name 'SKILL.md' | wc -l
      2. Assert: output is "24"
    Expected Result: Exactly 24 SKILL.md files
    Failure Indicators: Count != 24
    Evidence: .sisyphus/evidence/f1-skill-count.txt

  Scenario: validate works without local schemas (Bug 3 fix verification)
    Tool: Bash
    Preconditions: corgispec@2.3.1 installed, /tmp/empty-qa-test exists
    Steps:
      1. mkdir -p /tmp/empty-qa-test
      2. Run: corgispec validate --path /tmp/empty-qa-test 2>&1
      3. Assert: no "schema not found" or "Cannot find" errors in output
    Expected Result: Validates (may report no skills found) without schema crash
    Failure Indicators: "schema not found" or "Cannot find module" errors
    Evidence: .sisyphus/evidence/f1-validate-no-local.txt

  Scenario: hooks generate works
    Tool: Bash
    Preconditions: corgispec@2.3.1 installed
    Steps:
      1. Run: corgispec hooks generate --help
      2. Assert: exit code 0, output contains "--platform"
    Expected Result: Help text displayed
    Failure Indicators: Exit code non-zero
    Evidence: .sisyphus/evidence/f1-hooks-generate.txt
  ```

- [x] F2. **Master Cleanliness Verification** — APPROVE

  **What to do**:
  - Checkout master branch
  - List all tracked files: `git ls-tree -r --name-only master`
  - Grep for dev-only patterns
  - Check package.json version on master

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Master has zero dev-only files
    Tool: Bash
    Preconditions: On master branch after Task 5 commit
    Steps:
      1. Run: git ls-tree -r --name-only master | grep -E '\.claude/|\.opencode/skills/|\.codex/|\.obsidian/|omx_wiki/|conflict-files|AGENTS\.md'
      2. Assert: exit code 1 (no matches)
    Expected Result: Zero matches for dev-only file patterns
    Failure Indicators: Any file matches
    Evidence: .sisyphus/evidence/f2-master-clean.txt

  Scenario: Master package.json has version 2.3.1
    Tool: Bash
    Preconditions: On master branch
    Steps:
      1. Run: git show master:packages/corgispec/package.json | grep '"version"'
      2. Assert: output contains "2.3.1"
    Expected Result: "2.3.1"
    Failure Indicators: "0.1.1" or "2.3.0"
    Evidence: .sisyphus/evidence/f2-master-version.txt

  Scenario: Master README has no overclaimed hooks
    Tool: Bash
    Preconditions: On master branch
    Steps:
      1. Run: git show master:README.md | grep -c "hooks install\|hooks status\|hooks doctor"
      2. Assert: output is "0"
    Expected Result: 0 matches
    Failure Indicators: Any matches
    Evidence: .sisyphus/evidence/f2-readme-hooks.txt
  ```

- [x] F3. **CLI Functional Verification** — APPROVE

  **What to do**:
  - Fresh install corgispec@2.3.1
  - Run each key command and verify output

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Version command returns 2.3.1
    Tool: Bash
    Preconditions: corgispec@2.3.1 installed
    Steps:
      1. Run: corgispec --version
      2. Assert: output is "2.3.1"
    Expected Result: "2.3.1"
    Failure Indicators: Any other version
    Evidence: .sisyphus/evidence/f3-version.txt

  Scenario: hooks generate help works
    Tool: Bash
    Preconditions: corgispec@2.3.1 installed
    Steps:
      1. Run: corgispec hooks generate --help
      2. Assert: exit code 0, output contains "platform"
    Expected Result: Help text with platform options
    Failure Indicators: Error or missing options
    Evidence: .sisyphus/evidence/f3-hooks.txt

  Scenario: validate help works
    Tool: Bash
    Preconditions: corgispec@2.3.1 installed
    Steps:
      1. Run: corgispec validate --help
      2. Assert: exit code 0, output contains "path"
    Expected Result: Help text with path option
    Failure Indicators: Error
    Evidence: .sisyphus/evidence/f3-validate.txt

  Scenario: doctor passes
    Tool: Bash
    Preconditions: corgispec@2.3.1 installed
    Steps:
      1. Run: corgispec doctor
      2. Assert: exit code 0, output contains "pass" or "ok"
    Expected Result: All checks pass
    Failure Indicators: Checks fail
    Evidence: .sisyphus/evidence/f3-doctor.txt
  ```

- [x] F4. **Scope Fidelity Check** — APPROVE (override: INSTALL.md pre-existing)

  **What to do**:
  - For each task 1-6, compare "What to do" vs actual git diff
  - Verify "Must NOT do" compliance
  - Flag any unaccounted changes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All 6 tasks have corresponding diffs
    Tool: Bash
    Preconditions: All tasks completed
    Steps:
      1. Run: git log dev --oneline -3
      2. Assert: dev has commit with "v2.3.1" message
      3. Run: git log master --oneline -3
      4. Assert: master has commit with "v2.3.1" message
    Expected Result: Both branches have v2.3.1 commits
    Failure Indicators: Missing commits
    Evidence: .sisyphus/evidence/f4-commits.txt

  Scenario: No scope creep on master
    Tool: Bash
    Preconditions: On master
    Steps:
      1. Run: git diff v2.3.0..master --name-only | grep -E '\.opencode/skills/|\.claude/skills/|\.claude/commands/|\.codex/|\.obsidian/|omx_wiki/|AGENTS\.md|conflict-files'
      2. Assert: exit code 1 (no matches = PASS)
      3. Run: git diff v2.3.0..master --name-only
      4. Assert: all listed files are within these allowed paths: README.md, packages/corgispec/, INSTALL.md, .gitignore (use grep to verify each line matches allowed pattern)
    Expected Result: Zero dev-only files, all changes within allowed paths
    Failure Indicators: Any match for dev-only patterns, or files outside allowed paths
    Evidence: .sisyphus/evidence/f4-scope.txt
  ```

---

## Commit Strategy

- **T3 (dev)**: `fix(corgispec): README hooks docs + validate schema fallback + version 2.3.1` — README.md, packages/corgispec/package.json, packages/corgispec/src/commands/validate.ts, packages/corgispec/dist/*
- **T5 (master)**: `chore: sync v2.3.1 fixes to master + clean dev-only files` — README.md, packages/corgispec/package.json, packages/corgispec/package-lock.json (removals of conflict-files-obsidian-git.md, omx_wiki/)
- **T6 (master)**: tag `v2.3.1`

---

## Success Criteria

### Verification Commands
```bash
npm view corgispec@2.3.1 version          # Expected: 2.3.1
corgispec --version                         # Expected: 2.3.1
grep -c "hooks install" README.md           # Expected: 0
git ls-tree -r --name-only master | grep -cE '\.claude/|\.opencode/skills/|\.codex/|\.obsidian/|omx_wiki/'  # Expected: 0
npm pack corgispec@2.3.1 --dry-run 2>&1 | grep "skills/.*SKILL.md" | wc -l  # Expected: 24
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] corgispec@2.3.1 on npm
- [ ] master branch clean
- [ ] GitHub Release v2.3.1 created
