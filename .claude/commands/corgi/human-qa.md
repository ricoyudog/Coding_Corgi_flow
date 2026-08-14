---
name: "Corgi: Human QA"
description: Run the human real-user-path QA gate and submit RFC AC-bound evidence
category: Workflow
tags: [workflow, qa, rfc, human-gate]
---

Follow **corgispec-human-qa** only in `awaiting_human_qa` after Human Review approval.

- Route to relevant smoke/UI/API/CLI/backend/exploratory atoms.
- Bind real user-path evidence to each human/both AC and the verified final HEAD.
- In an interactive terminal submit `corgispec human-qa "<change>" --report "<qa-report.json>" --run-id "<runId>" --session "<sessionId>" --state-revision "<revision>" --nonce "<nonce>" --json`, copying the Review token unchanged; never call `gh`/`glab`.
- Skip only for human-confirmed no-runtime-impact work with reviewer identity and reason.
- PASS or valid skip advances to `ready_for_archive`; FAIL requires repair.
