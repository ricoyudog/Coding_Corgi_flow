---
name: "Corgi: Migrate"
description: Migrate existing project knowledge into memory/wiki structure from docs, archived changes, agent configs, and vault files
category: Workflow
tags: [workflow, memory, migrate, experimental]
---

Migrate existing project knowledge into the memory/wiki structure.

**Dispatches to**: `corgispec-memory-migrate`

**Input**: Optionally specify flags: `--auto-only` (skip interactive phases), `--phase N` (run single phase).

**Steps**

1. **Check preconditions**

   Verify `memory/` and `wiki/` directories exist. If not, instruct the user to run `/corgi:memory-init` first.

2. **Follow the migration skill**

   Follow the instructions in the **corgispec-memory-migrate** skill.

3. **Pass through all input**

   Forward the user's input (flags, phase selection) to the skill as-is.
