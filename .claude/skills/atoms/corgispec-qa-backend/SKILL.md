---
name: corgispec-qa-backend
description: Backend logic walkthrough — traces call chain from real entry points, verifies data integrity across layers
license: MIT
compatibility: Requires a backend codebase with identifiable entry points (routes, handlers, commands).
metadata:
  author: corgispec
  version: "1.0.0"
  generatedBy: "1.0.0"
---

Backend logic walkthrough for QA verification.

## Overview

This skill guides a structured walkthrough of backend logic by tracing the call chain from a real entry point (route handler, CLI command, event listener) down through service, repository, and data layers. It verifies data integrity, auth enforcement, and error handling at each layer.

## When to Use

- Verifying a new or modified backend feature works correctly end-to-end
- QA review of a pull request's backend changes
- Investigating whether auth, validation, and error paths are complete
- Confirming DB read/write operations match expected behavior

Do not use this skill for frontend-only changes, infrastructure/CI changes, or pure refactors with no behavioral change.

## Preconditions

- [ ] Target feature or endpoint is identified
- [ ] Codebase is accessible and readable
- [ ] `qa-testcases.md` exists in the change directory (if reporting results)

## Walkthrough Procedure

### 1. Identify the entry point

Find the root function for the feature under test:
- Route handler (e.g., `POST /api/users`)
- Event listener (e.g., `onOrderCreated`)
- CLI command handler
- Scheduled job entry

Record: **file path**, **function name**, **HTTP method + path** (if applicable).

### 2. Trace the call chain (3-layer depth)

Walk through exactly 3 layers from the entry point:

| Layer | Typical Role | What to Record |
|-------|-------------|----------------|
| L1 — Controller/Handler | Request parsing, input validation, auth check | Input shape, auth requirement, early returns |
| L2 — Service/Use-case | Business logic, orchestration | Transformations, conditional branches, side effects |
| L3 — Repository/Data | DB queries, external API calls | Query shape, write operations, return shape |

At each layer record:
- **Function signature** (params + return type)
- **Input values** that reach this layer (trace from caller)
- **Return values** passed back to caller
- **Side effects** (DB writes, events emitted, external calls)

### 3. Verify the happy path

Trace one successful request end-to-end:
1. Construct a valid input at L1
2. Follow the data through L2 transformations
3. Confirm L3 performs the expected DB write/read
4. Verify the response returned to the caller matches expected shape

Record: input → each layer's transformation → final output.

### 4. Verify one error path

Choose the most critical error scenario:
- Invalid input (400)
- Unauthorized access (401/403)
- Resource not found (404)
- Business rule violation (409/422)

Trace the error from point of detection back to the response:
1. Where is the error detected? (which layer, which condition)
2. How does it propagate? (thrown exception, error return, early return)
3. What response does the caller receive? (status code, error body)

### 5. Auth pyramid verification

Check auth enforcement at each level of the pyramid:

| Level | Check | Pass Criteria |
|-------|-------|---------------|
| Unauthenticated | No token/session | Returns 401 |
| Authenticated | Valid token, wrong role | Returns 403 (if role-gated) |
| Authorized | Valid token, correct role, wrong resource | Returns 403 or 404 |
| Admin | Admin token | Full access confirmed |

For each level, confirm the check happens BEFORE any business logic or DB access.

### 6. DB write/read verification

For every DB operation found in L3:
- **Writes**: Confirm the written shape matches the schema. Confirm no partial writes on error (transaction or rollback).
- **Reads**: Confirm query filters are correct (no over-fetching, no missing tenant/owner scoping).
- **Ordering**: If the operation is read-after-write in the same flow, confirm consistency.

## Reading qa-testcases.md

If `qa-testcases.md` exists in the change directory, read it before starting the walkthrough. It contains pre-defined test scenarios that MUST be covered:

```
## Format of qa-testcases.md

### <Feature Name>

| ID | Scenario | Input | Expected | Priority |
|----|----------|-------|----------|----------|
| TC-001 | ... | ... | ... | P0 |
```

Map each test case to a walkthrough path. After completing the walkthrough, report coverage:
- Which test cases were verified via trace
- Which test cases could NOT be verified (and why)

## Reporting Format

After completing the walkthrough, produce a summary in this structure:

```markdown
## QA Backend Walkthrough: <Feature Name>

### Entry Point
- **Path**: `<file>:<line>`
- **Function**: `<name>`
- **Route**: `<METHOD /path>` (if applicable)

### Call Chain
| Layer | File | Function | Input | Output | Side Effects |
|-------|------|----------|-------|--------|--------------|
| L1 | ... | ... | ... | ... | ... |
| L2 | ... | ... | ... | ... | ... |
| L3 | ... | ... | ... | ... | ... |

### Happy Path
- Input: ...
- Flow: L1 → L2 → L3
- DB Operation: ...
- Response: ...
- **Status: PASS / FAIL**

### Error Path (<which error>)
- Trigger: ...
- Detection point: L<n>, condition: ...
- Propagation: ...
- Response: status=<code>, body=...
- **Status: PASS / FAIL**

### Auth Pyramid
| Level | Tested | Result |
|-------|--------|--------|
| Unauthenticated | Yes/No | PASS/FAIL |
| Authenticated | Yes/No | PASS/FAIL |
| Authorized | Yes/No | PASS/FAIL |
| Admin | Yes/No | PASS/FAIL |

### DB Integrity
| Operation | Table | Verified | Notes |
|-----------|-------|----------|-------|
| INSERT | ... | Yes/No | ... |
| SELECT | ... | Yes/No | ... |

### Test Case Coverage (from qa-testcases.md)
| ID | Covered | Method | Notes |
|----|---------|--------|-------|
| TC-001 | Yes/No | Trace/Manual | ... |

### Verdict
- [ ] Happy path verified
- [ ] Error path verified
- [ ] Auth pyramid complete
- [ ] DB integrity confirmed
- **Overall: PASS / FAIL / PARTIAL**
```

## Tips

- If the codebase uses middleware for auth, trace through the middleware FIRST before entering the handler.
- For microservices, treat inter-service calls as an L3 boundary (record request/response shape).
- If you cannot reach 3 layers (e.g., thin handler directly calling DB), note the collapsed layers and verify what exists.
- Prefer reading actual code over documentation — docs may be stale.
