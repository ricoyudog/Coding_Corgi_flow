---
name: corgispec-verify
description: Run the canonical whole-change verification gate for a Run Contract v3 delivery in awaiting_verify, covering integration checks and every RFC or maintenance AC. Use after Apply completes all Task Groups and before human review.
---

# Verify the Whole Delivery

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Verify is read-only with respect to implementation and planning. It submits canonical evidence through the CLI; it never edits `.corgi/loop`, tracker content, source, traceability, or task artifacts directly.

1. Resolve the delivery worktree and require Run Contract phase `awaiting_verify`.
2. Require a clean final HEAD and unchanged planning revision, source digest, traceability digest, RFC accepted commit, and single Issue binding.
3. Run the complete project test/build/lint/integration suite appropriate to the Change. Capture each command, exit code, and evidence path.
4. For every source AC, verify exact traceability to planning anchors and completed Task Groups.
5. Supply automated evidence for `automated` and `both` ACs. Mark human-only evidence as not applicable to this gate; never claim Human QA evidence early.
6. Write the temporary report JSON with top-level `checks` and `acceptance`, then submit `corgispec verify "<change>" --report "<verify-report.json>" --run-id "<runId>" --session "<sessionId>" --state-revision "<revision>" --nonce "<nonce>" --json`. Copy the four token values from the final Apply JSON unchanged; use the new returned token for Review.
7. Let the CLI update the single Issue through its tracker adapter; never call `gh` or `glab`.

Any failing check, missing/extra AC, absent evidence reference, dirty worktree, or digest drift is FAIL and transitions to an implementation repair requirement. Do not implement the repair during Verify. A pass transitions only to `awaiting_human_review`.

Report verdict, final HEAD, planning revision, checks, per-AC evidence matrix, canonical report hash, and next action.
