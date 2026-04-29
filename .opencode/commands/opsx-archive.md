---
description: Archive a completed change
---

Archive a completed change, close tracking issues, and sync delta specs.

**Input**: Optionally specify a change name after `/opsx-archive`.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

2. **Dispatch to platform skill**

   - If `schema: gitlab-tracked` → Follow the instructions in the **openspec-archive-change** skill
   - If `schema: github-tracked` → Follow the instructions in the **openspec-gh-archive** skill
   - Otherwise → Tell the user: "Unsupported schema '<value>'. Supported: gitlab-tracked, github-tracked." and stop.

3. **Pass through all input**

   Forward the user's input to the selected skill as-is.
