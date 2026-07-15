---
name: "Corgi: Archive"
description: Validate and archive a CorgiSpec change using its authoritative store paths
category: Workflow
tags: [workflow, archive]
---

1. Resolve the change and isolated worktree, then run `corgispec status "<change>" --json`.
2. Require `changeRoot`, `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. If absent, stop and request a CLI upgrade.
3. Route only by normalized `trackingProvider`: `github` → **corgispec-gh-archive**; `gitlab` or `none` → **corgispec-archive-change**.
4. Pass all input and CLI context through unchanged. Never route by `schemaName` or construct a planning/archive path.
5. Verify CLI blockers, actual archived root, tracker closeout, knowledge extraction, and worktree cleanup before reporting completion.
