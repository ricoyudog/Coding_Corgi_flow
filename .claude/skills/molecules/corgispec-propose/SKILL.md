---
name: corgispec-propose
description: Create or complete one RFC-first CorgiSpec planning package from an accepted unbound RFC Slice or a closed maintenance exemption. Use when the CLI must create/recover the single Issue, Change, source overlay, traceability, and strict-ready handoff without implementing code.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# Propose an RFC-first Delivery

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Propose is planning-only and provider-neutral. The CLI owns Issue creation/recovery, tracker state, `corgi/source.yaml`, initial `corgi/traceability.yaml`, and RFC delivery binding. Never call `gh` or `glab` directly.

## Select One Source

For a Feature, require an exact accepted, merged, unbound reference:

```bash
corgispec propose "<change>" --from "RFC-0001-slug/S-01-slug" --json
```

Do not turn free-form Feature prose into an RFC. If no accepted Slice exists, stop and direct the human to `corgispec rfc new`.

For maintenance, require a concrete description and use:

```bash
corgispec propose "<change>" --maintenance --description "<bounded work>" \
  --contract-ref "<existing RFC AC or canonical spec when required>" --json
```

The CLI may accept only docs-only, test-only, internal-refactor, dependency-maintenance, or contract-bug work. If classification is ambiguous or could change public behavior, API/CLI/config/schema, data, security, compatibility, migration, or boundaries, stop and require an RFC.

## Establish Context

1. Confirm the project uses `corgi.contract: rfc-v1` and the Foundation RFC is effective.
2. Create or reuse the configured delivery worktree before Propose when worktree isolation is enabled. Run all subsequent commands there.
3. Keep `HEAD` unchanged throughout Propose.
4. Run the exact CLI command once. On retry, run the same command so its durable intent and Issue marker can reconcile idempotently.
5. If the CLI reports multiple Issue markers, a conflicting Change, an occupied Slice, or a source contract error, stop without manual repair.

## Complete Planning

1. Run `corgispec status "<change>" --json`.
2. Require authoritative `changeRoot`, concrete `artifactPaths`, `contextFiles`, `taskArtifactId`, and `contract` containing delivery/source/traceability/tracker bindings.
3. Read [references/artifact-creation.md](references/artifact-creation.md).
4. For each CLI-ready artifact, run `corgispec instructions "<artifact-id>" --change "<change>" --json` and write only its returned concrete target.
5. Re-run status after each artifact; never infer an artifact path or role from a filename.
6. Complete `corgi/traceability.yaml` so every source AC maps to concrete planning anchors and one or more Task Groups, with no missing, unknown, or duplicate ACs. Do not edit `corgi/source.yaml`.
7. Run `corgispec ready "<change>" --strict --json` as a diagnostic and require the same RFC/source/traceability digests.
8. Re-run the exact same source command with `--finalize --json`, for example `corgispec propose "<change>" --from "<RFC>/<Slice>" --finalize --json` or the identical maintenance flags plus `--finalize`. Only this CLI-owned closeout may enforce strict ready, write the managed single-Issue dashboard, move the Issue from backlog to todo, and mark planning complete.
9. If finalize is interrupted, rerun that exact finalize command so the durable intent reconciles idempotently. Do not edit the dashboard or delivery binding manually.

Task Groups remain sections in the authoritative task artifact and dashboard of the single Issue; never create a Task Group Issue.

## Handoff

Report the RFC/Slice or maintenance exemption, Change, worktree, single Issue or provider-none binding, concrete planning artifacts, traceability coverage, planning revision, strict readiness, and finalized todo handoff. Tell the user that Apply is the next separate action.

Do not install packages, implement code, create commits, push, open an implementation PR/MR, invoke Apply/Verify/Review/QA/Archive, or publish. End the turn after the planning handoff.
