---
name: "Corgi: Apply"
description: Apply a CorgiSpec change through all Task Groups with per-group commits
category: Workflow
tags: [workflow, apply, run-contract]
---

`/corgi:apply` is the sole user-facing implementation entry for the **corgispec-apply** workflow. Pass the optional change name and current session identity through unchanged. Use hook-driven mode unless the user explicitly selects self-driven mode. The skill uses the internal Run Contract v2 loop engine, and every approved Task Group must receive its own acknowledged commit before apply advances.

Never write `.corgi/loop/**`, `state.json`, `verify.json`, or `review.json` directly; every canonical mutation must be performed by `corgispec loop`.
