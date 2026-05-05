---
description: Install, update, or verify OpenSpec GitFlow assets in a target project
---

Install, update, or verify project-local OpenSpec GitFlow assets.

**Dispatches to**: `corgispec-install`

**Input**: The argument after `/corgi-install` is optional mode and target-path input for the installer.

**Steps**

1. **Follow the installer skill**

   Follow the instructions in the **corgispec-install** skill.

2. **Pass through all input**

   Forward the user's input to the skill as-is.

**Example**

```text
/corgi-install --mode fresh --path /path/to/project
```
