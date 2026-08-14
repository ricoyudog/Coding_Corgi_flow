---
description: Verify mandatory RFC-first Memory/Wiki or route initialization through transactional bootstrap
---

Memory/Wiki is mandatory in CorgiSpec v4. Transactional bootstrap is its only initialization writer.

**Input**: Optionally specify the target project path. If omitted, uses the current working directory.

**Steps**

1. **Inspect the target**

   If the mandatory structure is absent or the project is still on v3, route to `corgispec bootstrap --migrate-v4`. Do not create individual files manually.

2. **Dispatch to skill**

   Follow the instructions in the **corgispec-memory-init** skill.

3. **Pass through all input**

   Forward the user's input (target path, if any) to the skill as-is.

There is no memory opt-out in v4. Preserve legacy `wiki/sessions/` and `wiki/log.md` in place without new writes.
