---
name: corgispec-qa-exploratory
description: SBTM-style exploratory testing session — charter-driven, tour-guided, time-boxed human investigation
license: MIT
compatibility: Universal. Works with any codebase or platform.
metadata:
  author: corgispec
  version: "1.0.0"
  generatedBy: "1.0.0"
---

# Exploratory Testing — SBTM Session

## Overview

Session-Based Test Management (SBTM), developed by James Bach and Michael Bolton, structures exploratory testing into accountable, time-boxed sessions. Each session has a charter (mission), uses one or more Test Tours to guide exploration, and produces a debrief report with findings and coverage notes.

Exploratory testing is simultaneous learning, test design, and test execution. It is not ad-hoc — it is disciplined investigation guided by heuristics and documented in real time.

## Session Structure (45–75 minutes)

| Phase | Duration | Activity |
|-------|----------|----------|
| Charter | 5 min | Define mission, scope, and success criteria |
| Explore | 30–55 min | Systematic investigation using selected tours |
| Note | Continuous | Record observations, findings, questions as they occur |
| Debrief | 10–15 min | Summarize coverage, findings, and next steps |

## The 12 Test Tours

Select 2–4 tours per session based on the change context.

| # | Tour | Description | When to Recommend |
|---|------|-------------|-------------------|
| 1 | **Business District** | Exercise key business flows end-to-end | All changes — validates core value paths |
| 2 | **Money** | Probe revenue-related features (payments, subscriptions, pricing) | Payment/billing changes |
| 3 | **Bad Neighborhood** | Focus on historically buggy areas | Historically buggy modules |
| 4 | **Historical** | Revisit past bug clusters and regressions | Legacy code changes |
| 5 | **FedEx** | Track data as it flows through the entire system | Full-stack or integration changes |
| 6 | **Rained-Out** | Explore failure modes, error handling, edge cases | All changes — validates resilience |
| 7 | **Obsessive-Compulsive** | Repeat operations rapidly, vary sequences | Loops, batch processing, concurrency |
| 8 | **Garbage Collector** | Test cleanup, boundaries, limits, resource exhaustion | CRUD operations, resource management |
| 9 | **Intellectual** | Challenge complex logic with tricky inputs and edge cases | Algorithms, business rules, calculations |
| 10 | **Couch Potato** | Take the minimal effort path, use defaults only | UX flows, onboarding, happy paths |
| 11 | **Landmark** | Navigate via key features and integration points | New features, UI navigation |
| 12 | **Museum** | Examine help docs, examples, error messages, tooltips | SDK, library, or API documentation |

## Steps

### 1. Read the Charter

If called from a molecule (e.g., `corgispec-qa-session`), read the charter provided. Otherwise, define your own charter:

- **Mission**: What are you investigating?
- **Scope**: Which areas/features are in-bounds?
- **Out of scope**: What to explicitly avoid this session?

### 2. Select Tours (2–4)

Choose **2 to 4 tours** from the table above based on the change context. Different scenarios call for different Tour strategies:

- Bug fix → apply **Bad Neighborhood Tour** + **Historical Tour** + **Rained-Out Tour**
- New feature → apply **Landmark Tour** + **Business District Tour** + **Couch Potato Tour**
- Refactor → apply **FedEx Tour** + **Obsessive-Compulsive Tour** + **Intellectual Tour**
- Payment change → apply **Money Tour** + **Rained-Out Tour** + **Business District Tour**
- Full-stack change → apply **FedEx Tour** + **Business District Tour** + **Rained-Out Tour**
- CRUD/management → apply **Garbage Collector Tour** + **Obsessive-Compulsive Tour** + **Museum Tour**

### 3. Explore Systematically

For each selected tour:

1. State which tour you are executing
2. Identify specific test ideas within that tour's lens
3. Execute tests, varying inputs and sequences
4. Note observations immediately — do not defer

### 4. Record Findings with Severity

Classify each finding:

| Severity | Definition |
|----------|-----------|
| **Blocker** | Prevents core functionality, no workaround |
| **Critical** | Major feature broken, workaround exists but unacceptable |
| **Major** | Significant issue affecting user experience |
| **Minor** | Small defect, cosmetic, or low-impact behavioral issue |
| **Trivial** | Nitpick, suggestion, or style concern |

### 5. Assemble Debrief

Compile the session report (see Reporting format below).

## Reading qa-testcases.md

If the change directory contains `qa-testcases.md`, read it before starting exploration. Use the documented test cases as a baseline — your exploratory session extends beyond them, finding what structured cases miss.

## Reporting Format

```markdown
## Exploratory Test Session Report

- **Session ID**: ET-{YYYY-MM-DD}-{NNN}
- **Charter**: {mission statement}
- **Duration**: {actual minutes} / {planned minutes}
- **Tours Used**: {list of tours selected}

### Coverage

{Areas explored, features touched, paths taken}

### Findings

| # | Severity | Tour | Finding | Evidence |
|---|----------|------|---------|----------|
| 1 | major | FedEx | Data lost between step X and Y | screenshot/log ref |

### Oddities

{Things that aren't bugs but seem wrong, surprising, or worth investigating later}

### Debrief

- **Coverage confidence**: {low/medium/high} — {why}
- **Areas not reached**: {what was skipped and why}
- **Recommendations**: {follow-up sessions, automated tests to add, areas needing deeper review}

### Evidence

{Links to screenshots, logs, recordings, or reproduction steps}
```

## When to Use

- After code changes are applied and you need human-style investigation
- When automated tests pass but confidence in quality is low
- For areas with no existing test coverage
- When a molecule skill requests exploratory QA

## When NOT to Use

- For writing automated test scripts (use TDD skill instead)
- For test planning without execution (use qa-plan skill instead)
- As a replacement for structured regression testing
