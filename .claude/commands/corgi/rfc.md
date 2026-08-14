---
name: "Corgi: RFC"
description: Create, validate, inspect, renumber, or explicitly accept a human-authored RFC
category: Workflow
tags: [workflow, rfc, governance]
---

Follow **corgispec-rfc** and pass all input to `corgispec rfc`.

- `new <slug> [--amends RFC-ID]` creates an isolated governance worktree.
- `validate <RFC-ID>` and `status [RFC-ID]` are safe inspection commands.
- `renumber <draft-RFC-ID> --next` resolves a draft number collision.
- `accept <RFC-ID> --approver <human-id>` is human-only and interactive; an Agent must stop and let the user run it.

Never create an Issue during RFC governance. After human acceptance, commit and merge the RFC before Propose.
