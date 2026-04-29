---
description: Think through ideas, investigate problems, or clarify requirements
---

Think through ideas, investigate problems, or clarify requirements.

**Input**: Optionally specify a change name or topic to explore.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

2. **Dispatch to platform skill**

   - If `schema: gitlab-tracked` → Follow the instructions in the **openspec-explore** skill
   - If `schema: github-tracked` → Follow the instructions in the **openspec-gh-explore** skill
   - Otherwise → Tell the user: "Unsupported schema '<value>'. Supported: gitlab-tracked, github-tracked." and stop.

3. **Pass through all input**

   Forward the user's input to the selected skill as-is.
