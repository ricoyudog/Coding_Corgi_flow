---
description: Propose a new change - create it and generate all artifacts in one step
---

Propose a new change — create it and generate all artifacts in one step.

**Input**: The argument after `/opsx-propose` is the change name (kebab-case), OR a description of what you want to build.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

2. **Check isolation mode (CRITICAL — do NOT skip)**

   Read `openspec/config.yaml` and check `isolation.mode`.

   - If `isolation.mode` is `worktree`: the platform skill MUST create a git worktree before any other work. Verify this happens. If it does not, stop and report failure.
   - If `isolation` section is missing or `mode` is `none`: normal operation, no worktree needed.

3. **Dispatch to platform skill**

   - If `schema: gitlab-tracked` → Follow the instructions in the **openspec-propose** skill
   - If `schema: github-tracked` → Follow the instructions in the **openspec-gh-propose** skill
   - Otherwise → Tell the user: "Unsupported schema '<value>'. Supported: gitlab-tracked, github-tracked." and stop.

   The selected skill owns the internal propose phases and any platform-specific execution. This wrapper only reads config, enforces isolation, dispatches by schema, and verifies postconditions.

4. **Pass through all input**

   Forward the user's input (change name, description, etc.) to the selected skill as-is.

5. **Verify postconditions**

   After the skill completes, verify:
   - If `isolation.mode` is `worktree`: run `git worktree list` and confirm the change worktree exists
   - All required artifacts exist
   - If any postcondition fails, report which one and do not claim completion
