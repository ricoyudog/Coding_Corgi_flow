---
name: corgispec-ready
description: Assess whether an existing CorgiSpec change is safe to implement by combining deterministic `corgispec ready` checks with a read-only cross-artifact semantic review. Use before apply or loop execution, after planning edits, or whenever proposal, requirements, scenarios, design, and tasks may disagree.
---

# Assess planning readiness

Keep this workflow read-only. Report planning problems; never edit an artifact, implementation file, tracker, QA record, or memory file.

## Workflow

1. Resolve exactly one change name and optional `--store <id>` from the user's input or status context. If discovery is ambiguous, ask the user to select a change.
2. Make store selection sticky. When input or status identifies a store, append the same `--store "<id>"` to every subsequent `corgispec status` and `corgispec ready` call. If status indicates a store-backed root but does not expose a stable store ID, stop and request a CLI upgrade; never fall back to the local planning home.
3. Run the deterministic preflight:

   ```bash
   corgispec ready "<change>" --strict --json [--store "<id>"]
   ```

   Omit `--strict` only when the user explicitly requests a non-blocking diagnostic. Preserve the JSON output even when the process exits with status 1.
4. Interpret the exit contract:
   - Exit 0: continue with the semantic review.
   - Exit 1: retain every reported check and continue reviewing readable artifacts so the report is complete.
   - Exit 2: stop and report the environment or contract error; do not guess missing paths.
5. Treat `artifactPaths.<id>.existingOutputPaths` as the only readable planning-file inventory. Ignore unknown JSON fields, never derive a conventional change path, and never read or write `resolvedOutputPath` as a file.
6. Read every existing planning artifact returned by the CLI. Use `taskArtifactId` to identify tasks; do not assume conventional artifact IDs exist in a custom schema.
7. Read [references/semantic-checks.md](references/semantic-checks.md) and apply every relevant cross-artifact check. Cite concrete artifact IDs, paths, headings, requirement names, scenario names, and task IDs for each finding.
8. Keep deterministic checks separate from semantic findings. Never change a CLI check's status or claim that a semantic judgment came from the CLI.
9. Compute the overall result:
   - `ready`: the CLI status is `ready` and no semantic error exists.
   - `not_ready`: the CLI status is `not_ready` or a semantic error exists.
   - In strict mode, treat semantic warnings as `not_ready`; otherwise retain them as warnings.

## Report

Return:

- change name, schema name, and `planningRevision`;
- deterministic status and checks exactly as reported;
- semantic findings grouped by error, warning, and info;
- overall `ready` or `not_ready` status;
- the smallest artifact-specific follow-up for every blocker.

State explicitly that the review made no file changes.

## Guardrails

- Remain read-only even when a fix appears obvious.
- Do not infer missing artifacts from common filenames.
- Do not inspect implementation code to compensate for incomplete planning.
- Do not weaken strict validation, suppress a warning, or fabricate evidence.
- Do not report ready when any required artifact is unreadable or contradictory.
