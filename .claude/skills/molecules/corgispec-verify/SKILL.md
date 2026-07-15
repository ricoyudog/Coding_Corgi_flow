---
name: corgispec-verify
description: Verify completed CorgiSpec Task Groups against tests, builds, linting, and returned planning requirements, with optional GitHub or GitLab evidence posting. Use after apply and before human review.
---

# Verify completed Task Groups

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Gather reproducible evidence without changing implementation, planning, or tracker state.

## Resolve context

1. Resolve the change and isolated worktree with [references/worktree-discovery.md](references/worktree-discovery.md) when required.
2. Run `corgispec status "<change>" --json` and `corgispec apply "<change>" --json` from the selected worktree.
3. Require matching `changeRoot` plus `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade when absent.
4. Accept only normalized provider values `github`, `gitlab`, or `none`; never infer provider from `schemaName`.
5. Treat returned planning/store paths as authoritative even outside the working directory. Never construct an artifact path.

## Verify

1. Select the requested completed group or all CLI-reported completed groups. Confirm completion through `taskArtifactId` and its concrete paths.
2. Read implementation files from apply checkpoints, tracker summaries, or the actual diff. Read normative planning evidence only from returned `contextFiles` and `artifactPaths`.
3. Follow [references/verification-steps.md](references/verification-steps.md): detect and run relevant tests, lint, type checks, builds, and requirement-by-requirement coverage checks.
4. Capture exact commands, working directories, exit codes, salient output, requirement evidence, and concrete file references. Never fabricate or reinterpret a failed command as passing.
5. Produce PASS, PASS WITH WARNINGS, or FAIL using the documented verdict rules.

## Report

- For `gitlab`, read `<changeRoot>/.gitlab.yaml` and post evidence with `glab`.
- For `github`, read `<changeRoot>/.github.yaml` and post evidence with `gh`.
- For `none` or missing tracker state, report locally only.
- Never change labels, close issues, add tasks, or implement fixes.

Report each group, commands/evidence, requirement coverage, verdict, tracker posting, `changeRoot`, and worktree.
