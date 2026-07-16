**English** | [繁體中文](README.zh-TW.md)

# 🐕 Coding Corgi Flow

> **Your AI pipeline, structured.**  
> A workflow toolkit that turns any AI coding assistant into a disciplined engineering partner — proposal to archive, tracked and reviewable.

<p align="center">
  <img src="docs/assets/developer_tools_banner.png" alt="Coding Corgi Flow — Your AI pipeline, structured" width="100%"/>
</p>

---

## 🐾 Before & After

<table>
  <tr>
    <td align="center" width="50%"><b>😫 Without Corgi</b></td>
    <td align="center" width="50%"><b>🐕 With Corgi Flow</b></td>
  </tr>
  <tr>
    <td><img src="docs/articles/corgi_developer_chaos.png" alt="AI coding chaos without workflow management"/></td>
    <td><img src="docs/articles/corgi_developer_confident.png" alt="Structured AI coding with Coding Corgi Flow"/></td>
  </tr>
  <tr>
    <td align="center">No pipeline. No tracking.<br/>Code spaghetti. Repeated mistakes.</td>
    <td align="center">Schema-driven planning. Issue tracking.<br/>Checkpoint execution. 5-axis review.</td>
  </tr>
</table>

## 🗺️ The Pipeline

<p align="center">
  <img src="docs/assets/corgi_journey_illustration.png" alt="Corgi journey: Propose → Apply → Verify → Review → Archive" width="100%"/>
</p>

<p align="center">
  <img src="docs/assets/corgi-loop-pipeline-flow.png" alt="Complete Corgi Loop pipeline — from /corgi:propose through Manual vs Automated paths, converging to /corgi:archive" width="100%"/>
</p>

---

## 🔧 What This Is

Coding Corgi Flow is the **community extension** of [OpenSpec](https://github.com/Fission-AI/OpenSpec) by [Fission AI](https://github.com/Fission-AI). We layer custom schemas, AI skills, and CLI tooling on top of OpenSpec's core artifact pipeline to add what real teams need:

| Superpower | Why you need it |
|---|---|
| 📌 **Automatic Issue Tracking** | Parent + child issues on GitLab or GitHub, labels synced |
| 🛑 **Checkpoint-based Apply** | One Task Group at a time — never lose control of your AI |
| ✅ **Automated Verify Gate** | Lint, build, tests, spec coverage — blocks review on failure |
| 🔍 **5-Axis Review** | Architecture · Security · Performance · Quality · Completeness |
| 🧠 **Cross-Session Memory** | 3-layer system — your AI remembers across sessions (≤3000 tokens at startup) |
| 🌿 **Worktree Isolation** | Parallel changes, each in its own git worktree (opt-in) |
| 🧩 **Composable Skills** | Atoms → Molecules → Compounds with validated metadata |
| 🪝 **Session Hooks** | Lifecycle hooks (pre-write, pre-bash, session-start…) with context gates |
| 🔄 **Automated Pipeline (Loop)** | One-command apply-verify-review per group with auto-approve/fix, zero human gates |
| 📦 **One-command Install** | `npm i -g corgispec@next` → `corgispec bootstrap` → done |

It ships as an npm CLI (`corgispec`), a Claude Code / Codex plugin, and a set of slash commands for OpenCode, Claude Code, and Codex.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js >=20.19.0**
- **OpenSpec CLI >=1.6.0 <2.0.0** — OpenSpec 1.3–1.5 are not supported by CorgiSpec 3
- **An LLM Agent** — OpenCode, Claude Code, Cursor, AmpCode, etc.
- **`gh` CLI** (for GitHub) or **`glab` CLI** (for GitLab), only when issue tracking is enabled

### Install & Bootstrap

Choose your path:

**A. npm (recommended)**

```bash
npm install -g @fission-ai/openspec@^1.6.0
npm install -g corgispec@next
corgispec doctor --path /path/to/your-project
```

`next` is the prerelease channel and currently resolves to `3.0.0-rc.2`. For a reproducible install, pin it with `npm install -g corgispec@3.0.0-rc.2`. The unqualified `corgispec` package and the `latest` tag remain on stable `2.4.3`; they do not install this RC.

Options: `--platform <platforms>` (claude, opencode, codex; default: all), `--scope <scope>` (global, local, both; default: global). When TTY is detected and flags are not provided, interactive prompts ask for platform and scope.

```bash
# Basic (all platforms, global scope)
corgispec bootstrap --target /path/to/your-project --schema github-tracked

# Specific platforms
corgispec bootstrap --target /path/to/your-project --platform opencode --schema github-tracked

# Local scope only
corgispec bootstrap --target /path/to/your-project --scope local --schema github-tracked

# Interactive mode
corgispec bootstrap --target /path/to/your-project
```

**B. Claude Code / Codex Plugin**

```text
# Claude Code
/plugin marketplace add ricoyudog/Coding_Corgi_flow
/plugin install corgispec@corgispec

# Codex
codex plugin install corgispec
```

**C. Bootstrap via AI Agent**

Paste this into your agent:

```text
Fetch and follow instructions from https://raw.githubusercontent.com/ricoyudog/Coding_Corgi_flow/master/.opencode/INSTALL.md
```

### Initialize Memory (recommended)

```text
# OpenCode
/corgi-memory-init

# Claude Code
/corgi:memory-init
```

### Start Building

```text
# OpenCode
/corgi-propose Add user authentication with JWT and refresh tokens

# Claude Code
/corgi:propose Add user authentication with JWT and refresh tokens
```

Then: `apply` → `verify` → `review` → `human-qa` → `archive`. One Task Group at a time.

---

## 🎮 Commands

| Command              | What it does                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `/corgi-propose`     | Generate planning artifacts (proposal, specs, design, tasks) + create issues                                       |
| `/corgi-update`      | Reconcile existing planning artifacts, with one confirmed artifact-scoped diff at a time                           |
| `/corgi-ready`       | Check deterministic planning integrity before apply or loop                                                        |
| `/corgi-apply`       | Execute one Task Group, sync closeout, pause for review                                                            |
| `/corgi-verify`      | Automated quality gate — lint, build, tests, spec coverage                                                         |
| `/corgi-review`      | 5-axis review with evidence gathering, approve/reject/discuss                                                      |
| `/corgi-loop`        | Run Contract v2 pipeline — CAS-safe apply, evidence, review, commit, recovery, and finalization                    |
| `/corgi-converge`    | Compare fresh planning/Git/evidence and append one confirmed successor Task Group when implementation has a gap    |
| `/corgi-human-qa`    | Human QA gate — route to specialized QA atoms (smoke, UI, API, CLI, backend, exploratory)                          |
| `/corgi-archive`     | Close issues, sync delta specs, extract knowledge, cleanup                                                         |
| `/corgi-explore`     | Thinking partner — explore ideas, clarify requirements                                                             |
| `/corgi-install`     | Project-local asset install, update, or verify                                                                     |
| `/corgi-memory-init` | Initialize 3-layer memory (`memory/` + `wiki/`)                                                                    |
| `/corgi-migrate`     | Import existing knowledge into memory/wiki                                                                         |
| `/corgi-lint`        | 14-check memory health validation                                                                                  |
| `/corgi-ask`         | Answer questions from the vault with budget-aware retrieval                                                        |

> Claude Code uses `/corgi:<command>` syntax (e.g., `/corgi:propose`). Platform auto-detected from `config.yaml`.

### Planning integrity in 3.0 RC

OpenSpec 1.6 JSON is the source of truth for artifact dependencies, glob-expanded files, instructions, and locations. Corgi uses the returned `planningHome`, `changeRoot`, `artifactPaths`, and `actionContext`; it does not assume a local `openspec/changes/<name>` directory or hard-code artifact filenames. This also allows a change selected from an OpenSpec Store to live outside the current repository.

```bash
# Read-only coordination context; the skill performs confirmed planning edits.
corgispec update add-auth --json

# Deterministic preflight. --strict also promotes warnings to blockers.
corgispec ready add-auth --strict --json

# Select an OpenSpec Store explicitly when needed.
corgispec ready add-auth --store shared-product --strict --json

# Read-only convergence evaluation. Confirmation is a separate, token-bound call.
corgispec converge add-auth --json
```

Confirmed converge operations are crash-resumable. If the confirmed call is interrupted, rerun it with the same `confirmationToken`; the CLI resumes the durable intent idempotently and remains the only writer of planning and loop state.

For `ready`, exit code `0` means ready, `1` means a planning blocker, and `2` means an environment or contract error. `update` uses `0` when coordination may proceed, `1` when an active or recovery-pending loop blocks planning edits, and `2` for contract errors. In agent sessions, use `/corgi:update`, `/corgi:ready`, and `/corgi:converge` (Claude Code), the dash-named OpenCode commands, or the installed matching Codex skills.

---

## ✨ Feature Showcase

<table>
  <tr>
    <td width="50%">
      <b>📋 Checkpoint-based Apply</b><br/>
      One Task Group at a time, pauses for review — never lose control.
      <br/><br/>
      <img src="docs/articles/images/group check point.png" alt="Checkpoint-based apply" width="100%"/>
    </td>
    <td width="50%">
      <b>📌 Automatic Issue Tracking</b><br/>
      Parent + child issues on GitLab or GitHub, labels synced automatically.
      <br/><br/>
      <img src="docs/articles/images/issue_board_example.png" alt="Issue board" width="100%"/>
    </td>
  </tr>
  <tr>
    <td>
      <b>✅ Task Management</b><br/>
      Tasks broken into groups with clear checklist tracking.
      <br/><br/>
      <img src="docs/articles/images/task_list.png" alt="Task list" width="100%"/>
    </td>
    <td>
      <b>🔍 5-Axis Review</b><br/>
      Architecture · Security · Performance · Quality · Completeness.
      <br/><br/>
      <img src="docs/articles/images/issue_card_example.png" alt="Review card" width="100%"/>
    </td>
  </tr>
</table>

---

## 🧠 Cross-Session Memory

AI sessions are stateless by default. Corgi Flow adds a **3-layer memory system** that persists knowledge across sessions — ≤2900 tokens at startup, self-compacting, Obsidian-compatible.

<p align="center">
  <img src="docs/assets/corgi_knowledge_vault.png" alt="3-layer memory system" width="80%"/>
</p>

<details>
<summary>Precise diagram (Mermaid)</summary>

```mermaid
flowchart LR
    subgraph "Layer 1: memory/ (always loaded)"
        A["MEMORY.md"] --- B["session-bridge.md"] --- C["pitfalls.md"]
    end
    subgraph "Layer 2: wiki/ (on-demand)"
        D["hot.md"] --- E["index.md"] --- F["patterns/ sessions/ decisions/ ..."]
    end
    subgraph "Layer 3: docs/ (untouched)"
        G["existing docs"]
    end

    B -.->|"startup read"| D
    D -.->|"navigate"| E
    E -.->|"wikilinks"| F
    F -.->|"references"| G
```

</details>

> 📸 See it in action: ![](docs/articles/images/obisidian_wiki_example.png)

| Scenario | Command |
|---|---|
| New project | Paste Quick Start prompt → `corgispec bootstrap` |
| Add memory to existing | `/corgi-memory-init` |
| Migrate existing KB | `/corgi-migrate` |
| Health check | `/corgi-lint` |

→ **[Full Memory Documentation](docs/cross-session-memory.md)**

---

## 🪝 Session Hooks

Hooks give you **lifecycle control** over AI sessions — validate context before execution, guard dangerous operations, and enforce memory compaction rules.

### CLI Commands

| Command | Purpose |
|---|---|
| `corgispec hooks generate --platform <name>` | Generate hook config for `claude`, `opencode`, or `codex`: Claude Code JSON, an OpenCode TypeScript plugin, or Codex TOML plus Node `.cjs` wrappers |
| `corgispec hook <name>` | Invoke a runtime hook where `name` is one of: `session-start`, `pre-write`, `post-write`, `pre-bash`, `post-compact`, `stop-check`, `loop-check` |

### Available Hooks

| Hook | Fires when | Purpose |
|---|---|---|
| `session-start` | Session begins | Load memory, validate environment |
| `pre-write` | Before any file write | Guard protected paths, enforce patterns |
| `post-write` | After file write | Trigger lint, sync mirrors |
| `pre-bash` | Before shell commands | Block destructive ops, enforce allowlists |
| `post-compact` | After context compaction | Ensure session-bridge is updated |
| `stop-check` | Before session ends | Validate shutdown state, flush memory |
| `loop-check` | Before a loop-driven session ends | Inspect canonical Run Contract v2 state and return the required next action |

Claude Code and Codex have awaited lifecycle hooks, so a non-zero `stop-check` or `loop-check` exit can stop completion directly. OpenCode 1.18.x does not expose an awaited stop hook: its generated plugin observes `session.idle`, preserves hook stdout/stderr, and calls `session.promptAsync` to re-enter the interactive session when work remains. The authoritative hard gates are still `corgispec ready` and the canonical `corgispec loop ...` state transitions. A one-shot `opencode run` can tear down before that asynchronous re-entry completes, so automation should explicitly inspect the ready/loop CLI result instead of treating idle as completion.

### Context Gates

Every molecule skill includes a **context gate** — a structured pre-execution check that validates required context (config, worktree state, issue references) is present before the skill runs. This prevents partial execution in incomplete environments.

```text
# Example: corgispec-apply checks for:
✓ openspec/config.yaml exists
✓ OpenSpec resolves one authoritative change root
✓ The configured task artifact has uncompleted groups
✓ Issue tracker reachable
```

Hooks are **opt-in** — existing projects work without them. Run `corgispec hooks generate --platform <name>` to get started.

---

## 🔄 Automated Pipeline (Loop)

Manually running `/corgi:apply` → `/corgi:verify` → `/corgi:review` for every Task Group works — but it means 3+ command invocations per group. The **Corgi Loop** automates this.

```text
# One command to rule them all:
/corgi:loop <change-name>
```

**What it does:** Executes one bounded **Task Group attempt** (apply → verify → review evidence), then submits it to the deterministic Run Contract v2 CLI. Skills never write lifecycle files. The CLI owns locking, CAS, event replay, evidence validation, commit acknowledgement, and finalization.

| Mode | Behavior |
|---|---|
| **Approve and commit** | Clean evidence/review → `awaiting_group_commit`; the CLI verifies a clean, matching commit tree before advancing |
| **Auto-fix loop** | Self-driven failure with retry budget → `fixing`; hook-driven or exhausted retries stop deterministically |
| **Crash recovery** | Fsynced events replay into atomic snapshots; only a truncated final JSONL record can be repaired automatically |

**Platform differences:**

| | Claude Code | OpenCode |
|---|---|---|
| Driving mode | Hook-driven (stop-based) | Self-driven (`selfDriven: true`) |
| On failure | Stops immediately | Auto-retry up to 3 times |
| Command | `/corgi:loop <name>` | `/corgi-loop <name>` |

Canonical state is stored under `.corgi/loop/<change>/`, with atomic per-run snapshots and append-only event/triage logs. Every mutation carries `stateRevision + nonce`; stale tokens and conflicting sessions leave the filesystem unchanged.

**Design principle:** *Hard Logic Orchestrates, LLM Executes.* The CLI owns state-machine transitions, validation, evidence identity, locks, recovery, and circuit breakers. The LLM skill executes bounded work and submits truthful evidence through the CLI.

→ **[Full Loop Guide](.opencode/skills/compounds/corgispec-loop/SKILL.md)**

---

## 🧩 Skill Architecture

Skills are organized in a **composable 3-tier hierarchy**:

<p align="center">
  <img src="docs/assets/coding_corgi_architecture.png" alt="Coding Corgi Flow System Architecture" width="100%"/>
</p>

| Tier | Role | Dependencies |
|---|---|---|
| **Atom** | Single reusable operation (resolve config, parse tasks) | None |
| **Molecule** | Workflow combining atoms (propose, apply, review) | Atoms only |
| **Compound** | End-to-end orchestration (the full pipeline) | Molecules only |

Each skill has two files:
- `SKILL.md` — AI-readable instructions
- `skill.meta.json` — Machine-readable metadata (tier, deps, platform, version)

Validate and visualize with the `ds-skills` CLI:

```bash
cd tools/ds-skills && npm install
node bin/ds-skills.js validate --path ../..    # schema + tier + cycle checks
node bin/ds-skills.js graph --path ../..        # dependency graph (Mermaid)
node bin/ds-skills.js list --path ../.. --tier atom --platform github
```

---

## 📐 Schemas

A schema defines the artifact pipeline. CorgiSpec accepts any OpenSpec schema name and follows the artifact graph and paths reported by OpenSpec. The two bundled schemas (`gitlab-tracked`, `github-tracked`) produce the following 4-artifact pipeline:

| Artifact | File | Purpose |
|---|---|---|
| **Proposal** | `proposal.md` | Motivation, scope, capabilities, impact |
| **Specs** | `specs/<capability>/spec.md` | Formal WHEN/THEN scenarios (one per capability) |
| **Design** | `design.md` | Technical decisions, architecture, risks, trade-offs |
| **Tasks** | `tasks.md` | Numbered Task Groups with checkboxes — each becomes a child issue |

Pipeline: `proposal → specs → design → tasks → apply`

Key decisions:
- **Capability-driven specs** — one spec file per capability, traceable contracts
- **Delta spec model** — ADDED/MODIFIED/REMOVED/RENAMED operations accumulate into canonical specs
- **Task Groups as checkpoints** — each `## N. Group` = one child issue, one apply session, one review cycle

<details>
<summary>Creating a custom schema</summary>

Create `openspec/schemas/my-schema/`:

```
my-schema/
├── schema.yaml
└── templates/
    ├── proposal.md
    └── tasks.md
```

`schema.yaml`:

```yaml
name: my-schema
version: 1
description: Lightweight workflow with proposal and tasks

artifacts:
  - id: proposal
    generates: proposal.md
    description: What and why
    template: proposal.md
    instruction: |
      Write the proposal explaining the change motivation and scope.
    requires: []

  - id: tasks
    generates: tasks.md
    description: Implementation checklist
    template: tasks.md
    instruction: |
      Break implementation into numbered Task Groups with checkboxes.
    requires:
      - proposal

apply:
  requires:
    - tasks
  tracks: tasks.md
  instruction: |
    Execute one Task Group at a time. Mark tasks as [x] when done.
```

Set `schema: my-schema` in `config.yaml`.

</details>

---

## ⚖️ Vanilla OpenSpec vs. Corgi Flow

| Capability | Vanilla OpenSpec | Coding Corgi Flow |
|---|---|---|
| Issue tracking | None | Parent/child issues via `gh` or `glab` |
| Apply behavior | All tasks at once | Checkpoint-based: one group, pause, review |
| Progress sync | Local checkboxes only | Rich summaries posted to issues |
| Workflow labels | None | `backlog → todo → in-progress → review → done` |
| Review | None | 5-axis automated checks + verify gate + decision loop |
| Human QA | None | Structured QA with 6 specialized atoms (smoke, UI, API, CLI, backend, exploratory) |
| Spec format | Generic | Delta ops (ADDED/MODIFIED/REMOVED/RENAMED) |
| Worktree isolation | None | Opt-in parallel dev via git worktrees |
| Cross-session memory | None | 3-layer system with self-compaction |
| Knowledge migration | None | Guided import from docs, archives, vault pages |
| Memory health | None | 14-check lint (freshness, caps, links, extraction) |
| Skill architecture | Flat files | Atoms → Molecules → Compounds with schema validation |
| Session hooks | None | Lifecycle hooks (pre-write, pre-bash, session-start…) + context gates |
| Automated pipeline | None | One-command loop: apply, verify, review per group with auto-approve/fix |
| Plugin marketplace | None | Claude Code `/plugin install` + Codex marketplace |

---

## ⚙️ Configuration

All settings live in `openspec/config.yaml`:

```yaml
schema: product-delivery     # any installed OpenSpec schema

# Optional Corgi-specific settings
corgi:
  tracking:
    provider: github         # github | gitlab | none
  taskArtifactId: tasks      # artifact containing executable Task Groups

# Optional: worktree isolation for parallel changes
isolation:
  mode: worktree             # worktree | none (default: none)
  root: .worktrees
  branch_prefix: feat/

# Optional: project context for AI-generated artifacts
context: |
  Tech stack: TypeScript, Next.js 14, Prisma, PostgreSQL
  Domain: e-commerce platform

# Optional: per-artifact rules
rules:
  proposal:
    - Keep proposals under 500 words
  tasks:
    - Max 2 hours per task
```

`schema` selects only the OpenSpec workflow; it no longer selects an issue tracker. `corgi.taskArtifactId` may be omitted only when the schema exposes an artifact whose id is exactly `tasks`. Apply and ready require that artifact to resolve to one concrete file. The installer preserves project-owned `context` and `rules`.

### Migrating from CorgiSpec 2.x

1. Upgrade to Node >=20.19.0 and OpenSpec >=1.6.0 <2.0.0, then install `corgispec@next` (currently `3.0.0-rc.2`) or pin `corgispec@3.0.0-rc.2` exactly. The unqualified package remains stable `2.4.3` via `latest`.
2. Keep your existing schema name, but make the inferred tracker explicit:

   ```yaml
   schema: github-tracked
   corgi:
     tracking:
       provider: github
     taskArtifactId: tasks
   ```

   Use `gitlab` for `gitlab-tracked`, or `none` when no issue integration is wanted. Legacy inference remains readable during migration and `corgispec doctor` reports the recommended edit.
3. Run `corgispec doctor --path .`, followed by `corgispec ready <change> --strict --json` for every active change. Resolve all blockers before apply.
4. If the change belongs to a Store, repeat lifecycle commands with `--store <id>` and use only the authoritative paths returned in JSON.

OpenSpec 1.3–1.5 cannot be used as a fallback. Upgrade OpenSpec first if doctor reports `openspec_version_unsupported`.

For full install/update/verify reference (fresh install, managed update, local modifications, legacy migration), see [Install / Update / Verify Workflow](#-install--update--verify-reference) below.

---

## 📂 Repository Layout

```
schemas/
└── skill-meta.schema.json            # JSON Schema for skill validation

packages/corgispec/                   # Unified CLI (npm publishable)
├── src/                              # TypeScript source
│   └── commands/hooks/               # Hook subcommand (generate)
├── dist/                             # Built output
└── assets/                           # Bundled assets

tools/ds-skills/                      # Skill CLI (legacy, use corgispec)
├── bin/ds-skills.js
├── lib/{loader,validate,list,graph}.js
└── tests/

docs/
├── articles/                         # Comics, screenshots, publish kits
│   └── images/                       # Feature screenshots
├── plans/                            # Design & planning documents
└── specs/                            # Feature design specs

openspec/
├── config.yaml
├── schemas/{gitlab,github}-tracked/  # Schema definitions + templates
├── specs/                            # Accumulated canonical specs
└── changes/                          # Active change directories

.opencode/
├── skills/corgispec-*/               # Source of truth: SKILL.md + skill.meta.json
└── commands/corgi-*.md               # Slash command dispatch

.claude/
├── skills/corgispec-*/               # Claude Code skill mirrors
├── commands/corgi/                   # Claude slash command dispatch
└── settings.json                     # Team auto-install config

.claude-plugin/                       # Claude Code Plugin manifest
.codex-plugin/                        # Codex Plugin manifest
.codex/skills/corgispec-*/           # Codex skill symlinks → .claude/skills/
```

---

## 📖 Docs

| Article | Lang | Description |
|---|---|---|
| [Cross-Session Memory](docs/cross-session-memory.md) | EN / [中文](docs/cross-session-memory.zh-TW.md) | Architecture, lifecycle, migration |
| [OpenSpec 落地 GitHub](docs/superpowers/articles/2026-04-28-openspec-github-workflow-zhihu.md) | 中文 | Spec → Issue → Review → Git pipeline integration |

---

## 🤝 Contributing

1. Fork and clone
2. Create or update a skill under `.opencode/skills/`
3. Each skill needs `SKILL.md` (AI instructions) + `skill.meta.json` (metadata)
4. Validate: `node tools/ds-skills/bin/ds-skills.js validate --path .`
5. Test locally, then submit a PR
6. Sync changes across `.opencode/skills/`, `.claude/skills/`, and `.codex/skills/`

---

## 🔧 Install / Update / Verify Reference

The installer supports four modes:

### Fresh Install

The target project has no managed files yet:

```text
/corgi-install --mode fresh --path /path/to/your-project
```

Copies managed files to `.opencode/`, `.claude/`, `openspec/schemas/`, patches `config.yaml` minimally, writes install manifest and report.

### Managed Update

The project already has `openspec/.corgi-install.json`:

```text
/corgi-install --mode update --path /path/to/your-project
```

If local modifications are detected, the installer prints a diff, stops, and asks for manual resolution — it never silently overwrites your changes.

### Verify-Only

Health check without mutations:

```text
/corgi-install --mode verify --path /path/to/your-project
```

### Legacy Migration

If managed files exist but no install manifest, the installer classifies it as legacy, creates backups, and asks for confirmation before migrating.

---

## 🙏 Acknowledgments

Built on [OpenSpec](https://github.com/Fission-AI/OpenSpec) by [Fission AI](https://github.com/Fission-AI). The core CLI, artifact pipeline engine, and change lifecycle are all OpenSpec — we extend it with custom schemas, AI skills, issue tracking, memory, and review automation.

If you find this useful, please ⭐ [OpenSpec](https://github.com/Fission-AI/OpenSpec) too.

---

## 📸 Image Credits

- **Hero Banner** & **Pipeline Illustration** & **Architecture Diagram** & **Memory Vault** — AI-generated for this project
- **Corgi Comics** (chaos, confident, journey, knowledge) — AI-generated for the project articles
- **Feature Screenshots** — from real usage of Coding Corgi Flow on GitHub/GitLab projects
