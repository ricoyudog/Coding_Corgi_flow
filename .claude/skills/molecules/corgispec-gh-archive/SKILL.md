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

## Canonical loop ownership gate

Before any archive action, task-artifact edit, or local/remote tracker write, inspect only the resolved change:

```bash
corgispec loop inspect "<change>" --json
```

- When the result has `status: "ok"` and a non-terminal `state.phase` (`action.type` is not `terminal`), an active canonical loop owns this change. Stop without archiving, editing planning/task artifacts, or invoking `gh`/`glab`.
- Report the returned `action.type` and require the user to explicitly continue the loop. In particular, `sync_tracker` must be performed through `corgispec loop sync-tracker ...`, and `finalize` through `corgispec loop finalize ...`; never run either action on the user's behalf.
- If the result is `not_found` or has `action.type: "terminal"`, continue this skill. For any other inspect error or ambiguous response, stop before mutation and report it. An active loop for a different change does not block this workflow.

When this inspection found a terminal canonical loop and tracking is enabled, archive is final-only: before the archive action or tracker closeout, verify the existing managed dashboard already shows all task checkboxes complete and every Group row `done`. Never rebuild, refresh, or backfill task checkboxes or Group progress. If that verification fails, stop without archiving or tracker mutation; if it succeeds, tracker closeout may only post the final summary and apply the final label/close policy.

## Archive and synchronize

1. Read GitHub tracker state at `<changeRoot>/.github.yaml` before archival. Require `issue.number`/`issue.url`; if legacy `parent` or `groups` keys exist, stop before archival or remote mutation with the manual single-issue conversion guidance. When the loop inspection was terminal, verify the existing managed dashboard already has every task checkbox complete and every Group row `done`; never correct it here.
2. Present CLI blockers and overridable warnings. Never bypass a blocker.
3. Execute only the archive action returned by the CLI; let OpenSpec choose and report the archived root.
4. Verify the payload moved without overwriting a conflicting destination.
5. Extract durable knowledge from returned artifact paths, implementation evidence, and Git history.
6. Read the live single Issue, require exactly one ordered dashboard marker pair, verify the existing dashboard already has every task checkbox complete and every Group row `done`, and preserve all content outside the markers. Never rebuild, refresh, or backfill task checkboxes or Group progress; post only `## Archive Summary`, move the Issue to `done`, and apply the existing close/open policy to that one Issue.
7. Remove the worktree only after all closeout steps succeed; keep the branch unless explicitly asked to delete it.

Report old `changeRoot`, actual archived root, warnings, knowledge extraction, the single Issue transition, and worktree cleanup. Never hardcode planning/archive paths, route by schema, overwrite an archive, or archive unresolved blockers.
