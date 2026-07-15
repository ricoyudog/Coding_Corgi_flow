---
name: corgispec-apply-change
description: Implement exactly one pending Task Group from a CorgiSpec change and optionally synchronize GitLab progress. Use when applying a change whose normalized tracking provider is GitLab or none.
---

# Apply one Task Group

Execute one group, checkpoint it, and stop. Use CLI-returned paths for every planning read or write.

## Resolve context

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

1. Resolve the change and worktree. When isolation is enabled, read [references/worktree-discovery.md](references/worktree-discovery.md) and run all subsequent commands from the selected worktree.
2. Run:

   ```bash
   corgispec status "<change>" --json
   corgispec ready "<change>" --strict --json
   corgispec apply "<change>" --json
   ```

3. Require the status and apply responses to agree on `changeRoot`, and require `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade if any field is absent.
4. Accept `trackingProvider: "gitlab"` or `"none"`. Route `"github"` to `corgispec-gh-apply`; never infer provider from `schemaName`.
5. Treat `changeRoot` and returned paths as authoritative even outside the current working directory. Do not reconstruct a planning path.
6. Stop on failed readiness, blocked apply state, missing `taskArtifactId`, ambiguous task-artifact paths, or all groups complete.

## Execute

1. Use the apply response's `currentGroup`, task records, instruction, and `contextFiles`. Read planning context only from returned concrete paths.
2. Read [references/checkpoint-flow.md](references/checkpoint-flow.md) and [references/delegation-strategy.md](references/delegation-strategy.md).
3. If GitLab tracking is enabled, read tracker state at `<changeRoot>/.gitlab.yaml` and follow [references/issue-sync.md](references/issue-sync.md). Verify the child issue is in the expected state before changing labels.
4. Announce the selected group. Implement only its pending tasks in dependency order; delegate independent tasks when useful.
5. Test each task proportionally. Mark its checkbox complete only in the concrete task-artifact path returned for that task and only after its verification passes.
6. Record actual modified implementation files and evidence. Stop immediately on a blocker; post a tracker note when configured.

## Close out

- Re-run `corgispec apply "<change>" --json` and verify the completed group has no pending tasks.
- When GitLab tracking is enabled, update the child summary, move it from in-progress to review, and update parent progress. When provider is none, perform no tracker operation.
- Report group/task progress, modified files, evidence, tracker status, `changeRoot`, and worktree.
- Stop after one group. Do not continue automatically.

## Guardrails

- Never hardcode the planning home, artifact layout, or task filename.
- Never edit a planning artifact other than CLI-authorized task checkboxes.
- Never work in the main checkout when an isolated worktree is required.
- Never commit, push, review, archive, or publish during apply.
