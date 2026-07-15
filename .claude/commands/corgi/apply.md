---
name: "Corgi: Apply"
description: Implement one CorgiSpec Task Group using authoritative CLI paths
category: Workflow
tags: [workflow, apply]
---

**Input**: Accept an optional change name; resolve exactly one when omitted.

1. **Context Gate**: If session context already contains `isolation.mode`, active changes with worktree paths, and the current branch, reuse it. Otherwise read isolation configuration and resolve the existing worktree.
2. Run `corgispec status "<change>" --json` from the selected worktree.
3. Require `changeRoot`, `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. If absent, stop and request a CLI upgrade.
4. Route only by normalized `trackingProvider`: `github` → **corgispec-gh-apply**; `gitlab` or `none` → **corgispec-apply-change**.
5. Pass the status JSON and input through unchanged. Never route by `schemaName` or infer a planning path.
6. Verify exactly one group was processed, task state changed only at CLI-returned paths, tracker sync matched the provider, and isolated output stayed in its worktree.
