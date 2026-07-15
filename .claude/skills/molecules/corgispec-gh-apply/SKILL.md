---
name: corgispec-gh-apply
description: Implement exactly one pending Task Group from a CorgiSpec change and synchronize GitHub progress. Use when applying a change whose normalized tracking provider is GitHub.
---

# Apply one GitHub-tracked Task Group

Execute one group, checkpoint it, synchronize its GitHub child issue, and stop.

## Resolve context

1. Resolve the change and isolated worktree with [references/worktree-discovery.md](references/worktree-discovery.md) when required.
2. Run `corgispec status "<change>" --json`, `corgispec ready "<change>" --strict --json`, and `corgispec apply "<change>" --json` from that worktree.
3. Require matching `changeRoot` plus `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade when absent.
4. Require `trackingProvider: "github"`; never infer provider from `schemaName`.
5. Accept authoritative planning/store paths outside the current working directory. Never prepend or reconstruct them.
6. Stop on failed readiness, blocked apply, missing task-artifact identity, ambiguous concrete paths, or all groups complete.

## Execute

1. Use the apply response's `currentGroup`, task records, instruction, `contextFiles`, and concrete artifact paths.
2. Read [references/checkpoint-flow.md](references/checkpoint-flow.md) and [references/delegation-strategy.md](references/delegation-strategy.md).
3. Read GitHub tracker state at `<changeRoot>/.github.yaml`, match the group number, verify the child issue's current label, then move it from todo to in-progress.
4. Implement only the selected group's pending tasks. Delegate independent work without allowing delegates to change planning artifacts.
5. Verify each task, then update its checkbox only in the CLI-returned concrete task-artifact path.
6. Record actual modified files and evidence. On a blocker, stop and comment on the child issue.

## Close out

- Re-run `corgispec apply "<change>" --json` and verify the group is complete.
- Update the child issue with objectives derived from returned context, completed tasks, modified files, and evidence; move it from in-progress to review.
- Update parent progress and post a final-group note when applicable.
- Report the checkpoint, issue URLs, `changeRoot`, and worktree, then stop after one group.

Never hardcode planning paths or artifact names, edit non-task planning content, route by schema, commit, push, review, archive, or publish.
