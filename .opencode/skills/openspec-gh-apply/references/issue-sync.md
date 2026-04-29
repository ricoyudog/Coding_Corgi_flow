# Issue Sync Procedures (GitHub)

## Tracking File

Issue tracking metadata is stored in `openspec/changes/<name>/.github.yaml`:
```yaml
parent:
  number: 42
  url: https://github.com/org/repo/issues/42
groups:
  - number: 1
    name: "Setup database schema"
    issue_number: 43
    url: https://github.com/org/repo/issues/43
  - number: 2
    name: "Implement API endpoints"
    issue_number: 44
    url: https://github.com/org/repo/issues/44
```

Use `parent.number` for the parent issue. Match the current `## N.` Task Group in `tasks.md` to `groups[].number`, then read that group's `issue_number` and `url`.

If `.github.yaml` does not exist, skip all issue sync steps silently.

## Moving Group Issue to In-Progress

When starting a Task Group, verify the current label before changing it:
```bash
gh issue view <group_issue_number> --json labels --jq '.labels[].name'
```
Confirm `todo` is present. If not, STOP and report:
"⚠️ Expected label `todo` but found: \<actual labels\>. Aborting label change."

Then move:
```bash
gh issue edit <group_issue_number> --remove-label todo --add-label in-progress
```

Update parent issue body, set the matched `groups[].number` row's Status cell to `in-progress`.

## Rich Summary Format

After completing a Task Group, update the child issue body:

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
- Parent issue: #<parent_issue_number>
- Change: `openspec/changes/<name>/`
```

Update with:
```bash
gh issue edit <group_issue_number> --body "$RICH_SUMMARY_BODY"
```

## Completion Comment and Label Change

Verify the current label before changing it:
```bash
gh issue view <group_issue_number> --json labels --jq '.labels[].name'
```
Confirm `in-progress` is present. If not, STOP and report:
"⚠️ Expected label `in-progress` but found: \<actual labels\>. Aborting label change."

Then post the comment and move:
```bash
gh issue comment <group_issue_number> --body "Group N complete. Waiting for review."
gh issue edit <group_issue_number> --remove-label in-progress --add-label review
```

## Parent Issue Update

After syncing the group issue:

1. Read current parent issue body
2. Update the Task Groups table — set this group's Status to `review`
3. Update the `**Progress:**` line (count groups with Status `done`)
```bash
gh issue edit <parent_issue_number> --body "$UPDATED_PARENT_BODY"
```

If this was the last unfinished group, post a comment:
```bash
gh issue comment <parent_issue_number> --body "All groups complete. Ready for final review."
```

## Blocker Comments

If a blocker is hit mid-group:
```bash
gh issue comment <group_issue_number> --body "Group N paused: <reason>"
```
