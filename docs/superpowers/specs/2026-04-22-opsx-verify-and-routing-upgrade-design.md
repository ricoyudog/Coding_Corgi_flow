# OPSX Verify Stage and Routing Accuracy Upgrade Design

**Date:** 2026-04-22

## Goal

Introduce a first-class `verify` stage into the OPSX workflow and improve routing accuracy without replacing the existing command-wrapper plus platform-skill architecture.

The target shape is:

`propose -> apply -> verify -> review -> advance/repair -> archive`

This design also defines how to borrow the strongest parts of `agent-skills`—explicit routing discipline, preflight classification, and failure-to-route rules—without changing OPSX into a free-form intent router.

## Scope

This design covers:

- separating evidence collection from human review decisions
- introducing `/opsx-verify` and `/opsx:verify`
- defining local canonical `verify` state and report outputs
- improving command routing accuracy with explicit routing rules
- formalizing browser-aware verification for UI-facing work
- phasing rollout from local-only verify to optional tracker-visible verify

This design does **not** cover:

- replacing shallow command wrappers with a generic orchestration engine
- collapsing review approval into automation
- introducing a mandatory tracker-visible `verify` state in phase 1
- building a full Chrome DevTools-style runtime inspection system in the first iteration

## Context

Current OPSX workflow documentation and skill surfaces already expose the key seam this design builds on:

- `apply` ends after implementation, closeout, tracker sync, and review handoff
- `review` currently mixes evidence gathering, quality checks, human decision prompting, and state mutation
- GitLab review is already partly decomposed into evidence, decisions, and repair references
- GitHub review is still more monolithic
- UI verification already exists in scattered form via Playwright screenshot capture, screenshot evidence requirements, and Playwright planning templates

The repository's existing design direction already favors:

- shallow wrappers
- authoritative local state
- explicit human gates
- replayable side-effect phases

This proposal extends that direction instead of replacing it.

## Problem Statement

Today, OPSX review does too much.

It acts as both:

1. the place where evidence is collected and quality checks are run, and
2. the place where a human is asked to approve, reject, or discuss the result and where workflow state is mutated

This creates three concrete problems:

1. **Boundary blur** — evidence collection and decision-making are coupled in one command surface.
2. **Routing ambiguity** — wrappers and platform skills must infer too much from partially prepared state.
3. **UI verification fragmentation** — Playwright and screenshot evidence exist, but only as embedded review or planning instructions instead of a first-class phase.

## Design Summary

The recommended design is a staged architecture:

- **Target architecture:** `apply -> verify -> review -> advance/repair`
- **Phase 1 rollout:** local-only `verify` phase, no tracker-visible `verify` label required
- **Phase 2 option:** add tracker-visible `verify` state if the local-only phase proves stable and valuable

This design intentionally separates:

- **core work** from **quality verification**
- **quality verification** from **human decision**
- **human decision** from **tracker mutation**

## Updated Phase Contract

### Apply

Purpose: execute one task group and close it out locally and in tracker mirrors.

- **Owns:** discover, develop, closeout
- **Produces:** task-group outputs, closeout summary, canonical handoff state, tracker mirror update
- **Must not do:** perform final quality verification or ask for approve/reject/discuss
- **Ends with:** verify handoff, not review handoff

### Verify

Purpose: gather evidence, run checks, and produce a verify report.

- **Owns:** evidence collection, build/test/lint validation, UI/browser verification when required, verify report generation
- **Reads:** closeout state, changed files, evidence references, tracker context if needed
- **Writes:** verify report, verify status in canonical local state, evidence references
- **Must not do:** ask for approval, reject the work as a workflow decision, or mutate progression state beyond verify status

### Review

Purpose: consume the verify report and run the explicit human decision gate.

- **Owns:** approve / reject / discuss prompt, review note/report consumption, advance/repair transition
- **Reads:** verify report, canonical local state, review comments, acceptance discussion
- **Writes:** approved transitions only, plus any repair-ready state on rejection
- **Must not do:** own primary evidence gathering as a normal path

### Advance / Repair

Purpose: apply the explicit human decision.

- **Approve:** move forward toward merge/archive readiness
- **Reject:** create or point to repair-ready follow-up state
- **Discuss:** remain review-blocked pending more input

## Routing Accuracy Upgrade

OPSX should borrow routing discipline from `agent-skills`, but not its intent-first architecture.

The key borrow is **decision discipline**, not free-form command selection.

### 1. Router Contract

Add one repo-level routing contract that defines, for each command surface:

- valid entry conditions
- required prior artifacts/state
- forbidden conditions
- expected outputs
- failure conditions that must stop the flow instead of guessing

This becomes the authoritative routing reference across wrappers and platform skills.

### 2. Preflight Classification

Before dispatch, each wrapper should classify the current request against a shared checklist:

- target change / task group identity
- current canonical local phase
- tracker state compatibility
- required handoff artifact presence
- whether the change is UI-facing and therefore browser evidence-sensitive

This classification is read-only. It should not perform substantive work.

### 3. Negative Routing Rules

Add explicit stop conditions so the system fails clearly instead of improvising.

Examples:

- `review` must fail if no verify report exists
- `verify` must fail if apply closeout is incomplete
- `review` must fail if the target is still in active implementation state
- `verify` must fail UI-related work when required browser evidence is missing
- `review` must not silently collect missing core evidence except as a narrow recovery path

These rules are the highest-value routing upgrade because they reduce false progression.

## Browser-Aware Verification

This design separates **browser-aware verification** from **browser-debug tooling**.

### Phase 1: Browser-Aware Verify

In phase 1, `verify` gains first-class support for UI-facing validation using the patterns already present in the repo:

- Playwright screenshot capture
- UI evidence blocks
- screenshot artifact upload patterns
- Playwright sprint planning documents

When verify detects UI-facing changes, it should require browser evidence such as:

- key screenshots
- relevant Playwright run output
- minimal UI flow confirmation for changed surfaces
- any required artifact links in the verify report

### Phase 2: Browser-Debug Capability

In phase 2, OPSX may add a dedicated browser-debug or browser-verify capability inspired by `agent-skills/browser-testing-with-devtools`.

This later capability may include:

- console inspection
- network inspection
- runtime DOM/state checks
- richer browser debugging workflows

This is deliberately out of MVP scope because the repo currently has evidence patterns for Playwright and screenshots, but not an established DevTools-style inspection model.

## Canonical Local State Additions

Phase 1 should extend canonical local state with verify metadata.

Minimum additions:

```yaml
phase: verify
verify:
  status: pending | passed | failed | needs-input
  report_path: <path to verify report>
  ui_evidence_required: true | false
  ui_evidence_present: true | false
  last_verified_at: <timestamp>
```

This keeps repo-local state authoritative while allowing tracker mirrors to lag behind until a later upgrade.

## Tracker Strategy

### Phase 1 Recommendation: Local-Only Verify

The first implementation should **not** require a tracker-visible `verify` label/state.

Reasons:

- lower migration risk across GitLab and GitHub flows
- fewer changes to issue sync and review selection logic
- preserves current public workflow while improving internal correctness
- fits the repository's stated preference for authoritative local state

### Phase 2 Option: Tracker-Visible Verify

If phase 1 proves stable, phase 2 may add tracker-visible `verify`.

That would require updating:

- issue sync references and label transitions
- wrapper expectations
- README workflow text and diagrams
- review selection logic for both platforms

This should be treated as a deliberate second-stage migration, not bundled into the first delivery.

## Wrapper Responsibilities

Wrappers remain shallow.

### `/opsx-apply` / `/opsx:apply`

- preserve config and isolation checks
- dispatch by schema
- verify postconditions around one-group execution and closeout
- end with verify handoff expectations instead of review handoff expectations

### `/opsx-verify` / `/opsx:verify`

- preserve config and isolation checks
- dispatch by schema
- enforce verify preconditions
- verify postconditions such as: verify report exists, required evidence exists, UI evidence exists when required

### `/opsx-review` / `/opsx:review`

- preserve config and isolation checks
- require verify report existence before proceeding
- enforce explicit human decision gate
- verify postconditions around decision prompt and approved transition handling

## Browser Evidence Contract

For UI-facing work, verify should produce a consistent evidence packet.

Minimum expected contents:

- changed UI surfaces or routes covered
- command(s) used for browser verification
- screenshot references or artifact links
- pass/fail status for required UI checks
- notes on gaps, flaky behavior, or missing environment prerequisites

This contract should be reused by review and by any later browser-debug capability.

## Rollout Plan

### Phase 1 — Introduce Verify Locally

- add verify wrappers
- split evidence/checks out of review
- keep review as human gate + advance/repair
- add local canonical verify metadata
- add browser-aware verify for UI changes
- add router contract, preflight classification, and negative routing rules

### Phase 2 — Promote Verify Across Tracker Surfaces

- add optional tracker-visible verify label/state
- update sync logic and public docs
- align review consumer logic to start after verify instead of after apply

### Phase 3 — Expand Browser Debugging

- add richer browser-debug tooling if needed
- formalize console/network/runtime inspection flows
- keep this as a separate capability from basic browser-aware verify

## Acceptance Criteria

- OPSX workflow is documented as `apply -> verify -> review -> advance/repair`
- verify is explicitly evidence-only and review is explicitly decision-only
- wrappers remain shallow and schema-driven
- local canonical state includes verify metadata
- review fails clearly when verify prerequisites are missing
- UI-facing changes require browser evidence during verify
- GitLab and GitHub platform skills follow the same conceptual phase boundaries even where implementation details differ
- the design preserves explicit human control over progression decisions

## Non-Goals

- making review fully automatic
- introducing a generic workflow engine
- forcing tracker-visible verify in the first rollout
- bundling full browser-debug instrumentation into MVP

## Why This Design

This design takes the strongest verified patterns already present in the repository—closeout evidence, Playwright-backed UI review, screenshot artifacts, and explicit human gates—and reorganizes them into cleaner boundaries.

It also borrows the most useful part of `agent-skills`: not its global free-form intent routing, but its insistence on explicit applicability rules, lifecycle discipline, and refusal to proceed when prerequisites are missing.

The result is a workflow that is stricter, easier to reason about, and better aligned with the repository's existing architectural direction.
