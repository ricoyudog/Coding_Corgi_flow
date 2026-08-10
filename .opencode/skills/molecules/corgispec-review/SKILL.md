---
name: corgispec-review
description: Review one completed CorgiSpec Task Group, gather quality evidence, and optionally synchronize a GitLab approval decision. Use when reviewing a change whose normalized tracking provider is GitLab or none.
---

# Review one Task Group

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Gather evidence first, then ask the human to approve or reject. Do not infer any planning path.

## Resolve context

1. Resolve the change and isolated worktree with [references/worktree-discovery.md](references/worktree-discovery.md) when required.
2. Run `corgispec status "<change>" --json` and the internal read-only query `corgispec apply "<change>" --json` from the selected worktree.
3. Require matching `changeRoot` plus `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade when absent.
4. Accept `trackingProvider: "gitlab"` or `"none"`. Route `"github"` to `corgispec-gh-review`; never infer provider from `schemaName`.
5. Treat returned paths as authoritative even outside the current working directory.

## Canonical loop ownership gate

Before any task-artifact edit or local/remote tracker write, inspect only the resolved change:

```bash
corgispec loop inspect "<change>" --json
```

- When the result has `status: "ok"` and a non-terminal `state.phase` (`action.type` is not `terminal`), an active canonical loop owns this change. Stop without editing planning/task artifacts or invoking `gh`/`glab`.
- Report the returned `action.type` and require the user to explicitly continue the apply workflow. In particular, `sync_tracker` must be performed through `corgispec loop sync-tracker ...`, and `finalize` through `corgispec loop finalize ...`; never run either action on the user's behalf.
- If the result is `not_found` or has `action.type: "terminal"`, continue this skill. For any other inspect error or ambiguous response, stop before mutation and report it. An active loop for a different change does not block this workflow.

## Select and inspect

1. When tracked, read `<changeRoot>/.gitlab.yaml`. Require `issue.iid`/`issue.url`; if legacy `parent` or `groups` keys exist, stop before any local or remote mutation with the documented manual-conversion guidance. Query the single live Issue and select the requested group or first dashboard row in `review` while the Issue has label `workflow::review`. When untracked, select a completed group from status or ask when ambiguous.
2. Use `taskArtifactId` and its concrete `artifactPaths` to verify every selected-group task is complete. Do not parse a guessed file.
3. Read implementation files from the same Issue's `Apply Checkpoint: Group N` note or actual diff. Read planning evidence only from `contextFiles` and concrete `artifactPaths`.
4. Read and execute [references/quality-checks.md](references/quality-checks.md), plus the security and performance checklists when applicable.
5. Post `## Review Report: Group N` to the same Issue when tracked; otherwise present it locally.

## Human decision

Read [references/review-decisions.md](references/review-decisions.md).

- On approval, verify the single Issue state, set the current dashboard row to `done`, rebuild progress from the authoritative task artifact, and move `workflow::review` to `workflow::todo` only when groups remain. After the final group, retain `workflow::review` for Human QA and archive. For untracked changes, record no remote state.
- On rejection, read [references/repair-flow.md](references/repair-flow.md). Append confirmed fix tasks only to the concrete task-artifact path returned by the CLI, rebuild the managed dashboard, then reset the same Issue and current row to in-progress when configured.
- Never implement fixes during review.

## Guardrails

- Keep deterministic CLI fields separate from reviewer judgment.
- Never hardcode artifact roles, planning locations, or task filenames.
- Never edit planning content except confirmed repair tasks in the authorized task artifact.
- Never commit, push, archive, or publish.
- Before editing the Issue description, require exactly one ordered dashboard marker pair and preserve everything outside it.

Report the group, evidence, human decision, task-artifact edits, tracker result, `changeRoot`, and worktree.
