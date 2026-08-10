---
description: Apply a CorgiSpec change through all Task Groups with per-group commits
---

`/corgi-apply` is the sole user-facing implementation entry for the **corgispec-apply** workflow. Pass the requested change, actor/session identity, and mode through unchanged. The skill uses the internal Run Contract v2 loop engine, and every approved Task Group must receive its own acknowledged commit before apply advances.

All lifecycle state, events, attempt bundles, verification evidence, review findings, triage, commit acknowledgement, and finalization must go through `corgispec loop`. Never write `.corgi/loop/**` or either legacy platform loop directory directly.
