---
name: "Corgi: Archive"
description: Execute strong RFC-first Archive closeout with canonical evidence, knowledge, and single-Issue recovery
category: Workflow
tags: [workflow, archive, rfc]
---

Follow **corgispec-archive-change** only from `ready_for_archive`.

Require unchanged contract digests, all Task Group commits/checkpoints, Verify PASS, Human Review approval, and Human QA PASS/valid skip. Starting with the QA JSON token, invoke one phase at a time with the exact four CAS flags: `--begin`, then `--local`, then tracked providers use `--confirm-tracker`, then `--finish`; copy each returned token into the next call and retry the same phase/token after an unknown outcome. `corgispec archive --local` is the sole writer of archive-derived delivery, hot, architecture, pattern, MEMORY, pitfall, and bridge provenance; skills may only prepare or verify it read-only. The CLI archives OpenSpec, CAS-closes the Slice, closes the Issue, and removes the worktree only after success. Never call `gh`/`glab` directly.
