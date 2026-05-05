---
name: "OPSX: Archive"
description: Archive a completed change, close tracking issues, and sync delta specs
category: Workflow
tags: [workflow, archive, experimental]
---

Archive a completed change, close tracking issues, and sync delta specs.

**Input**: Optionally specify a change name after `/corgi:archive`.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

2. **Dispatch to platform skill**

   - If `schema: gitlab-tracked` → Follow the instructions in the **corgispec-archive-change** skill
   - If `schema: github-tracked` → Follow the instructions in the **corgispec-gh-archive** skill
   - Otherwise → Tell the user: "Unsupported schema '<value>'. Supported: gitlab-tracked, github-tracked." and stop.

3. **Pass through all input**

   Forward the user's input (change name, etc.) to the selected skill as-is.
