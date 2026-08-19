---
name: corgispec-human-qa
description: Run the human real-user-path QA gate for an approved RFC-first Run Contract v3 delivery, route to relevant QA atoms, and submit AC-bound evidence. Use in awaiting_human_qa before Archive; skip only for human-confirmed no-runtime-impact work.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# Human QA

Require phase `awaiting_human_qa`, Human Review approval, clean unchanged final HEAD, and matching planning/source/traceability digests.

## Build the QA Charter

1. Read the RFC Slice or maintenance source, especially ACs requiring `human` or `both` evidence.
2. Classify the actual runtime surfaces: smoke, UI, API, CLI, backend, and exploratory risk.
3. Route only to relevant `corgispec-qa-*` atoms. Start with smoke when the product has a runnable surface.
4. Present real user paths, expected results, evidence to capture, and stop conditions to the human.

## Execute and Submit

- Bind screenshots, logs, confirmations, and defects to exact AC IDs.
- Record environment, steps, expected/actual results, evidence references, reviewer identity, final HEAD, and planning revision.
- Any required AC without passing human evidence makes QA fail.
- In an interactive human-controlled terminal, submit only through `corgispec human-qa "<change>" --report "<qa-report.json>" --run-id "<runId>" --session "<sessionId>" --state-revision "<revision>" --nonce "<nonce>" --json`. The report supplies `verdict`, `reviewer`, optional `reason`/`noRuntimeImpact`, and the AC `acceptance` matrix. Copy the four token values from Human Review JSON unchanged; let the CLI persist canonical evidence and update the single Issue.
- Never invoke `gh`/`glab` or edit `.corgi/loop` directly.

QA may be `skipped` only when the Change has no runtime impact and a human reviewer explicitly supplies identity and reason. Agent classification alone cannot authorize a skip.

A pass or valid skip transitions to `ready_for_archive`. A failure creates an implementation repair requirement; do not fix defects inside QA. Report the per-AC result, evidence paths, reviewer, final HEAD, canonical report hash, and next action.
