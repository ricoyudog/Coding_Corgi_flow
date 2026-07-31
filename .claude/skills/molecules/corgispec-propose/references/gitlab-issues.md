# GitLab issue creation

Run this closeout only when `status.trackingProvider` is `gitlab`.

1. Resolve tracker state as `<changeRoot>/.gitlab.yaml`. When it exists, require exactly the single-issue contract below and reuse that issue. If it contains legacy `parent` or `groups` keys, stop before any tracker mutation and report: `Unsupported legacy tracker state. Keep the former parent as the single issue, rewrite .gitlab.yaml to the issue contract, and handle former child issues manually.` Never create a replacement or modify old child issues automatically.
2. Run `glab auth status`. Warn and skip tracker closeout when unavailable without blocking local planning.
3. Read the artifact identified by `taskArtifactId` for Task Groups and checkbox items. Read returned `contextFiles` and concrete `artifactPaths` for objectives, acceptance behavior, and design context; never select planning files by name.
4. Build one issue description containing objectives, acceptance behavior, design decisions, references, and exactly one managed dashboard delimited by `<!-- corgispec:task-dashboard:start -->` and `<!-- corgispec:task-dashboard:end -->`. The dashboard contains task/group progress, a Group/Name/Status table whose rows start at `pending`, and every Task Group's checkbox items. State that the task artifact is authoritative and edits inside the managed block are overwritten on synchronization.

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

5. When tracker state is absent, create exactly one issue labeled `workflow::backlog`, then write this tracker contract under `changeRoot`:

   ```yaml
   issue:
     iid: <issue-iid>
     url: <issue-url>
   ```

6. When tracker state exists, read the live issue before updating it. Require exactly one ordered dashboard marker pair; stop without replacing the description if either marker is missing, duplicated, or reversed. Replace only the managed block and preserve all content outside it.
7. Post a planning-complete note on the same issue. Never create Task Group issues.

Treat tracker state as operational metadata, not a planning artifact. Do not inject issue links into an arbitrary artifact.
