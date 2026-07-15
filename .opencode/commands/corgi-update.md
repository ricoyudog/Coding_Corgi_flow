---
description: Reconcile an existing CorgiSpec planning package without changing implementation files
---

Update the planning package for an existing change.

**Input**: Pass a change name, optional `--store <id>`, and revised intent, for example `/corgi-update add-auth --store team require passkeys`. If no name is given, resolve exactly one change from context; ask the user when discovery is ambiguous.

Follow the **corgispec-update** skill and pass through the user's requested planning change unchanged. Once a store is named, preserve the same `--store` on the first and every subsequent CorgiSpec and OpenSpec command. Do not dispatch by tracker or assume a built-in schema name.

Verify that every edited artifact received its own confirmation, all changed paths came from the authoritative OpenSpec context, strict validation and ready checks ran, and no implementation, tracker, QA, memory, or loop-state file changed.
