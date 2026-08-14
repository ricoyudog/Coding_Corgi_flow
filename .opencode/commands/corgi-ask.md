---
description: Answer vault questions with bounded retrieval and queue unverified knowledge for promotion
---

Answer human questions from source-cited Memory/Wiki context using early-stop retrieval.

**Input**: Specify a question file path (e.g., `wiki/questions/how-auth-works.md`) or use `--pending` to process all pending questions.

**Steps**

1. **Dispatch to skill**

   Follow the instructions in the **corgispec-ask** skill.

2. **Pass through all input**

   Forward the user's input (file path or `--pending` flag) to the skill as-is.

3. **Preserve knowledge boundaries**

   Never promote an answer directly into Architecture, Pitfalls, Patterns, Decisions, or MEMORY. Queue candidates in Session Bridge with their source and verification requirement.
