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

Run automated quality checks for a completed Task Group and write a machine-readable `review.json` artifact. This skill is designed for the **corgi-loop** automation pipeline — it produces structured evidence consumed by the loop hook without any human interaction.

## Preconditions

- [ ] Change exists in `openspec/changes/<name>/`
- [ ] Group `N` has completed apply and verify phases
- [ ] `tasks.md` has all tasks for group `N` marked `[x]`
- [ ] Loop state directory exists: `<platform>-corgi-loop/<change>/groups/<N>/`

## Forbidden Actions

- NEVER ask for human approval — approval is automatic based on finding severity
- NEVER skip posting the review report to the child issue (if tracked)
- NEVER commit or push changes — commit/push is the loop skill's responsibility, not review-loop's
- NEVER implement fixes during review
- NEVER present results to the user or wait for input
- NEVER present human-gate decision options to the user

---

## Steps

### 1. Discover: resolve change, group, and platform

**Context Gate**: If session context already contains ALL of: change name, group number, platform, worktree path (if applicable), and the loop state directory path
→ Gate passed — SKIP discovery below and proceed to Step 2.

**Worktree Path Resolution**: If a worktreePath parameter is provided (from corgispec-loop caller), resolve all file paths (tasks.md, spec files, implementation files) relative to worktreePath instead of the current working directory. If no worktreePath is provided, use the current working directory as normal.

Otherwise, resolve:

1. **Change name**: Read from loop state or from `openspec/changes/`. If the loop executor passed `--change <name>`, use that.
2. **Group number**: Read from loop state (`state.json` `currentGroup` field) or from `--group <N>`.
3. **Platform root**: Determine platform-specific path:
   - Claude Code / `.claude`: output to `.claude/corgi-loop/<change>/groups/<N>/review.json`
   - OpenCode / `.opencode`: output to `.opencode/corgi-loop/<change>/groups/<N>/review.json`
   - If uncertain, default to `.claude/corgi-loop/<change>/groups/<N>/review.json`

Read `openspec/changes/<change>/tasks.md` to identify the group's task list. Confirm all tasks for group N are marked `[x]` before proceeding.

### 2. Run quality checks (same 5-axis as corgispec-review)

Run the same quality checks as documented in `references/quality-checks.md` (from `corgispec-review`). These checks gather evidence — they do NOT decide an outcome.

Read `references/quality-checks.md` for the full procedure. Summary of axes:

#### 2.1 Anti-Rationalization Guard
Confirm none of the standard rationalizations are skewing judgment.

#### 2.2 Code Quality
- Read all files produced by this group
- Check: structure, bugs, anti-patterns, naming, style consistency
- Produce: findings per file with severity tags

#### 2.3 Spec Verification
- Read `specs/<capability>/spec.md` from the change directory
- If no specs exist: note "No spec found for this group"
- Check each Requirement against actual implementation
- Produce: coverage status per requirement with severity for gaps

#### 2.4 Functional Verification
Detect project type and gather evidence:
- **Tests**: Run `python -m pytest` (or equivalent) if test infrastructure exists
- **UI**: Screenshot if `.html`, `.tsx`, `.vue`, `.jsx` files exist
- **CLI**: Run basic commands if CLI entry points exist
- **Fallback**: Try importing or executing the core function

#### 2.5 Architecture
Check: design patterns, module boundaries, circular dependencies, abstraction level, new dependencies.

#### 2.6 Performance & Security
Check: N+1 queries, missing pagination, blocking sync ops, unnecessary re-renders, memory leaks. Optionally consult `references/security-checklist.md` and `references/performance-checklist.md`.

### 3. Write review.json

Write a file at the output path: `<platform>/corgi-loop/<change>/groups/<N>/review.json`

Use the exact schema below. `finding_details[]` MUST be a JSON array. Every finding MUST have a `severity` from the Severity enum.

**Severity enum** (case-sensitive): `critical`, `important`, `suggestion`, `nit`, `fyi`

```json
{
  "schemaVersion": 1,
  "changeName": "<change-name>",
  "group": <N>,
  "nonce": "<ISO-8601-timestamp>-group-<N>",
  "finding_details": [
    {
      "severity": "important",
      "check": "Spec Coverage",
      "requirement": "REQ-3: Error handling",
      "description": "No null input error path in cli.py"
    },
    {
      "severity": "suggestion",
      "check": "Code Quality",
      "file": "src/utils.py",
      "description": "Consider extracting repeated validation logic"
    }
  ]
}
```

**Field rules**:
- `schemaVersion`: Always `1` (integer)
- `changeName`: The change directory name (string)
- `group`: The group number (integer, not string)
- `nonce`: ISO-8601 timestamp with group suffix, e.g. `"2026-06-10T10:00:00Z-group-2"` (string)
- `finding_details`: Array of finding objects. MUST be a JSON array — never null, never a string
- Each finding:
  - `severity` (required, string): One of `critical`, `important`, `suggestion`, `nit`, `fyi`
  - `check` (required, string): Which check axis produced this finding (e.g., "Code Quality", "Spec Coverage", "Architecture", "Performance", "Security")
  - `requirement` (optional, string): The spec requirement ID for spec findings
  - `file` (optional, string): The file path for code-level findings
  - `description` (required, string): Human-readable description of the finding

**Severity assignment rules**:
- When in doubt between two levels, choose the HIGHER severity
- Never use severity values outside the allowed enum — the hook will reject the artifact
- Never use `null` for severity

Top-level count fields (`critical`, `important`) are optional. If present they are redundant summaries — the hook recomputes counts from `finding_details[]` directly.

### 3b. Post review report to child issue (if tracked)

After writing review.json, post the review report to the tracked child issue:

1. **Assemble review report** from finding_details in the format:
   - Severity summary line with counts per level
   - Code Quality table (file, finding, severity, comment)
   - Architecture check summary
   - Performance/Security check summary
   - Spec coverage summary
   - Decision recommendation (approve or fix)

2. **Find child issue number**: Read the tracking file at openspec/changes/<change>/<change>/.github.yaml (GitHub) or .gitlab.yaml (GitLab). Extract the child issue number for the current group.

3. **Post to child issue**:
   - GitHub: gh issue comment <child_number> --body "REVIEW_REPORT"
   - GitLab: glab issue note <child_iid> --message "REVIEW_REPORT"

4. If no tracking file exists, skip issue posting silently.

### 3c. Severity-based decision output

After posting (or skipping), output a decision recommendation based on severity counts from finding_details:

- If zero critical AND zero important findings → output { "decision": "approve" }
- If any critical or important findings exist → output { "decision": "fix" }

This is a recommendation only — the loop skill reads review.json directly and makes the final decision.

### 4. Exit

After posting the review report (if tracked) and outputting the decision recommendation, the skill terminates. Do NOT:
- Ask for user feedback
- Present a summary to the user
- Commit or push changes
- Close issues

The loop skill reads review.json, the posted review report, and the decision recommendation to auto-approve or enter a fix loop.

---

## Postconditions

- [ ] `review.json` exists at `<platform>/corgi-loop/<change>/groups/<N>/review.json`
- [ ] `review.json` is valid JSON with correct schema
- [ ] All findings have valid severity values from the allowed enum
- [ ] `finding_details` is a non-null array
- [ ] Review report was posted to child issue (if tracked)
- [ ] Decision recommendation was output
- [ ] No human interaction was performed
- [ ] No commits or pushes were made
