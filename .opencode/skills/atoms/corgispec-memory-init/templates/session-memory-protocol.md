## Session Memory Protocol

### Startup (every session)
Read in order, max 3 files:
1. `memory/session-bridge.md` — durable delivery checkpoint
2. `memory/MEMORY.md` — permanent source-backed constraints
3. `wiki/hot.md` — current project context (~500 words, hard cap 600)
Then read the active RFC, Slice, `source.yaml`, `traceability.yaml`, and Change artifacts named by the bridge. Read `wiki/index.md` only on demand.

### Retrieval Budget
- Startup: max 3 files (session-bridge + MEMORY + hot), then active delivery artifacts
- Per-question: max 2 wiki pages before answering
- If >5 pages needed: say "this needs a deep session"

### File Size Limits (hard caps)
| File | Target | Hard Cap | Overflow Action |
|------|--------|----------|-----------------|
| wiki/hot.md | 500 words | 600 words | Trim oldest entries |
| wiki/index.md | 40 lines | 80 lines | Archive completed entries |
| memory/pitfalls.md | 10 active | 20 active | Rotate oldest 10 |
| memory/session-bridge.md | 30 lines | 50 lines | Archive old Done items |

### Durable Checkpoints
`memory/session-bridge.md` is not a live state machine. Apply updates it only with a planning-baseline commit and immediately before each Task Group commit. `corgispec archive --local` alone writes the archive closeout checkpoint; skills must not repeat that write after the closeout commit is sealed. SessionStart/PostCompact hooks synthesize the live phase and report drift from `.corgi/loop`.

### Knowledge Promotion
- During Apply, keep discoveries in the bridge Promotion Queue; do not promote unverified claims.
- At Archive, `corgispec archive --local` creates `wiki/deliveries/<RFC-ID>-<Slice-ID>.md` and is the sole writer of archive-derived hot, architecture, patterns, pitfalls, MEMORY, and bridge provenance. Skills only prepare or verify this work read-only.
- Do not create new `wiki/sessions/` pages or append to `wiki/log.md`; migrated legacy data stays read-only in place.

### Compaction Triggers (agent self-maintains)
- Every archive: clear the completed delivery pointer and compact the bridge
- pitfalls > 20 entries: rotate oldest 10 to Archive section
- hot.md > 550 words: trim oldest entries
- Every 10 Corgi sessions: suggest running `/corgi-lint`; lint is read-only unless `--report` is explicit
