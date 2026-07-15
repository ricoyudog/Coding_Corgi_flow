---
name: corgispec-review
description: Review one completed CorgiSpec Task Group, gather quality evidence, and optionally synchronize a GitLab approval decision. Use when reviewing a change whose normalized tracking provider is GitLab or none.
---

# Review one Task Group

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Gather evidence first, then ask the human to approve or reject. Do not infer any planning path.

## Resolve context

1. Resolve the change and isolated worktree with [references/worktree-discovery.md](references/worktree-discovery.md) when required.
2. Run `corgispec status "<change>" --json` and `corgispec apply "<change>" --json` from the selected worktree.
3. Require matching `changeRoot` plus `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade when absent.
4. Accept `trackingProvider: "gitlab"` or `"none"`. Route `"github"` to `corgispec-gh-review`; never infer provider from `schemaName`.
5. Treat returned paths as authoritative even outside the current working directory.

## Select and inspect

1. When tracked, read `<changeRoot>/.gitlab.yaml`, query live child labels, and select the requested group or first group in review state. When untracked, select a completed group from status or ask when ambiguous.
2. Use `taskArtifactId` and its concrete `artifactPaths` to verify every selected-group task is complete. Do not parse a guessed file.
3. Read implementation files from the apply checkpoint/tracker summary or actual diff. Read planning evidence only from `contextFiles` and concrete `artifactPaths`.
4. Read and execute [references/quality-checks.md](references/quality-checks.md), plus the security and performance checklists when applicable.
5. Post the evidence report to the child issue when tracked; otherwise present it locally.

## Human decision

Read [references/review-decisions.md](references/review-decisions.md).

- On approval, verify the current child state, move it to done, update parent progress, and report remaining groups. For untracked changes, record no remote state.
- On rejection, read [references/repair-flow.md](references/repair-flow.md). Append confirmed fix tasks only to the concrete task-artifact path returned by the CLI, then reset the tracked child to in-progress when configured.
- Never implement fixes during review.

## Guardrails

- Keep deterministic CLI fields separate from reviewer judgment.
- Never hardcode artifact roles, planning locations, or task filenames.
- Never edit planning content except confirmed repair tasks in the authorized task artifact.
- Never commit, push, archive, or publish.

Report the group, evidence, human decision, task-artifact edits, tracker result, `changeRoot`, and worktree.
