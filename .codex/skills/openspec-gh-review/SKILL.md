---
name: openspec-gh-review
description: Review a completed Task Group via GitHub Issues feedback using GitHub CLI. Mirrors the GitLab review flow but switched to GitHub and gh tooling.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.0"
---

Review a completed Task Group with quality checks and interactive approval.

## Preconditions (VERIFY BEFORE STARTING)

- [ ] Change exists in `openspec/changes/<name>/`
- [ ] `.github.yaml` exists with parent and group issue numbers
- [ ] If `isolation.mode` is `worktree`: worktree exists for this change (error if not)

## Forbidden Actions

- NEVER auto-approve or auto-reject, ONLY the user decides
- NEVER change issue labels without explicit user choice
- NEVER close issues — closing removes them from board label columns; label changes are sufficient
- NEVER skip the user decision prompt in Step 5
- NEVER fabricate test results or screenshots
- NEVER implement fixes during review

---

## Steps

### 1. Discover: select change and resolve worktree

Read `openspec/config.yaml` for `isolation` settings.

**If `isolation.mode: worktree`**: Changes live inside worktrees, not the main checkout. Read `references/worktree-discovery.md` for the full discovery procedure. Quick summary:
1. `openspec list --json`, if it returns changes, use them
2. If empty (new session from main checkout): scan `<isolation.root>/` directories, verify each with `git worktree list` and check `openspec/changes/<name>/` exists inside
3. Auto-select if one found, prompt if multiple
4. ALL subsequent work uses the worktree as workdir

**If no isolation**: `openspec list --json` directly. Auto-select if one, prompt if multiple.

If name provided by user, use it directly.

### 2. Discover: select Task Group and verify completion

- Read `.github.yaml` for the group list
- Read each group's live issue labels and state from GitHub
- Default to the first group in `review` if the user does not specify one

Read `tasks.md`. Stop if the selected group's tasks are not all complete.

### 3. Review: inspect existing GitHub feedback and completion context

Read child issue comments:
```
gh api repos/{owner}/{repo}/issues/<child_number>/comments --paginate
```

If reviewer comments exist, present them to the user before proceeding.

Read the child issue description, which should contain the Rich Summary from apply. Display the group's completion overview to the user:
- Objectives
- Completed tasks
- Files produced

This gives the user context before the human gate.

### 4. Review: gather evidence and post the review report

Run automated quality checks and assemble a Review Report.

Quality checks inform the decision. They do not decide the outcome.

Only the user approves or rejects. Do not change labels, close issues, update parent progress, or append repair tasks in this step.

**a. Code Quality Review**
- Read all files produced by this group (from the child issue Rich Summary's file table)
- Check: code structure, obvious bugs or anti-patterns, naming and style consistency
- Produce: a short comment per file with ✅ / ⚠️ / ❌ status

**b. Spec Verification**
- Read the corresponding `specs/<capability>/spec.md` from the change directory
- If no specs exist: note "No spec found for this group", skip this check
- Check each Requirement against the actual implementation
- Produce: coverage status per requirement with ✅ / ⚠️ / ❌

**c. Functional Verification**

Detect the project type and gather evidence accordingly. All detection is best-effort, skip gracefully if not applicable.

- **Test infrastructure detection**:
  - Check for `tests/` directory plus `pytest.ini`, `pyproject.toml` with `[tool.pytest]`, or `setup.cfg`
  - If found: run `python -m pytest` (or the appropriate test command), capture output
  - If not found: note "No test infrastructure detected", skip
- **UI detection**:
  - Check for web/frontend files (`.html`, `.tsx`, `.vue`, `.jsx`, etc.)
  - If found: use Playwright to open the application and capture key screenshots
  - Upload screenshots to GitHub by attaching them in issue comments or via API if needed
  - If not found: skip
- **CLI detection**:
  - Check for CLI entry points (`pyproject.toml` `[project.scripts]`, `bin/`, etc.)
  - If found: run basic CLI commands, capture output as evidence
  - If not found: skip
- **Fallback**: if none of the above apply, try to import or execute the core function to verify basic functionality

**d. Assemble Review Report**

Format for terminal display and GitHub issue:
```markdown
## Review Report: Group N, {group name}

### Code Quality
| File | Comment | Status |
|------|---------|--------|
| path/file.py | Clean structure, consistent naming | ✅ |

### Spec Coverage
| Requirement | Status | Notes |
|-------------|--------|-------|
| REQ-1: Basic functionality | ✅ | Implemented and tested |
| REQ-2: Edge cases | ⚠️ | Implemented but no test |

### Functional Verification
| Item | Result | Notes |
|------|--------|-------|
| add(1,1) returns 2 | ✅ Pass | See test output below |

### Tests
{pytest output or "No test infrastructure detected"}

### UI Screenshots
{Playwright screenshots or "No UI detected"}

### Summary
✅ N passed | ⚠️ N need attention | ❌ N not met
```

**e. Post Review Report to GitHub**
```bash
gh issue comment <child_number> --body "$REVIEW_REPORT"
```

If screenshots were taken, upload first to get URLs, then embed them in the report markdown.

Posting the report records evidence for the human gate. Workflow state changes happen only in the approve or reject paths in Step 6.

### 5. Human gate: ask the user for a decision

**This step is MANDATORY. You MUST stop here and wait for user input.**

Use the structured question/choice tool (e.g., `question()`) to present exactly these options.
Do NOT present them as plain text — use the interactive selection tool so the user can click/select directly:

1. **Approve** — commit & push all changes, move the group issue to done, and advance
2. **Reject** — fail this group and enter repair (no commit)
3. **Discuss** — talk before deciding

Quality checks inform the decision. Only the user approves or rejects.

**Do NOT proceed until the user explicitly chooses.**

### 6. Advance / Repair: execute the user's decision

**Approve, advance the group**
- Post a note to the child issue:
```bash
gh issue comment <child_number> --body "✅ Review passed.

<Review Summary>"
```
- Commit and push all local changes:
```bash
git add -A
git commit -m "feat(<change-name>): complete Group N review"
git push
```
  - If there are no local changes to commit, skip and log: "No local changes to commit."
  - If `isolation.mode: worktree`, run git commands inside the worktree directory.
  - **If commit or push fails: STOP. Report the error to the user. Do NOT proceed with label changes.**
- Verify the child issue's current label before changing it:
```bash
gh issue view <child_number> --json labels --jq '.labels[].name'
```
  Confirm `review` is present. If not, STOP and report:
  "⚠️ Expected label `review` but found: \<actual labels\>. Aborting label change."
- Close the child issue:
```bash
gh issue edit <child_number> --remove-label "review" --add-label "done"
```
  Note: Do NOT call `gh issue close`. Closing removes issues from board label columns.
- Update the parent issue:
  - Set this group's Status to `done` in the Task Groups table
  - Update the `Progress:` line (example: `2/3 groups completed`)
```bash
gh issue edit <parent_number> --body "$UPDATED_PARENT_BODY"
```

**Reject, enter repair**
1. Collect user feedback
   - Ask: "What's wrong? What did you expect?"
   - Support multiple rounds until intent is clear
   - Maximum 3 rounds. After that, suggest clarifying offline and re-running review later
2. Analyze gaps
   - Compare user intent vs spec vs actual implementation
   - Identify specific gaps: which file, which function, what is missing or wrong
3. Confirm fix plan
   - Present a concrete plan: "I plan to change: ..."
   - List which files will be modified and what will change
   - Wait for user confirmation or adjustment
4. Generate precise fix tasks
   - Convert the confirmed fix plan into `tasks.md` format
   - Append under the current group as `N.x` fix tasks (example: `- [ ] 1.4 Fix input validation in cli.py`)
   - Each fix task must be specific and actionable. Never write "fix the bug" or "improve quality"
5. Reset GitHub state to in-progress
   - Post a note to the child issue:
```bash
gh issue comment <child_number> --body "❌ Review failed.

**Feedback:**
{summary of user feedback}

**Fix Plan:**
{summary of proposed changes}

**Added Tasks:**
- [ ] N.x fix task 1
- [ ] N.x fix task 2"
```
   - Verify the child issue's current label before changing it:
```bash
gh issue view <child_number> --json labels --jq '.labels[].name'
```
     Confirm `review` is present. If not, STOP and report:
     "⚠️ Expected label `review` but found: \<actual labels\>. Aborting label change."
   - Move the child issue back to in-progress:
```bash
gh issue edit <child_number> --remove-label "review" --add-label "in-progress"
```
   - Update the parent issue, set this group's Status back to `in-progress` in the Task Groups table:
```bash
gh issue edit <parent_number> --body "$UPDATED_PARENT_BODY"
```
6. Guide next steps
   - Tell the user: "Fix tasks have been added to tasks.md. Run `/opsx-apply` to start fixing."
   - Stop after task generation and state reset. Do not implement the fixes during review.

**Discuss**
- Enter free-form conversation with the user
- The user can ask questions about the implementation, request clarification, or describe concerns
- The agent explains implementation logic, provides context, and offers suggestions
- After discussion concludes, ask the user to choose **approve** or **reject**
- Do not change issue labels or parent progress during discussion

All label changes, parent updates, and repair task generation happen only inside the approve or reject paths after the user chooses.

## Guardrails

- Review operates on one group at a time
- Evidence gathering and the review report are informational. They do not decide the outcome
- Only the user approves or rejects
- Workflow state mutation happens only in the approve or reject paths
- Repair is limited to user feedback, gap analysis, fix plan confirmation, precise fix-task generation, state reset, and next-step guidance
- Review must not implement fixes
- If GitHub comments contain existing feedback, present them before asking for a decision
- All review decisions are posted back to the GitHub child issue as comments
- If test execution fails (infra issue, not a test failure), report the error and continue
- Evidence gathering is best-effort, skip gracefully if detection fails
- Never fabricate test results or screenshots
- Fix tasks must be specific and actionable
- Always confirm the fix plan with the user before generating tasks
- Repair conversation is bounded. If the user cannot articulate the issue after 3 rounds, suggest clarifying offline and re-running review later

## Postconditions (VERIFY BEFORE REPORTING DONE)

- [ ] Review report was posted to the GitHub child issue
- [ ] User explicitly chose approve, reject, or discuss (not auto-decided)
- [ ] If approve: all local changes committed and pushed before label change (or confirmed no changes to commit)
- [ ] If approve: if commit or push failed, label change was NOT performed and error was reported
- [ ] If approve: child issue label changed to `done` (issue left open — closing removes it from board)
- [ ] If approve: parent issue progress updated
- [ ] If reject: fix tasks added to `tasks.md`, child issue moved to `in-progress`
- [ ] If reject: no fixes were implemented during review

**If you reached postconditions without asking the user in Step 5, you violated the contract. Stop and re-do Step 5.**

## Notes
- Labels used on GitHub are flat: `todo`, `in-progress`, `review`, `done`
- Uploading screenshots can be done by attaching images in issue comments or via the GitHub API if needed
- Tracking file: `.github.yaml` tracks groups by their GitHub issue numbers

(End of file)
