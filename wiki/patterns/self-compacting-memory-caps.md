---
type: wiki
created: 2026-05-05
source_change: openspec-llm-memory
tags: [pattern, memory, compaction, size-management]
---

# Self-Compacting Memory with Word/Line Caps

## Context
Memory files grow unboundedly if not managed. Without a runtime process, there is no cron job or daemon to compact files. The AI agent is the only writer.

## Pattern
Encode hard size caps directly in the agent's instructions (AGENTS.md / CLAUDE.md Session Memory Protocol). The AI self-enforces during every write:

| File | Target | Hard Cap | Overflow Action |
|------|--------|----------|-----------------|
| wiki/hot.md | 500 words | 600 words | Trim oldest entries |
| wiki/index.md | 40 lines | 80 lines | Archive completed entries |
| memory/pitfalls.md | 10 active | 20 active | Rotate oldest 10 to Archive |
| memory/session-bridge.md | 30 lines | 50 lines | Archive old Done items |

A separate lint skill validates post-hoc that caps are respected, catching any self-enforcement failures.

## When to Use
- Pure-instruction AI systems with no runtime
- Any memory/log file that grows with each session
- Word counts serve as reliable token proxies (1 word ~ 1.3 English tokens)

## Example
From openspec-llm-memory: `wiki/hot.md` has a compaction trigger at 550 words. When the AI finishes writing, it counts words. If > 550, it trims the oldest "Recently Shipped" entries to stay under 600. The lint skill's check #9 catches any file that exceeded the cap.

## Source
- Extracted from change: [[openspec/changes/archive/2026-05-05-openspec-llm-memory/proposal]]
- Design rationale: [[openspec/changes/archive/2026-05-05-openspec-llm-memory/design]] (Decision #2, #5)
