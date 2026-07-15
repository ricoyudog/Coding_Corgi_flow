# Artifact creation procedure

## Resolve the graph

Run `corgispec status "<change>" --json`. Preserve `changeRoot`, `artifactPaths`, `contextFiles`, and `taskArtifactId` for the entire operation.

Use the CLI-reported artifact status, dependencies, and implementation prerequisites as the graph. Do not assign roles from filenames or assume a fixed number of artifacts.

## Create one artifact

1. Select a CLI-reported ready artifact.
2. Run `corgispec instructions "<artifact-id>" --change "<change>" --json`.
3. Verify that its `changeRoot` matches status and that every returned concrete output remains inside that root. An external store root is valid.
4. Read only returned dependency paths and `contextFiles`.
5. Apply `context` and `rules` as constraints. Follow `template` and `instruction` without copying constraint blocks into the output.
6. Write only the concrete target authorized by the response. Never construct a target from an artifact ID or write a path pattern as a filename.
7. Re-run status and verify that the artifact is complete.

Continue until every CLI-reported implementation prerequisite is complete. Stop on an ambiguous target, root mismatch, unreadable context file, or blocked graph.
