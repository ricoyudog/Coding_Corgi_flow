---
name: "Corgi: Ready"
description: Check deterministic and semantic readiness for an existing CorgiSpec change
category: Workflow
tags: [workflow, planning, readiness]
---

Assess an existing change without modifying files.

**Input**: Pass a change name, optional `--strict`, and optional `--store <id>`, for example `/corgi:ready add-auth --strict --store team`. If no name is given, resolve exactly one change from context; ask the user when discovery is ambiguous.

Follow the **corgispec-ready** skill and pass through the selected change, strictness, and store. Once a store is named, preserve the same `--store` on the first and every subsequent CLI call. Default to strict mode unless the user explicitly requests a diagnostic review.

Verify that the final report includes the `planningRevision`, unchanged deterministic checks, separate semantic findings, overall readiness, and an explicit statement that no files changed.
