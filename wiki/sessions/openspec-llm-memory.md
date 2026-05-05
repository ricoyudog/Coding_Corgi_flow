---
type: wiki
created: 2026-05-05
source_change: openspec-llm-memory
status: archived
tags: [session, memory, cross-session, skills]
---

# Session Summary: openspec-llm-memory

## Overview
Added a 3-layer cross-session memory system (memory/ + wiki/) to OpenSpec GitFlow, shipping 4 new skills (memory-init, memory-lint, memory-ask, memory-extract) and integrating memory lifecycle hooks into install and archive workflows.

## Timeline
- **Proposed**: 2026-05-04
- **Completed**: 2026-05-05
- **Task Groups**: 7 groups, 56 total tasks

## Key Decisions
- Three-layer separation: `memory/` (permanent, always-loaded) vs `wiki/` (long-term, on-demand) vs `docs/` (existing, untouched)
- Word/line caps as token proxies instead of programmatic token counting (no runtime available)
- Lint as standalone molecule skill, not a blocking gate before archive
- Early-stop retrieval for ask skill: session-bridge -> hot -> index -> domain -> docs -> specs
- Agent self-compaction encoded in Session Memory Protocol instructions
- Memory-init called by default from corgispec-install, with `--no-memory` opt-out

## Pitfalls Encountered
- No significant pitfalls encountered during this change specifically.

## Outcome
Delivered 4 new skills (corgispec-memory-init, corgispec-lint, corgispec-ask, corgispec-memory-extract) with full three-directory sync. Modified corgispec-install and corgispec-archive to integrate memory lifecycle. Session Memory Protocol injected into AGENTS.md. All 56 tasks completed across 7 groups.

## References
- Proposal: [[openspec/changes/archive/2026-05-05-openspec-llm-memory/proposal]]
- Design: [[openspec/changes/archive/2026-05-05-openspec-llm-memory/design]]
- Tasks: [[openspec/changes/archive/2026-05-05-openspec-llm-memory/tasks]]
