---
description: Migrate source-backed knowledge after transactional v4 bootstrap while preserving legacy vault data
---

Migrate existing project knowledge into the memory/wiki structure.

**Input**: Optionally specify a target project path. Migration remains idempotent and source-cited.

**Steps**

1. **Check preconditions**

   Verify the v4 bootstrap migration record and complete mandatory Memory/Wiki structure. If absent, run `corgispec bootstrap --migrate-v4` first.

2. **Dispatch to skill**

   Follow the instructions in the **corgispec-memory-migrate** skill.

3. **Pass through all input**

   Forward the target and any read-only inventory options to the skill as-is.

Never create or append to `wiki/sessions/` or `wiki/log.md`; preserve existing legacy content byte-for-byte.
