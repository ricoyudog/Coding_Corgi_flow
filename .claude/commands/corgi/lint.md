---
name: "Corgi: Lint"
description: Read-only validation of RFC-first Memory/Wiki health; --report persists an explicit report
category: Workflow
tags: [workflow, lint, quality]
---

Validate memory and wiki health with 14 structured checks.

**Input**: None for read-only output. Pass `--report` to persist the report under `wiki/meta/`.

**Steps**

1. **Dispatch to lint skill**

   Follow the instructions in the **corgispec-lint** skill.

2. **Enforce write mode**

   Without explicit `--report`, do not create or modify files. Never auto-fix findings.

3. **Report results**

   After the skill completes, present the summary:
   - Total checks: 14
   - Errors / Warnings / Info counts
   - Overall status (PASS / WARN / FAIL)
   - Report path only when `--report` was explicit
   - Top 3 suggested actions (if any findings)
