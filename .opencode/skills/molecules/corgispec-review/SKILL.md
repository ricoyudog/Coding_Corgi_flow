---
name: corgispec-review
description: Review a completed Task Group via GitLab issue feedback.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "2.0"
  generatedBy: "1.3.0"
---

Review a completed Task Group with quality checks and interactive approval.

## Preconditions (VERIFY BEFORE STARTING)

- [ ] Change exists in `openspec/changes/<name>/`
- [ ] `.gitlab.yaml` exists with parent and group issue IIDs
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

Read `.gitlab.yaml` for the group list. Check each group's labels via GitLab. Default to the first group in `workflow::review` state.

Read `tasks.md`. If the selected group's tasks are not all `[x]`, stop.

### 3. Review: inspect existing GitLab feedback

Read child issue notes. If reviewer feedback exists, present it to the user before proceeding.

### 4. Review: gather evidence and post the review report

Run automated quality checks and assemble a Review Report.

Quality checks inform the decision. They do not decide the outcome.

Read `references/quality-checks.md` for the full quality check procedure (code quality, spec verification, functional testing, report format).

Post the review report to the GitLab child issue:

```bash
glab issue note <child_iid> --message "$REVIEW_REPORT"
```

Posting the report records evidence for the human gate. Do not change labels, close issues, update parent progress, or generate repair tasks in this step.

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

Read `references/review-decisions.md` for the full approve, reject, and discuss procedures.

- **Approve**: commit & push local changes, move the child issue to done, update parent progress
- **Reject**: enter repair flow (see `references/repair-flow.md`)
- **Discuss**: free-form conversation, then re-ask approve or reject

All label changes, parent updates, and repair task generation happen only inside the approve or reject paths after the user chooses.

---

## Postconditions (VERIFY BEFORE REPORTING DONE)

- [ ] Review report was posted to the GitLab child issue
- [ ] User explicitly chose approve, reject, or discuss (not auto-decided)
- [ ] If approve: all local changes committed and pushed before label change (or confirmed no changes to commit)
- [ ] If approve: if commit or push failed, label change was NOT performed and error was reported
- [ ] If approve: child issue label changed to `workflow::done` (issue left open — closing removes it from board)
- [ ] If approve: parent issue progress updated
- [ ] If reject: fix tasks added to `tasks.md`, child issue moved to `workflow::in-progress`
- [ ] If reject: no fixes were implemented during review

**If you reached postconditions without asking the user in Step 5, you violated the contract. Stop and re-do Step 5.**
