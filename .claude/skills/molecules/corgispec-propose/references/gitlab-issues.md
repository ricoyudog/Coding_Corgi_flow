# GitLab issue creation

Run this closeout only when `status.trackingProvider` is `gitlab`.

1. Resolve tracker state as `<changeRoot>/.gitlab.yaml`. Reuse it when present; never create duplicate issues.
2. Run `glab auth status`. Warn and skip tracker closeout when unavailable without blocking local planning.
3. Read the artifact identified by `taskArtifactId` for Task Groups. Read returned `contextFiles` and concrete `artifactPaths` for objectives, acceptance behavior, and design context; never select planning files by name.
4. Create one parent issue labeled `workflow::backlog` containing objectives, acceptance behavior, Task Group table, progress, authoritative `changeRoot`, and worktree reference when applicable.
5. Create one child issue per Task Group labeled `workflow::todo`, with the group's objectives and checkbox items.
6. Update the parent with child IIDs and URLs.
7. Write this tracker contract under `changeRoot`:

   ```yaml
   parent:
     iid: <parent-iid>
     url: <parent-url>
   groups:
     - number: <group-number>
       name: <group-name>
       iid: <child-iid>
       url: <child-url>
   ```

8. Post a planning-complete note on the parent.

Treat tracker state as operational metadata, not a planning artifact. Do not inject issue links into an arbitrary artifact.
