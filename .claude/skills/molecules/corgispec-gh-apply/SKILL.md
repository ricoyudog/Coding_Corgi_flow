---
name: corgispec-gh-apply
description: Implement exactly one pending Task Group from a CorgiSpec change and synchronize GitHub progress. Use when applying a change whose normalized tracking provider is GitHub.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
  Stop:
    - hooks:
        - type: command
          command: "corgispec hook stop-check"
---

# Apply one GitHub-tracked Task Group

Execute one group, checkpoint it, synchronize the change's single GitHub issue, and stop.

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
3. Read GitHub tracker state at `<changeRoot>/.github.yaml` and follow [references/issue-sync.md](references/issue-sync.md). Reject legacy `parent`/`groups` state before implementation, then verify and update the single issue's label and managed dashboard.
4. Implement only the selected group's pending tasks. Delegate independent work without allowing delegates to change planning artifacts.
5. Verify each task, then update its checkbox only in the CLI-returned concrete task-artifact path.
6. Record actual modified files and evidence. On a blocker, refresh the managed dashboard from the authoritative task artifact, stop, and comment on the same issue.

## Close out

- Re-run `corgispec apply "<change>" --json` and verify the group is complete.
- Refresh only the single issue's managed dashboard from the authoritative task artifact, set the completed group to review, post a `Group N` completion comment with objectives, completed tasks, modified files, and evidence, then move the issue from in-progress to review.
- Post an all-groups-ready comment on the same issue when applicable.
- Report the checkpoint, the single Issue URL, `changeRoot`, and worktree, then stop after one group.

Never hardcode planning paths or artifact names, edit non-task planning content, route by schema, commit, push, review, archive, or publish.
