---
description: Execute Corgi Task Groups automatically through apply→verify→review
---

Run the Corgi Loop for a change. Executes Task Groups automatically through the full pipeline: apply, verify, review-evidence.

**Input**: Specify a change name (e.g., `/corgi-loop add-auth`). If omitted, infer from context.

**Steps**

0. **Context Gate**

   **Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch
   → Gate passed — SKIP config reading below and proceed to the next step.
   Otherwise: read `openspec/config.yaml` and proceed with discovery.

1. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

2. **Check isolation mode (CRITICAL — do NOT skip)**

   Read `openspec/config.yaml` and check `isolation.mode`.

   - If `isolation.mode` is `worktree`: the worktree MUST already exist (created by propose). The skill MUST resolve it and work inside it. If the worktree is missing, stop and report failure — do not create it during the loop.
   - If `isolation` section is missing or `mode` is `none`: normal operation, no worktree needed.

3. **Dispatch to loop skill**

   Follow the instructions in the **corgispec-loop** skill (compound skill — orchestrates apply, verify, and review-evidence per group).

   The loop skill owns:
   - Initializing loop state in `.opencode/corgi-loop/<change>/state.json`
   - Executing one full group bundle per invocation: apply → verify → review-evidence
   - Writing structured artifacts (verify.json, review.json) per group
   - Stopping after each bundle — the stop hook decides continue/stop/advance

   This wrapper only reads config, enforces isolation, dispatches the skill, and verifies postconditions.

4. **Pass through all input**

   Forward the user's input to the corgispec-loop skill as-is.

5. **Verify postconditions**

   After the skill completes, verify:
   - `state.json` exists at `.opencode/corgi-loop/<change>/state.json`
   - If a group was executed: `verify.json` and `review.json` exist for that group
   - All artifacts share the same `changeName`, `group`, and `nonce`
   - The skill STOPPED after writing artifacts — no lifecycle decisions were made
   - If any postcondition fails, report which one and do not claim completion

## How it works

1. **Initialization**: Creates loop state in `.opencode/corgi-loop/<change>/state.json` with group count, session ID, auto-approval policy, and retry config (maxRetries: 3 on OpenCode)
2. **Per-group bundle**: For each Task Group — apply → verify → review-evidence → write artifacts
3. **Self-driving on OpenCode**: The loop calls `corgispec hook loop-check` internally after each bundle to evaluate state. The hook returns the decision (advance, fixing, terminal) and the skill acts on it automatically.
4. **Retry on failure**: When the hook returns `phase: "fixing"`, the loop re-executes the group with fix context, up to 3 retry attempts. After exhausting retries, the loop stops with a terminal verdict.
5. **Compaction recovery**: If context is lost, re-reads state.json from disk and resumes

## Stopping conditions

The loop stops on:
- Verification failure after exhausting retries (max 3 per group on OpenCode)
- Critical or important review findings after exhausting retries
- Circuit breaker (blockCount exceeds maxBlocks)
- All groups completed
- State file corruption or missing artifacts
- Claude Code (hook-driven): stops immediately on any failure (no auto-retry)
