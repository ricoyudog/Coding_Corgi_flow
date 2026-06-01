# Artifact Creation Procedure

## Build Order

Get the artifact pipeline status:
```bash
openspec status --change "<name>" --json
```

Parse the JSON:
- `applyRequires`: artifact IDs needed before implementation (e.g., `["tasks"]`)
- `artifacts`: list with `id`, `status`, `missingDeps`

## Creating Each Artifact

For each artifact in dependency order (no pending dependencies first):

1. Get instructions:
   ```bash
   openspec instructions <artifact-id> --change "<name>" --json
   ```

2. The JSON includes:
   - `context`: Project background — constraints for YOU, do NOT include in output
   - `rules`: Artifact-specific rules — constraints for YOU, do NOT include in output
   - `template`: Structure to follow for the output file
   - `instruction`: Schema-specific guidance
   - `outputPath`: Where to write the artifact
   - `dependencies`: Completed artifacts to read first

3. Read dependency artifacts for context before creating the new one.

4. Write the artifact using `template` as structure, following `instruction` guidance.

5. After writing, re-check status:
   ```bash
   openspec status --change "<name>" --json
   ```

6. Continue until all `applyRequires` artifacts have `status: "done"`.

## Guidelines

- Follow the `instruction` field from `openspec instructions` for each artifact type
- Use `template` as the structure — fill in its sections
- `context` and `rules` guide what you write but NEVER appear in the output
- If context is unclear, ask the user — but prefer reasonable decisions to keep momentum
- Verify each artifact file exists after writing before moving to the next
