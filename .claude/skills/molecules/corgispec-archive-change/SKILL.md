---
name: corgispec-archive-change
description: Execute the strong, provider-neutral Archive transaction for an RFC-first Run Contract v3 delivery, materialize evidence, close knowledge and delivery state, reconcile the single Issue, and remove the worktree only after success.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# Archive an RFC-first Delivery

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Archive only from `ready_for_archive`. The CLI owns the durable archive intent, evidence materialization, OpenSpec move, RFC delivery CAS, tracker outbox, and final Run Contract transitions. Never construct archive paths or call provider CLIs directly.

## Strong Gate

Require:

- clean final HEAD and unchanged RFC/source/traceability/planning bindings;
- every Task Group commit, local evidence, and tracker checkpoint;
- canonical Verify PASS with full automated AC coverage;
- explicit Human Review approval;
- Human QA PASS or a valid human-confirmed no-runtime skip;
- exactly one Slice binding, Change, archive destination, and single Issue/provider-none binding.

Any blocker stops before mutation.

## Transaction

1. From the Human QA JSON token, run `corgispec archive "<change>" --begin --run-id "<runId>" --session "<sessionId>" --state-revision "<revision>" --nonce "<nonce>" --json`.
2. Copy the newly returned four-field token unchanged into `corgispec archive "<change>" --local --run-id "<runId>" --session "<sessionId>" --state-revision "<revision>" --nonce "<nonce>" --json`. Retry that exact operation/token after an unknown outcome.
3. For GitHub/GitLab, use the next token with `--confirm-tracker`; provider `none` skips this operation. Then use the latest token with `--finish`. Each invocation performs exactly one resumable phase; never reuse a superseded token.
4. Require canonical evidence materialized into the archived Change, including manifest, per-group evidence, whole-change Verify, Human Review, Human QA, and run binding.
5. Require the actual OpenSpec archived root returned by the CLI; never guess or overwrite it.
6. `corgispec archive --local` is the sole write transaction for the immutable `wiki/deliveries/<RFC-ID>-<Slice-ID>.md`, managed hot/architecture/pattern regions, MEMORY/pitfall provenance, and the archive bridge checkpoint. Use **corgispec-memory-extract** only for read-only preparation or verification; never use it to create, promote, or repair those files.
7. Require RFC `delivery.yaml` archive evidence and local archive closeout commit.
8. Let the CLI outbox move the one Issue to done and close it idempotently. Never invoke `gh`/`glab`.
9. Require `--finish` to report worktree cleanup only after local and tracker closeout succeed. Preserve the branch by default.

If local archive succeeds but tracker closeout fails, keep the intent and worktree and resume tracker closeout without repeating the local archive or rewriting history.

Report archived root, evidence manifest, delivery page, promoted knowledge, archive commit, Issue result, final `archived` phase, worktree cleanup, and any retained branch.
