---
description: Run automated verification on a completed Task Group before review
---

Run automated verification (tests, spec coverage, lint/build) on a completed Task Group before review.

**Input**: Optionally specify a change name and/or Task Group number.

**Steps**

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field. Verify tracks both gitlab-tracked and github-tracked — the platform determines which CLI (`glab` vs `gh`) is used for posting the verify report note.

2. **Check isolation mode (CRITICAL — do NOT skip)**

   Read `openspec/config.yaml` and check `isolation.mode`.

   - If `isolation.mode` is `worktree`: the worktree MUST already exist (created by propose). The skill MUST resolve it and work inside it. If the worktree is missing, stop and report failure.
   - If `isolation` section is missing or `mode` is `none`: normal operation, no worktree needed.

3. **Critical rule: Verify is fully automated**

   Unlike review, verify requires NO human gate. The skill runs all checks automatically and produces a PASS/PASS WITH WARNINGS/FAIL verdict. If the skill asks the user for input, the verify is INVALID.

4. **Dispatch to verify skill**

   Follow the instructions in the **corgispec-verify** skill (universal platform — no platform-specific variant needed).

   Verify automatically detects the platform from config.yaml for the report posting step. The skill owns all verification phases.

5. **Pass through all input**

   Forward the user's input to the corgispec-verify skill as-is.

6. **Verify postconditions**

   After the skill completes, verify:
   - A verify report exists with an explicit PASS/PASS WITH WARNINGS/FAIL verdict
   - If tracked: the report was posted to the child issue
   - Next-steps guidance was printed
   - If any postcondition fails, report which one and do not claim completion
