---
description: Record an explicit human whole-change decision after canonical Verify
---

Follow **corgispec-review** in `awaiting_human_review`.

Present the RFC/Slice boundary, AC evidence, final HEAD, Verify report, risks, and limitations. In an interactive terminal a human must run exactly one decision, e.g. `corgispec review "<change>" --approve --reviewer "<human-id>" --run-id "<runId>" --session "<sessionId>" --state-revision "<revision>" --nonce "<nonce>" --json`, using the Verify token unchanged. Alternatives are `--reject-implementation --reason` or `--require-rfc-amendment --reason`. Never choose for the user, review per Task Group, or mutate the Issue directly.
