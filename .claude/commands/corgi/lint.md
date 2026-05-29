---
name: "OPSX: Lint"
description: Validate memory health across 14 checks — freshness, size caps, broken links, extraction completeness
category: Workflow
tags: [workflow, lint, quality]
---

Validate memory and wiki health with 14 structured checks.

**Input**: None required. Runs a comprehensive health check on the project's memory layer.

**Steps**

1. **Dispatch to lint skill**

   Follow the instructions in the **corgispec-lint** skill.

2. **Report results**

   After the skill completes, present the summary:
   - Total checks: 14
   - Errors / Warnings / Info counts
   - Overall status (PASS / WARN / FAIL)
   - Location of full report: `wiki/meta/lint-report-{date}.md`
   - Top 3 suggested actions (if any findings)
