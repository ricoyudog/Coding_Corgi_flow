---
name: corgispec-gh-archive
description: Validate and archive a completed CorgiSpec change, extract durable knowledge, and close GitHub tracking. Use when archiving a change whose normalized tracking provider is GitHub.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# Archive a GitHub-tracked change

## Resolve and validate

1. Resolve the change and isolated worktree with [references/worktree-discovery.md](references/worktree-discovery.md) when required.
2. Run `corgispec status "<change>" --json`, `corgispec apply "<change>" --json`, and `corgispec archive "<change>" --json`.
3. Require matching `changeRoot` plus `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade when absent.
4. Require `trackingProvider: "github"`; never infer provider from `schemaName`.
5. Use CLI task status and returned context for completeness and QA/review evidence. Accept store paths outside the working directory without reconstruction.

## Archive and synchronize

1. Read GitHub tracker state at `<changeRoot>/.github.yaml` before archival.
2. Present CLI blockers and overridable warnings. Never bypass a blocker.
3. Execute only the archive action returned by the CLI; let OpenSpec choose and report the archived root.
4. Verify the payload moved without overwriting a conflicting destination.
5. Extract durable knowledge from returned artifact paths, implementation evidence, and Git history.
6. Post the archive summary to GitHub, verify issue labels, mark completed children and the parent done, update progress, and close issues according to policy.
7. Remove the worktree only after all closeout steps succeed; keep the branch unless explicitly asked to delete it.

Report old `changeRoot`, actual archived root, warnings, knowledge extraction, issue transitions, and worktree cleanup. Never hardcode planning/archive paths, route by schema, overwrite an archive, or archive unresolved blockers.
