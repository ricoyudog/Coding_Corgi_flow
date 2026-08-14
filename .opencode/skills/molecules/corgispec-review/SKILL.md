---
name: corgispec-review
description: Record the explicit human whole-change decision for a verified RFC-first Run Contract v3 delivery. Use in awaiting_human_review to approve, reject implementation, or require an RFC Amendment; never review per Task Group or mutate trackers directly.
---

# Human Review

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Require phase `awaiting_human_review`, canonical Verify PASS, a clean unchanged final HEAD, and matching planning/source/traceability digests. Present the accepted RFC/Slice boundary, AC matrix, implementation commits, Verify evidence, known limitations, and risks to the human.

Only a human may choose one decision:

- `--approve`: accept implementation against the existing RFC; transition to `awaiting_human_qa`.
- `--reject-implementation`: record a precise reason and create an implementation repair successor path using the same Issue.
- `--require-rfc-amendment`: record the contract gap and block until a human-authored Amendment RFC is accepted, merged, and adopted.

In an interactive human-controlled terminal run exactly one decision flag, for example `corgispec review "<change>" --approve --reviewer "<human-id>" --run-id "<runId>" --session "<sessionId>" --state-revision "<revision>" --nonce "<nonce>" --json`. Use `--reject-implementation --reason "<reason>"` or `--require-rfc-amendment --reason "<reason>"` instead when chosen. Copy the four token values from Verify JSON unchanged. An Agent may assemble evidence and ask for the decision, but must not choose, fake identity, feed confirmation, or edit review evidence.

Tracker transitions and comments belong to the CLI adapter. Never invoke `gh`/`glab`, edit Issue dashboards, implement a repair, alter RFC content, commit, push, QA, or Archive during review.

Report decision, reviewer, final HEAD, Verify report hash, new Run Contract phase, and required next action.
