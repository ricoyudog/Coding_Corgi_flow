## Task: Create ask.md (Claude command dispatch)

- Created: `packages/corgispec/assets/commands/claude/corgi/ask.md`
- Structure follows `install.md` minimal dispatch pattern:
  - Claude frontmatter with `name: "Corgi: Ask"`, `description`, `category: Workflow`, `tags: [workflow, ask, experimental]`
  - One-line description
  - **Dispatches to**: `corgispec-ask`
  - Input description adapted from OpenCode `corgi-ask.md` (file path or `--pending` flag)
  - Step 1: Follow the skill; Step 2: Pass through all input
  - Example block included
- `corgispec-ask` appears 2x in the file (frontmatter + dispatch line)
- No platform detection or isolation checks added (not a pipeline command)

## Task: Create memory-init.md (Claude command dispatch)

- Created: `packages/corgispec/assets/commands/claude/corgi/memory-init.md`
- Structure follows `install.md` minimal dispatch pattern:
  - Claude frontmatter with `name: \Corgi: Memory Init\`, `description: Initialize the 3-layer memory structure (memory/ + wiki/) for cross-session AI continuity`, `category: Workflow`, `tags: [workflow, memory, experimental]`
  - One-line description: Initialize the 3-layer memory structure for cross-session AI continuity.
  - **Dispatches to**: `corgispec-memory-init`
  - Input description adapted from OpenCode `corgi-memory-init.md` (optional target project path)
  - Step 1: Follow the skill; Step 2: Pass through all input
- `corgispec-memory-init` appears 2x in the file (frontmatter dispatch line + step reference)
- No platform detection or isolation checks added (not a pipeline command)
- Created packages/corgispec/assets/commands/claude/corgi/migrate.md
- Pattern: YAML front matter with name, description, category, tags wrapped in ---
- Dispatch to corgispec-memory-migrate skill (universal, not platform-specific)
- Pre-requisite check: verify memory/ and wiki/ directories exist; if not, instruct user to run /corgi:memory-init (Claude syntax, not OpenCode /corgi-memory-init)
- Input flags: --auto-only (skip interactive phases), --phase N (run single phase)
- Steps: check preconditions -> follow migration skill -> pass through all input
