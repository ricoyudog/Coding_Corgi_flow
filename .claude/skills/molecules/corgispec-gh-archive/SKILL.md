---
name: corgispec-gh-archive
description: Compatibility entry for GitHub-backed RFC-first Archive. Use only when an older wrapper routes here; delegate to corgispec-archive-change because the CLI owns evidence, durable closeout, the single Issue, and retry recovery.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# GitHub Archive Compatibility

Follow **corgispec-archive-change** without provider-specific behavior.

- Require `ready_for_archive` and every canonical evidence gate.
- Let `corgispec archive --local` materialize evidence and perform the only archive-derived delivery/Wiki/Memory write; use `corgispec-memory-extract` only read-only.
- Never invoke `gh`, edit dashboard markers, rebuild progress, or create Task Group Issues.
- Keep the worktree when local or tracker closeout is incomplete, then resume the same archive intent.

Stop and request a CLI upgrade if the v3 archive intent, evidence bindings, or single Issue contract is absent.
