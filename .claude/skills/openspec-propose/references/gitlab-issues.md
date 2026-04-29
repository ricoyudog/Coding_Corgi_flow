# GitLab Issue Creation Procedure

## Prerequisites

Check glab availability:
```bash
glab auth status 2>&1
```

If the change already has `.gitlab.yaml`, skip all issue creation.

## Parent Issue

Read `proposal.md` and `tasks.md`. Build the parent issue body with:

- `**Objectives**` — from proposal's Why section
- `**Background**` — from proposal's What Changes section
- `**Acceptance Criteria**` — for each spec file in `specs/**/*.md`, extract each `### Requirement:` name and its first `#### Scenario:` as a one-line bullet. Format: `- **Requirement name**: WHEN condition -> THEN outcome`
- `**Key Design Decisions**` — from `design.md`, extract each `### N. Decision Title` heading and its `**Decision:**` line. If no `design.md`, omit this section.
- `**Task Groups**` table:
  ```
  | Group | Name | Issue | Status |
  |-------|------|-------|--------|
  | 1 | Setup | #<child_iid> | backlog |
  ```
  All groups start with Status `backlog`.
- `**Progress:**` 0/N groups completed
- `**Conclusion**`
- `**References**` including the change path

Create the parent issue:
```bash
glab issue create --title "feat(<scope>): <change-name>" --description "$PARENT_BODY" --label "workflow::backlog"
```

## Child Issues

For each `## N. Group Name` heading in `tasks.md`, build a child issue body:

- `**Objectives**`
- `**Todo**` — the group's checkbox items
- `**Estimated Completion Date:** Set when the issue is created`
- `**Conclusion**`
- `**References**` — parent issue link and change path

```bash
glab issue create --title "Group N: <group-name> [<change-name>]" --description "$CHILD_BODY" --label "workflow::todo"
```

## Post-Creation

1. Update parent issue to include each group issue IID in the Task Groups table:
   ```bash
   glab issue update <parent_issue_iid> --description "$UPDATED_PARENT_BODY"
   ```

2. Save `.gitlab.yaml` in the change directory with the canonical nested tracking contract:
   ```yaml
   parent:
     iid: <parent_issue_iid>
     url: <parent_issue_url>
   groups:
     - number: 1
       name: "Setup"
       iid: <group_1_issue_iid>
       url: <group_1_issue_url>
   ```

   Later phases should read `parent.iid` for the parent issue and match `groups[].number` to the Task Group number to find each group's `iid` and `url`.

3. Post initial note:
   ```bash
   glab issue note <parent_issue_iid> --message "Planning complete. Run /opsx-apply to begin implementation."
   ```

4. Update `proposal.md` with the parent issue link in the `## GitLab Issue` section.

5. If worktree isolation is active, add worktree info to parent issue References:
   ```markdown
   - Worktree: `.worktrees/<name>` (branch: `feat/<name>`)
   ```

## If glab Unavailable

Print a warning. Do not block artifact creation.
