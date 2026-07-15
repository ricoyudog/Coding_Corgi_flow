---
name: corgispec-converge
description: Compare fresh CorgiSpec planning, implementation, Git, and run evidence and close only implementation gaps through the canonical converge CLI. Use after implementation or review when deciding whether a change is converged, planning needs update, or a new append-only Task Group is required.
---

# CorgiSpec Converge

Converge is an evidence-driven gap check. The initial evaluation is read-only. Only the CLI may append a confirmed successor Task Group or invalidate a run.

## Evaluate

1. Resolve one change and the selected project/worktree.
2. Run `corgispec converge "<change>" --json`.
3. Require fresh `planningRevision`, Git revision, workspace fingerprint, and run evidence in the response. Never substitute remembered values.
4. Route by status:
   - `converged`: report the supporting evidence and make no file changes.
   - `blocked`: if planning is wrong or inconsistent, direct the user to `/corgi:update`; do not create implementation tasks.
   - `needs_work`: show the evidence gaps and the proposed Task Group exactly as returned.
   - `contract_error`: stop and report the error.

## Confirm an implementation gap

For `needs_work`, ask for explicit approval of the displayed Task Group draft. Approval covers that draft and confirmation token only.

After approval, run:

`corgispec converge "<change>" --confirm "<confirmationToken>" --json`

If that confirmed invocation is interrupted or its outcome is unknown, rerun the exact same command with the same `confirmationToken`. The CLI uses its durable convergence intent to resume idempotently; do not request a new evaluation or allocate a replacement token while recovery is pending. If the CLI returns a contract error, stop and report it instead of editing or repairing files.

The CLI must:

- resolve the unique task artifact from OpenSpec metadata;
- verify planning and Git revisions are unchanged;
- append exactly one new Task Group;
- preserve every old group byte-for-byte;
- assign non-conflicting Task and Group IDs;
- invalidate the old active run through Run Contract v2;
- allow successor evidence references only for old groups whose fingerprints are unchanged.

Never edit the task artifact or any other planning file yourself. Never modify proposal, specs, design, old Task Groups, implementation files, trackers, QA, memory, or `.corgi/loop/**` during converge. Only the CLI may persist or recover the confirmed planning and loop mutations.

## Continue

After a successful append:

1. Run `corgispec ready "<change>" --strict --json`.
2. Inspect the successor with `corgispec loop inspect "<change>" --json`.
3. Start or resume through the `corgispec-loop` skill.

## Report

Report status, planning/Git revisions, evidence gaps, whether a Task Group was appended, the invalidated and successor run IDs, and which evidence references were reused. State explicitly when the evaluation was read-only.
