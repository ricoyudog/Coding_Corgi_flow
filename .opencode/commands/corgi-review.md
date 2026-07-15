---
description: Review one completed CorgiSpec Task Group with a human decision gate
---

1. Resolve the change and isolated worktree, then run `corgispec status "<change>" --json`.
2. Require `changeRoot`, `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. If absent, stop and request a CLI upgrade.
3. Route only by normalized `trackingProvider`: `github` → **corgispec-gh-review**; `gitlab` or `none` → **corgispec-review**.
4. Pass all input and CLI context through unchanged. Never route by `schemaName` or construct an artifact path.
5. Verify evidence preceded the human decision and that any repair tasks were written only to the CLI-authorized task artifact.
