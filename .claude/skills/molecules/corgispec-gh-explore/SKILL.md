---
name: corgispec-gh-explore
description: Investigate a CorgiSpec change, its planning context, implementation state, and GitHub tracking without modifying anything. Use for read-only exploration when the normalized tracking provider is GitHub.
---

# Explore a GitHub-tracked change

1. Resolve the change and isolated worktree with [references/worktree-discovery.md](references/worktree-discovery.md) when required.
2. Run `corgispec status "<change>" --json` and use SessionStart/loop-check context for any current Run Contract; `apply` is a mutating command and must never be used as a status query.
3. Require matching `changeRoot` plus `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade when absent.
4. Require `trackingProvider: "github"`; never infer provider from `schemaName`.
5. Read planning material only from returned concrete paths. Accept an external store root and never reconstruct a path or artifact role.
6. Inspect relevant implementation, tests, Git history, and worktree state without editing them.
7. Read tracker state at `<changeRoot>/.github.yaml` and require `issue.number`/`issue.url`. If legacy `parent` or `groups` keys exist, report the unsupported format and manual single-issue conversion without querying or modifying legacy issues. Otherwise query that one live Issue for its label, managed Task Dashboard, and discussion.
8. Present findings, evidence paths, uncertainties, and possible next steps. Make no file, issue, label, branch, or worktree changes.
