# Review: Security Checklist

Use this checklist during the review phase for deeper security scrutiny. This is supplementary to the baseline Architecture and Performance checks in `quality-checks.md`.

This checklist is informational — it feeds findings into the review report. It does not independently block or approve.

## Always Check (No Exceptions)

These items must be checked for EVERY change, regardless of scope or perceived risk.

- [ ] **No secrets in source code or git history**
  - Check: grep for API keys, passwords, tokens, private keys (`grep -rE "(api.?key|secret|password|token|private.?key)" --include="*.{py,js,ts,go,yaml,toml,json}" .`)
  - Red flag: Any hardcoded credential → 🔴 Critical

- [ ] **All user input validated at system boundaries**
  - Check: Are there input validation layers at API entry points, form handlers, CLI parsers?
  - Red flag: Direct use of unvalidated user input in business logic → 🟡 Important

- [ ] **Parameterized queries (no string concatenation for SQL)**
  - Check: grep for SQL string formatting patterns (`grep -rE "(f\"|f'|\.format\(|%s|%.format).*(SELECT|INSERT|UPDATE|DELETE)"` )
  - Red flag: String-interpolated SQL → 🔴 Critical

- [ ] **Error responses don't expose internal details**
  - Check: Do error responses include stack traces, file paths, DB schema info?
  - Red flag: Internal details in error messages → 🟡 Important

## Red Flags (Any Trigger → 🔴 Critical)

If any of the following are detected, mark as 🔴 Critical in the review report. These are security vulnerabilities, not style issues.

- [ ] **User input passed directly to shell commands**
  - Pattern: `os.system(user_input)`, `subprocess.call(user_input)`, `child_process.exec(user_input)`, backtick execution with user data
  - Why: Shell injection vulnerability. Can lead to remote code execution.
  - How to check: grep for subprocess/exec calls where arguments include user-provided variables

- [ ] **API endpoints without authentication/authorization**
  - Pattern: Route handlers with no auth middleware, no token validation, no session check
  - Why: Unauthenticated access to protected resources
  - How to check: Review route definitions. Check for auth decorator/middleware on every non-public endpoint.

- [ ] **CORS using wildcard `*`**
  - Pattern: `Access-Control-Allow-Origin: *` or CORS middleware with `allow_origins=["*"]`
  - Why: Allows any website to make authenticated requests from the user's browser
  - How to check: grep for "Access-Control-Allow-Origin" and "\*" in CORS configuration

- [ ] **Dependencies with known critical vulnerabilities**
  - Pattern: `npm audit` shows high/critical, `pip-audit` reports vulnerabilities
  - Why: Known exploits exist for these versions
  - How to check: Run `npm audit --audit-level=high` or `pip-audit` if available

- [ ] **No rate limiting on authentication endpoints**
  - Pattern: Login/register/reset-password endpoints with no rate limiter
  - Why: Brute force attacks become feasible
  - How to check: Look for rate limiting middleware on auth routes. Check for `rate-limit`, `throttle`, or similar patterns near login handlers.

## Detection Guidance

### For Python Projects

```bash
# Secrets
grep -rnE "(api.?key|secret|password|token|private.?key)\s*=" --include="*.py" .
# SQL injection
grep -rnE "(f\"|f'|\.format\(|%\s).*(SELECT|INSERT|UPDATE|DELETE)" --include="*.py" .
# Subprocess injection
grep -rnE "os\.system|subprocess\.(call|Popen|run)" --include="*.py" .
# CORS
grep -rn "Access-Control-Allow-Origin" --include="*.py" .
```

### For JavaScript/TypeScript Projects

```bash
# Secrets
grep -rnE "(api.?key|secret|password|token|private.?key)\s*=" --include="*.{js,ts}" .
# SQL injection (string concat)
grep -rnE "(\+.*)(SELECT|INSERT|UPDATE|DELETE)" --include="*.{js,ts}" .
# Exec injection
grep -rnE "child_process\.exec|\.exec\(" --include="*.{js,ts}" .
# CORS
grep -rn "origin.*\*" --include="*.{js,ts}" .
```

## Severity: All Red Flags Default to 🔴 Critical

Security vulnerabilities are not negotiable. If a Red Flag is found, the default severity is 🔴 Critical. The human gate in review may choose to accept the risk with explicit acknowledgment, but the finding must be clearly presented at Critical level.
