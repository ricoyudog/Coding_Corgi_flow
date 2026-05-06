# Issue Sync Procedures

## Tracking File

Issue tracking metadata is stored in `openspec/changes/<name>/.gitlab.yaml`:
```yaml
parent:
  iid: 42
  url: https://gitlab.example.com/group/project/-/issues/42
groups:
  - number: 1
    name: "Setup database schema"
    iid: 43
    url: https://gitlab.example.com/group/project/-/issues/43
  - number: 2
    name: "Implement API endpoints"
    iid: 44
    url: https://gitlab.example.com/group/project/-/issues/44
```

Use `parent.iid` for the parent issue. Match the current `## N.` Task Group in `tasks.md` to `groups[].number`, then read that group's `iid` and `url`.

If `.gitlab.yaml` does not exist, skip all issue sync steps silently.

## Moving Group Issue to In-Progress

When starting a Task Group, verify the current label before changing it:
```bash
glab issue view <group_issue_iid> --output json | jq -r '.labels[]'
```
Confirm `workflow::todo` is present. If not, STOP and report:
"⚠️ Expected label `workflow::todo` but found: \<actual labels\>. Aborting label change."

Then move:
```bash
glab issue update <group_issue_iid> --unlabel "workflow::todo" --label "workflow::in-progress"
```

Update parent issue description, set the matched `groups[].number` row's Status cell to `in-progress`.

## Rich Summary Format

After completing a Task Group, update the child issue description:

```markdown
**Objectives**
{Extract from proposal.md for this group's scope. If proposal.md missing, derive from task descriptions.}

**完成摘要**
- {One-sentence summary of each completed task — from actual implementation}

**產出檔案**
| 檔案 | 說明 |
|------|------|
| path/to/file.py | Brief description of what this file does |

**Todo**
- [x] N.1 task description
- [x] N.2 task description

**Estimated Completion Date:** {today's date, YYYY-MM-DD}

**References**
- Parent issue: #<parent_issue_iid>
- Change: `openspec/changes/<name>/`
```

Update with:
```bash
glab issue update <group_issue_iid> --description "$RICH_SUMMARY_BODY"
```

## Completion Note and Label Change

Verify the current label before changing it:
```bash
glab issue view <group_issue_iid> --output json | jq -r '.labels[]'
```
Confirm `workflow::in-progress` is present. If not, STOP and report:
"⚠️ Expected label `workflow::in-progress` but found: \<actual labels\>. Aborting label change."

Then post the note and move:
```bash
glab issue note <group_issue_iid> --message "Group N complete. Waiting for review."
glab issue update <group_issue_iid> --unlabel "workflow::in-progress" --label "workflow::review"
```

## Parent Issue Update

After syncing the group issue:

1. Read current parent issue description
2. Update the Task Groups table — set this group's Status to `review`
3. Update the `**Progress:**` line (count groups with Status `done`)
```bash
glab issue update <parent_issue_iid> --description "$UPDATED_PARENT_BODY"
```

If this was the last unfinished group, post a note:
```bash
glab issue note <parent_issue_iid> --message "All groups complete. Ready for final review."
```

## Blocker Notes

If a blocker is hit mid-group:
```bash
glab issue note <group_issue_iid> --message "Group N paused: <reason>"
```
