---
name: corgispec-memory-init
description: Define and verify CorgiSpec v4's mandatory Memory/Wiki structure, startup protocol, ownership boundaries, and legacy preservation rules. Use during bootstrap, v4 migration, install verification, or repair of missing project knowledge files.
---

# Initialize Memory and Wiki

Treat Memory and Wiki as mandatory parts of every CorgiSpec v4 project. The transactional `corgispec bootstrap` command is the only writer for initialization and migration; do not create a partial structure by hand.

## Required Structure

Require all of these paths:

```text
memory/
├── MEMORY.md
├── session-bridge.md
└── pitfalls.md

wiki/
├── hot.md
├── index.md
├── schema.md
├── architecture/
├── research/
├── patterns/
├── decisions/
├── guides/
├── questions/
├── deliveries/
└── meta/
```

Each Wiki directory must contain `_index.md`, except the root. `architecture/` also starts with `implicit-contracts.md`.

## Bootstrap or Migrate

1. Inspect the target without writing.
2. If the project is not on the v4 contract, run `corgispec bootstrap --migrate-v4`; otherwise run the normal bootstrap/update path.
3. Let bootstrap copy the bundled templates and inject `## Session Memory Protocol` into exactly one supported agent configuration file.
4. Preserve every existing user-owned Memory/Wiki file. Never overwrite it silently.
5. Preserve existing `wiki/sessions/` and `wiki/log.md` in place as legacy read-only data. Do not create either path in a fresh project and do not append to either path.
6. Verify the complete structure and protocol after the bootstrap transaction commits.

Memory cannot be opted out of in v4. If an old command or document offers a skip flag, stop and report that the project is using a legacy asset.

## Startup Contract

Read exactly these three files first, in order:

1. `memory/session-bridge.md`
2. `memory/MEMORY.md`
3. `wiki/hot.md`

Then read the active RFC/Slice and Change overlays named by the bridge. Read `wiki/index.md` only when domain retrieval is needed.

SessionStart and PostCompact hooks must synthesize live lifecycle state from `.corgi/loop`. `session-bridge.md` is only a durable checkpoint mirror: Apply updates it with the planning-baseline and immediately before each Task Group commit, while `corgispec archive --local` alone writes the archive closeout checkpoint. No skill may repeat that closeout write after the commit is sealed.

## Knowledge Ownership

- `MEMORY.md`: permanent, source-backed constraints and preferences only.
- `session-bridge.md`: delivery pointer, last durable checkpoint, next action, blockers, uncommitted work, discoveries, and Promotion Queue.
- `pitfalls.md`: verified cross-delivery pitfalls with evidence links.
- `architecture/`: verified current-system knowledge.
- `research/`: evidence and hypotheses that are not yet current architecture.
- `decisions/`: ADRs inside accepted RFC scope.
- `deliveries/`: one closeout page per archived RFC Slice.
- `meta/`: explicit generated reports.

Only edit tool-owned Wiki sections between matching `corgi:managed` markers. Preserve human content outside the markers.

For an RFC Slice archive, `corgispec archive --local` is the sole writer of archive-derived delivery, hot, architecture, pattern, MEMORY, pitfall, and bridge provenance. Skills may inspect candidates before Archive or verify its result afterwards, but must not create, promote, or repair those outputs directly.

## Verification Output

Report:

- created, preserved, and conflicted files;
- whether the startup protocol is present exactly once;
- whether all mandatory paths exist;
- whether legacy `sessions/` or `log.md` paths were preserved without new writes;
- the next action, normally human review of `RFC-0001-project-foundation`.

Fail closed if the structure is partial, the protocol order is wrong, or a user-owned file would be overwritten.
