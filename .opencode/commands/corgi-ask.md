---
description: Answer human questions from vault context using early-stop retrieval
---

Answer human questions from vault context using early-stop retrieval.

**Input**: Specify a question file path (e.g., `wiki/questions/how-auth-works.md`) or use `--pending` to process all pending questions.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

2. **Dispatch to skill**

   Follow the instructions in the **corgispec-ask** skill.

3. **Pass through all input**

   Forward the user's input (file path or `--pending` flag) to the skill as-is.
