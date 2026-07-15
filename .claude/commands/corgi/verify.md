---
name: "Corgi: Verify"
description: Verify completed CorgiSpec Task Groups with reproducible evidence
category: Workflow
tags: [workflow, verify]
---

1. Resolve the change and isolated worktree, then run `corgispec status "<change>" --json`.
2. Require `changeRoot`, `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. If absent, stop and request a CLI upgrade.
3. Follow **corgispec-verify** and pass the normalized provider plus every authoritative path unchanged.
4. Never infer provider from `schemaName`, reconstruct planning paths, or select artifacts by filename.
5. Verify that the report contains commands, exit codes, requirement evidence, verdict, optional tracker posting, `changeRoot`, and worktree, with no state changes.
