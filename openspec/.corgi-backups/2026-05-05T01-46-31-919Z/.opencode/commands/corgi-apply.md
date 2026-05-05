---
description: Implement tasks from an OpenSpec change
---

Implement tasks from an OpenSpec change, one Task Group at a time.

**Input**: Optionally specify a change name (e.g., `/corgi-apply add-auth`). If omitted, infer from context.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

2. **Check isolation mode (CRITICAL — do NOT skip)**

   Read `openspec/config.yaml` and check `isolation.mode`.

   - If `isolation.mode` is `worktree`: the worktree MUST already exist (created by propose). The skill MUST resolve it and work inside it. If the worktree is missing, stop and report failure — do not create it during apply.
   - If `isolation` section is missing or `mode` is `none`: normal operation, no worktree needed.

3. **Dispatch to platform skill**

   - If `schema: gitlab-tracked` → Follow the instructions in the **corgispec-apply-change** skill
   - If `schema: github-tracked` → Follow the instructions in the **corgispec-gh-apply** skill
   - Otherwise → Tell the user: "Unsupported schema '<value>'. Supported: gitlab-tracked, github-tracked." and stop.

   The selected skill owns the internal apply phases, including discover, develop, closeout, and review handoff. This wrapper only reads config, enforces isolation, dispatches by schema, and verifies postconditions.

4. **Pass through all input**

   Forward the user's input to the selected skill as-is.

5. **Verify postconditions**

   After the skill completes, verify:
   - All tasks in the completed group are marked `[x]` in `tasks.md`
   - The skill STOPPED after one group (did not auto-continue)
   - If `isolation.mode` is `worktree`: all local output changes are in the worktree, not main checkout
   - If tracking is enabled: closeout synced the completed group state
   - If any postcondition fails, report which one and do not claim completion
