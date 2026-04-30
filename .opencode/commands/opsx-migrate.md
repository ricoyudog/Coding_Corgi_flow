---
description: Migrate existing project knowledge into memory/wiki structure from docs, archived changes, agent configs, and vault files
---

Migrate existing project knowledge into the memory/wiki structure.

**Input**: Optionally specify flags: `--auto-only` (skip interactive phases), `--phase N` (run single phase).

**Steps**

1. **Check preconditions**

   Verify `memory/` and `wiki/` directories exist. If not, instruct the user to run `/opsx-memory-init` first.

2. **Determine platform**

   Read `openspec/config.yaml` and check the `schema` field.

3. **Dispatch to skill**

   Follow the instructions in the **openspec-memory-migrate** skill.

4. **Pass through all input**

   Forward the user's input (flags, phase selection) to the skill as-is.
