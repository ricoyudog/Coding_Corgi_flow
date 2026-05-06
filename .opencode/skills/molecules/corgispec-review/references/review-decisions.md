# Advance / Repair Decision Procedures

Use this procedure only after the human gate.

Do not change labels, close issues, update parent progress, or append repair tasks until the user explicitly chooses approve or reject.

## Approve, advance the group

Post approval note to the child issue:
```bash
glab issue note <child_iid> --message "✅ Review passed.

<Review Summary>"
```

Commit and push all local changes:
```bash
git add -A
git commit -m "feat(<change-name>): complete Group N review"
git push
```
- If there are no local changes to commit, skip and log: "No local changes to commit."
- If `isolation.mode: worktree`, run git commands inside the worktree directory.
- **If commit or push fails: STOP. Report the error to the user. Do NOT proceed with label changes.**

Verify the child issue's current label before changing it:
```bash
glab issue view <child_iid> --output json | jq -r '.labels[]'
```
Confirm `workflow::review` is present. If not, STOP and report:
"⚠️ Expected label `workflow::review` but found: \<actual labels\>. Aborting label change."

Move the child issue to done (do NOT close — closing removes issues from board columns):
```bash
glab issue update <child_iid> --unlabel "workflow::review" --label "workflow::done"
```

Update the parent issue:
- Set this group's Status to `done` in the Task Groups table
- Update the `**Progress:**` line (example: `2/3 groups completed`)
```bash
glab issue update <parent_iid> --description "$UPDATED_PARENT_BODY"
```

## Reject, enter repair

Proceed to the repair flow in `references/repair-flow.md`.

This is the only path that can append fix tasks or reset workflow state to `workflow::in-progress`.

## Discuss

- Enter free-form conversation with the user
- Answer questions about the implementation, provide context
- After discussion concludes, re-ask: **approve** or **reject**
- Do not change issue labels or parent progress during discussion
