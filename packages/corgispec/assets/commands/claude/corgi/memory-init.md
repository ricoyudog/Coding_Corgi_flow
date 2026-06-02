---
name: "Corgi: Memory Init"
description: Initialize the 3-layer memory structure (memory/ + wiki/) for cross-session AI continuity
category: Workflow
tags: [workflow, memory, experimental]
---

Initialize the 3-layer memory structure for cross-session AI continuity.

**Dispatches to**: `corgispec-memory-init`

**Input**: Optionally specify the target project path. If omitted, uses the current working directory.

**Steps**

1. **Follow the memory-init skill**

   Follow the instructions in the **corgispec-memory-init** skill.

2. **Pass through all input**

   Forward the user's input to the skill as-is.
