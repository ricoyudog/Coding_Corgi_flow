# Unified Router Workflow Design

**Date:** 2026-04-21

## Goal

Define one stable workflow architecture for `propose`, `apply`, and `review` that keeps command wrappers shallow, separates core work from tracker synchronization, preserves explicit human decision points, and reduces drift between GitLab and GitHub flows.

## Scope

This design covers workflow shape, phase boundaries, handoff rules, failure isolation, and refactor order.

This design does **not** propose a generic workflow engine, new infrastructure, or a full rewrite of the existing command-wrapper plus platform-skill structure.

## Context

Based on the current repository:

- `propose` is already close to a shallow router, with a DAG shaped like `proposal -> {spec, design} -> tasks`.
- `apply` wrappers are already shallow routers, but platform skills still mix execution, summary generation, tracker sync, and verification.
- GitLab `review` is partially decomposed into worktree discovery, quality checks, review decisions, and repair flow.
- GitHub `review` is still comparatively monolithic.
- Tracking metadata currently drifts between what `propose` writes and what `apply` reads.
- The repo already contains a stronger split in the GitLab issue-phase flow: development, finishing/closeout, reviewing, and merging.

## Design Principles

1. Keep the existing **command wrapper -> platform skill** architecture.
2. Make **repo-local state authoritative**; tracker state mirrors it.
3. Split **core work** from **tracker mutation**.
4. Require explicit human gates for promotion decisions.
5. Make side-effect phases replayable without rerunning core work.
6. Fix boundary drift before introducing broader abstractions.

## Shared Phase Contract

All three workflows use the same phase vocabulary:

### 1. Discover

Purpose: resolve target, context, worktree, prior outputs, and current tracker state.

- **Reads:** config, schema, worktree state, canonical local metadata, prior outputs, tracker state
- **Writes:** nothing persistent
- **Must not do:** generate new substantive outputs or change workflow state

### 2. Develop

Purpose: produce the primary local outputs for the current workflow.

- **Reads:** canonical inputs from `discover`
- **Writes:** primary local outputs only
- **Must not do:** mutate tracker state or infer approval

### 3. Closeout

Purpose: package results, update canonical handoff state, and mirror status to the tracker.

- **Reads:** primary outputs plus current tracker state
- **Writes:** canonical handoff/status record, tracker comments/links/labels/status mirrors
- **Must not do:** create new substantive work or reinterpret workflow intent

### 4. Review

Purpose: collect evidence, run checks, and prepare a decision packet.

- **Reads:** outputs, evidence, closeout state, tracker context if needed
- **Writes:** findings and a decision packet only
- **Must not do:** promote workflow state by itself

### 5. Advance / Repair

Purpose: apply an explicit human decision.

- **Reads:** decision packet plus explicit user choice
- **Writes:** approved transitions only, such as apply-ready, accepted, back-to-repair, merge-ready, closed, or archived
- **Must not do:** guess human intent from prior comments, labels, or passing checks

## Workflow Mapping

### Propose

- **Discover:** resolve config, schema, worktree, existing change state, existing tracker state, and source context
- **Develop:** generate `proposal -> {spec, design} -> tasks`
- **Closeout:** write canonical handoff/status state and create or update tracker mirrors
- **Review:** present the proposal/spec/tasks package for human review
- **Advance:** mark the package apply-ready only after approval

### Apply

- **Discover:** resolve worktree, change, target task group, canonical handoff state, and tracker references
- **Develop:** execute one task group and produce local evidence
- **Closeout:** write execution summary, update canonical status, and sync child/parent tracker state
- **Review:** prepare a review packet for that task group
- **Advance / Repair:** move into review or return to repair based on explicit decision

### Review

- **Discover:** resolve target group, worktree, canonical state, tracker context, and prior evidence
- **Review:** run checks, gather findings, and prepare a decision packet
- **Advance:** apply human approval, rejection, or discussion outcome to tracker and canonical state
- **Repair:** on rejection, generate repair-ready follow-up state without rerunning evidence collection unless needed

## Canonical Handoff / Status Record

The design requires one canonical local handoff/status record per tracked workflow subject.

This record is the source of truth between phases. It must carry enough information for the next phase to resume without reconstructing meaning from tracker comments or labels.

At minimum, it must identify:

- stable target identity
- current workflow phase
- primary output locations or references
- tracker references
- pending or resolved decision state
- last successful closeout/sync point

This design does not require a new service. It only requires one normalized local contract that `propose` writes and `apply` / `review` consume.

## Authority and Invariants

1. **Local canonical state is authoritative.** GitLab or GitHub state mirrors local state and must not replace it.
2. **Later phases resume from persisted outputs.** No phase may depend on scraping tracker comments or labels to reconstruct core outputs.
3. **Closeout is replayable.** If tracker sync fails after local work succeeds, rerun `closeout`, not `develop`.
4. **Advance is decision-driven.** No state promotion without an explicit user choice.
5. **Review does not mutate progression by itself.** Checks may recommend, but they do not approve.

## Human Gates

The following transitions require explicit human confirmation:

- proposal package -> apply-ready
- review packet -> accept vs reject vs discuss
- merge / close / archive transitions

Mirror-only sync does not require a new human gate, but it also must not invent one.

## Failure Isolation

The architecture is designed so that failures stop inside the smallest possible phase.

### If `develop` succeeds and `closeout` fails

Primary outputs remain valid. Retry `closeout` only.

### If `review` succeeds and `advance` is not approved

Evidence remains valid. Wait for human choice without changing progression state.

### If tracker APIs fail

Canonical local state remains usable. Tracker sync is delayed, not treated as core output loss.

### If tracker and local state disagree

Local canonical state wins. Closeout replays the tracker mirror.

## Refactor Blueprint

### Keep

- shallow command wrappers as platform routers
- current `propose` DAG for `proposal -> {spec, design} -> tasks`
- GitLab review decomposition shape as the baseline review skeleton

### Split

#### Apply

Split platform apply skills into:

- **core executor** for one task group
- **tracker-sync finalizer** for summary and child/parent issue updates
- **review packet handoff** for the next phase

#### Review

Split review into:

- **evidence collector**
- **decision gate**
- **mutation executor**
- **repair handler**

#### Propose

Keep the current artifact DAG, but end it in `closeout` instead of treating tracker creation as part of the primary output itself.

### Align

- GitHub review must align to the same phase contract already visible in GitLab review.
- Tracker schema must be normalized so that `propose` and `apply` agree on the same local metadata contract.

## Minimum Viable Refactor Order

### 1. Normalize tracker schema

Fix the `propose` writer / `apply` reader boundary first. This removes the most dangerous current drift.

### 2. Split apply into `develop` and `closeout`

This creates immediate stability gains because execution can succeed independently from tracker synchronization.

### 3. Align GitHub review to the GitLab review skeleton

Bring GitHub review to the same phase model: discover, review, advance/repair.

### 4. Upgrade propose into a complete phase-based router

Do this last, because propose is already closest to the target shape.

## Out of Scope

- a generic workflow engine
- replacing command wrappers with a new orchestration layer
- collapsing human gates into automation
- hiding real GitHub/GitLab platform differences behind premature abstraction

## Why This Design

This design reuses the strongest pattern already proven in the repo: the GitLab split between development, closeout, review, and merge. It fixes the most dangerous boundary first, preserves explicit human control, and improves retry behavior without forcing a framework rewrite.
