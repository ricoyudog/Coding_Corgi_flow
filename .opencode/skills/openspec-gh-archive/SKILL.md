---
name: openspec-gh-archive
description: Archive a completed change in the experimental workflow with GitHub integration. Use when the user wants to finalize and archive a change after implementation is complete.
license: MIT
compatibility: Requires openspec CLI and gh CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.0"
---

Archive a completed change in the experimental workflow with GitHub integration.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select change and resolve worktree**

   Read `openspec/config.yaml` for `isolation` settings.

   **If `isolation.mode: worktree`**: Changes live inside worktrees, not the main checkout. Read `references/worktree-discovery.md` for the full discovery procedure. Quick summary:
   1. `openspec list --json` — if it returns changes, use them
   2. If empty (new session from main checkout): scan `<isolation.root>/` directories, verify each with `git worktree list` and check `openspec/changes/<name>/` exists inside
   3. Auto-select if one found, prompt if multiple
   4. ALL subsequent work uses the worktree as workdir

   **If no isolation**: `openspec list --json` directly. Auto-select if one, prompt if multiple.

   If name provided by user, use it directly.

2. **Check artifact completion status**

   Run `openspec status --change "<name>" --json` and warn if artifacts are incomplete.

3. **Check task completion status**

   Read `tasks.md` if it exists. Warn if incomplete tasks remain.

4. **Assess delta spec sync state**

   Check for delta specs at `openspec/changes/<name>/specs/` and prompt whether to sync before archive.

4.5 **Update GitHub issues (if tracked)**

   Read `openspec/changes/<name>/.github.yaml` BEFORE archiving moves it.

   If tracking exists (using `number` field):
   - For each child issue, verify its current labels before changing:
     ```bash
     gh issue view <number> --json labels --jq '.labels[].name'
     ```
     If the child already has `done`, skip the label change for that child.
     If the child has none of `todo`, `in-progress`, or `review`, STOP and report:
     "⚠️ Child issue #\<number\> has unexpected labels: \<actual labels\>. Aborting."
     Otherwise proceed:
      ```bash
      gh issue edit <number> --remove-label "todo,in-progress,review" --add-label "done"
      ```
      Note: Do NOT close the issue. Closing removes issues from board label columns.
   - Post a final note on the parent issue:
     ```bash
      gh issue comment <parent_number> --body "Change '<name>' archived. All groups done. Specs synced: <yes/no/skipped>."
     ```
   - Verify the parent issue's current labels before changing:
     ```bash
     gh issue view <parent_number> --json labels --jq '.labels[].name'
     ```
     Confirm `backlog` is present. If not, STOP and report:
     "⚠️ Expected label `backlog` on parent issue but found: \<actual labels\>. Aborting label change."
   - Move the parent issue to done (do NOT close):
      ```bash
      gh issue edit <parent_number> --remove-label "backlog" --add-label "done"
      ```

   If gh is unavailable or `.github.yaml` is missing, skip silently.

5. **Perform the archive**

   Create `openspec/changes/archive/` if it does not exist and move the change to `openspec/changes/archive/YYYY-MM-DD-<name>`.

5.5 **Clean up worktree (if isolation active)**

   If worktree isolation is active (from step 1.3) and the worktree exists:
   - Remove the worktree:
     ```bash
     git worktree remove <worktree-path> --force
     ```
   - **Do NOT delete the branch.** The branch `<branch_name>` remains for the user to merge via PR.
   - Announce: `Worktree removed. Branch <branch_name> preserved — create a PR to merge it, or run \`git branch -d <branch_name>\` to discard.`

6. **Display summary**

   Show:
   - Change name
   - Schema
   - Archive location
   - Spec sync status
   - GitHub status if tracked
   - Any warnings acknowledged during archive

**Output On Success**

```
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** openspec/changes/archive/YYYY-MM-DD-<name>/
**Specs:** synced / skipped / no delta specs
**GitHub:** parent and child issues moved to done (open, not closed)
**Worktree:** removed (branch `<branch-name>` preserved) / not applicable
```

**Guardrails**
- Always prompt for change selection if not provided
- Use `openspec status --json` for completion checking
- Don't block archive on warnings; inform and confirm
- Preserve `.openspec.yaml` and `.github.yaml` by moving the full directory
- If delta specs exist, always assess sync before archive
