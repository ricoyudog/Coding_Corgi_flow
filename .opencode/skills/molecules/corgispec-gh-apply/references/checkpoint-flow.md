# Task Group checkpoint flow

Use `corgispec apply "<change>" --json` as the Task Group parser. Do not parse a guessed planning file.

## Select and execute

1. Accept `currentGroup` and task records from the apply response.
2. Use `taskArtifactId` plus `artifactPaths` to locate each task's concrete source path.
3. Move the tracked child issue to in-progress when tracking is enabled.
4. Implement each pending task in dependency order.
5. Verify the task, update its checkbox at the returned concrete path, and record modified files.
6. Stop on a blocker; never skip silently.
7. Re-run apply JSON after the group and require no pending task in that group.
8. Synchronize tracker closeout when enabled, report the checkpoint, and stop.

## Checkpoint report

Include the change, group, completed/total tasks, completed/total groups, child and parent issue state when tracked, authoritative `changeRoot`, worktree, completed task IDs, modified files, and verification evidence.

If implementation succeeds but reporting or tracker sync fails, retry only closeout. On resume, re-run apply JSON instead of trusting session memory.
