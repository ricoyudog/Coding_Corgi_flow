# Hook Context Gate — Canonical Text

This document defines the canonical Step 1 gate text block added to all molecule-level skills. The gate enables hook-injected session context to short-circuit manual config reading.

## Canonical Gate Block

Insert this block at the **top of the first step** that reads `openspec/config.yaml` or performs project discovery. Do not renumber existing steps — the gate is content within a step, not a separate step.

```markdown
**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch
→ Gate passed — SKIP config reading below and proceed to the next step.
Otherwise: read `openspec/config.yaml` and proceed with discovery.
```

## Properties

- **3 lines** (condition, pass action, fallback action)
- **Platform-neutral** — no reference to Claude/OpenCode/Codex
- **Deterministic field list** — `isolation.mode`, active changes with worktree paths, current branch
- **~60 tokens** overhead per skill file

## Placement Rules

| Skill structure | Insertion point |
|---|---|
| `## Steps` → `### 1. Discover: ...` | Top of `### 1.` content (before config reading) |
| `**Steps**` → `1. **Step name**` | Top of step 1 content (indented under the item) |
| No `## Steps` (e.g., explore) | Top of the section that reads config |
| Skills that don't read config (ask, lint) | Top of `### 1.` as project-awareness check |

## Validation Pattern

The `corgispec validate` gate check (task 5.8) verifies all gated skill files contain this regex:

```
/\*\*Context Gate\*\*.*isolation\.mode.*active changes.*current branch/
```
