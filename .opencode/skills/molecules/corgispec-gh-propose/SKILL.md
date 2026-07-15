---
name: corgispec-gh-propose
description: Create or complete a CorgiSpec planning package and synchronize one GitHub parent issue plus Task Group child issues. Use when proposing a change whose normalized tracking provider is GitHub.
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

1. Iterate over CLI-reported ready artifacts until every implementation prerequisite is complete.
2. For each artifact, run `corgispec instructions "<artifact-id>" --change "<change>" --json`.
3. Read only its returned `contextFiles`, dependency paths, and `artifactPaths`.
4. Follow `template`, `instruction`, `context`, and `rules`, but never copy constraint blocks into the artifact.
5. Write only the concrete output authorized by the instructions response; never invent a conventional filename or expand a path pattern.
6. Re-run `corgispec status "<change>" --json` after every write.

## Synchronize GitHub

1. Resolve tracker state as `<changeRoot>/.github.yaml`. If it already exists, reuse it and do not create duplicate issues.
2. If `gh auth status` fails, warn and finish the local planning package without blocking readiness.
3. Use the artifact at `taskArtifactId` to enumerate Task Groups. Use all returned planning `contextFiles` and concrete `artifactPaths` to summarize objectives, acceptance behavior, and design decisions; do not select files by name.
4. Create one parent issue labeled `backlog`, then one child issue per Task Group labeled `todo`.
5. Store the parent number/URL and each group number/name/issue number/URL in `.github.yaml` under `changeRoot`.
6. Update the parent body with the Task Group table, child issue checklist, progress, authoritative `changeRoot`, and worktree reference when applicable.
7. Post a planning-complete comment. Keep issue creation as closeout; never treat it as an artifact prerequisite.

## Finish

- Write `.worktree.yaml` under `changeRoot` when isolation is active and verify it with `git worktree list`.
- Run `corgispec ready "<change>" --strict --json` and require ready.
- Report created artifact IDs and paths, GitHub issue URLs or the skip reason, `changeRoot`, and worktree.

Do not implement code, infer artifact roles from names, write outside `changeRoot`, or route by schema.
