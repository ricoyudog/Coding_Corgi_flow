# Delegation strategy

Delegate when a group has several independent tasks or mechanical tracker closeout. Keep tightly coupled tasks local and sequential.

## Delegate safely

Give each delegate:

- one task ID and exact expected outcome;
- the selected worktree and implementation scope;
- relevant `contextFiles` and concrete planning paths returned by apply JSON;
- required tests and existing project conventions;
- an explicit prohibition on planning-file, tracker, and unrelated refactors.

Run independent tasks in parallel only when they do not share files or mutable state. Verify every result in the selected worktree. The main agent alone updates checkboxes at CLI-returned task-artifact paths after verification.

For tracker closeout, pass the tracker-state path under `changeRoot`, issue identifiers, completed task IDs, actual modified files, and evidence. Require label precondition checks before every transition.
