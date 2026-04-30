## Why

OpenSpec sessions are stateless — each new session starts from scratch with no memory of prior work, decisions, or pitfalls. This wastes context window tokens re-discovering known constraints and causes repeated mistakes. Research shows that structured memory layering (MemGPT, GenericAgent, xMemory) can reduce agent startup overhead by 70%+ while maintaining cross-session continuity.

We need a memory system that: (1) costs ≤ 3000 tokens at startup, (2) overlays without disrupting existing docs/specs, (3) is human-readable in Obsidian, and (4) self-compacts to prevent unbounded growth.

## What Changes

- **New skill `openspec-memory-init`** (Atom): Creates `memory/` and `wiki/` directory structures with template files; injects Session Memory Protocol into CLAUDE.md/AGENTS.md.
- **New skill `openspec-lint`** (Molecule): 11-check health validator for memory freshness, file size caps, broken wikilinks, and extraction completeness.
- **New skill `openspec-ask`** (Molecule): Q&A channel allowing humans to ask questions in Obsidian that AI answers using vault context with early-stop retrieval.
- **New skill `openspec-memory-extract`** (Atom): Extracts reusable patterns and session summaries from completed changes into long-term wiki.
- **Modified `openspec-install`**: Calls `openspec-memory-init` after standard install (opt-out via `--no-memory`).
- **Modified `openspec-archive`**: Calls `openspec-memory-extract` before closing a change to capture long-term knowledge.
- **Modified apply closeout**: Writes session-bridge, pitfalls, and wiki/hot.md updates after each Task Group.
- **New lifecycle hooks**: Session startup reads memory (3 files), session shutdown writes session-bridge.

## Capabilities

### New Capabilities
- `memory-init`: Scaffold the 3-layer memory structure (memory/ + wiki/) with templates and inject session protocol into agent config files
- `memory-lint`: Validate memory health across 11 checks — freshness, size caps, broken links, extraction completeness — with severity levels and auto-fix routing
- `memory-ask`: Answer human questions from Obsidian vault using early-stop retrieval (session-bridge → hot → index → domain → docs → specs)
- `memory-extract`: Extract reusable patterns and session summaries from completed changes into wiki/patterns/ and wiki/sessions/

### Modified Capabilities
<!-- No existing spec-level capabilities are changing requirements -->

## Impact

- **New directories**: `memory/` (3 files), `wiki/` (7 subdirs, 8+ files) created per-project
- **Skills directory**: 4 new skills across `.opencode/skills/`, `.claude/skills/`, `.codex/skills/` (3-directory sync)
- **Existing skills modified**: `openspec-install`, `openspec-archive`, apply closeout logic
- **Agent config files**: CLAUDE.md and AGENTS.md get Session Memory Protocol injection
- **Token budget**: +2900 tokens per session startup (≈7% of Claude Code baseline)
- **Dependencies**: None new — pure markdown/yaml, no external packages

## GitLab Issue

<!-- This section will be filled automatically by the propose skill with the parent issue link. -->
