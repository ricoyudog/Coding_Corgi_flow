---
name: corgispec-qa-ui
description: UI walkthrough — real user path verification with screenshots, component state checks, keyboard navigation, and cross-browser testing
license: MIT
compatibility: Requires a running application with browser access. Works with Playwright MCP or manual browser.
metadata:
  author: corgispec
  version: "1.0"
  generatedBy: "1.0.0"
---

Verify UI quality by walking real user paths, checking component states, and capturing evidence.

## Overview

This skill guides a systematic UI walkthrough that verifies the application works correctly from a real user's perspective. It covers:
- Full user path walkthroughs (enter → interact → observe → exit)
- Component state verification (loading, empty, error, edge cases)
- Screenshot capture as evidence (minimum 3)
- Error path testing
- Responsive boundary checks
- Keyboard navigation verification
- Cross-browser validation

## When to Use

- After implementing a UI feature, before marking it complete
- During `/corgi-review` when UI verification is required
- When `qa-testcases.md` contains UI walkthrough test cases
- Standalone QA pass on any page or flow

Do not use for API-only changes, backend logic, or pure data validation.

## Preconditions

- [ ] Application is running and accessible in a browser
- [ ] Target pages/flows are identified
- [ ] Screenshot capture is available (Playwright MCP or manual)

## Steps

### 1. Read test cases (if available)

Check for `qa-testcases.md` in the change directory:

```
openspec/changes/<change-name>/qa-testcases.md
```

If it exists, read and use its UI test cases as the walkthrough guide. Each test case should map to one or more steps below. If it does not exist, derive test cases from the feature's specs and tasks.

### 2. Define the user path

Identify the complete user journey for the feature under test:

1. **Enter** — How does the user arrive at this page/feature? (URL, navigation, redirect)
2. **Interact** — What actions does the user take? (clicks, form fills, selections)
3. **Observe** — What feedback does the user see? (success states, transitions, data updates)
4. **Exit** — How does the user leave? (navigation, completion, back button)

Document the path before executing it.

### 3. Walk the happy path

Execute the user path end-to-end with valid inputs:

1. Navigate to the entry point
2. Perform each interaction step
3. Verify each expected observation
4. **Capture screenshot** after key state transitions (minimum 1 here)
5. Confirm the exit state is correct

### 4. Verify component states

For each significant UI component in the flow, verify these states:

| State | What to check |
|-------|--------------|
| **Loading** | Spinner/skeleton shown, no layout shift on resolve |
| **Empty** | Empty state message displayed, no broken layout |
| **Error** | Error message shown, recovery action available |
| **Edge** | Long text truncation, maximum items, boundary values |

**Capture screenshot** of at least one non-happy state (minimum 1 here).

### 5. Test error paths

Trigger realistic error conditions:

- Submit forms with invalid data — verify inline validation
- Simulate network failure (if possible) — verify error messaging
- Attempt unauthorized actions — verify graceful handling
- Navigate to invalid routes — verify 404/fallback behavior

Document each error path tested and its result.

### 6. Check responsive boundaries

Test at these viewport breakpoints (minimum):

| Breakpoint | Width | What to verify |
|-----------|-------|---------------|
| Mobile | 375px | Layout stacks, touch targets ≥44px, no horizontal scroll |
| Tablet | 768px | Grid adjusts, navigation adapts |
| Desktop | 1280px | Full layout, no excessive whitespace |

**Capture screenshot** at mobile or tablet width (minimum 1 here).

### 7. Verify keyboard navigation

Without using a mouse:

1. Tab through all interactive elements — verify visible focus indicator
2. Enter/Space activates buttons and links
3. Escape closes modals/dropdowns
4. Arrow keys navigate within lists/menus (if applicable)
5. No keyboard traps (user can always Tab away)

Document any keyboard navigation failures.

### 8. Cross-browser spot check

If the project supports multiple browsers, verify the happy path in at least one additional browser beyond the primary:

- Chrome (primary)
- Firefox or Safari (secondary)

Note any rendering differences or functional issues.

## Reporting Format

After completing the walkthrough, produce a report in this structure:

```markdown
## UI Walkthrough Report

**Feature:** <feature name>
**Date:** <date>
**Browser:** <primary browser and version>

### User Path
- Entry: <how user arrives>
- Steps: <numbered interaction steps>
- Exit: <how user leaves>

### Results

| Check | Status | Notes |
|-------|--------|-------|
| Happy path | PASS/FAIL | |
| Loading state | PASS/FAIL/SKIP | |
| Empty state | PASS/FAIL/SKIP | |
| Error state | PASS/FAIL/SKIP | |
| Edge cases | PASS/FAIL/SKIP | |
| Error paths | PASS/FAIL | |
| Responsive (mobile) | PASS/FAIL | |
| Responsive (tablet) | PASS/FAIL | |
| Keyboard navigation | PASS/FAIL | |
| Cross-browser | PASS/FAIL/SKIP | |

### Screenshots
1. <description> — <path or inline>
2. <description> — <path or inline>
3. <description> — <path or inline>

### Issues Found
- [ ] <issue description> — severity: high/medium/low
- [ ] <issue description> — severity: high/medium/low

### Verdict
PASS / FAIL (with blockers listed)
```

### 9. Record results

- If part of a `/corgi-review`, include the report in the review evidence
- If standalone, save to `qa-ui-report.md` in the change directory
- Any blocking issues become tasks or bug reports

## Tips

- Take screenshots at moments of state change, not static pages
- Test with realistic data volumes (not just 1-2 items)
- Check that loading states actually appear (throttle network if needed)
- Verify error messages are user-friendly, not stack traces
- Mobile testing: check that modals/popovers don't overflow viewport
