---
name: corgispec-memory-migrate
description: Migrate existing project knowledge into CorgiSpec v4 Memory/Wiki after transactional bootstrap, preserving legacy sessions/log data and separating verified architecture from research. Use for v3 projects, documentation-heavy repos, archived changes, or existing Obsidian vaults.
---

# Migrate Existing Knowledge

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Use only after `corgispec bootstrap --migrate-v4` has created the mandatory v4 structure and migration record. Bootstrap owns filesystem migration and rollback; this skill classifies and enriches user-owned knowledge without accepting RFCs or fabricating archive evidence.

## Inventory First

Read the migration report, then inventory:

- AGENTS.md, CLAUDE.md, README, docs, and canonical specs;
- existing Memory/Wiki or Obsidian pages;
- accepted/archived OpenSpec changes and their actual evidence;
- source paths that can verify current architecture;
- legacy `wiki/sessions/` and `wiki/log.md` paths.

Record sources and destinations before writing. Deduplicate by canonical source path plus content digest.

## Classification Rules

- Permanent accepted constraints → `memory/MEMORY.md`, with source citation.
- Verified recurring failure modes → `memory/pitfalls.md`, with evidence and remediation.
- Current behavior verified against source → `wiki/architecture/`.
- Investigation, historical narrative, or unverified claims → `wiki/research/`.
- Demonstrably reusable implementation approaches → `wiki/patterns/`.
- ADRs inside an accepted RFC boundary → `wiki/decisions/`, linked to RFC/AC.
- Verified operational procedures → `wiki/guides/`.
- Archived RFC Slice evidence → report it as a candidate only. `corgispec archive --local` is the sole writer of v4 `wiki/deliveries/` pages and archive-derived provenance; migration must not synthesize or repair a delivery closeout.

Never turn an old design, archived change, session note, or decision into an accepted RFC. Such material may inform `RFC-0001-project-foundation`, but that RFC remains a human-reviewed draft until explicitly accepted and merged.

## Legacy Preservation

Leave existing `wiki/sessions/` and `wiki/log.md` byte-for-byte in place. Do not create missing legacy paths, append entries, rewrite indexes, or use them as current archive outputs. Their migration-record hashes make later lint checks possible.

## Managed Writes

- Preserve all human text outside managed markers.
- Update domain `_index.md` files idempotently.
- Keep `wiki/hot.md` under 600 words and only edit its managed regions for RFC/delivery lifecycle data.
- Put ambiguous candidates in `memory/session-bridge.md` Promotion Queue with source and verification needed.
- Do not change bridge lifecycle fields; `.corgi/loop` is authoritative.
- Do not write archive-derived delivery, hot, architecture, pattern, MEMORY, pitfall, or bridge closeout provenance. Report it for the canonical Archive transaction instead.

## Verification

Run read-only `/corgi-lint`. Report migrated, preserved, skipped, conflicting, and queued items with source/destination links. A second run against unchanged inputs must produce no changes.
