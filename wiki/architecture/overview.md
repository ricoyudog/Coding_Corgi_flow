---
type: wiki
updated: 2026-05-05
tags: [architecture, overview, design]
---

# Architecture & Design Overview

> Comprehensive analysis of the OpenSpec GitFlow (Coding Corgi Flow) project — structure, design decisions, and key abstractions.

## 1. Project Identity

This is **not an application** but a **workflow/skills toolkit** built on top of [OpenSpec](https://github.com/Fission-AI/OpenSpec) by Fission AI. It turns LLM Agents into structured engineering workflow engines via custom schemas, AI skills, slash commands, and issue-tracking integrations.

**Supported AI platforms**: OpenCode, Claude Code, Codex.

## 2. Core Workflow Pipeline

```
propose → apply (one Task Group) → verify → review → (loop or archive)
```

| Phase | What happens |
|-------|-------------|
| **Propose** | Generate proposal.md, specs/, design.md, tasks.md; create parent/child issues |
| **Apply** | Execute one Task Group at a time; mark checkboxes; sync to child issue; pause |
| **Verify** | Automated gate: lint, build, tests, spec coverage — blocks review on failure |
| **Review** | 5-axis quality check (Architecture, Security, Performance, Code Quality, Completeness); explicit approve/reject/discuss |
| **Archive** | Close issues, sync delta specs into canonical specs, extract knowledge, clean up |

### Key Design Decisions

- **Checkpoint-based apply**: One Task Group per session, enforced pause between groups
- **Delta spec model**: ADDED/MODIFIED/REMOVED/RENAMED operations accumulate into canonical specs
- **Parent/child issues**: One parent issue + one child per Task Group
- **Capabilities-driven specs**: Proposal declares capabilities; each becomes a separate spec file
- **Worktree isolation** (opt-in): Parallel development via `git worktree`

## 3. Directory Layout

```
Coding_Corgi_flow/
├── .opencode/skills/corgispec-*/     # ★ Source of Truth for skills
│   ├── SKILL.md                      #   AI-readable step instructions
│   ├── skill.meta.json               #   Machine-readable metadata
│   └── references/                   #   Supplementary references
├── .claude/skills/corgispec-*/       # Claude Code skill mirrors (must sync)
├── .codex/skills/corgispec-*/        # Codex skill mirrors (must sync)
├── .opencode/commands/corgi-*.md     # OpenCode slash command dispatch
├── .claude/commands/corgi/*.md       # Claude slash command dispatch
├── packages/corgispec/               # ★ Unified CLI (replaces ds-skills + install-skills.sh)
│   ├── src/bin/corgispec.ts          #   Commander.js entry point
│   ├── src/commands/                 #   14 subcommands
│   ├── src/lib/                      #   Reusable modules
│   ├── assets/                       #   Bundled resources
│   └── test/                         #   Vitest tests (114 tests)
├── tools/ds-skills/                  # Legacy CLI (being replaced by corgispec)
├── schemas/skill-meta.schema.json    # ★ JSON Schema for skill validation
├── openspec/
│   ├── config.yaml                   # Project config (schema, isolation, context, rules)
│   ├── schemas/{gitlab,github}-tracked/  # Schema definitions + templates
│   ├── specs/                        # Accumulated canonical specs
│   └── changes/                      # Active change directories
├── memory/                           # ★ Layer 1: Always-loaded session memory
│   ├── MEMORY.md                     #   Hard constraints (never expires)
│   ├── session-bridge.md             #   Last session handoff state
│   └── pitfalls.md                   #   Cross-change pitfall log
├── wiki/                             # ★ Layer 2: On-demand knowledge base
│   ├── hot.md                        #   Current project pulse (≤600 words)
│   ├── index.md                      #   Navigation index
│   └── architecture/ decisions/ patterns/ sessions/ ...
├── docs/                             # Layer 3: Traditional docs (untouched by memory)
├── README.md / README.zh-TW.md       # Bilingual documentation
└── AGENTS.md                         # Agent behavioral guidelines + memory protocol
```

## 4. Skill Architecture

### 4.1 Three-Tier Hierarchy (Atoms → Molecules → Compounds)

| Tier | Description | Dependency Rule | Examples |
|------|-------------|----------------|----------|
| **Atom** | Single reusable operation | No dependencies | `corgispec-memory-init`, `corgispec-memory-extract` |
| **Molecule** | Workflow combining atoms | Atoms only | `corgispec-propose`, `corgispec-apply-change`, `corgispec-review`, `corgispec-verify` |
| **Compound** | End-to-end orchestration | Molecules only | (not yet implemented) |

### 4.2 Complete Skill Inventory (17 skills)

| Skill | Platform | Tier | Depends On |
|-------|----------|------|------------|
| `corgispec-memory-init` | universal | atom | — |
| `corgispec-memory-extract` | universal | atom | — |
| `corgispec-propose` | gitlab | molecule | — |
| `corgispec-apply-change` | gitlab | molecule | — |
| `corgispec-review` | gitlab | molecule | — |
| `corgispec-verify` | universal | molecule | — |
| `corgispec-archive-change` | gitlab | molecule | memory-extract |
| `corgispec-explore` | gitlab | molecule | — |
| `corgispec-install` | universal | molecule | memory-init |
| `corgispec-lint` | universal | molecule | memory-init |
| `corgispec-ask` | universal | molecule | memory-init |
| `corgispec-memory-migrate` | universal | molecule | memory-init |
| `corgispec-gh-propose` | github | molecule | — |
| `corgispec-gh-apply` | github | molecule | — |
| `corgispec-gh-review` | github | molecule | — |
| `corgispec-gh-archive` | github | molecule | — |
| `corgispec-gh-explore` | github | molecule | — |

### 4.3 Platform Mapping Strategy

- **GitLab**: `corgispec-*` (unprefixed — default skills using `glab` CLI)
- **GitHub**: `corgispec-gh-*` (`gh` prefixed variants using `gh` CLI)
- **Universal**: `corgispec-memory-*`, `corgispec-verify`, `corgispec-install`, `corgispec-lint`, `corgispec-ask` — no issue tracker dependency

### 4.4 Skill Anatomy

Each skill directory contains exactly two files:

- **`SKILL.md`** — YAML frontmatter + numbered step-by-step AI instructions with Preconditions, Forbidden Actions, Steps, Output, and Postconditions
- **`skill.meta.json`** — Validated against `schemas/skill-meta.schema.json`; fields: `slug`, `tier`, `version`, `description`, `depends_on`, `platform`, `tags`, `installation`

## 5. Schema Design (Artifact Pipeline)

Both `gitlab-tracked` and `github-tracked` schemas produce the same 4-artifact pipeline:

```
proposal.md → specs/<capability>/spec.md → design.md → tasks.md
```

### Artifact Definitions

| Artifact | File | Requires | Purpose |
|----------|------|----------|---------|
| proposal | `proposal.md` | — | Why, what changes, capabilities, impact |
| specs | `specs/**/*.md` | proposal | Formal requirements with WHEN/THEN scenarios |
| design | `design.md` | proposal | Technical decisions, architecture, risks |
| tasks | `tasks.md` | specs, design | Numbered Task Groups with checkboxes |

### Key Schema Features

- **Capabilities-driven specs**: Each capability from the proposal becomes `specs/<capability>/spec.md`
- **Delta operations**: ADDED / MODIFIED / REMOVED / RENAMED — changes accumulate into `openspec/specs/` at archive
- **Task Groups as checkpoints**: `## N. Group Name` in `tasks.md` = one child issue = one apply session = one review cycle
- **Template + instruction model**: Each artifact has a template (structure) and instruction (AI guidance); context/rules are constraints never included in output

## 6. Cross-Session Memory System

```
Layer 1: memory/ (always loaded at startup, ≤3 files, ≤2900 tokens)
    ├── MEMORY.md          → Hard constraints (project identity, sync rules, preferences)
    ├── session-bridge.md  → Last session Done / Waiting / Pitfalls / Discoveries (≤50 lines)
    └── pitfalls.md        → Cross-change pitfall log with source links (≤20 active entries)

Layer 2: wiki/ (on-demand, wikilink-navigable)
    ├── hot.md             → Current project pulse (~500 words, hard cap 600)
    ├── index.md           → Navigation index (≤40 lines, hard cap 80)
    └── architecture/ decisions/ patterns/ sessions/ research/ questions/ meta/

Layer 3: docs/ (untouched by memory system)
    └── Traditional docs, design specs, published articles
```

### Self-Maintenance Rules

- **Startup**: Read session-bridge → hot → index (max 3 files), then on-demand
- **Per-question**: Max 2 wiki pages before answering
- **After each Task Group complete**: Append pitfalls → `memory/pitfalls.md`; update decisions → `wiki/hot.md`
- **Every archive**: Compress session-bridge
- **pitfalls > 20 entries**: Rotate oldest 10 to Archive
- **hot.md > 550 words**: Trim oldest entries
- **Every 10 corgi sessions**: Suggest running `/corgi-lint`
- **11 lint checks**: Freshness, size caps, broken links, extraction completeness

## 7. CLI Architecture (corgispec)

`packages/corgispec/` — TypeScript, Commander.js, built with tsup, tested with Vitest (114 tests).

### Command Map (14 subcommands)

| Category | Command | Responsibility |
|----------|---------|---------------|
| **Setup** | `bootstrap` | Single-entry installer (fetch + clone + build + init) |
| | `install` | Project-local asset install (fresh/update/legacy/verify) |
| | `init` | Initialize openspec config |
| | `doctor` | Environment diagnostics |
| **Skill Mgmt** | `validate` | Schema + constraint validation of all skills |
| | `list` | List skills with tier/platform filters |
| | `graph` | Dependency graph (mermaid/dot output) |
| **Workflow** | `status` | Query change status |
| | `instructions` | Generate artifact instructions for AI |
| | `propose` | Create change directory |
| | `apply` | Trigger apply phase |
| | `review` | Trigger review phase |
| | `archive` | Trigger archive phase |

### Lib Module Reuse

| Module | Responsibility |
|--------|---------------|
| `config.ts` | Read/parse `openspec/config.yaml` |
| `skills.ts` | Skill discovery, parsing, validation |
| `schemas.ts` | Schema loading, artifact pipeline |
| `platform.ts` | Platform detection (gitlab vs github) |
| `bootstrap.ts` | Bootstrap orchestration logic |
| `install-assets.ts` | Asset copy/sync with manifest tracking |
| `memory-init.ts` | Memory system initialization |
| `changes.ts` | Change directory management |

## 8. Key Design Principles

1. **Agent-first**: All workflows triggered via LLM slash commands, not manual CLI
2. **Skill as product**: Core deliverable is SKILL.md files, not executable code
3. **Three-directory sync obligation**: `.opencode/` (canonical), `.claude/`, `.codex/` must stay in sync
4. **Checkpoint discipline**: Each Task Group is an atomic checkpoint with forced pause-for-review
5. **Memory-first continuity**: 3-layer memory solves AI session statelessness
6. **Platform abstraction**: Skill files use generic tool names; platform mapping at runtime
7. **Legacy coexistence**: `ds-skills` + `install-skills.sh` are legacy; `corgispec` CLI is the future
8. **No CI**: Validation is manual via `corgispec validate` or `ds-skills validate`

## 9. Compared to Vanilla OpenSpec

| Capability | Vanilla OpenSpec | This Project |
|------------|-----------------|-------------|
| Issue tracking | None | Parent/child via `glab`/`gh` CLI |
| Apply behavior | All tasks at once | Checkpoint-based, one group at a time |
| Progress sync | Local checkboxes only | Rich summaries posted to issues |
| Workflow labels | None | `backlog → todo → in-progress → review → done` |
| Review | None | 5-axis + verify gate + approve/reject/discuss |
| Spec format | Generic | Delta operations + formal scenarios |
| Worktree isolation | None | Opt-in `git worktree` parallel dev |
| Cross-session memory | None | 3-layer with ≤2900 token startup |
| Skill architecture | Flat files | Composable 3-tier with schema validation |

## 10. Recent Activity

- **Active change**: `single-entry bootstrap install` (branch: `bootstrap-install`) — implementation complete, branch preserved
- **`corgispec bootstrap`** now covers: fresh install, managed update, legacy migration, verify-only, user-level skill sync, project memory init, machine-readable JSON output
- **114 tests passing** in `packages/corgispec/` as of 2026-05-02
