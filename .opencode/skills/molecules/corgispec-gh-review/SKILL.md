---
name: corgispec-gh-review
description: Compatibility entry for GitHub-backed RFC-first human review. Use only when an older wrapper routes here; delegate to corgispec-review because Run Contract v3 and the CLI tracker adapter own the whole-change decision and single Issue.
---

# GitHub Review Compatibility

Follow **corgispec-review** without provider-specific behavior.

- Review the whole verified delivery, not an individual Task Group.
- Keep the final decision explicitly human-controlled.
- Submit it only through `corgispec review`.
- Never invoke `gh`, edit the Issue body/dashboard, or create repair Issues.

Stop and request a CLI upgrade if status lacks the Run Contract v3 contract, Verify binding, or single Issue binding.
