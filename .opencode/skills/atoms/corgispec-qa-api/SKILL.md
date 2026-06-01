---
name: corgispec-qa-api
description: API walkthrough — endpoint verification with auth pyramid, CRUD coverage, request/response validation, and edge case probing.
license: MIT
compatibility: Requires a running API server or accessible endpoint URL. Works with any HTTP API (REST, GraphQL over HTTP).
metadata:
  author: corgispec
  version: "1.0"
  generatedBy: "1.0.0"
---

API endpoint walkthrough with systematic coverage.

## Overview

This skill provides a structured approach to manually verifying API endpoints using real HTTP calls (curl/httpie or language-native HTTP clients). It covers:

- **Auth pyramid** — escalating from no auth through authenticated, insufficient-permission, and admin roles
- **CRUD coverage** — Create, Read, Update, Delete per role
- **Status code coverage** — 2xx success, 4xx client errors, 5xx server errors
- **Response vs spec validation** — comparing actual responses to documented spec
- **Boundary/edge case probing** — empty bodies, large payloads, special characters, malformed input

## When to Use

- After implementing or modifying API endpoints, before marking a Task Group complete
- During the verify phase to confirm endpoints match their spec
- When investigating reported API issues with structured reproduction
- As part of a QA checklist before review

Do not use this skill for unit testing, load testing, or UI testing.

## Preconditions

- [ ] API server is running and accessible (local or remote URL known)
- [ ] Endpoint spec exists (in `specs/` or documented in design.md/proposal.md)
- [ ] Auth credentials available for each role level (if auth is required)
- [ ] `qa-testcases.md` exists in the change directory (optional — will be created if missing)

## Steps

### 1. Identify endpoints under test

Read the relevant spec or tasks.md to enumerate all endpoints that need verification:

```
Endpoint List:
- METHOD /path — purpose
- METHOD /path — purpose
```

For each endpoint, you will execute the full walkthrough below.

### 2. Auth pyramid testing

Test each endpoint through four authentication levels in order:

| Level | Description | Expected Behavior |
|-------|-------------|-------------------|
| **No auth** | No token/cookie/key sent | 401 Unauthorized (or 403) |
| **Authenticated** | Valid token, standard role | Access per role permissions |
| **Insufficient** | Valid token, wrong role/scope | 403 Forbidden |
| **Admin** | Valid token, admin/superuser role | Full access |

For each level, record the request and response:

```bash
# Level 1: No auth
curl -s -w "\n%{http_code}" -X GET https://api.example.com/resource

# Level 2: Authenticated (standard user)
curl -s -w "\n%{http_code}" -X GET https://api.example.com/resource \
  -H "Authorization: Bearer $USER_TOKEN"

# Level 3: Insufficient permissions
curl -s -w "\n%{http_code}" -X DELETE https://api.example.com/resource/1 \
  -H "Authorization: Bearer $USER_TOKEN"

# Level 4: Admin
curl -s -w "\n%{http_code}" -X DELETE https://api.example.com/resource/1 \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Record** actual status code and body snippet for each level.

### 3. CRUD coverage per role

For each role that should have access, execute the full CRUD cycle:

| Operation | Method | Path Pattern | Key Checks |
|-----------|--------|--------------|------------|
| **Create** | POST | /resource | 201 + Location header + body matches input |
| **Read (list)** | GET | /resource | 200 + array + pagination headers |
| **Read (single)** | GET | /resource/:id | 200 + correct entity returned |
| **Update (full)** | PUT | /resource/:id | 200 + all fields updated |
| **Update (partial)** | PATCH | /resource/:id | 200 + only specified fields changed |
| **Delete** | DELETE | /resource/:id | 204 or 200 + subsequent GET returns 404 |

```bash
# Create
curl -s -w "\n%{http_code}" -X POST https://api.example.com/resource \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-item", "value": 42}'

# Read back
curl -s -w "\n%{http_code}" -X GET https://api.example.com/resource/$ID \
  -H "Authorization: Bearer $TOKEN"

# Update
curl -s -w "\n%{http_code}" -X PATCH https://api.example.com/resource/$ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": 99}'

# Delete
curl -s -w "\n%{http_code}" -X DELETE https://api.example.com/resource/$ID \
  -H "Authorization: Bearer $TOKEN"

# Confirm deletion
curl -s -w "\n%{http_code}" -X GET https://api.example.com/resource/$ID \
  -H "Authorization: Bearer $TOKEN"
```

### 4. Status code coverage

Ensure the endpoint produces the expected codes across scenarios:

| Category | Codes to Cover | How to Trigger |
|----------|---------------|----------------|
| **2xx** | 200, 201, 204 | Normal CRUD operations |
| **4xx** | 400, 401, 403, 404, 409, 422 | Bad input, no auth, wrong role, missing resource, conflict, validation failure |
| **5xx** | 500 (if reproducible) | Malformed internal state, forced error paths |

For each expected error code, craft a request that should trigger it:

```bash
# 400 Bad Request — malformed JSON
curl -s -w "\n%{http_code}" -X POST https://api.example.com/resource \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{invalid json'

# 404 Not Found — nonexistent ID
curl -s -w "\n%{http_code}" -X GET https://api.example.com/resource/nonexistent-id \
  -H "Authorization: Bearer $TOKEN"

# 409 Conflict — duplicate creation
curl -s -w "\n%{http_code}" -X POST https://api.example.com/resource \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "already-exists"}'

# 422 Validation — missing required field
curl -s -w "\n%{http_code}" -X POST https://api.example.com/resource \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": 42}'
```

### 5. Response vs spec validation

For each endpoint, compare the actual response structure against the spec:

1. Read the spec (from `specs/<capability>/spec.md`)
2. Execute a successful request
3. Compare:
   - All documented fields are present
   - Field types match (string, number, array, object)
   - Enum values are within documented range
   - Nested objects match documented structure
   - No undocumented fields leak (unless spec allows extension)

Record mismatches in the report as `MISMATCH: field X expected type Y, got Z`.

### 6. Boundary and edge case probing

Test these boundary conditions for each endpoint that accepts input:

| Case | Input | Expected |
|------|-------|----------|
| **Empty body** | `{}` or no body | 400 or 422 with clear error message |
| **Large payload** | Body > 1MB (or server limit) | 413 Payload Too Large or graceful rejection |
| **Special characters** | `{"name": "<script>alert(1)</script>"}` | Stored safely or rejected; never reflected raw |
| **Unicode** | `{"name": "Te\\u00DFt \\u00FC\\u00F1\\u00EF\\u00E7\\u00F6d\\u00E9"}` | Accepted and stored correctly |
| **Numeric overflow** | `{"count": 99999999999999999}` | Handled without crash |
| **Null fields** | `{"name": null}` | Rejected or handled per spec |
| **Extra fields** | `{"name": "x", "unknown": true}` | Ignored or rejected per API contract |
| **SQL/NoSQL injection** | `{"name": "'; DROP TABLE--"}` | No error, stored as literal string |
| **Path traversal** | ID = `../../etc/passwd` | 400 or 404, no file access |

```bash
# Empty body
curl -s -w "\n%{http_code}" -X POST https://api.example.com/resource \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# Large payload (~2MB)
curl -s -w "\n%{http_code}" -X POST https://api.example.com/resource \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$(python3 -c "print('A'*2000000)")\"}"

# Special characters
curl -s -w "\n%{http_code}" -X POST https://api.example.com/resource \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "<script>alert(1)</script>"}'
```

### 7. Read qa-testcases.md (if exists)

If a `qa-testcases.md` file exists in the change directory (`openspec/changes/<change-name>/qa-testcases.md`), read it for additional test scenarios specific to this change.

The file format expected:

```markdown
# QA Test Cases: <change-name>

## Endpoint: METHOD /path

### Happy Path
- [ ] Description of test — expected result

### Error Cases
- [ ] Description of test — expected result

### Edge Cases
- [ ] Description of test — expected result
```

Execute every unchecked item. Mark items as `[x]` when they pass, or annotate with `[FAIL]` and the actual result.

### 8. Generate walkthrough report

Produce a structured report summarizing all findings:

```markdown
# API Walkthrough Report

**Date**: <today>
**Change**: <change-name>
**Server**: <base URL>
**Endpoints tested**: N

## Summary

| Endpoint | Auth | CRUD | Status Codes | Spec Match | Edge Cases | Result |
|----------|------|------|--------------|------------|------------|--------|
| GET /resource | PASS | PASS | PASS | PASS | PASS | OK |
| POST /resource | PASS | PASS | PASS | FAIL | PASS | ISSUES |

## Issues Found

### Issue 1: <endpoint> — <summary>
- **Severity**: critical | high | medium | low
- **Request**: <curl command>
- **Expected**: <what spec says>
- **Actual**: <what happened>
- **Evidence**: <response body snippet>

## Coverage Matrix

| Test Category | Executed | Passed | Failed | Skipped |
|---------------|----------|--------|--------|---------|
| Auth pyramid | N | N | N | N |
| CRUD ops | N | N | N | N |
| Status codes | N | N | N | N |
| Spec validation | N | N | N | N |
| Boundary tests | N | N | N | N |
| qa-testcases.md | N | N | N | N |

## Verdict

**PASS** — All endpoints conform to spec, auth is enforced, edge cases handled.
or
**FAIL** — N issues found. See Issues Found above.
```

---

## Common Mistakes

- Running tests against a stale/stopped server (verify connectivity first)
- Skipping the "no auth" test (assumes auth is enforced — verify it)
- Not recording the actual response body (makes debugging impossible later)
- Testing only happy paths (the auth pyramid and edge cases catch real bugs)
- Forgetting to compare response structure against spec (drift accumulates silently)
- Using hardcoded IDs that no longer exist (create fresh test data in step 3)
- Not cleaning up test data after the walkthrough (leaves garbage in the database)
