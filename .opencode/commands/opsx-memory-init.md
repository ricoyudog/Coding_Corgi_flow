---
description: Initialize the 3-layer memory structure (memory/ + wiki/) for cross-session AI continuity
---

Initialize the 3-layer memory structure for cross-session AI continuity.

**Input**: Optionally specify the target project path. If omitted, uses the current working directory.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

2. **Dispatch to skill**

   Follow the instructions in the **openspec-memory-init** skill.

3. **Pass through all input**

   Forward the user's input (target path, if any) to the skill as-is.
