---
description: Explore a CorgiSpec change and tracker context without modifying state
---

1. Resolve the change and isolated worktree, then run `corgispec status "<change>" --json`.
2. Require `changeRoot`, `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. If absent, stop and request a CLI upgrade.
3. Route only by normalized `trackingProvider`: `github` → **corgispec-gh-explore**; `gitlab` or `none` → **corgispec-explore**.
4. Pass all input and CLI context through unchanged. Never route by `schemaName` or infer a planning path.
5. Verify that exploration made no file, issue, label, branch, or worktree changes.
