---
description: Validate memory and wiki health with 11 structured checks
---

Validate memory and wiki health with 11 structured checks.

**Input**: No arguments required. Runs against the current project's memory/ and wiki/ directories.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

2. **Dispatch to skill**

   Follow the instructions in the **openspec-lint** skill.

3. **Pass through all input**

   Forward any user input to the skill as-is.
