---
name: corgispec-update
description: Reconcile an existing CorgiSpec planning package after intent, requirements, scenarios, design, or task sequencing changes. Use when the user asks to update or realign an existing change while preserving implementation boundaries, stable Task Group IDs, OpenSpec 1.6 artifact paths, and strict readiness.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# Reconcile existing planning

Update planning artifacts only. Coordinate the user's revised intent across the existing artifact graph without implementing code or changing operational records.

## Workflow

1. Resolve exactly one change name, optional `--store <id>`, and the requested planning change. Do not proceed while the target or requested intent is ambiguous.
2. Make store selection sticky. When input or status identifies a store, append the same `--store "<id>"` to every subsequent `corgispec status`, `corgispec update`, `corgispec ready`, and `openspec validate` call. If a store-backed root is reported without a stable ID, stop; never fall back to local planning.
3. Request the authoritative update context:

   ```bash
   corgispec update "<change>" --json [--store "<id>"]
   ```

4. Interpret the contract before reading or editing files:
   - Ignore unknown fields.
   - On exit 2, stop and report the environment or OpenSpec contract error.
   - On exit 1 or `status: "blocked"`, report every blocker and make no edits.
   - On blocker code `PENDING_CONVERGENCE`, make no edits. It is legacy Run Contract v2 state and v4 has no Converge command; finish or withdraw it with CorgiSpec v3.0.1 before migration.
   - On an active Run Contract v3, make no planning edits. Implementation repair must use `corgispec change repair`; a Goal, Boundary, Slice, AC, or public-contract change must use a human-authored accepted Amendment RFC and the dedicated adoption command.
   - If legacy active-run data is detected, stop and require the transactional v4 migration precondition; never mutate legacy state from Update.
5. Establish the write allowlist:
   - Allow only artifact IDs in `existingArtifactIds`.
   - Allow existing concrete files only from `artifactPaths.<id>.existingOutputPaths`.
   - Keep every candidate path within the authoritative `changeRoot`; reject symlinks or traversal outside it.
   - Never create an artifact ID listed in `missingArtifactIds`.
   - Never write the literal `outputPath` or `resolvedOutputPath` pattern.
6. Read the existing artifacts and [references/reconciliation-rules.md](references/reconciliation-rules.md). Build a consistency map from intent to requirements, scenarios, design decisions, and task IDs before proposing edits.
7. Prepare changes in the dependency order indicated by `actionContext`. For each artifact ID, show one artifact-scoped diff that includes every affected concrete file, including proposed glob-file additions or removals.
8. Ask for explicit approval for that artifact only. Apply only the approved artifact diff; do not treat approval for one artifact as approval for another.
9. For a glob artifact:
   - Reconcile each path in `existingOutputPaths` independently.
   - Add or remove a concrete file only under the artifact's resolved glob root, only when the artifact ID already exists, and only after the artifact-scoped diff names the concrete path.
   - Normalize and verify every concrete path under `changeRoot`; never write a glob expression as a filename.
10. Preserve stable task and Task Group IDs, but do not derive or write execution status from task checkboxes. Checkboxes are planning syntax only; Run Contract v3 records lifecycle completion and the CLI-managed Issue dashboard records tracker progress. Never mark, reset, or infer `[x]` during reconciliation.
11. After all approved edits, request fresh context with `corgispec update "<change>" --json [--store "<id>"]` and record the new `planningRevision`.
12. Run both gates:

    ```bash
    openspec validate "<change>" --strict --no-interactive [--store "<id>"]
    corgispec ready "<change>" --strict --json [--store "<id>"]
    ```

13. Execute the read-only `corgispec-ready` semantic review with the same store argument. If either gate fails, report the remaining artifact-specific findings; do not claim completion.

## Scope boundary

Never modify:

- implementation source, tests, generated code, or build configuration;
- GitHub/GitLab issues or local tracker state;
- QA evidence, loop evidence, review artifacts, or run state;
- `corgi/source.yaml`, RFC content, delivery bindings, or contract identity;
- `memory/`, `wiki/`, session records, or unrelated documentation;
- OpenSpec schema definitions or global/store configuration.

Do not run apply, loop, review, archive, commit, push, or publish actions.

## Completion report

Return the changed artifact IDs and concrete paths, skipped or rejected diffs, original and final `planningRevision`, strict validation result, deterministic ready result, and semantic ready result. State explicitly that no implementation or operational files changed.
