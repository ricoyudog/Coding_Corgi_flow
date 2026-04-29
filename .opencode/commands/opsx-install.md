---
description: Install, update, or verify OpenSpec GitFlow assets in a target project
---

Install, update, or verify project-local OpenSpec GitFlow assets.

**Dispatches to**: `openspec-install`

**Input**: The argument after `/opsx-install` is optional mode and target-path input for the installer.

**Steps**

1. **Follow the installer skill**

   Follow the instructions in the **openspec-install** skill.

2. **Pass through all input**

   Forward the user's input to the skill as-is.

**Example**

```text
/opsx-install --mode fresh --path /path/to/project
```
