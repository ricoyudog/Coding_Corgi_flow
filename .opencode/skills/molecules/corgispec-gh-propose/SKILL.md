---
name: corgispec-gh-propose
description: Compatibility entry for a GitHub-backed RFC-first proposal. Use only when an older command routes here; delegate the full provider-neutral workflow to corgispec-propose because the CLI now owns the single Issue and tracker reconciliation.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# GitHub Propose Compatibility

Follow **corgispec-propose** without adding provider-specific behavior.

- Pass the accepted `RFC/Slice` or maintenance source unchanged.
- Let `corgispec propose` create or recover the one GitHub Issue by its stable marker.
- Never invoke `gh` directly, create Task Group Issues, edit tracker sidecars, or replace Issue content manually.
- Complete only OpenSpec planning artifacts and `corgi/traceability.yaml` through authoritative CLI paths.
- Use ready only as a diagnostic, then rerun the exact source command with `--finalize --json`; only CLI finalize may write the managed dashboard and move the Issue to todo.

If CLI output lacks the RFC/source/traceability/tracker contract, stop and request a CLI upgrade rather than falling back to the v3 GitHub workflow.
