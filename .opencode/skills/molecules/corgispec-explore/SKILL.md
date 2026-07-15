---
name: corgispec-explore
description: Investigate a CorgiSpec change, its planning context, implementation state, and optional GitLab tracking without modifying anything. Use for read-only exploration when the normalized tracking provider is GitLab or none.
---

# Explore a change

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

1. Resolve the change and isolated worktree with [references/worktree-discovery.md](references/worktree-discovery.md) when required.
2. Run `corgispec status "<change>" --json` and `corgispec apply "<change>" --json` from the selected worktree.
3. Require matching `changeRoot` plus `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade when absent.
4. Accept `trackingProvider: "gitlab"` or `"none"`. Route `"github"` to `corgispec-gh-explore`; never infer provider from `schemaName`.
5. Read planning material only from returned concrete artifact paths and context files. Accept an external store root; never prepend the working directory or infer an artifact filename.
6. Inspect relevant implementation, tests, Git history, and worktree state without editing them.
7. When GitLab tracking is enabled, read tracker state at `<changeRoot>/.gitlab.yaml`, then query live issues for current labels and discussion. Treat remote state as current and local tracker state as identifiers.
8. Present findings, evidence paths, uncertainties, and possible next steps. Make no file, issue, label, branch, or worktree changes.
