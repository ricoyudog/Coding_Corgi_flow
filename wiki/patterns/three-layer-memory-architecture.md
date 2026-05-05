---
type: wiki
created: 2026-05-05
source_change: openspec-llm-memory
tags: [pattern, memory, architecture, cross-session]
---

# Three-Layer Memory Architecture

## Context
AI coding sessions are stateless. Each new session re-discovers context, wastes tokens, and repeats mistakes. Projects need cross-session continuity without external databases or runtime dependencies.

## Pattern
Separate memory into three layers with different lifecycles and access patterns:

1. **Permanent layer** (`memory/`) — Always loaded at startup. Contains project identity (MEMORY.md), session handoff state (session-bridge.md), and pitfall log (pitfalls.md). Budget: ~1300 tokens.
2. **Long-term wiki** (`wiki/`) — Loaded on demand via wikilinks. Contains patterns, session summaries, decisions, research, questions. Organized by subdirectory. Navigated via `hot.md` (project pulse) and `index.md` (hub).
3. **Raw docs** (`docs/`) — Existing human-authored documentation. Never modified by memory system. Referenced as needed.

Startup reads exactly 3 files: session-bridge + hot.md + index.md. Total budget: ~2900 tokens.

## When to Use
- Project has multiple AI-assisted sessions over weeks/months
- Need to preserve decisions, pitfalls, and progress across sessions
- Obsidian-compatible vault structure is desired
- No external runtime or database is available

## Example
From the openspec-llm-memory change: `memory/session-bridge.md` carries the active change name, phase, branch, and last commit. On startup, the AI reads this first and immediately knows where to resume. `wiki/hot.md` provides the 500-word project pulse. `wiki/index.md` links to domain-specific pages for deeper dives.

## Source
- Extracted from change: [[openspec/changes/archive/2026-05-05-openspec-llm-memory/proposal]]
- Design rationale: [[openspec/changes/archive/2026-05-05-openspec-llm-memory/design]] (Decision #1)
