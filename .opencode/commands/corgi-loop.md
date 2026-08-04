---
description: Start or resume a canonical CorgiSpec Run Contract v2
---

`/corgi-loop` is the explicit user entry point for the **corgispec-loop** workflow. Pass the requested change, actor/session identity, and mode through unchanged.

All lifecycle state, events, attempt bundles, verification evidence, review findings, triage, commit acknowledgement, and finalization must go through `corgispec loop`. Never write `.corgi/loop/**` or either legacy platform loop directory directly.
