## Session Memory Protocol

### Startup (every session)
Read in order, max 3 files:
1. `memory/session-bridge.md` — last session's state
2. `wiki/hot.md` — current project context (~500 words, hard cap 600)
3. `wiki/index.md` — jump to relevant domain page
Then read `docs/` or code as needed.

### Retrieval Budget
- Startup: max 3 files (session-bridge + hot + index), then on-demand
- Per-question: max 2 wiki pages before answering
- If >5 pages needed: say "this needs a deep session"

### File Size Limits (hard caps)
| File | Target | Hard Cap | Overflow Action |
|------|--------|----------|-----------------|
| wiki/hot.md | 500 words | 600 words | Trim oldest entries |
| wiki/index.md | 40 lines | 80 lines | Archive completed entries |
| memory/pitfalls.md | 10 active | 20 active | Rotate oldest 10 |
| memory/session-bridge.md | 30 lines | 50 lines | Archive old Done items |

### Shutdown (every session end)
Update `memory/session-bridge.md`: Done / Waiting / New Pitfalls / New Discoveries

### opsx Apply → Long-term Memory
After each Task Group completes:
- New pitfalls → append to `memory/pitfalls.md` (link source change)
- New implicit rules → append to `wiki/architecture/implicit-contracts.md`
- Update `wiki/hot.md` Recent Decisions

### Compaction Triggers (agent self-maintains)
- Every archive: compress session-bridge
- pitfalls > 20 entries: rotate oldest 10 to Archive section
- hot.md > 550 words: trim oldest entries
- Every 10 opsx sessions: suggest running /corgi-lint
