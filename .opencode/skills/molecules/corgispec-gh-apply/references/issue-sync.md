# GitHub single-issue synchronization

Run only when `status.trackingProvider` is `github`. Resolve tracker state as `<changeRoot>/.github.yaml`; skip synchronization when it is absent.

## Validate tracker state

Require exactly this contract:

```yaml
issue:
  number: 42
  url: https://github.com/org/repo/issues/42
```

If the file contains legacy `parent` or `groups` keys, stop before implementation or any remote mutation and report: `Unsupported legacy tracker state. Keep the former parent as the single issue, rewrite .github.yaml to the issue contract, and handle former child issues manually.` Do not migrate, replace, close, or comment on legacy issues automatically.

Read `issue.number`, then fetch the live issue label and body. Require exactly one ordered `<!-- corgispec:task-dashboard:start -->` / `<!-- corgispec:task-dashboard:end -->` marker pair. Stop without replacing the body if the markers are absent, duplicated, or reversed. Every body update must replace only that managed block and preserve all surrounding content.

## Synchronize the dashboard

Rebuild task checkboxes and task progress from `apply.currentGroup`, `taskArtifactId`, and the CLI-returned concrete task-artifact path. The task artifact always wins over edits made inside the Issue dashboard. Preserve existing statuses for other groups and update only the current group's lifecycle status.

Before a new group starts, require `backlog` for the first group or `todo` after an approved group, move the Issue to `in-progress`, and set the current dashboard row to `in-progress`. A resumed group may already be `in-progress` only when its dashboard row agrees. Stop on every other label/status combination.

On a blocker, refresh task checkboxes and progress, keep the group and Issue `in-progress`, and post `## Apply Blocked: Group N` with the task ID and reason.

After the group completes:

1. Re-run apply JSON and require no pending task in the group.
2. Refresh task checkboxes and progress, then set the group row to `review`.
3. Verify the Issue has `in-progress`, post `## Apply Checkpoint: Group N` with objectives derived from returned context, completed task IDs, actual modified files, evidence, and authoritative `changeRoot`.
4. Move the Issue from `in-progress` to `review`.
5. If all Task Groups have completed checkboxes, post an all-groups-ready comment on this same Issue. Do not mark groups approved; review owns that decision.

Use `gh issue view`, `gh issue edit`, and `gh issue comment`. Never create another Issue, replace remote state without first reading it, or select a planning file by name. If implementation succeeds but synchronization fails, retry only this closeout.
