---
name: "Corgi: Memory Init"
description: Verify mandatory RFC-first Memory/Wiki or route initialization through transactional bootstrap
category: Workflow
tags: [workflow, memory, bootstrap]
---

Follow **corgispec-memory-init**. Memory/Wiki is mandatory; if initialization or migration is needed, route through transactional `corgispec bootstrap` and never create a partial structure manually. Preserve legacy sessions/log data without new writes.
