---
name: corgispec-review-loop
description: Collect structured review findings for the current Run Contract v2 attempt without a human gate or filesystem writes. Use inside corgispec-loop after verification and return findings for the canonical loop submit command.
---

# Review a loop attempt

Review the implementation for the exact run, Task Group, and attempt returned by `corgispec loop inspect`. Return structured findings to the parent loop workflow; do not persist them yourself.

## Constraints

- Never read or write `.corgi/loop/**`, `state.json`, `verify.json`, `review.json`, `events.jsonl`, or `review-triage.jsonl`.
- Never infer a change root, task path, group, attempt, or planning revision.
- Use only the authoritative paths, fingerprints, Git revisions, and action context supplied by the CLI.
- Do not modify implementation, planning, tracker, QA, or memory.
- Do not dismiss findings or accept risk. Human triage is a separate CLI action with actor and reason.

## Review

1. Check that the supplied run/group/attempt identity matches the current inspect response.
2. Read requirements and Task Group scope only from the supplied artifact paths.
3. Inspect the submitted Git diff and implementation files.
4. Evaluate code quality, requirement/scenario coverage, functional behavior, architecture, and performance/security where relevant.
5. For each finding return:
   - `severity`: `critical`, `important`, `suggestion`, `nit`, or `fyi`;
   - `check`: the review axis;
   - `description`: a concrete, actionable statement;
   - optional requirement, file, line, and supporting evidence.
6. Return an empty findings array only after all applicable axes were checked.

Do not assign fingerprints. The CLI normalizes each finding and generates its stable fingerprint during `corgispec loop submit`.

## Output

Return the findings array and a concise axis summary directly to the parent workflow. State explicitly that no file was changed and no finding was triaged.
