---
name: corgispec-archive-change
description: Validate and archive a completed CorgiSpec change, extract durable knowledge, and optionally close GitLab tracking. Use when archiving a change whose normalized tracking provider is GitLab or none.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# Archive a change

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Archive through the CLI/upstream instruction and never construct an archive path.

## Resolve and validate

1. Resolve the change and isolated worktree with [references/worktree-discovery.md](references/worktree-discovery.md) when required.
2. Run `corgispec status "<change>" --json`, `corgispec apply "<change>" --json`, and `corgispec archive "<change>" --json` from the selected worktree.
3. Require matching `changeRoot` and the fields `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade when absent.
4. Accept `trackingProvider: "gitlab"` or `"none"`. Route `"github"` to `corgispec-gh-archive`; never infer provider from `schemaName`.
5. Use `taskArtifactId` and CLI task status to warn about incomplete work. Use returned `contextFiles` for QA/review evidence; never guess an evidence filename.
6. Treat an external store `changeRoot` as valid. Do not prepend the repository path.

## Archive

1. Before moving anything, read GitLab tracker state at `<changeRoot>/.gitlab.yaml` when enabled.
2. Present incomplete-task, readiness, validation, and artifact-drift warnings. Require explicit confirmation when the CLI marks any warning as overridable; stop on a blocker.
3. Execute only the archive action returned by `corgispec archive --json`. Let OpenSpec synchronize applicable deltas and choose the destination.
4. Capture the actual archived root from CLI/upstream output. Verify the full change payload moved and no conflicting destination was overwritten.

## Close out

- Extract durable session knowledge from returned planning artifacts, implementation evidence, and Git history without assuming an artifact name.
- When GitLab tracking is enabled, post the archive summary, verify labels, move completed child/parent issues to done, and close them according to policy. Skip all tracker operations for provider none.
- Remove the worktree only after archive and tracker closeout succeed; preserve its branch unless the user explicitly requests deletion.
- Report old `changeRoot`, actual archived root, validation/warnings, knowledge extraction, tracker result, and worktree cleanup.

Never construct planning/archive paths, route by schema, overwrite an archive, or archive with unresolved blockers.
