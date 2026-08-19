---
description: Read-only validation of RFC-first Memory/Wiki health; --report persists an explicit report
---

Validate Memory/Wiki health with 14 RFC-first checks.

**Input**: No arguments for read-only output. Pass `--report` to also write `wiki/meta/lint-report-YYYY-MM-DD.md`.

**Steps**

1. **Dispatch to skill**

   Follow the instructions in the **corgispec-lint** skill.

2. **Pass through all input**

   Forward any user input to the skill as-is.

3. **Enforce write mode**

   Without explicit `--report`, do not create or modify any file. Lint never auto-fixes findings.
