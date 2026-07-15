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

## Gather evidence

1. Read tracker state at `<changeRoot>/.github.yaml`, query live labels, and select the requested group or first group in review state.
2. Confirm group completion through `taskArtifactId` and its CLI-returned concrete paths.
3. Read implementation files from the apply checkpoint, tracker summary, or actual diff. Read planning evidence only from `contextFiles` and `artifactPaths`.
4. Check code quality, behavior against every applicable planning requirement, tests, architecture, security, and performance. Use the security and performance checklists. Cite commands, outputs, concrete paths, and requirement text.
5. Post the review report to the child issue without changing its state.

## Apply the human decision

- Approve: verify the review label, move the child to done, update the parent table/checklist/progress, and close the child when policy allows.
- Reject: collect feedback, confirm a precise fix plan, append tasks only to the CLI-authorized task-artifact path, comment on the child, and move it back to in-progress.
- Never implement the repair during review.

Never hardcode planning paths or artifact names, route by schema, edit unrelated planning content, commit, push, archive, or publish. Report evidence, decision, tracker transitions, `changeRoot`, and worktree.
