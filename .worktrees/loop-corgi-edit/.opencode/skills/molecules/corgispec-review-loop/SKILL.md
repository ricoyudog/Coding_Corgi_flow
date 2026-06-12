---
name: corgispec-review-loop
description: Automated loop review — runs quality checks and writes review.json without human gate.
license: MIT
compatibility: Requires corgispec CLI. Used by the corgi-loop executor (not invoked directly by users).
metadata:
  author: corgispec
  version: "1.0.0"
  generatedBy: "1.3.0"
---

# corgispec-review-loop

Loop-only review. Runs the SAME 5-axis quality checks as normal review but produces a machine-readable `review.json` artifact for the loop hook to evaluate. NO human gate. NO issue posting. NO commit/push.

## When to Use

Invoked by the corgispec-loop skill during loop execution. NOT invoked directly by users.

---

## Forbidden Actions

- NEVER ask for Approve/Reject/Discuss — fully automated
- NEVER post the review report to any issue tracker (GitLab/GitHub)
- NEVER mutate issue labels
- NEVER commit or push changes
- NEVER close issues or update parent progress
- NEVER implement fixes during review
- NEVER present results to the user or wait for input

---

## Steps

### 1. Gather Context

Read these files from the loop state directory:

- **tasks.md**: `openspec/changes/<change>/tasks.md` — identify the current group's task list
- **verify.json**: `.claude/corgi-loop/<change>/groups/<N>/verify.json` — review the verify results
- **state.json**: `.claude/corgi-loop/<change>/state.json` — extract the `nonce` field (CRITICAL: copy verbatim)

If `isolation.mode` is `worktree`, resolve all paths relative to the worktree root.

Confirm all tasks for group N are marked `[x]` before proceeding. If not all complete, abort with an error message.

### 2. Run 5-Axis Quality Checks

These are the SAME checks used by `corgispec-review` (see `references/quality-checks.md` for the full procedure). Summarized here for self-contained execution:

#### 2.1 Anti-Rationalization Guard

Before executing any checks, confirm none of the standard rationalizations are skewing judgment:

| Rationalization | Counter |
|---|---|
| "It runs, that's enough" | Running but unreadable/insecure/wrong-architecture code compounds debt |
| "Just a small change" | 60% of major incidents trace to unreviewed "small changes" |
| "I wrote it, I know it's right" | Authors have blind spots — every piece of code needs a second look |
| "AI-generated should be fine" | AI code needs MORE review, not less — confident but possibly wrong |
| "Tests pass, it's fine" | Tests are necessary but insufficient — they don't catch architecture, security, readability |
| "Fix it later" | "Later" never comes — review is the quality gate, demand cleanup now |
| "Review takes too long" | Unreviewed bugs cost 10x more to fix than bugs caught in review |

#### 2.2 Code Quality

- Read all files produced by this group (from the verify artifact or group task list)
- Check for:
  - **Anti-patterns**: God functions, deep nesting (>3 levels), duplicate code blocks
  - **Naming conventions**: Consistent casing, descriptive names, no single-letter vars outside loops
  - **Error handling**: Try-catch coverage, meaningful error messages, no swallowing
  - **Unused/dead code**: Unused imports, dead branches, commented-out code blocks
- Produce: at least one finding per file reviewed (Clean = fyi with positive comment)

#### 2.3 Spec Verification

- Read `openspec/changes/<change>/specs/<capability>/spec.md` for each capability in scope
- If no specs exist for the group: produce a single finding — `severity: "fyi"`, `check: "Spec Coverage"`, `description: "No spec found for this group"`
- For each requirement in the spec:
  - Map to implementation evidence (file, function, or test)
  - Mark coverage: covered, partially covered, or missing
  - For partially covered or missing: produce a finding with appropriate severity

#### 2.4 Functional Verification

Detect project type and gather evidence. All detection is best-effort; skip gracefully.

| Signal | Action |
|---|---|
| `tests/` + `pytest.ini` / `pyproject.toml[.pytest]` | Run `python -m pytest`, capture output |
| `.html`, `.tsx`, `.vue`, `.jsx` files | Attempt screenshot via Playwright if available |
| CLI entry points in `pyproject.toml[project.scripts]` | Run basic commands, capture output |
| None of the above | Skip and note "No functional verification infrastructure detected" |

#### 2.5 Architecture

- **Design patterns**: Does the change follow existing patterns? If a new pattern is introduced, is it intentional?
- **Module boundaries**: Clean separation? No circular dependencies?
- **Abstraction level**: Appropriate — not too high, not too low, testable and composable
- **Dependencies**: Are new dependencies necessary and justified?
- Produce: one finding per check item where issues are found

#### 2.6 Performance + Security

**Performance**:
- N+1 queries (queries inside loops)
- Missing pagination on list endpoints
- Blocking synchronous operations where async would be appropriate
- Unnecessary re-renders (React: missing useMemo/useCallback)
- Memory leaks (missing cleanup in useEffect, unclosed streams)

**Security**:
- Secrets in code (API keys, tokens, passwords)
- Missing or weak input validation
- SQL injection / shell injection vectors
- Missing authentication or authorization checks
- Unsafe deserialization

Produce: one finding per issue found, tagged with the appropriate check name ("Performance" or "Security").

### 3. Classify Each Finding

Every finding MUST have:

| Field | Required | Description |
|---|---|---|
| `severity` | ✅ Yes | One of: `"critical"`, `"important"`, `"suggestion"`, `"nit"`, `"fyi"` |
| `check` | ✅ Yes | Review axis: `"Code Quality"`, `"Spec Coverage"`, `"Functional Verification"`, `"Architecture"`, `"Performance"`, `"Security"` |
| `description` | ✅ Yes | Human-readable explanation of the finding |
| `file` | Optional | File path related to the finding |
| `requirement` | Optional | Specific requirement ID (e.g., "REQ-3: Error handling") |

**Severity assignment rules**:
- When in doubt between two levels, choose the HIGHER severity
- Only use values from the allowed enum: `critical`, `important`, `suggestion`, `nit`, `fyi`
- Never use `null` for severity

| Level | When to Use |
|---|---|
| `critical` | Must fix — security vulnerability, data loss risk, core functionality broken |
| `important` | Should fix — missing tests, poor error handling, spec non-compliance |
| `suggestion` | Nice to have — naming improvements, optional refactors, better abstractions |
| `nit` | Format/style preference — whitespace, line breaks, personal taste |
| `fyi` | Informational — future considerations, background context, clean file confirmation |

### 4. Write review.json

Write to `.claude/corgi-loop/<change>/groups/<N>/review.json`:

```json
{
  "schemaVersion": 1,
  "changeName": "<change-name>",
  "group": <N>,
  "nonce": "<nonce-from-state.json>",
  "finding_details": [
    {
      "severity": "suggestion",
      "check": "Code Quality",
      "description": "Consider extracting repeated validation logic into a helper function",
      "file": "src/utils.ts"
    },
    {
      "severity": "fyi",
      "check": "Spec Coverage",
      "description": "No spec found for this group — implementation reviewed against task list instead"
    }
  ]
}
```

**CRITICAL rules**:
- `nonce` MUST match exactly what's in `state.json` — copy it verbatim, do NOT generate a new one
- `group` MUST be an integer, not a string
- `finding_details` MUST be a JSON array — never null, never a string
- Every finding MUST include `severity`, `check`, and `description`
- Optional fields (`file`, `requirement`) are null-safe — omit when not applicable

### 5. STOP — Do Not Continue

After writing `review.json`:
- DO NOT ask Approve/Reject/Discuss
- DO NOT commit or push
- DO NOT mutate issue labels
- DO NOT post to any issue tracker
- DO NOT close issues or update parent progress
- DO NOT output a decision recommendation
- Simply write `review.json` and terminate

The loop skill reads `review.json` and makes the lifecycle decision through the loop-check hook.

---

## Postconditions

- [ ] `review.json` exists at `.claude/corgi-loop/<change>/groups/<N>/review.json`
- [ ] `review.json` is valid JSON matching the `ReviewArtifact` schema
- [ ] `nonce` field matches `state.json` nonce exactly (copy-paste, not regenerated)
- [ ] `finding_details` is a non-null array
- [ ] All findings have valid severity values from the allowed enum
- [ ] All required fields (`severity`, `check`, `description`) are present on every finding
- [ ] No human interaction was performed
- [ ] No commits, pushes, or issue tracker mutations were made

**If you reached postconditions but posted to an issue or asked the user for approval, you violated the contract. Stop and re-do.**
