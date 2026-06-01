---
name: corgispec-qa-smoke
description: "Smoke test gate — verifies the application launches and critical paths are accessible before deeper QA"
license: MIT
compatibility: Requires a running or launchable application. Called before any deeper QA testing begins.
metadata:
  author: corgispec
  version: "1.0.0"
  generatedBy: "1.0.0"
---

# Smoke Test Gate

"Does it even launch?" — The first gate in any QA cycle.

## Overview

This skill executes a minimal smoke test to confirm the application is functional at the most basic level before investing time in deeper QA. If smoke fails, all further testing is aborted — there is no point testing features on a broken build.

A smoke pass means:
- The application starts without crashing
- No HTTP 500 errors on critical endpoints
- No unhandled runtime exceptions in logs
- Critical navigation paths are reachable
- Build version matches the expected release

## When to Use

- As the first step after deploying or launching a build for QA
- Before executing any test cases from `qa-testcases.md`
- After a hotfix deployment to confirm basic stability
- When a QA session begins and you need a go/no-go decision

Do NOT use this skill for deep functional testing, regression, or performance validation.

## Preconditions

- [ ] Application is deployed or can be launched locally
- [ ] Expected build version is known (from tasks.md, release tag, or deploy log)
- [ ] Critical paths are identified (login page, main dashboard, primary API health endpoint)

## Steps

### 1. Launch or confirm application is running

Start the application (or confirm the deployed instance is reachable):
- Web app: verify the root URL returns HTTP 200
- API service: verify the health/status endpoint responds
- CLI tool: verify `--version` or `--help` executes without error

If the app fails to start or the URL is unreachable, **FAIL immediately**.

### 2. Verify build version

Confirm the running instance matches the expected version:
- Check version endpoint, page footer, response headers, or CLI output
- Compare against the expected version from the change artifacts

If version does not match, **FAIL** — wrong build is deployed.

### 3. Check for runtime errors

Inspect available logs (console, server logs, browser devtools) for:
- Unhandled exceptions or stack traces
- Fatal errors during startup
- Critical dependency failures (DB connection, auth service)

If critical errors are present, **FAIL**.

### 4. Verify critical paths are accessible

Navigate or request each critical path:
- Authentication page loads (if applicable)
- Main dashboard/home page renders
- Primary API endpoints return expected status codes (200/201, not 500/503)
- No blank pages or broken layouts on key screens

If any critical path returns 500 or fails to render, **FAIL**.

### 5. Read assigned test cases

If `qa-testcases.md` exists in the change directory:
1. Read the file and identify cases assigned to the current smoke scope
2. Execute only cases tagged `[smoke]` or explicitly listed for this gate
3. Record pass/fail for each

### 6. Report result

Produce a smoke report in this format:

```markdown
## Smoke Test Report

- **Build Version:** <actual> (expected: <expected>)
- **Timestamp:** <ISO 8601>
- **Result:** PASS | FAIL

### Checks

| Check | Status | Notes |
|-------|--------|-------|
| App launches | PASS/FAIL | <detail> |
| Version match | PASS/FAIL | <detail> |
| No runtime errors | PASS/FAIL | <detail> |
| Critical path: <name> | PASS/FAIL | <detail> |
| ... | ... | ... |

### Decision

- **PASS** → Proceed to full QA test cases
- **FAIL** → Abort QA. Reason: <summary>
```

## Common Mistakes

- **Testing too deeply** — Smoke is not regression. Only check "does it launch and respond." Move on quickly.
- **Ignoring version mismatch** — Testing the wrong build wastes everyone's time. Always verify version first.
- **Skipping log inspection** — An app can return 200 while throwing errors internally. Check logs.
- **Continuing after failure** — If smoke fails, STOP. Do not proceed to deeper QA. Report and block.
