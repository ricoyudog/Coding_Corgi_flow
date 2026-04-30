**English** | [繁體中文](cross-session-memory.zh-TW.md)

# Cross-Session Memory

AI coding sessions are stateless by default — every new session starts from scratch. OpenSpec GitFlow adds a **3-layer memory system** that gives AI agents cross-session continuity while staying under a strict token budget (~2900 tokens at startup).

## The Problem

Without memory, each session wastes tokens re-discovering:
- What was decided in prior sessions
- What pitfalls were already hit (and hit again)
- What the project's implicit rules and contracts are
- Where the last session left off

## Architecture

```mermaid
graph TB
    classDef layer1 fill:#1a1a2e,stroke:#e94560,color:#fff,stroke-width:2px
    classDef layer2 fill:#16213e,stroke:#0f3460,color:#fff,stroke-width:2px
    classDef layer3 fill:#0f3460,stroke:#533483,color:#fff,stroke-width:1px
    classDef trigger fill:#533483,stroke:#533483,color:#fff,stroke-width:2px

    subgraph L1["Layer 1 — Core Memory (always loaded, ~1300 tokens)"]
        direction LR
        MEMORY["MEMORY.md\n━━━━━━━━━━\nProject identity\nHard constraints\nPreferences"]
        BRIDGE["session-bridge.md\n━━━━━━━━━━━━━━\nActive change & phase\nDone / Waiting\nNew pitfalls"]
        PITFALLS["pitfalls.md\n━━━━━━━━━━\n≤20 active entries\nRotates to Archive"]
    end

    subgraph L2["Layer 2 — Wiki Knowledge (on-demand, navigated via index)"]
        direction LR
        HOT["hot.md\n━━━━━━━\n≤600 words\nActive changes\nRecent decisions\nArchitecture pulse"]
        INDEX["index.md\n━━━━━━━━\n≤80 lines\nWikilink navigation\nAll categories"]
        subgraph PAGES["Domain Pages"]
            direction TB
            ARCH["architecture/"]
            PATT["patterns/"]
            SESS["sessions/"]
            DECI["decisions/"]
            RESE["research/"]
            QUES["questions/"]
        end
    end

    subgraph L3["Layer 3 — Existing Docs (untouched, referenced only)"]
        DOCS["docs/ • specs/ • README"]
    end

    subgraph LIFECYCLE["Write Triggers"]
        direction LR
        T1(["Session Startup"])
        T2(["Apply Closeout"])
        T3(["Archive"])
        T4(["Session Shutdown"])
    end

    T1 -.->|"read 3 files"| BRIDGE
    T1 -.->|"read"| HOT
    T1 -.->|"read"| INDEX

    T2 ==>|"update"| BRIDGE
    T2 ==>|"append"| PITFALLS
    T2 ==>|"update"| HOT

    T3 ==>|"extract"| PATT
    T3 ==>|"create"| SESS
    T3 ==>|"reset"| BRIDGE

    T4 ==>|"update"| BRIDGE

    INDEX -.->|"wikilinks"| PAGES
    PAGES -.->|"references"| DOCS

    class MEMORY,BRIDGE,PITFALLS layer1
    class HOT,INDEX layer2
    class ARCH,PATT,SESS,DECI,RESE,QUES layer3
    class DOCS layer3
    class T1,T2,T3,T4 trigger
```

## Lifecycle Integration

```mermaid
sequenceDiagram
    participant H as Human
    participant A as AI Agent
    participant M as memory/
    participant W as wiki/
    participant D as docs/

    Note over A,M: ── Session Startup ──
    A->>M: Read session-bridge.md
    A->>W: Read hot.md + index.md
    Note right of A: Total: ~2900 tokens

    Note over H,A: ── Development ──
    H->>A: /opsx-apply
    A->>D: Read code & docs as needed
    A->>W: Read ≤2 wiki pages per question

    Note over A,W: ── Apply Closeout ──
    A->>M: Update session-bridge (Done/Waiting)
    A->>M: Append new pitfalls
    A->>W: Update hot.md decisions

    Note over A,W: ── Archive ──
    A->>W: Extract patterns → wiki/patterns/
    A->>W: Create session summary → wiki/sessions/
    A->>M: Reset session-bridge
    A->>W: Move change to Recently Shipped

    Note over A,M: ── Session Shutdown ──
    A->>M: Final session-bridge update
```

## File Structure

```
Layer 1: memory/          ← Always loaded at startup (~1300 tokens)
├── MEMORY.md             Hard constraints, project identity (write-once)
├── session-bridge.md     Last session's handoff state (write-every-session)
└── pitfalls.md           Cross-change pitfall log (append + rotate)

Layer 2: wiki/            ← On-demand, navigated via index (~700 tokens for index)
├── hot.md                Project pulse, recent decisions (write-every-session)
├── index.md              Navigation hub with wikilinks (80-line cap)
├── architecture/         Structural insights, implicit contracts
├── patterns/             Reusable approaches from completed changes
├── sessions/             Historical summaries of archived changes
├── decisions/            Key decisions from reviews
├── research/             Investigation results from explore sessions
└── questions/            Human Q&A via Obsidian

Layer 3: docs/            ← Existing project documentation (untouched)
```

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Word/line caps instead of token counting | Skills have no runtime — AI self-enforces during writes |
| Separate `memory/` from `wiki/` | Core memory (always loaded) vs archival (on-demand) — from MemGPT research |
| Compaction as agent self-maintenance | No cron/daemon available — agent compacts during normal writes |
| Lint as standalone, not gate | Never blocks workflow; periodic health check via `/opsx-lint` |
| Early-stop retrieval for ask | Budget-aware: max 2 wiki pages per question, stop when sufficient |

## File Size Limits

Memory self-compacts via hard caps. The AI agent enforces these during writes; `/opsx-lint` validates post-hoc:

| File | Target | Hard Cap | Overflow Action |
|------|--------|----------|-----------------|
| `wiki/hot.md` | 500 words | 600 words | Trim oldest entries |
| `wiki/index.md` | 40 lines | 80 lines | Archive completed entries |
| `memory/pitfalls.md` | 10 active | 20 active | Rotate oldest 10 to Archive |
| `memory/session-bridge.md` | 30 lines | 50 lines | Archive old Done items |

## Getting Started

### New Project

Memory initializes automatically during `/opsx-install` (opt-out with `--no-memory`):

```text
/opsx-install --path /path/to/project
# Installer asks: "Initialize memory structure? (yes/no — default: yes)"
```

### Existing Project (no prior knowledge)

Add memory to a project that already uses OpenSpec:

```text
/opsx-memory-init
```

### Existing Project with Accumulated Knowledge

Migrate docs, archived changes, and vault pages into the memory structure:

```text
/opsx-migrate
```

The migrate skill runs 4 phases:

1. **Agent Config Deepening** (auto) — extracts constraints from CLAUDE.md/AGENTS.md into `memory/MEMORY.md`
2. **Archived Changes** (auto) — generates session summaries and patterns from `openspec/changes/archive/`
3. **docs/ Directory** (hybrid) — auto-categorizes obvious docs, asks about ambiguous ones
4. **Vault Pages** (hybrid) — presents found .md files for user categorization

Migration never moves or deletes source files — it creates wiki entries that reference originals.

## Obsidian Compatibility

All memory files are valid markdown with `[[wikilinks]]`. If your project is also an Obsidian vault:
- `wiki/` renders as a navigable knowledge graph
- `memory/` shows session state at a glance
- Humans can browse, search, and even edit memory files directly
- `/opsx-ask` answers questions created as pending .md files in the vault

## Related Commands

| Command | Purpose |
|---------|---------|
| `/opsx-memory-init` | Initialize the 3-layer memory structure |
| `/opsx-migrate` | Import existing knowledge into memory/wiki |
| `/opsx-lint` | Validate memory health (11 checks) |
| `/opsx-ask` | Answer questions using budget-aware retrieval |

## Further Reading

- [Design document](../openspec/changes/openspec-llm-memory/design.md) — architecture decisions, risks, trade-offs
- [Proposal](../openspec/changes/openspec-llm-memory/proposal.md) — motivation and scope
- Research references: MemGPT, GenericAgent, xMemory
