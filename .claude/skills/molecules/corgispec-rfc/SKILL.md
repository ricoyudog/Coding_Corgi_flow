---
name: corgispec-rfc
description: Guide a human-authored CorgiSpec RFC through isolated draft creation, validation, explicit interactive approval, merge effectiveness, collision renumbering, and amendments. Use when defining Feature boundaries, Slices, AC evidence, or changing an accepted contract before Propose.
---

# Govern a Human-authored RFC

RFCs define Feature intent, boundary, Slices, and acceptance criteria. The human owns the normative text and approval; Agents may scaffold, research, edit at the human's direction, and validate, but must never manufacture approval.

## Create a Draft

Run from the integration worktree:

```bash
corgispec rfc new <semantic-slug>
```

For a contract change:

```bash
corgispec rfc new <semantic-slug> --amends <accepted-RFC-ID>
```

The CLI allocates `RFC-0001-semantic-slug`, creates an isolated governance worktree and branch, and scaffolds `rfc.md`, `rfc.yaml`, and `delivery.yaml`. Work only in the returned worktree.

## Author the Normative Document

The human-authored `rfc.md` must contain non-empty `## Goal`, `## Non-goals`, `## Boundary`, `## Slices`, and `## Risks` sections. Define each Slice and AC exactly:

```markdown
### S-01-semantic-slug: Slice title

- AC-001 [evidence: automated]: Observable acceptance statement
- AC-002 [evidence: human]: Real user-path acceptance statement
- AC-003 [evidence: both]: Acceptance requiring both evidence types
```

Each AC appears exactly once and belongs to one Slice. Remove every TODO/TBD/FIXME before validation. Do not edit `delivery.yaml` manually.

## Validate and Resolve Collisions

```bash
corgispec rfc validate <RFC-ID> --json
corgispec rfc status <RFC-ID> --json
```

If another merged draft took the same number, run only while the RFC remains draft:

```bash
corgispec rfc renumber <draft-RFC-ID> --next
```

Commit the completed draft and present its Goal, Non-goals, Boundary, Slices, AC/evidence matrix, risks, and validation result to the human.

## Human Approval and Effectiveness

Only the human may run in an interactive terminal:

```bash
corgispec rfc accept <RFC-ID> --approver <human-id>
```

An Agent must stop and wait; it must not invoke this command, supply terminal input, reuse an identity, or edit acceptance metadata. Acceptance records the exact `rfc.md` digest.

After acceptance, commit and merge the RFC branch into the configured integration branch. `accepted-local` is not effective. Propose is allowed only after `corgispec rfc status` reports effective and the accepted commit is an ancestor of the delivery worktree HEAD.

RFC acceptance does not create an Issue. Propose creates or recovers the single Slice Issue later.

## Accepted RFC Changes

Do not modify accepted Goal, Boundary, Slice membership, or AC text. Create an Amendment RFC instead. An Amendment follows the same human approval and merge process; an existing Change adopts it only through the dedicated CLI contract, which invalidates old Verify/Review/QA evidence.

If an Amendment introduces a new Slice, deliver it through a new Issue and Change rather than rebinding the old one.
