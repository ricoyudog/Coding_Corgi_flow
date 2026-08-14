---
name: "Corgi: Apply"
description: Implement all Task Groups through Run Contract v3 with one checked commit per group
category: Workflow
tags: [workflow, apply, rfc]
---

`/corgi:apply` is the sole user-facing implementation entry for **corgispec-apply**.

1. Require RFC-first strict-ready planning and create the planning-baseline commit when the allowed planning handoff is the only dirty state.
2. Start with `corgispec apply "<change>" --session "<session-id>" --owner "<agent-id>" --owner-kind agent --json`; retain the returned four-field token.
3. Implement one Task Group at a time, run local checks and automated review, update the durable bridge checkpoint, and give every group its own acknowledged commit. After the planning-baseline commit, do not edit planning artifacts or task checkboxes: Run Contract v3 is the lifecycle authority and the CLI-managed Issue dashboard is the tracker view of progress.
4. Submit each group with `--complete-group`, `--workspace-fingerprint`, `--evidence <JSON-file>`, and the preceding JSON's exact `--run-id/--session/--state-revision/--nonce`; the CLI writes the evidence hash and tracker checkpoint.
5. Let CLI tracker adapters update the one Slice Issue. Never call `gh`/`glab` or create Task Group Issues.
6. Stop at `awaiting_verify`; Apply must not run whole-change Verify, human Review, Human QA, or Archive.

Never write `.corgi/loop/**` or canonical evidence files directly.
