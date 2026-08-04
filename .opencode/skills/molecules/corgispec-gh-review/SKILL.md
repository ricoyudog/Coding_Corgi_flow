---
name: corgispec-gh-review
description: Review one completed CorgiSpec Task Group, gather quality evidence, and synchronize a GitHub approval decision. Use when reviewing a change whose normalized tracking provider is GitHub.
---

# Review one GitHub-tracked Task Group

Gather reproducible evidence and keep the final approve/reject decision human-controlled.

## Resolve context

1. Resolve the change and isolated worktree with [references/worktree-discovery.md](references/worktree-discovery.md) when required.
2. Run `corgispec status "<change>" --json` and `corgispec apply "<change>" --json` from the selected worktree.
3. Require matching `changeRoot` plus `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade when absent.
4. Require `trackingProvider: "github"`; never infer provider from `schemaName`.
5. Accept authoritative planning/store paths outside the current working directory without rewriting them.

## Canonical loop ownership gate

Before any task-artifact edit or local/remote tracker write, inspect only the resolved change:

```bash
corgispec loop inspect "<change>" --json
```

- When the result has `status: "ok"` and a non-terminal `state.phase` (`action.type` is not `terminal`), an active canonical loop owns this change. Stop without editing planning/task artifacts or invoking `gh`/`glab`.
- Report the returned `action.type` and require the user to explicitly continue the loop. In particular, `sync_tracker` must be performed through `corgispec loop sync-tracker ...`, and `finalize` through `corgispec loop finalize ...`; never run either action on the user's behalf.
- If the result is `not_found` or has `action.type: "terminal"`, continue this skill. For any other inspect error or ambiguous response, stop before mutation and report it. An active loop for a different change does not block this workflow.

## Gather evidence

1. Read tracker state at `<changeRoot>/.github.yaml`. Require `issue.number`/`issue.url`; if legacy `parent` or `groups` keys exist, stop before any local or remote mutation with the documented manual-conversion guidance. Query the single live Issue and select the requested group or the first dashboard row in `review` while the Issue has label `review`.
2. Confirm group completion through `taskArtifactId` and its CLI-returned concrete paths.
3. Read implementation files from the same Issue's `Apply Checkpoint: Group N` comment or actual diff. Read planning evidence only from `contextFiles` and `artifactPaths`.
4. Check code quality, behavior against every applicable planning requirement, tests, architecture, security, and performance. Use the security and performance checklists. Cite commands, outputs, concrete paths, and requirement text.
5. Post `## Review Report: Group N` to the same Issue without changing its state.

## Apply the human decision

- Approve: verify the Issue label and managed dashboard markers, set the current row to `done`, and rebuild task/group progress from the authoritative task artifact. If groups remain, move the Issue from `review` to `todo`; after the final group, keep it in `review` for Human QA and archive. Post `## Review Decision: Group N` on the same Issue.
- Reject: collect feedback, confirm a precise fix plan, append tasks only to the CLI-authorized task-artifact path, rebuild the managed dashboard with the new unchecked tasks, post `## Review Decision: Group N`, and move the same Issue from `review` to `in-progress` with the row set to `in-progress`.
- Never implement the repair during review.

Before editing the Issue body, require exactly one ordered dashboard marker pair and preserve everything outside it. Never hardcode planning paths or artifact names, route by schema, edit unrelated planning content, commit, push, archive, or publish. Report evidence, decision, tracker transitions, `changeRoot`, and worktree.
