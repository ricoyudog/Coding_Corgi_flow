---
name: "Corgi: Verify"
description: Submit canonical whole-change checks and complete RFC AC automated evidence
category: Workflow
tags: [workflow, verify, rfc]
---

Follow **corgispec-verify** only when Run Contract v3 is `awaiting_verify`.

- Run full test/build/lint/integration checks against the clean final HEAD.
- Cover every source AC and bind evidence to the unchanged planning/source/traceability digests.
- Submit `corgispec verify "<change>" --report "<verify-report.json>" --run-id "<runId>" --session "<sessionId>" --state-revision "<revision>" --nonce "<nonce>" --json`, copying the final Apply token unchanged; do not edit implementation or call tracker CLIs.
- PASS advances to `awaiting_human_review`; FAIL requires an implementation repair successor.
