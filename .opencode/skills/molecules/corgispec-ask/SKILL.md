---
name: corgispec-ask
description: Answer pending Obsidian questions from CorgiSpec Memory/Wiki with early-stop retrieval, source citations, and a strict file budget. Use for one wiki/questions file or all pending questions; queue unverified discoveries for promotion instead of changing architecture or permanent memory.
---

# Answer from the Knowledge Vault

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

Accept either `wiki/questions/<file>.md` or `--pending`. Humans own the question text; edit only status and answer-owned sections.

## Preconditions

Require `memory/session-bridge.md`, `memory/MEMORY.md`, `wiki/hot.md`, `wiki/index.md`, and `wiki/questions/`. For a named file, require `status: pending`. For `--pending`, process pending files in deterministic path order.

## Retrieval

Read in this order and stop as soon as the answer is supported:

1. `memory/session-bridge.md`
2. `memory/MEMORY.md`
3. `wiki/hot.md`
4. `wiki/index.md`, only if it identifies a relevant domain page
5. At most two relevant Wiki domain pages
6. A directly referenced RFC, archived delivery, spec, document, or source file

Read at most five files beyond the question file. The three startup files count toward that limit. Prefer accepted RFCs, archived delivery evidence, and current architecture over Research. Never present Research as verified current behavior.

If five files are insufficient, set `status: needs-deep-session`, write the supported partial answer, and list the exact additional sources needed.

## Write the Answer

- Set `status: answered` and `answered: YYYY-MM-DD`, or `status: needs-deep-session`.
- Replace only `## Answer`, `## Sources`, and optional `## Needs` content.
- Cite every material claim with a file path, RFC/AC, delivery page, or source anchor.
- Preserve the Question and Context sections byte-for-byte.

## Queue Knowledge Candidates

An answer must never directly append to `memory/MEMORY.md`, `memory/pitfalls.md`, `wiki/architecture/`, `wiki/patterns/`, or `wiki/decisions/`.

When the answer reveals a reusable candidate, add one deduplicated item under `## Promotion Queue` in `memory/session-bridge.md`:

```markdown
- [candidate] <claim> (source: [[wiki/questions/<file>]]; verify: <required evidence>)
```

Archive or an explicit human promotion may later move the candidate after verification. Do not edit live phase fields in the bridge; hooks synthesize those from `.corgi/loop`.

## Report

Return the question file, final status, files consulted, confidence, and whether a Promotion Queue candidate was added. Batch mode returns one row per question.
