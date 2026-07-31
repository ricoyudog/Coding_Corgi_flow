# Repair Flow

Entered only when the user chooses **reject** after the human gate.

This flow does not implement fixes during review. It only captures feedback, confirms a fix plan, appends precise fix tasks, resets state, and guides the next step.

## 1. Collect user feedback

Ask: "What's wrong? What did you expect?"

Support multiple rounds until intent is clear. Maximum 3 rounds. After that, suggest clarifying offline and re-running review later.

## 2. Analyze gaps

Compare user intent vs spec vs actual implementation. Identify specific gaps: which file, which function, what is missing or wrong.

## 3. Confirm fix plan

Present a concrete plan: "I plan to change: ..."
- List files to modify and what changes
- Wait for user confirmation or adjustment

## 4. Append precise fix tasks

Convert the confirmed plan into the task artifact's existing checkbox format. Append under the current group at the concrete path resolved from `taskArtifactId` and `artifactPaths`:
```
- [ ] 1.4 Fix input validation in cli.py
- [ ] 1.5 Add edge case handling for empty input
```

Fix tasks MUST be specific and actionable. Never write "fix the bug" or "improve quality".

## 5. Refresh the single Issue and reset GitLab state

Post rejection note:
```bash
glab issue note <issue_iid> --message "## Review Decision: Group N

❌ Review failed.

**Feedback:**
{summary}

**Fix Plan:**
{changes}

**Added Tasks:**
- [ ] N.x fix task 1
- [ ] N.x fix task 2"
```

Verify the Issue's current label before changing it:
```bash
glab issue view <issue_iid> --output json | jq -r '.labels[]'
```
Confirm `workflow::review` is present. If not, STOP and report:
"⚠️ Expected label `workflow::review` but found: \<actual labels\>. Aborting label change."

Move the same Issue back:
```bash
glab issue update <issue_iid> --unlabel "workflow::review" --label "workflow::in-progress"
```

Read the live description and require exactly one ordered dashboard marker pair. Rebuild checkboxes from the newly updated authoritative task artifact, set the current group row to `in-progress`, update progress, and replace only the managed dashboard block.

## 6. Guide next steps

Tell the user: "Fix tasks were added to the authorized task artifact. Run `/corgi-apply` to start fixing."

Stop after task generation and state reset. Do not implement the fixes during review.
