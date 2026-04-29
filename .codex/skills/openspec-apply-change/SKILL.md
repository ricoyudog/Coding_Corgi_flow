---
name: openspec-apply-change
description: Implement tasks from an OpenSpec change. Use when the user wants to start implementing, continue implementation, or work through tasks.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.0"
---

Implement tasks from an OpenSpec change.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `openspec list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Using change: <name>" and how to override (e.g., `/opsx-apply <other>`).

1.3 **Resolve worktree (if isolation configured)**

   Read `openspec/config.yaml` and check for `isolation` settings.

   **If `isolation.mode` is `worktree`:**
   - Derive worktree path: `<isolation.root>/<name>` (default root: `.worktrees`)
   - Check that the worktree exists:
     ```bash
     git worktree list --porcelain 2>/dev/null | grep "worktree.*/<name>$"
     ```
   - If worktree exists:
     - Announce: `Working in worktree: <path> (branch: <branch_prefix><name>)`
     - **All subsequent commands run inside the worktree.** Use the Bash tool's `workdir` parameter set to the absolute worktree path.
   - If worktree does NOT exist:
     - Check if `.worktree.yaml` exists in the change directory for metadata
     - If neither worktree nor metadata found → error: `Worktree not found for change "<name>". Run /opsx-propose first to create it.`
   - Also read `.worktree.yaml` from the change directory (within the worktree) if it exists, for branch name and metadata.

   **If `isolation.mode` is `none` or `isolation` section is missing:**
   - Continue as today — work in the current directory
   - Skip worktree resolution

1.5 **Check for GitLab tracking**

   Read `openspec/changes/<name>/.gitlab.yaml` if it exists.
   - If found: announce `Tracked on GitLab: parent #<parent_iid>, N group issues`
   - If not found and glab is available: ask whether to create issues using the propose flow
   - If not found and glab is unavailable: continue silently

2. **Check status to understand the schema**
   ```bash
   openspec status --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used
   - Which artifact contains the tasks

3. **Get apply instructions**

   ```bash
   openspec instructions apply --change "<name>" --json
   ```

   This returns:
   - Context file paths
   - Progress (total, complete, remaining)
   - Task list with status
   - Dynamic instruction based on current state

   **Handle states:**
   - If `state: "blocked"`: show message and stop
   - If `state: "all_done"`: congratulate and suggest review or archive
   - Otherwise: proceed to implementation

4. **Read context files**

   Read the files listed in `contextFiles` from the apply instructions output.

5. **Show current progress**

   Display:
   - Schema being used
   - Progress: `N/M tasks complete`
   - Remaining tasks overview
   - Dynamic instruction from CLI

5.5 **Parse Task Groups from tasks.md**

   Read `tasks.md`. Identify groups by `## N.` headings.
   Each heading plus its child `- [ ]` or `- [x]` items is one Task Group.

   Build a table like:
   - Group number
   - Group name
   - Total tasks
   - Done tasks
   - Issue number from `.gitlab.yaml` if available

   Find the first group with pending tasks. That is the current group.

6. **Execute current Task Group (checkpoint loop)**

   a. Announce: `Group N: <name> — Issue #<child_iid>`

   b. If tracked, move the child issue to in-progress:
      ```bash
      glab issue update <child_iid> --unlabel "workflow::todo" --label "workflow::in-progress"
      ```
      Also update the parent issue's Task Groups table — set this group's Status to `in-progress`:
      ```bash
      glab issue update <parent_iid> --description "$UPDATED_PARENT_BODY"
      ```

   c. Execute all pending tasks in this group only:
      - Show which task is being worked on
      - Make the code changes required
      - Keep changes minimal and focused
      - Mark task complete in `tasks.md`: `- [ ]` → `- [x]`
      - Continue until the current group is done or a blocker is hit

   c.5. **Generate Rich Summary** for the completed group:
      - Read the change's `proposal.md` to extract the group's objectives. If `proposal.md` does not exist, read `specs/` directory. If neither exists, derive objectives from the task descriptions themselves.
      - List all files created or modified during this group's tasks (from actual implementation, not guessed).
      - Compose a one-sentence completion summary for each completed task.
      - Assemble the Rich Summary block (see format in step d below).

   d. Sync to the child issue if tracked:
      - Read `.gitlab.yaml` to find the current `child_iid`
      - Update the child issue description using the Rich Summary format:
        ```markdown
        **Objectives**
        {Objectives extracted from proposal.md, specs/, or task descriptions}

        **完成摘要**
        - {One-sentence summary of each completed task}

        **產出檔案**
        | 檔案 | 說明 |
        |------|------|
        | path/to/file.py | Brief description of what this file does |

        **Todo**
        - [x] N.1 task description
        - [x] N.2 task description

        **Estimated Completion Date:** {today's date}

        **References**
        - Parent issue: #{parent_iid}
        - Change: `openspec/changes/<name>/`
        ```
        ```bash
        glab issue update <child_iid> --description "$RICH_SUMMARY_BODY"
        ```
      - Post a completion note:
        ```bash
        glab issue note <child_iid> --message "Group N complete. Waiting for review."
        ```
      - Move the child issue to review:
        ```bash
        glab issue update <child_iid> --unlabel "workflow::in-progress" --label "workflow::review"
        ```

    e. Update the parent issue if tracked:
      - Read `.gitlab.yaml` for `parent_iid`
      - Update the parent issue description:
        - Set this group's Status to `review` in the Task Groups table
        - Update the `**Progress:**` line (e.g., "1/3 groups completed" — count groups with Status `done`)
        ```bash
        glab issue update <parent_iid> --description "$UPDATED_PARENT_BODY"
        ```
      - If this was the last unfinished group, post a note on the parent issue

   f. Report and STOP:

      ```
      ## Checkpoint: Group N Complete

      **Change:** <name>
      **Progress:** A/B tasks complete
      **Child Issue:** #<child_iid> moved to review
      **Parent Issue:** #<parent_iid> updated

       Run `/opsx-review` to review this group, or `/opsx-apply` to continue with the next group.
      ```

      **STOP. Do not auto-continue to the next group.**

   g. If a blocker is hit mid-group:
      - Post a note to the child issue if tracked
        ```bash
        glab issue note <child_iid> --message "Group N paused: <reason>"
        ```
      - Report the blocker and wait for guidance

7. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress
   - If all task groups are done: suggest review
   - If paused: explain why and wait for guidance

**Output During Implementation**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on Group 2: <group name>
Working on task 2.1: <task description>
[...implementation happening...]
✓ Task complete

Working on task 2.2: <task description>
[...implementation happening...]
✓ Task complete
```

**Output On Checkpoint**

```
## Checkpoint: Group N Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete
**Child Issue:** #<child_iid> → workflow::review

### Completed This Session
- [x] Task 1
- [x] Task 2
...

Run `/opsx-review` to review this group, or `/opsx-apply` to continue with the next group.
```

**Output On Pause (Issue Encountered)**

```
## Implementation Paused

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete

### Issue Encountered
<description of the issue>

**Options:**
1. <option 1>
2. <option 2>
3. Other approach

What would you like to do?
```

**Guardrails**
- Execute one Task Group at a time
- Always read context files before starting (from the apply instructions output)
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Pause on errors, blockers, or unclear requirements - don't guess
- Use contextFiles from CLI output, don't assume specific file names
- If `.gitlab.yaml` exists, keep issue state in sync with `tasks.md`
- STOP after completing one group. Do not auto-continue.
- Rich summary is generated from actual implementation artifacts, not fabricated
- If proposal.md or specs/ is missing, use task descriptions as objectives

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
