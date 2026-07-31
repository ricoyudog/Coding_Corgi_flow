---
name: corgispec-gh-propose
description: Create or complete a CorgiSpec planning package and synchronize one GitHub issue with an embedded Task Group dashboard. Use when proposing a change whose normalized tracking provider is GitHub.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# Propose a GitHub-tracked change

Build the OpenSpec artifact graph first, then layer GitHub tracking on the completed planning package.

## Resolve authoritative context

1. Resolve the change name and intent. Create or reuse the configured worktree before any change work when isolation is enabled.
2. Run from the selected worktree or project root:

   ```bash
   corgispec propose "<change>" --json
   corgispec status "<change>" --json
   ```

3. Require `changeRoot`, `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. Stop and request a CLI upgrade when any field is absent.
4. Require `trackingProvider: "github"`. Never infer tracking from `schemaName`.
5. Accept `changeRoot` and every returned concrete path even when they are outside the current working directory. Do not reconstruct them.

## Create planning artifacts

Before writing the first artifact, create and maintain a visible planning checklist with the host's available planning or TODO mechanism when one is available and permitted. Do not hard-code a platform-specific tool name.

1. Iterate over CLI-reported ready artifacts until every implementation prerequisite is complete.
2. For each artifact, run `corgispec instructions "<artifact-id>" --change "<change>" --json`.
3. Read only its returned `contextFiles`, dependency paths, and `artifactPaths`.
4. Follow `template`, `instruction`, `context`, and `rules`, but never copy constraint blocks into the artifact.
5. Write only the concrete output authorized by the instructions response; never invent a conventional filename or expand a path pattern.
6. Re-run `corgispec status "<change>" --json` after every write.

## Synchronize GitHub

1. Resolve tracker state as `<changeRoot>/.github.yaml`. When it exists, require exactly the single-issue contract below and reuse that issue. If it contains legacy `parent` or `groups` keys, stop before any tracker mutation and report: `Unsupported legacy tracker state. Keep the former parent as the single issue, rewrite .github.yaml to the issue contract, and handle former child issues manually.` Never create a replacement or modify old child issues automatically.
2. If `gh auth status` fails, warn and finish the local planning package without blocking readiness.
3. Use the artifact at `taskArtifactId` to enumerate Task Groups and checkbox items. Use all returned planning `contextFiles` and concrete `artifactPaths` to summarize objectives, acceptance behavior, and design decisions; do not select files by name.
4. Build one issue body containing objectives, acceptance behavior, design decisions, references, and exactly one managed dashboard delimited by `<!-- corgispec:task-dashboard:start -->` and `<!-- corgispec:task-dashboard:end -->`. The dashboard contains task/group progress, a Group/Name/Status table whose rows start at `pending`, and every Task Group's checkbox items. State that the task artifact is authoritative and edits inside the managed block are overwritten on synchronization.

   ```markdown
   <!-- corgispec:task-dashboard:start -->
   ## Task Dashboard
   > Managed by CorgiSpec from the authoritative task artifact. Edits inside this block are overwritten.

   **Progress:** 0/<total tasks> tasks complete · 0/<total groups> groups approved

   | Group | Name | Status |
   |---|---|---|
   | 1 | <group name> | pending |

   ### Group 1: <group name>
   - [ ] 1.1 <task>
   <!-- corgispec:task-dashboard:end -->
   ```

5. When tracker state is absent, create exactly one issue labeled `backlog`, then write:

   ```yaml
   issue:
     number: <issue-number>
     url: <issue-url>
   ```

6. When tracker state exists, read the live issue before updating it. Require exactly one ordered dashboard marker pair; stop without replacing the body if either marker is missing, duplicated, or reversed. Replace only the managed block and preserve all content outside it.
7. Post a planning-complete comment on the same issue. Keep issue creation as closeout; never treat it as an artifact prerequisite, and never create Task Group issues.

## Finish

- Write `.worktree.yaml` under `changeRoot` when isolation is active and verify it with `git worktree list`.
- Run `corgispec ready "<change>" --strict --json` and require ready.
- Report created artifact IDs and paths, the single GitHub Issue URL or the skip reason, `changeRoot`, worktree, and the matching platform command the user may invoke later for apply or loop. For Codex, explicitly report `$corgispec-gh-apply <change>` or `$corgispec-loop <change>`.

## Terminal handoff boundary

- Do not infer artifact roles from names, write outside `changeRoot`, or route by schema.
- Throughout propose, keep `HEAD` unchanged. Do not install packages, create commits, push branches, open implementation pull requests, or publish at any point. Worktree setup must not commit housekeeping changes.
- Propose is a planning-only workflow and is terminal for the current turn.
- A strict `ready` result confirms planning integrity; it is not user approval to implement.
- An original request phrased as "fix", "implement", or "build" supplies planning intent only and does not authorize implementation after propose.
- After reporting, end the current turn. Do not invoke apply, loop, implementation, review, archive, commit, push, or publish actions.
- Implementation may begin only after a later explicit user request for the matching apply or loop workflow.
