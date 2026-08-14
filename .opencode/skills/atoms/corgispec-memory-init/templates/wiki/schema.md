---
type: schema
updated: {{DATE}}
---

# Wiki Schema and Ownership

## Knowledge Boundaries

- `architecture/`: verified description of the current system; cite source paths and delivery evidence.
- `research/`: evidence, hypotheses, and investigations; never treated as current architecture automatically.
- `patterns/`: reusable approaches verified by at least one archived delivery.
- `decisions/`: ADRs inside an accepted RFC boundary; link the RFC and affected ACs.
- `guides/`: operational instructions whose commands or paths have been verified.
- `questions/`: human questions and source-cited answers.
- `deliveries/`: one immutable closeout summary per archived RFC Slice.
- `meta/`: explicitly generated health reports and indexes.

`wiki/sessions/` and `wiki/log.md` are legacy read-only locations. Preserve them during migration, but never create or append to them.

For an RFC Slice Archive, only `corgispec archive --local` writes archive-derived delivery entries and promoted provenance in managed `hot`, `architecture`, `patterns`, and Memory regions. Skills may report candidates or verify the sealed result, never edit it.

## Required Frontmatter

Every non-index page requires `type` and `updated`. Delivery pages also require `rfc`, `slice`, `change`, `status: archived`, and `archived`. Decision pages require `rfc` and `ac`. Question pages use `status: pending | answered | needs-deep-session`.

## Managed Regions

Only text between matching `<!-- corgi:managed:start NAME -->` and `<!-- corgi:managed:end NAME -->` markers is tool-managed. Preserve all human-authored text outside those markers.
