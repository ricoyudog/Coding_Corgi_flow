---
description: Evaluate implementation convergence and append one confirmed successor Task Group when needed
---

Run the **corgispec-converge** skill for the requested change. Pass all user input through unchanged. The first evaluation must be read-only; require explicit approval before using the CLI confirmation token. If confirmation is interrupted, rerun with that same token so the CLI can recover its durable intent; never repair planning or loop state directly, and stop on contract errors.
