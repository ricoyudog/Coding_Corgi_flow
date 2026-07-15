# GitLab issue synchronization

Run only when `status.trackingProvider` is `gitlab`. Resolve tracker state as `<changeRoot>/.gitlab.yaml`; skip synchronization when it is absent.

1. Match `apply.currentGroup.number` to `groups[].number`, then use the group's IID and the parent IID.
2. Before implementation, verify the child has `workflow::todo`, then move it to `workflow::in-progress`. Stop on an unexpected label.
3. On a blocker, post the group number, task ID, and reason without changing completion state.
4. After completion, build the child summary from apply-returned context, completed task IDs, actual modified files, evidence, parent IID, and authoritative `changeRoot`.
5. Verify `workflow::in-progress`, post the summary, then move the child to `workflow::review`.
6. Update the matching parent table row and progress count. Post an all-groups-ready note when applicable.

Use `glab issue view`, `glab issue update`, and `glab issue note`. Never replace remote state without first reading it, and never select a planning file by name.
