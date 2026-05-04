# Single-Entry Bootstrap Install Design

**Date:** 2026-05-02

## Goal

Replace the current multi-step install and upgrade experience with one stable agent-facing entrypoint that works for:

- fresh install
- managed update
- legacy project migration
- verify-only health checks

The target outcome is that a user can tell an agent to install or upgrade a project, and the agent does not need to reconstruct the workflow from README fragments, scripts, and platform-specific commands.

## Scope

This design covers:

- a single fetchable agent install document at `.opencode/INSTALL.md`
- a new high-level `corgispec bootstrap` command
- automatic user-level skill installation as part of bootstrap
- automatic target project classification in `auto` mode
- safe handling for fresh, managed, legacy, and verify-only flows
- stable machine-readable output for agents
- README simplification so humans see one supported install entrypoint

This design does **not** cover:

- removing lower-level primitives such as `corgispec install` or `/corgi-install`
- replacing the current installer skill architecture with a generic workflow engine
- adding support for new AI platforms beyond the current OpenCode / Claude / Codex asset set
- silently overwriting locally modified managed files
- forcing non-interactive migration for risky paths unless the caller explicitly opts in

## Context

The current install knowledge is split across several surfaces:

- `README.md`
- `README.zh-TW.md`
- `install-skills.sh`
- `corgispec install`
- `/corgi-install` and `/corgi:install`
- the `corgispec-install` skill

This is workable for a careful human, but it is fragile for an agent. The agent currently has to infer:

- whether user-level skills are already installed
- whether the target project already ran `openspec init`
- whether the target is a fresh install, managed update, or legacy migration
- which install primitive is the correct entrypoint
- when it is safe to mutate files and when it must stop

The `superpowers` pattern is useful here because it does not ask the agent to infer a workflow from a long README. It gives the agent a single fetchable instruction document and keeps the execution shape narrow.

The important lesson is not just "add an `INSTALL.md` file." The real lesson is:

- one stable entrypoint
- one authoritative instruction surface for the agent
- minimal agent-side workflow inference
- the CLI, not the agent, owns the branching logic

## Problem Statement

Today, installation and upgrade are easy to do manually but too easy for agents to do incorrectly.

The concrete failures are:

1. **Entry drift** - there are multiple plausible install entrypoints, so the agent can pick the wrong one.
2. **State inference burden** - the agent has to decide whether the target is fresh, managed, or legacy.
3. **Layer confusion** - user-level and project-local setup are separate concerns, but the current flow exposes both directly.
4. **Legacy upgrade risk** - upgrading old projects requires backup and explicit approval, but the workflow is not concentrated in one place.
5. **Documentation drift risk** - README, scripts, CLI commands, and skill instructions can diverge.

## Design Principles

1. **Single entry for agents** - agents should start from one fetchable install document.
2. **CLI owns branching logic** - project state classification belongs in code, not in agent reasoning.
3. **Safe by default** - risky transitions must stop for approval instead of improvising.
4. **Keep lower-level primitives** - retain `corgispec install` and `/corgi-install` as building blocks and escape hatches.
5. **Machine-readable outcomes** - bootstrap must emit stable status that agents can summarize without scraping prose.
6. **Human docs stay human-sized** - README should point to the single entrypoint, not duplicate the whole execution graph.

## Approaches Considered

### 1. Documentation-only consolidation

Move the current multi-step instructions into one better markdown file and tell agents to follow it.

Why this is insufficient:

- it still leaves state classification in the agent
- it still depends on the agent executing a long ordered checklist without drift
- it moves the complexity, but does not remove it

### 2. Single agent dispatcher plus bootstrap command

Add a fetchable agent install document and a new high-level CLI command that performs the whole flow.

Why this is recommended:

- the agent only gathers missing inputs and runs one command
- state classification moves into tested code
- risky paths can enforce hard safety gates
- docs and behavior can stay aligned around one command surface

### 3. Keep `/corgi-install` as the primary entrypoint

Retain the current installer shape and make agents rely on the existing skill or command wrappers.

Why this is weaker:

- it still exposes the project-local installer as the top-level workflow even when user-level install is also required
- it keeps the two-layer mental model visible to the agent
- it does not produce the same "single command" onboarding shape that makes the `superpowers` model reliable

## Design Summary

The recommended architecture is:

- **Primary agent entrypoint:** `.opencode/INSTALL.md`
- **Primary bootstrap command:** `corgispec bootstrap`
- **Lower-level user primitive:** `corgispec install`
- **Lower-level project primitive:** `/corgi-install` and `/corgi:install`

The key shift is that `/corgi-install` stops being the main onboarding surface. It remains useful, but it becomes an internal or advanced primitive. The new primary entrypoint becomes:

1. fetch agent instructions
2. collect minimal input
3. run `corgispec bootstrap`
4. read the report and summarize the result

## Agent Entry Model

### `.opencode/INSTALL.md`

The install document should be written for agents, not for humans.

Its job is to:

- ask for `target project path` if missing
- ask for `schema` only when the CLI cannot resolve it from flags or existing config
- run the bootstrap command
- read the resulting report or JSON output
- summarize completion, failure, or required approval back to the user

It must **not** ask the agent to manually reconstruct the install workflow from README sections.

### README role after the change

README should become the human-facing pointer, for example:

1. install `corgispec`
2. tell your agent: `Fetch and follow instructions from https://raw.githubusercontent.com/ricoyudog/Coding_Corgi_flow/feat/openspec-llm-memory/.opencode/INSTALL.md`

The detailed branch logic should no longer live in README quick start.

If the supported `corgispec` installation path changes over time, README may still explain how to obtain the CLI, but it should not expand back into a full install workflow tutorial.

## CLI Surface

Add a new command:

```text
corgispec bootstrap --target <path>
```

Recommended options:

```text
corgispec bootstrap \
  --target <path> \
  [--schema gitlab-tracked|github-tracked] \
  [--mode auto|fresh|update|legacy|verify] \
  [--yes] \
  [--no-memory] \
  [--json]
```

Recommended defaults:

- `--mode auto`
- interactive prompts enabled unless `--yes` is passed
- human-readable output by default
- machine-readable output with `--json`

## Bootstrap Responsibilities

`corgispec bootstrap` is the single orchestration layer for install and upgrade.

It should own:

1. prerequisite checks
2. user-level skill sync
3. target project initialization when safe
4. target state classification
5. project-local install or update execution
6. report generation
7. machine-readable result output

This command should make the agent a thin executor rather than a workflow planner.

## Execution Flow

The bootstrap command should follow this fixed order.

### 1. Parse input

Inputs:

- `target`
- `schema` when provided
- `mode`, defaulting to `auto`
- `--yes`
- `--no-memory`
- `--json`

### 2. Run prerequisite checks

Before mutating the target project, bootstrap should verify:

- `openspec` CLI is available
- Node version satisfies CLI requirements
- `gh` or `glab` is available when the chosen schema requires it
- user-level platform directories exist or can be created

If prerequisites fail, bootstrap stops before touching the target project.

### 3. Perform user-level sync

Bootstrap should always run the equivalent of:

```text
corgispec install
```

This removes the need for the agent to remember a separate user-level install step.

### 4. Inspect target project

Bootstrap then inspects the target path for:

- `openspec/config.yaml`
- `openspec/.corgi-install.json`
- managed files already present in `.opencode/commands/`, `.claude/commands/`, and `openspec/schemas/`

### 5. Classify target state

Recommended classification rules:

| State | Detection | Action |
|---|---|---|
| init-needed | no `openspec/config.yaml` and no managed files | run `openspec init`, then continue as fresh install |
| fresh | config exists, no manifest, no managed files | fresh install |
| managed-update | config exists and manifest exists | verify hashes, then update |
| legacy | config exists, no manifest, managed files exist | backup + approval gate + migration |
| inconsistent | config missing but managed files exist | stop with repair guidance |

This classification logic belongs in code, not in the agent prompt.

### 6. Execute the classified flow

#### Fresh install

- copy project-local managed files
- patch installer-owned fields in `openspec/config.yaml`
- optionally initialize memory
- write manifest and report

#### Managed update

- compare current managed file hashes to manifest
- if clean, update files and refresh manifest
- if locally modified, stop and report the conflict

#### Legacy migration

- create `openspec/.corgi-backups/<timestamp>/`
- present the detected legacy state clearly
- require explicit approval unless `--yes` was passed
- if approved, proceed with migration and write the first manifest
- if declined, stop cleanly with a report

#### Verify-only

- do not mutate project-local managed files
- only write the verification report

## Approval and Failure Rules

Bootstrap must prefer explicit stop conditions over fallback behavior.

### Required stop conditions

- prerequisite failure
- ambiguous schema that cannot be resolved from existing config or flags
- locally modified managed files during managed update
- inconsistent target state
- denied legacy migration approval

### Required approval gate

Legacy migration is the critical risky path.

Rules:

- backup first
- then ask for approval
- never overwrite legacy-managed files silently

`--yes` may pre-approve this path for fully non-interactive automation, but only after the backup step is complete.

## Output Contract

Bootstrap should produce both:

- a human-readable summary on stdout
- a stable JSON payload with `--json`

It should also write the project-local report at:

```text
openspec/.corgi-install-report.md
```

Recommended JSON shape:

```json
{
  "status": "success|failed|needs-approval|stopped",
  "mode": "fresh|update|legacy|verify",
  "target": "/abs/path/to/project",
  "actions": ["installed-user-skills", "initialized-openspec", "migrated-legacy"],
  "reportPath": "/abs/path/to/project/openspec/.corgi-install-report.md",
  "manifestPath": "/abs/path/to/project/openspec/.corgi-install.json",
  "message": "Human-readable summary"
}
```

The exact field names may vary, but the command should expose enough structure that an agent can summarize the outcome without guessing.

## Relationship to Existing Commands

### `corgispec install`

Keep as the lower-level user-skill installation primitive.

### `/corgi-install` and `/corgi:install`

Keep as project-local installer primitives and as advanced or manual entrypoints.

However, these should no longer be the primary onboarding surface for agent-driven setup.

### `install-skills.sh`

Demote to legacy compatibility. The recommended path moves to `corgispec install`.

## Documentation Changes

### `.opencode/INSTALL.md`

Add a short agent-oriented install doc that:

- tells the agent to collect `target path`
- tells the agent to run `corgispec bootstrap --target <path> --mode auto`
- tells the agent to ask follow-up questions only when the CLI requires them
- tells the agent to read and summarize the install report

This file should be short and operational, closer to a dispatcher than to a tutorial.

### `README.md` and `README.zh-TW.md`

Reduce quick start to:

- prerequisites
- install `corgispec`
- tell the agent to fetch and follow `.opencode/INSTALL.md`

Long-form step-by-step details can move to reference sections, but they should no longer be the primary path.

## Testing Strategy

The implementation should be verified at three levels.

### 1. Unit tests

- target state classification
- installer-owned config patching
- manifest generation
- report generation
- approval gate logic

### 2. CLI integration tests

- fresh install from an initialized target
- fresh install with `openspec init` bootstrapped automatically
- managed update with clean hashes
- managed update with local modifications
- legacy migration with approval
- legacy migration with decline
- verify-only mode
- prerequisite failure
- inconsistent target state

### 3. Documentation consistency checks

- `.opencode/INSTALL.md` reflects the real bootstrap command surface
- README points to the fetchable install doc instead of duplicating the flow
- legacy references do not present `install-skills.sh` as the primary path

## Rollout Plan

### Phase 1

- add `corgispec bootstrap`
- add `.opencode/INSTALL.md`
- keep existing install paths working

### Phase 2

- update README and localized README to the single-entry model
- de-emphasize direct `/corgi-install` onboarding in human docs

### Phase 3

- decide whether any older install surfaces should be removed or retained as advanced-only tools

## Why This Design

This design solves the actual failure mode.

The problem is not that the current docs are missing detail. The problem is that agents are being asked to behave like workflow routers.

The recommended design reverses that:

- docs point to one place
- agents gather minimal input
- the CLI classifies state and enforces safety
- lower-level primitives stay available without remaining the primary onboarding path

That gives this repository the same practical advantage visible in the `superpowers` install model: one obvious entrypoint, one narrow execution path, and far less room for agent error.
