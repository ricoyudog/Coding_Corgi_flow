---
name: "Corgi: Ask"
description: Answer human questions from vault context using early-stop retrieval
category: Workflow
tags: [workflow, ask, experimental]
---

Answer human questions from vault context using early-stop retrieval.

**Dispatches to**: `corgispec-ask`

**Input**: Specify a question file path (e.g., `wiki/questions/how-auth-works.md`) or use `--pending` to process all pending questions.

**Steps**

1. **Follow the ask skill**

   Follow the instructions in the **corgispec-ask** skill.

2. **Pass through all input**

   Forward the user's input to the skill as-is.

**Example**

```text
/corgi:ask wiki/questions/how-auth-works.md
```