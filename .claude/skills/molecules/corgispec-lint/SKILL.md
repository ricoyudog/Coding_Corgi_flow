---
name: corgispec-lint
description: Validate CorgiSpec v4 Memory/Wiki structure, freshness, source integrity, delivery extraction, bridge drift, and legacy preservation. Use for periodic health checks or archive readiness; default execution is read-only and only --report may write wiki/meta.
---

# Lint Memory and Wiki

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Run all checks without modifying project files. `--report` is the only write mode and may create or replace only `wiki/meta/lint-report-YYYY-MM-DD.md`. Never auto-fix findings.

## Checks

Run exactly these 14 checks:

1. **Mandatory structure (error)** — require all three Memory files, `hot.md`, `index.md`, `schema.md`, and `_index.md` in architecture, research, patterns, decisions, guides, questions, deliveries, and meta.
2. **Startup protocol (error)** — require one `## Session Memory Protocol` in AGENTS.md or CLAUDE.md with order `session-bridge → MEMORY → hot` and `index` explicitly on demand.
3. **Bridge contract (error)** — require delivery pointer, checkpoint phase/group, observed run revision, verified HEAD, next action, blockers, uncommitted work, discoveries, and Promotion Queue; enforce 50-line cap.
4. **Bridge drift (warning)** — when `.corgi/loop` has an active run, compare its authoritative Change, phase, group, state revision, and HEAD with bridge checkpoint values; distinguish expected live advancement from contradictory bindings.
5. **Hot health (warning)** — require managed Active RFCs, Active Deliveries, and Recently Shipped regions; warn after 14 days and above 600 words.
6. **Root index health (warning)** — require links to every mandatory domain index and enforce 80-line cap.
7. **Wikilink integrity (error)** — resolve every Memory/Wiki wikilink, including aliases, and report source line for missing targets.
8. **Index coverage and orphans (warning)** — require every non-index Wiki page in its domain `_index.md`, unless `unlisted: true`; report pages with no incoming link.
9. **Frontmatter schema (warning)** — enforce `wiki/schema.md`, including delivery, decision, question, and meta-specific fields.
10. **Architecture verification (error)** — every current architecture/implicit-contract entry must cite final source and an accepted RFC, archived delivery, or equivalent verified evidence.
11. **Pitfall health (warning)** — every active pitfall needs evidence and remediation; enforce 20 active entries and rotate only via an explicit edit outside lint.
12. **Delivery completeness (error)** — every archived RFC Slice binding needs one delivery page whose RFC/Slice/Change/final HEAD and AC evidence match the archived evidence manifest; detect duplicates and missing pages.
13. **Managed-region integrity (error)** — require balanced, unique managed markers and reject tool-owned content outside them in hot and delivery indexes.
14. **Legacy preservation (error)** — fresh v4 projects must not contain generated `wiki/sessions/` or `wiki/log.md`; migrated projects may retain them only when their preserved hashes match the migration record and no current delivery writes reference them as outputs.

Treat a missing authoritative Run Contract or migration record as `not-applicable`, not as guessed data. Never infer delivery completion from task checkboxes alone.

## Output

Print a deterministic summary with total checks, pass/not-applicable/error/warning counts, each finding's path and evidence, and prioritized remediation. Exit semantics are:

- `PASS`: no errors or warnings;
- `WARN`: warnings but no errors;
- `FAIL`: one or more errors.

With `--report`, write the same content under `wiki/meta/` with frontmatter:

```yaml
type: meta
updated: YYYY-MM-DD
kind: lint-report
```

Without `--report`, do not create, update, touch, stage, or format any file.
