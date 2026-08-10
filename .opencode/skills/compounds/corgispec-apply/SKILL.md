---
name: corgispec-apply
description: Execute or resume the sole user-facing CorgiSpec implementation workflow through the canonical Run Contract v2 engine, including a required commit for every approved Task Group. Use when starting, continuing, fixing, committing, recovering, or finalizing an implementation run; never write loop state or evidence artifacts directly.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: "false"
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# CorgiSpec Apply

Use this apply skill as the only user-facing implementation entry and the Run Contract v2 CLI as the lifecycle authority. You execute implementation work and collect truthful evidence; the internal `corgispec loop` API validates and persists every transition.

## Hard rules

- Never create, edit, rename, or delete `.corgi/loop/**` files.
- Never write legacy `.claude/corgi-loop/**` or `.opencode/corgi-loop/**` state, verify, or review files.
- Never invent a revision, nonce, run ID, fingerprint, command, exit code, finding, or Git revision.
- Never reuse an old response token after any successful mutation. Inspect again.
- Execute only the Task Group named by the current CLI action.
- Run this workflow only after the user explicitly requests it through its skill or platform command.
- Never route users to the retired `corgi-loop` or `corgispec-loop` entry points, or to the old provider-specific `corgispec-apply-change` and `corgispec-gh-apply` skills.
- Do not commit until the phase is `awaiting_group_commit`.
- Give every approved Task Group its own new commit and acknowledge it before tracker sync, the next group, or finalization. Never combine multiple Task Groups in one commit.
- Do not finalize until the phase is `awaiting_finalize`.
- Treat contract errors, session conflicts, stale tokens, corruption, and planning revision changes as blockers.

## Start or resume

1. Resolve the change name and project/worktree selected by the user.
2. Run `corgispec ready "<change>" --strict --json`. Stop unless its status is `ready`.
3. Run `corgispec loop inspect "<change>" --json`.
4. If no canonical run exists, run `corgispec loop init "<change>" --owner "<actor>" --session "<session>" --mode "<self-driven|hook-driven>" --json`.
5. If inspect reports one migratable v1 run, allow the CLI to migrate it. Never copy legacy files yourself.
6. If inspect reports multiple active runs, corrupt JSON, a future schema, a legacy-writer conflict, or a different active session, stop and report the exact error.

Record the returned `runId`, `sessionId`, `stateRevision`, and `nonce`. Existing-run mutations require all four values as a single-use CAS token. `init` creates the token; `inspect` does not accept one.

## Follow the action

Inspect output supplies one canonical action:

- `dispatch_group`: implement exactly the current Task Group, then build a complete submission.
- `fix_group`: fix only the reported failed evidence or active findings, rerun all affected checks, and submit a new complete attempt.
- `commit_group`: create one dedicated commit for the approved group, make the worktree clean, then acknowledge the commit.
- `sync_tracker`: explicitly checkpoint the committed group with the configured tracker before continuing.
- `finalize`: finalize the run.
- `blocked`: stop and report the structured reason.
- `terminal`: report the terminal phase and do not mutate anything.

Run `inspect` after every successful command before taking another action.

## Submit one complete attempt

For `dispatch_group` or `fix_group`:

1. Read the task artifact and group paths returned by the CLI. Do not guess `tasks.md`, `specs/`, or the change root.
2. Implement only the current group. Preserve old Task Groups and their identifiers.
3. Run deterministic checks from the selected worktree.
4. Build one JSON submission in memory and pipe it to `corgispec loop submit "<change>" --run-id "<runId>" --session "<sessionId>" --state-revision <n> --nonce "<nonce>" --json`.
5. Prefer a safe evidence draft containing `schemaVersion: 2`, `evidence.verdict`, `evidence.evidence[]`, `review.findings[]`, and `artifacts`. Omit evidence bindings, entry bindings, `evidenceHash`, and `bundleHash`; the CLI binds the draft to the current run/group/attempt, planning and Task Group revisions, Git revisions, workspace fingerprint, and deterministic bundle ID. A caller-supplied complete evidence bundle must make every generated field exact; never send a partial binding or hash claim.
6. For every CLI evidence entry include the exact argv/command display, cwd, exit code, and matching pass/fail status.
7. For LLM evidence include a concrete description and no exit code. Never label LLM judgment as CLI evidence.
8. Include all review findings with file/location and description when known. The CLI assigns stable fingerprints.
9. A PASS submission must contain at least one passing CLI check and no failing evidence.

The submit command commits attempt artifacts atomically. Do not retry a timed-out mutation blindly: inspect first, because the original mutation may have succeeded.

## Fixing

In self-driven mode, a failed evaluation with retry budget enters `fixing` and increments the attempt. Fix only the recorded failure/finding scope and submit a fresh complete bundle.

In hook-driven mode, or when retry budget is exhausted, failure is terminal. Do not bypass it by starting another active run.

## Invalidate or resume

Invalidate only on explicit user intent:

`corgispec loop invalidate "<change>" --run-id "<runId>" --session "<sessionId>" --state-revision <n> --nonce "<nonce>" --reason "<reason>" --json`

Resume only a recoverable terminal run and use the current session in the CAS token. Use `--new-session` only when intentionally transferring ownership of the resumed run:

`corgispec loop resume "<change>" --run-id "<runId>" --session "<currentSessionId>" --state-revision <n> --nonce "<nonce>" --new-session "<newSessionId>" --json`

Pass `--target-phase` or `--max-attempts` only when the user has selected those recovery controls. Inspect after either mutation and use the newly returned token.

## Review triage

Do not dismiss or accept risk on behalf of a human. Only a human actor may submit `dismissed` or `accepted-risk`, and the CLI requires their identity and reason. After human input, pass it through the CLI exactly; never edit `review-triage.jsonl`.

## Commit acknowledgement

When inspect returns `commit_group`:

1. Confirm the approved workspace contains exactly the submitted Task Group implementation and no work from a later group.
2. Create one commit for that Task Group, including its authorized task-checkbox updates, and no unrelated changes.
3. Leave the worktree clean.
4. Run `corgispec loop ack-commit "<change>" --run-id "<runId>" --session "<sessionId>" --state-revision <n> --nonce "<nonce>" --json`.

Passing evaluation does not complete a group. The CLI advances only after it derives the dedicated commit from the current Git HEAD and checks the clean tree, submitted workspace fingerprint, commit tree, and ancestry. Do not run tracker sync or begin another group before acknowledgement succeeds. When push is required, also pass `--push-status pushed --remote-revision "<revision>"`; never pass a caller-supplied commit option. If it rejects the acknowledgement, do not rewrite state or amend evidence; inspect and report the mismatch.

## Tracker checkpoint

When inspect returns `sync_tracker`, run:

`corgispec loop sync-tracker "<change>" --run-id "<runId>" --session "<sessionId>" --state-revision <n> --nonce "<nonce>" --json`

This is an explicit lifecycle action. Never run it from a Stop/idle hook, and never call `gh` or `glab` directly for this checkpoint. If the command fails or times out, inspect before retrying; it is responsible for safe idempotent recovery.

## Finalize

When inspect returns `finalize`, run `corgispec loop finalize "<change>" --run-id "<runId>" --session "<sessionId>" --state-revision <n> --nonce "<nonce>" --json`.

Finalization rechecks planning revision, Git cleanliness/revision, every group commit, and evidence freshness. Success must report phase `done` and a final Git revision.

## Hook behavior

Hook wrappers may pass session input to the CLI and relay its JSON decision. They only inspect and report the next action: they never run `sync-tracker`, `gh`, `glab`, or any other tracker write. They do not own state and must preserve stdin identity, stdout, stderr, and exit status. In hook-driven mode, stop after submitting a bundle so the hook can resume the canonical run.

## Completion report

Report the change, run ID, terminal phase, completed groups and their commit revisions, planning revision, baseline/final Git revisions, and any structured blocked reason. State explicitly that all canonical mutations were performed by `corgispec loop`.
