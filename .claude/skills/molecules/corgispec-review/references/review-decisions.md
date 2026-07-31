# Advance / Repair Decision Procedures

Use this procedure only after the human gate.

Do not change labels, update the managed dashboard, close the Issue, or append repair tasks until the user explicitly chooses approve or reject.

## Approve, advance the group

Post the approval note to the single Issue with a Group-specific heading:
```bash
glab issue note <issue_iid> --message "## Review Decision: Group N

✅ Review passed.

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

Verify the Issue's current label and managed dashboard before changing either:
```bash
glab issue view <issue_iid> --output json | jq -r '.labels[]'
```
Confirm `workflow::review` is present. If not, STOP and report:
"⚠️ Expected label `workflow::review` but found: \<actual labels\>. Aborting label change."

Require exactly one ordered dashboard marker pair. Rebuild its checkboxes from the authoritative task artifact, set this group's Status to `done`, and update both task completion and approved-group progress while preserving all description content outside the markers.

- If another group is pending, move the Issue from `workflow::review` to `workflow::todo`.
- If this was the final group, retain `workflow::review` so Human QA and archive remain visible before `workflow::done`.

## Reject, enter repair

Proceed to the repair flow in `references/repair-flow.md`.

This is the only path that can append fix tasks or reset the single Issue and dashboard row to `workflow::in-progress`.

## Discuss

- Enter free-form conversation with the user
- Answer questions about the implementation, provide context
- After discussion concludes, re-ask: **approve** or **reject**
- Do not change Issue labels or managed dashboard progress during discussion
