---
name: "OPSX: Review"
description: Review a completed Task Group with quality checks and approve/reject flow
category: Workflow
tags: [workflow, review, experimental]
---

Review a completed Task Group with quality checks and approve/reject flow.

**Input**: Optionally specify a change name and/or Task Group number.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

2. **Check isolation mode (CRITICAL — do NOT skip)**

   Read `openspec/config.yaml` and check `isolation.mode`.

   - If `isolation.mode` is `worktree`: the worktree MUST already exist (created by propose). The skill MUST resolve it and work inside it. If the worktree is missing, stop and report failure.
   - If `isolation` section is missing or `mode` is `none`: normal operation, no worktree needed.

3. **Critical rule: NEVER auto-approve**

   The platform skill MUST present the user with Approve/Reject/Discuss options and WAIT for explicit input. If the skill completes without asking the user, the review is INVALID.

4. **Dispatch to platform skill**

   - If `schema: gitlab-tracked` → Follow the instructions in the **openspec-review** skill
   - If `schema: github-tracked` → Follow the instructions in the **openspec-gh-review** skill
   - Otherwise → Tell the user: "Unsupported schema '<value>'. Supported: gitlab-tracked, github-tracked." and stop.

   The selected skill owns the internal review phases and any platform-specific execution. This wrapper only reads config, enforces isolation, dispatches by schema, and verifies postconditions.

5. **Pass through all input**

   Forward the user's input (change name, group number, etc.) to the selected skill as-is.

6. **Verify postconditions**

   After the skill completes, verify:
   - A review report exists
   - The user was explicitly asked to approve, reject, or discuss
   - If any postcondition fails, report which one and do not claim completion
