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

Convert the confirmed plan into `tasks.md` format. Append under the current group as `N.x` fix tasks:
```
- [ ] 1.4 Fix input validation in cli.py
- [ ] 1.5 Add edge case handling for empty input
```

Fix tasks MUST be specific and actionable. Never write "fix the bug" or "improve quality".

## 5. Reset GitLab state to in-progress

Post rejection note:
```bash
glab issue note <child_iid> --message "❌ Review failed.

**Feedback:**
{summary}

**Fix Plan:**
{changes}

**Added Tasks:**
- [ ] N.x fix task 1
- [ ] N.x fix task 2"
```

Verify the child issue's current label before changing it:
```bash
glab issue view <child_iid> --output json | jq -r '.labels[]'
```
Confirm `workflow::review` is present. If not, STOP and report:
"⚠️ Expected label `workflow::review` but found: \<actual labels\>. Aborting label change."

Move the child issue back:
```bash
glab issue update <child_iid> --unlabel "workflow::review" --label "workflow::in-progress"
```

Update the parent issue, set the group Status back to `in-progress`.

## 6. Guide next steps

Tell the user: "Fix tasks added to tasks.md. Run `/corgi-apply` to start fixing."

Stop after task generation and state reset. Do not implement the fixes during review.
