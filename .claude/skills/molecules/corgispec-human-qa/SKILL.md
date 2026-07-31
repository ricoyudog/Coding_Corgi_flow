---
name: corgispec-human-qa
description: Human QA gate between review and archive — classifies change, routes to QA atoms, assembles evidence report.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
license: MIT
compatibility: Requires corgispec CLI.
metadata:
  author: corgispec
  version: "1.0"
  generatedBy: "1.3.0"
---

Human QA orchestrator. Classifies the change type, routes to appropriate QA atoms, collects human test cases, executes atoms in sequence, and assembles a full SBTM-style evidence report.

## Preconditions (VERIFY BEFORE STARTING)

- [ ] Change exists in `openspec/changes/<name>/`
- [ ] Review has passed (verify gate output = passed)
- [ ] If tracked: `.gitlab.yaml` or `.github.yaml` exists with one `issue` identifier and URL
- [ ] If `isolation.mode` is `worktree`: worktree exists for this change
- [ ] The application under test is runnable or deployable locally
- [ ] At least one QA atom skill is available (qa-smoke is mandatory)

## Forbidden Actions

- NEVER auto-pass QA — every gate requires actual human observation or atom execution evidence
- NEVER skip QA without a documented reason (e.g., "config-only change, no runtime behavior")
- NEVER fabricate evidence — screenshots, logs, and outputs must be real
- NEVER implement fixes during QA — file bugs, do not resolve them
- NEVER change issue labels or workflow state — QA reports findings, other skills manage state

---

## Steps

### 1. Select change and resolve worktree

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch
→ Gate passed — SKIP config reading below and proceed to the next step.
Otherwise: read `openspec/config.yaml` and proceed with discovery.

**If `isolation.mode: worktree`**: Changes live inside worktrees. Read `references/worktree-discovery.md` for the full discovery procedure. Quick summary:
1. `corgispec list --json`, if it returns changes, use them
2. If empty: scan `<isolation.root>/` directories, verify each with `git worktree list` and check `openspec/changes/<name>/` exists inside
3. Auto-select if one found, prompt if multiple
4. ALL subsequent work uses the worktree as workdir

**If no isolation**: `corgispec list --json` directly. Auto-select if one, prompt if multiple.

If name provided by user, use it directly.

### 2. Risk assessment using HTSM heuristics

Read `tasks.md` and `design.md` from the change directory. Assess risk using the following heuristic table:

| Heuristic | Weight | Assessment Criteria |
|-----------|--------|---------------------|
| **Complex** | High | Multi-component interaction, state machines, concurrency, distributed logic |
| **New** | High | First implementation of capability, no prior art in codebase |
| **Changed** | Medium | Modifications to existing stable code, regression potential |
| **Critical** | High | Auth, payments, data integrity, security boundaries |
| **Popular** | Medium | High-traffic paths, frequently used features, shared libraries |
| **Buggy** | High | Area with prior bug history, known fragile code |

Output a risk summary:
```
Risk Assessment:
- Overall: HIGH | MEDIUM | LOW
- Factors: [list applicable heuristics]
- Recommended depth: THOROUGH | STANDARD | LIGHT
```

Higher risk = more exploratory time allocated. Critical risk = mandatory type-specific atoms.

### 3. Classify change type and route to atoms

Scan all files modified in the change (from `tasks.md` completed items or git diff). Classify using the routing table:

#### Routing Table

| Change Type | File Patterns | Atoms Routed |
|-------------|---------------|--------------|
| **UI** | `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.css`, `*.scss`, `*.html` | qa-smoke → qa-ui → qa-exploratory |
| **Backend** | `*.py`, `*.go`, `*.rs`, `*.java`, `*.rb`, `services/`, `lib/` | qa-smoke → qa-backend → qa-exploratory |
| **API** | `**/api/**`, `**/routes/**`, `*.controller.*`, `openapi.*`, `swagger.*` | qa-smoke → qa-api → qa-exploratory |
| **CLI** | `**/cli/**`, `**/bin/**`, `**/commands/**`, `*.sh` | qa-smoke → qa-cli → qa-exploratory |
| **Full-stack** | UI + Backend patterns both present | qa-smoke → qa-ui → qa-api → qa-backend → qa-exploratory |
| **Config** | `*.yaml`, `*.toml`, `*.json` (non-code), `*.env*`, `Dockerfile` | qa-smoke → qa-exploratory |
| **Mixed** | Multiple categories detected | qa-smoke → [all matching type atoms] → qa-exploratory |

**Rules:**
- `qa-smoke` always executes FIRST (build/start gate)
- `qa-exploratory` always executes LAST (free-form session)
- Type-specific atoms execute in the middle, in the order listed

**Classification output format:**
```
Change Classification:
- Type: <type>
- Matched patterns: <file list>
- Atom sequence: qa-smoke → [type-specific] → qa-exploratory
- Risk-adjusted exploratory time: <minutes based on step 2>
```

### 4. Collect human test cases via conversational protocol

Engage the user in a structured conversation to collect test cases:

1. Present the change summary (from proposal.md or tasks.md)
2. Ask: "What scenarios should be tested? Provide input and expected output for each."
3. Collect scenarios until the user says "done" or equivalent
4. If user provides zero cases, prompt once more: "Are you sure? Even config changes benefit from a smoke verification."
5. If still zero, proceed with atom-generated cases only

Generate a **Test Case Sheet** table:

```markdown
| # | Scenario | Input / Action | Expected Output | Assigned Atom | Priority |
|---|----------|----------------|-----------------|---------------|----------|
| 1 | ... | ... | ... | qa-smoke | P1 |
| 2 | ... | ... | ... | qa-ui | P1 |
```

Write the table to `openspec/changes/<name>/qa-testcases.md`.

Confirm with user: "Here are N test cases assigned to atoms. Proceed with QA execution?"

### 5. Execute atoms in sequence

Execute atoms in the order determined by Step 3. Each atom:
- Receives the change directory path
- Reads `qa-testcases.md` for its assigned cases
- Produces structured output (pass/fail per case, evidence references)

**Execution protocol:**

1. **qa-smoke** (gate): If smoke fails, STOP. Report failure. Do not proceed to other atoms.
2. **Type-specific atoms**: Execute in sequence. Collect results from each.
3. **qa-exploratory**: Always last. Time-boxed based on risk assessment.

Between atoms, report progress:
```
Atom Progress:
- [x] qa-smoke: PASSED (3/3 checks)
- [ ] qa-ui: IN PROGRESS
- [ ] qa-exploratory: PENDING
```

If any type-specific atom reports a critical failure (severity = blocker), pause and ask: "Critical issue found. Continue remaining atoms or stop?"

### 6. Assemble qa-report.md

Collect all atom outputs and assemble the final report. Write to `openspec/changes/<name>/qa-report.md` using the template in Appendix A.

The report must include:
- Session metadata (ID, tester, date, build/commit)
- Human test case results (from Step 4 execution)
- Smoke test results table
- Type-specific walkthrough sections (one per atom executed)
- Exploratory findings table (from qa-exploratory)
- Bug reports for any issue with severity >= major
- QA conclusion with pass/fail status and archive recommendation
- Evidence inventory (screenshots, logs, recordings referenced)

### 7. Post summary to tracker (if tracked)

Read the tracking file (`.gitlab.yaml` or `.github.yaml`).

Require `issue.iid`/`issue.url` for GitLab or `issue.number`/`issue.url` for GitHub. If legacy `parent` or `groups` keys exist, stop tracker posting, report the unsupported format and manual conversion, and do not modify legacy issues.

**GitLab:**
```bash
glab issue note <issue_iid> --message "## QA Report Summary\n\nStatus: <PASSED|FAILED>\nAtoms executed: <list>\nBugs found: <count>\nFull report: openspec/changes/<name>/qa-report.md"
```

**GitHub:**
```bash
gh issue comment <issue_number> --body "## QA Report Summary\n\nStatus: <PASSED|FAILED>\nAtoms executed: <list>\nBugs found: <count>\nFull report: openspec/changes/<name>/qa-report.md"
```

If not tracked, skip this step silently. QA never changes the single Issue body, labels, or close state.

### 8. Gate output

Determine final QA gate result:

| Condition | Gate Output |
|-----------|-------------|
| All atoms passed, no bugs >= major | `passed` |
| Any atom reported bugs >= major severity | `failed` — list blocking bugs |
| QA skipped with documented reason | `skipped` — include reason |
| Smoke gate failed | `failed` — "smoke gate did not pass" |

Output format:
```
QA Gate: <passed|failed|skipped>
Reason: <explanation>
Bugs blocking: <list or "none">
Report: openspec/changes/<name>/qa-report.md
```

If `passed`: change is eligible for archive.
If `failed`: change needs fixes before re-QA.
If `skipped`: document justification; archive skill decides whether to accept.

---

## Appendix A: qa-report.md Template

```markdown
# QA Report

## Session Metadata

| Field | Value |
|-------|-------|
| Session ID | QA-<change-name>-<YYYYMMDD>-<seq> |
| Tester | <human or agent identifier> |
| Date | <ISO 8601> |
| Build / Commit | <short SHA or build ID> |
| Change | <change name> |
| Risk Level | <HIGH / MEDIUM / LOW> |

## Charter

<One-sentence QA charter derived from proposal.md>

## Human Test Case Results

| # | Scenario | Expected | Actual | Status | Evidence |
|---|----------|----------|--------|--------|----------|
| 1 | ... | ... | ... | PASS/FAIL | link |

## Smoke Test Results

| Check | Status | Notes |
|-------|--------|-------|
| Build succeeds | PASS/FAIL | ... |
| App starts | PASS/FAIL | ... |
| No crash on load | PASS/FAIL | ... |

## Type-Specific Walkthrough

### <Atom Name> (e.g., qa-ui)

<Structured output from atom execution>

| Test | Status | Evidence |
|------|--------|----------|
| ... | PASS/FAIL | ... |

### <Atom Name> (e.g., qa-api)

<Structured output from atom execution>

## Exploratory Findings

| # | Finding | Severity | Category | Evidence | Bug Filed? |
|---|---------|----------|----------|----------|------------|
| 1 | ... | minor/major/blocker | ... | ... | Yes/No |

## Bug Reports

### BUG-001: <title>

- **Severity**: major / blocker
- **Steps to reproduce**: ...
- **Expected**: ...
- **Actual**: ...
- **Evidence**: <screenshot/log reference>

## QA Conclusion

| Field | Value |
|-------|-------|
| Status | PASSED / FAILED |
| Blocking Bugs | <count> |
| Archive Recommendation | PROCEED / HOLD / RETEST |
| Notes | <any caveats> |

## Evidence Inventory

| # | Type | Path / URL | Referenced In |
|---|------|-----------|---------------|
| 1 | screenshot | ... | Human Test #2 |
| 2 | log | ... | Smoke Test |
```
