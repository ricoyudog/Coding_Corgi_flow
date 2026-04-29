# Task Group Checkpoint Flow

## Parsing Task Groups from tasks.md

Task Groups are identified by `## N.` headings in `tasks.md`. Each heading plus its child checkbox items forms one group.

Example:
```markdown
## 1. Setup database schema
- [x] 1.1 Create user table migration
- [x] 1.2 Add index on email column

## 2. Implement API endpoints
- [ ] 2.1 Create REST controller
- [ ] 2.2 Add input validation
- [ ] 2.3 Write integration tests

## 3. Frontend integration
- [ ] 3.1 Create form component
- [ ] 3.2 Add API client calls
```

## Building the Progress Table

For each group, track:

| Group | Name | Total | Done | Status | Issue |
|-------|------|-------|------|--------|-------|
| 1 | Setup database schema | 2 | 2 | done | #43 |
| 2 | Implement API endpoints | 3 | 0 | pending | #44 |
| 3 | Frontend integration | 2 | 0 | pending | #45 |

Issue numbers come from `.gitlab.yaml` if it exists.

## Finding the Current Group

The current group is the **first group with pending tasks** (has at least one `- [ ]` item).

If all groups are done → state is `all_done`, suggest review or archive.

## Discover, Develop, and Closeout Loop (One Group Only)

```
1. Discover: identify current group (first with pending tasks)
2. Discover: if tracked, move child issue to in-progress before code changes begin
3. Develop: announce "Group N: <name>"
4. Develop: for each pending task in this group:
   a. Announce task
   b. Implement (directly or via subagent)
   c. Mark [x] in tasks.md
   d. Record actual modified files for closeout
   e. If blocker → stop and report
5. Closeout: generate rich summary
6. Closeout: sync issues (if tracked)
7. Closeout: report checkpoint
8. STOP
```

## Checkpoint Report Format

```
## Checkpoint: Group N Complete

**Change:** <name>
**Progress:** A/B tasks complete (X/Y groups done)
**Child Issue:** #<iid> moved to review
**Parent Issue:** #<iid> updated
**Worktree:** <path> or "none"

### Completed This Session
- [x] N.1 task description
- [x] N.2 task description

### Files Modified
- path/to/file.py — description
- path/to/other.ts — description

Run `/opsx-review` to review this group, or `/opsx-apply` to continue.
```

## Closeout Retry Rule

If implementation work finished successfully but summary generation or issue sync fails, retry the closeout steps rather than re-running the completed group implementation.

## Blocker Handling

If a blocker occurs mid-group:

1. Stop execution immediately
2. Post note to child issue (if tracked)
3. Report to user with options:
   - Resolve the blocker and continue
   - Skip to next group
   - Update artifacts to address the design issue
4. Wait for guidance — do NOT guess or work around blockers

## Resume Behavior

When `/opsx-apply` is invoked again after a checkpoint or pause:

- Re-parse `tasks.md` to find current state
- Find first group with pending tasks
- If the previously-paused group still has pending tasks, resume there
- If it was completed, move to the next group
