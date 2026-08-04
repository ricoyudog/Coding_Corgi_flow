---
name: "Corgi: Loop"
description: Start or resume a canonical CorgiSpec Run Contract v2
category: Workflow
tags: [workflow, loop, run-contract]
---

`/corgi:loop` is the explicit user entry point for the **corgispec-loop** workflow. Pass the optional change name and current session identity through unchanged. Use hook-driven mode unless the user explicitly selects self-driven mode.

Never write `.corgi/loop/**`, `state.json`, `verify.json`, or `review.json` directly; every canonical mutation must be performed by `corgispec loop`.
