# GitHub issue synchronization

Run only when `status.trackingProvider` is `github`. Resolve tracker state as `<changeRoot>/.github.yaml`; skip synchronization when it is absent.

1. Match `apply.currentGroup.number` to `groups[].number`, then use the child issue number and parent number.
2. Before implementation, verify the child has `todo`, then move it to `in-progress`. Stop on an unexpected label.
3. On a blocker, comment with the group number, task ID, and reason without changing completion state.
4. After completion, build the child summary from apply-returned context, completed task IDs, actual modified files, evidence, parent number, and authoritative `changeRoot`.
5. Verify `in-progress`, post the summary, then move the child to `review`.
6. Update the matching parent table row and progress count. Post an all-groups-ready comment when applicable.

Use `gh issue view`, `gh issue edit`, and `gh issue comment`. Never replace remote state without first reading it, and never select a planning file by name.
