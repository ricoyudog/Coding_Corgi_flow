---
name: corgispec-apply
description: Execute or resume the sole user-facing CorgiSpec implementation workflow through canonical Run Contract v3, with one checked and acknowledged commit per Task Group. Use after RFC-first planning is strict-ready; stop at awaiting_verify and never perform final Verify, human review, QA, or Archive inside Apply.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: "false"
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# CorgiSpec Apply

Apply is the only public implementation entry. `.corgi/loop` Run Contract v3 is the lifecycle authority; never create, edit, rename, or delete `.corgi/loop/**` files or evidence directly.

## Start or Resume

1. Require an explicit user request and resolve the authoritative delivery worktree.
2. Run strict status/ready and require the same RFC or maintenance source, traceability, tracker binding, planning revision, and Task Groups created by Propose.
3. If only approved planning artifacts, source/traceability, delivery binding, and bridge pointer are dirty, create one planning-baseline commit. The planning artifacts, including task checkboxes, are frozen after that commit. If unrelated changes are mixed in, stop.
4. Start a new run with `corgispec apply "<change>" --session "<session-id>" --owner "<agent-id>" --owner-kind agent --json`. Persist the returned `token.runId`, `token.sessionId`, `token.stateRevision`, and `token.nonce`. If a run already exists, read its current JSON/hook context and continue it; do not submit `apply_started` twice.
5. Reject an active v2 run. A terminal v2 history is read-only and must not be resumed by v4.

## Execute Each Task Group

For the current CLI-selected group only:

1. Read its concrete task artifact anchors, mapped ACs, planning context, and source boundary.
2. Implement only that group. Do not broaden RFC scope, edit `source.yaml`, or modify planning artifacts/task checkboxes after the planning-baseline commit. Run Contract v3 is the lifecycle authority and the CLI-managed Issue dashboard is the tracker view of progress.
3. Run the group's targeted tests/checks and a structured automated review. Keep commands, exit codes, findings, and evidence paths truthful.
4. Resolve important findings before approval; do not dismiss or accept risk for a human.
5. Update Session Bridge checkpoint fields and Promotion Queue immediately before the dedicated group commit.
6. Create exactly one new commit for the approved Task Group. Never combine multiple Task Groups in one commit.
7. Write a temporary Task Group evidence JSON file with this exact contract (the CLI validates and stores canonical evidence):

   ```json
   {
     "schemaVersion": 3,
     "groupId": "<id>",
     "checks": [{"name": "<check>", "status": "pass", "evidenceRefs": ["<path-or-ref>"]}],
     "automatedReview": {"verdict": "pass", "findings": []},
     "artifacts": ["<path-or-ref>"],
     "summary": "<truthful summary>"
   }
   ```

8. Submit it only through `corgispec apply "<change>" --complete-group "<id>" --workspace-fingerprint "sha256:<digest>" --evidence "<JSON-file>" --run-id "<runId>" --session "<sessionId>" --state-revision "<revision>" --nonce "<nonce>" --json`. Copy all four token values from the immediately preceding CLI JSON unchanged. The CLI creates the tracker checkpoint and canonical evidence hash; there is no `--tracker-checkpoint` input.
9. Re-inspect before the next group. Do not begin another group until acknowledgement succeeds.

Task Groups remain within the one Slice Issue. Never create a child Issue or invoke `gh`/`glab`; CLI tracker adapters own dashboard checkpoints and retries.

## Repairs and Contract Gaps

- A local group failure stays in the current group attempt until corrected.
- A later Verify/Review/QA implementation failure creates explicit repair work and a successor run using the same Issue.
- Any requested Goal, Boundary, Slice, AC, public contract, data, security, or migration change requires a human-authored accepted Amendment RFC. Stop implementation until the dedicated adoption command creates a new source/planning revision.

## Stop Boundary

After every Task Group has an acknowledged dedicated commit, Apply must transition to `awaiting_verify` and stop. Passing group checks does not replace canonical whole-change Verify.

Report Change, RFC/Slice or exemption, run ID/revision, completed groups and commit revisions, final HEAD, planning/source/traceability digests, Issue checkpoint, and the next Verify command with `--report` plus the latest four-field token.

Do not run final Verify, human Review, Human QA, Archive, tracker closeout, push, or publish inside Apply.
