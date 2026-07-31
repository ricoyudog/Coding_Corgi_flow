---
description: Run human QA session with structured evidence collection and pass/fail verdict
---

Run a human QA session that guides the user through structured testing with evidence collection and a clear pass/fail verdict.

**Input**: Optionally specify a change name and/or Task Group number.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field. The platform determines which CLI (`glab` vs `gh`) is used for posting the QA report note.

2. **Check isolation mode (CRITICAL — do NOT skip)**

   Read `openspec/config.yaml` and check `isolation.mode`.

   - If `isolation.mode` is `worktree`: the worktree MUST already exist (created by propose). The skill MUST resolve it and work inside it. If the worktree is missing, stop and report failure.
   - If `isolation` section is missing or `mode` is `none`: normal operation, no worktree needed.

3. **Dispatch to human-qa skill**

   Follow the instructions in the **corgispec-human-qa** skill (universal platform — no platform-specific variant needed).

   The skill automatically detects the platform from config.yaml for the report posting step. The skill owns all QA phases (test scenario presentation, evidence collection, user interaction, verdict determination). This wrapper only reads config, enforces isolation, dispatches the skill, and verifies postconditions.

4. **Pass through all input**

   Forward the user's input to the corgispec-human-qa skill as-is.

5. **Verify postconditions**

   After the skill completes, verify:
   - A `qa-report.md` exists with an explicit PASS/FAIL status
   - The status is clear and unambiguous
   - All routed atom evidence is present (screenshots, logs, or confirmation notes as applicable)
   - If tracked: the report was posted to the single change Issue via the appropriate CLI
   - Next-steps guidance was printed for the user
   - If any postcondition fails, report which one and do not claim completion
