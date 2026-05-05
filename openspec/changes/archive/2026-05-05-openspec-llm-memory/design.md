## Context

OpenSpec GitFlow currently has no cross-session memory. Each AI session starts from scratch, re-reading docs/ and specs/ with no awareness of prior sessions' decisions, pitfalls, or progress. The toolkit ships skills as markdown files with metadata — there is no application runtime, database, or API server.

The target projects using OpenSpec are also Obsidian vaults, meaning the memory files must be valid markdown with wikilinks that render correctly in Obsidian's graph view.

**Current state**: Skills operate on `openspec/changes/` and `openspec/specs/` — purely short-term, per-change context.

**Constraints**:
- No external dependencies (pure markdown/yaml)
- Must work across Claude Code, OpenCode, and Codex platforms
- Three-directory sync obligation for all new skills
- Token startup cost must remain ≤ 3000 tokens additional

## Goals / Non-Goals

**Goals:**
- Add a 3-layer memory system (permanent → long-term wiki → raw docs) to OpenSpec projects
- Keep startup token overhead ≤ 3000 tokens (~7% of Claude Code baseline)
- Prevent memory rot via automated lint checks with hard size caps
- Enable humans to browse all memory in Obsidian
- Integrate memory writes into existing lifecycle hooks (apply closeout, archive)
- Ship as standard openspec skills following atom/molecule/compound hierarchy

**Non-Goals:**
- No concurrent multi-agent write safety (single-writer assumption for Phase 1)
- No MCP server or external process — skills are pure instructions
- No migration of existing `docs/` content into memory layer
- No real-time sync between vault instances (manual git push/pull)
- No programmatic token counting — size limits use word/line proxies

## Unknowns & Investigation

### 1. How to enforce file size limits without programmatic tooling?

**Investigated**: The toolkit has no runtime. Skills are AI instructions, not code.
**Concluded**: Encode limits as instructions in CLAUDE.md/AGENTS.md Session Memory Protocol. The AI agent self-enforces during writes. Lint skill validates post-hoc. Word/line counts are a proxy — AI can count these during writes.

### 2. Will 3-file startup read actually stay under 3000 tokens?

**Investigated**: Measured template sizes: session-bridge ~200 tokens, hot.md ~500 words ≈ 700 tokens, index.md ~40 lines ≈ 400 tokens. Plus CLAUDE.md protocol section ~1800 tokens.
**Concluded**: ~2900 tokens at steady state. Hard caps (600 words hot, 80 lines index, 50 lines bridge) prevent drift. Validated against MemGPT and GenericAgent research baselines.

### 3. How to handle the "forgotten shutdown" problem?

**Investigated**: Claude Code sessions can end abruptly (terminal close, context exhaustion). CLAUDE.md instructions are best-effort.
**Concluded**: Dual-write strategy — session-bridge is updated both at apply closeout (guaranteed via skill steps) AND at shutdown (best-effort). Stale bridge (>30d) triggers lint warning. Recovery: AI reads hot.md + index.md as fallback context.

### 4. Should memory-init be part of corgispec-install or standalone?

**Investigated**: Some projects want openspec without memory overhead (CI pipelines, small scripts).
**Concluded**: Both. `corgispec-install` calls memory-init by default; `--no-memory` flag skips it. Standalone `/corgi-memory-init` for adding memory to existing installs.

## Decisions

### 1. Three-Layer Memory Architecture

**Decision**: Separate `memory/` (permanent, agent-focused) from `wiki/` (long-term, human+agent) from `docs/` (existing, human-authored).

**Rationale**: MemGPT research shows that separating "core memory" (always loaded) from "archival memory" (searched on demand) reduces context waste. `memory/` maps to core, `wiki/` maps to archival, `docs/` remains external reference.

**Alternatives considered**:
- Single `memory/` directory with subdirs → loses Obsidian navigation clarity
- Inline memory in CLAUDE.md → makes CLAUDE.md too large, hard to lint independently

### 2. Word/Line Caps Instead of Token Counting

**Decision**: Use word counts (hot.md: 600 words) and line counts (index.md: 80 lines) as size proxies.

**Rationale**: Skills have no runtime to count tokens. Word count is a reliable proxy (1 word ≈ 1.3 tokens for English, ~2 tokens for CJK). AI agents can count words during file writes.

**Alternatives considered**:
- Exact token counting via API → requires runtime, violates "no external deps"
- Character count → less intuitive for humans editing in Obsidian

### 3. Lint as Separate Skill (Not Integrated into Archive)

**Decision**: `corgispec-lint` is a standalone molecule skill, recommended before archive but not blocking.

**Rationale**: Separation of concerns — lint detects problems, archive extracts knowledge. Running lint should never block the user's workflow. Pre-archive suggestion is via CLAUDE.md instruction.

**Alternatives considered**:
- Mandatory lint gate before archive → too rigid, user frustration
- Lint only inside archive → misses the "periodic health check" use case

### 4. Early-Stop Retrieval for Ask

**Decision**: Retrieval priority: session-bridge → hot → index → domain page → docs/ → specs/. Stop as soon as sufficient context is found.

**Rationale**: GenericAgent research shows budget-aware retrieval with early termination saves 40-60% context. Max 2 wiki pages per question prevents runaway reads.

**Alternatives considered**:
- Always read everything → token waste, defeats the purpose
- Vector search → requires external tooling (Obsidian plugin or MCP)

### 5. Compaction as Agent Self-Maintenance

**Decision**: AI agents perform compaction (trim hot.md, rotate pitfalls, compress bridge) as part of normal writes, not as a scheduled job.

**Rationale**: No daemon or cron available. The agent is the only writer. Compaction triggers are encoded in Session Memory Protocol instructions.

**Alternatives considered**:
- Periodic lint-triggered compaction → lint is read-only by design
- Human-triggered compaction → humans forget, memory bloats

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| Agent ignores shutdown write | Session context lost | Dual-write: apply closeout + shutdown. Lint check #1 detects staleness. |
| hot.md bloats past cap | Startup token budget exceeded | Hard cap in instructions + lint warning #9. Compaction trigger at 550 words. |
| Wikilinks break as files move | Obsidian navigation fails, lint errors | Lint check #3 catches broken links. Naming convention prevents most moves. |
| Multi-agent write conflict | Corrupted memory files | Phase 1: single-writer assumption. Phase 2: advisory lock file. |
| CJK text has higher token/word ratio | Budget underestimated for zh/ja projects | Conservative caps (600 words ≈ 1200 CJK tokens). Document this limitation. |
| Users skip memory entirely | Feature adoption failure | `--no-memory` respects choice. Default-on via install maximizes adoption. |

## Data Model

Not applicable in the traditional sense — no database. However, the memory files form a structured data model:

```
memory/MEMORY.md        → Entity: Project identity + hard constraints (write-once)
memory/session-bridge.md → Entity: Session state (write-every-session)
memory/pitfalls.md      → Collection: Pitfall entries (append + rotate)
wiki/hot.md             → Entity: Project pulse (write-every-session)
wiki/index.md           → Entity: Navigation hub (append + trim)
wiki/patterns/*.md      → Collection: Reusable patterns (write-at-archive)
wiki/sessions/*.md      → Collection: Session summaries (write-at-archive)
wiki/research/*.md      → Collection: Research findings (write-at-explore)
wiki/decisions/*.md     → Collection: Decision records (write-at-review)
wiki/questions/*.md     → Collection: Q&A threads (write-at-ask)
```

Relationships are expressed via Obsidian wikilinks (`[[target]]`), not foreign keys.

## API Contracts

Not applicable — no API surface changes in this change. All interactions are via AI skill instructions reading/writing markdown files.
