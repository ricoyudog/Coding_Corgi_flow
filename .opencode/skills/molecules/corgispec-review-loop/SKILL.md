---
name: corgispec-review-loop
description: Collect structured automated review findings for one current Run Contract v3 Task Group without a human gate or filesystem writes. Use inside corgispec-apply before that group's dedicated commit; this never replaces whole-change Verify or Human Review.
---

# Review a Task Group attempt

Review the implementation for the exact run and Task Group returned by canonical Apply context. Return structured findings to the parent Apply workflow; do not persist them yourself.

## Constraints

- Never read or write `.corgi/loop/**`, state, events, or evidence files.
- Never infer a change root, task path, group, attempt, or planning revision.
- Use only the authoritative paths, fingerprints, Git revisions, and action context supplied by the CLI.
- Do not modify implementation, planning, tracker, QA, or memory.
- Do not dismiss findings or accept risk. Human triage is a separate CLI action with actor and reason.

## Review

1. Check that the supplied run/group identity matches the latest CLI response.
2. Read requirements and Task Group scope only from the supplied artifact paths.
3. Inspect the submitted Git diff and implementation files.
4. Evaluate code quality, requirement/scenario coverage, functional behavior, architecture, and performance/security where relevant.
5. For each finding return:
   - `severity`: `critical`, `important`, `suggestion`, `nit`, or `fyi`;
   - `check`: the review axis;
   - `description`: a concrete, actionable statement;
   - optional requirement, file, line, and supporting evidence.
6. Return an empty findings array only after all applicable axes were checked.

Do not assign fingerprints or persist evidence hashes. The CLI normalizes and binds the returned review evidence.

## Output

Return the findings array and a concise axis summary directly to the parent workflow. State explicitly that no file was changed, no finding was human-triaged, and this is not canonical whole-change Verify or Human Review.
