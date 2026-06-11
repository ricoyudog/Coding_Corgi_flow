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

- NEVER ask the user for approval, rejection, or discussion
- NEVER skip posting the review report to the child issue (if tracked) — issue visibility is required
- NEVER ask for human approval — approval is automatic based on finding severity
- NEVER commit or push changes — commit/push is the loop skill's responsibility
- NEVER implement fixes during review
- NEVER present human-gate decision options to the user

---

## Steps

### 1. Discover: resolve change, group, and platform

**Context Gate**: If session context already contains ALL of: change name, group number, platform, and the loop state directory path
→ Gate passed — SKIP discovery below and proceed to Step 2.

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

### 4. Exit

After writing `review.json`, the skill terminates. Do NOT:
- Ask for user feedback
- Present a summary to the user
- Post to issue trackers
- Change labels
- Commit or push

The loop hook reads `review.json`, validates it, and decides whether to advance, block, or terminate.

---

## Postconditions

- [ ] `review.json` exists at `<platform>/corgi-loop/<change>/groups/<N>/review.json`
- [ ] `review.json` is valid JSON with correct schema
- [ ] All findings have valid severity values from the allowed enum
- [ ] `finding_details` is a non-null array
- [ ] No human interaction was performed
- [ ] No issue labels were changed
- [ ] No commits or pushes were made
