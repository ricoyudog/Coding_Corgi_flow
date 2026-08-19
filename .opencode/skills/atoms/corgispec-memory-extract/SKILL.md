---
name: corgispec-memory-extract
description: Read-only preparation and verification for CorgiSpec v4 Archive knowledge closeout. Archive --local is the sole writer of delivery and promoted Wiki/Memory provenance.
---

# Verify Archive Knowledge Closeout

Use this atom only as a read-only preflight before `corgispec archive --local`, or to verify the CLI result afterwards. It is not a second archive state machine: never create a delivery page, update a managed Wiki region, promote knowledge, edit the Session Bridge, or create a commit.

`corgispec archive --local` is the sole writer for archive-derived `wiki/deliveries/`, `wiki/hot.md`, `wiki/architecture/`, `wiki/patterns/`, `memory/MEMORY.md`, `memory/pitfalls.md`, and the archive closeout bridge checkpoint. Never infer success from task checkboxes or prose.

## Required Inputs

Require CLI-resolved values for:

- RFC ID, accepted revision/digest, Slice ID, Change, and single Issue binding;
- final HEAD and planning revision;
- per-AC automated/human evidence requirements and results;
- human review decision and Human QA result or valid skip;
- delivery binding revision used for CAS closeout.

For read-only preparation, also require the active Change root and the evidence inputs that `--local` will materialize. For post-`--local` verification, require the returned archived Change root and evidence manifest instead.

If an input required for the selected mode is missing, the Run Contract is not in archive closeout, or source/traceability/RFC digests drifted, report the blocker and stop. Do not write a workaround.

## Read-Only Preparation

Before `--local`, inspect the immutable inputs and report the candidate content that the CLI must be able to materialize:

1. The immutable delivery page contract: outcome, delivered boundary, AC evidence, Task Group commits/final HEAD, Review/QA result, promoted knowledge links, RFC/archived Change/evidence/Issue sources, and the delivery binding digest.
2. Evidence-backed promotion candidates for current architecture, reusable patterns, verified pitfalls, or permanent constraints. Each candidate must cite final source and accepted evidence; uncertain items remain in Research or the bridge Promotion Queue.
3. The required managed-region outcomes: delivery index entry, `hot.md` Active Deliveries → Recently Shipped transition, and archive bridge pointer/next action.

This report is advisory input to the CLI, not an authorization to write files. Never create `wiki/sessions/` or append to `wiki/log.md`.

## Verify CLI Materialization

After `corgispec archive --local` succeeds, read its returned archived root, evidence manifest, delivery page, promoted knowledge, bridge result, and closeout commit. Verify that:

1. `wiki/deliveries/<RFC-ID>-<Slice-ID>.md` is immutable for the returned delivery binding and evidence digest.
2. Managed `wiki/deliveries/_index.md` and `wiki/hot.md` regions match the returned delivery result.
3. Any CLI-promoted architecture, pattern, pitfall, or MEMORY entry cites the final source and accepted evidence.
4. The bridge records the archived page and final HEAD while preserving unrelated blockers and Promotion Queue items.
5. The live lifecycle phase still comes from `.corgi/loop`, not the bridge.

If a file is missing or inconsistent, fail closed and report the exact mismatch for archive recovery. Do not repair it manually after the closeout commit is sealed.

## Result

Return a read-only preparation or verification report: the CLI inputs inspected, delivery page/result paths, verified promoted knowledge with evidence sources, deliberately unpromoted candidates, and any blocker. Do not leave a dirty worktree.
