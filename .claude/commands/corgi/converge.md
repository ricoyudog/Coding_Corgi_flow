---
name: "Corgi: Converge"
description: Evaluate evidence-backed implementation convergence
category: Workflow
tags: [workflow, converge, evidence]
---

Invoke the **corgispec-converge** skill for `/corgi:converge`. Pass the optional change name through unchanged. Keep the initial evaluation read-only and request explicit approval before confirming any new Task Group. If confirmation is interrupted, rerun with that same token so the CLI can recover its durable intent; never repair planning or loop state directly, and stop on contract errors.
