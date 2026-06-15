# Draft: Interactive Bootstrap Upgrade

## Requirements (confirmed)
- User wants: interactive options for corgispec bootstrap, like spec-kit's installer
- Choice 1: Which coding CLI to install for (OpenCode, Claude, Cursor, Codex, etc.)
- Choice 2: Global vs project-local installation
- Reference: openspec/speckit design patterns

## Research Findings

### Current corgispec bootstrap
- **Command**: `corgispec bootstrap --target <path> [--schema] [--mode] [--yes] [--no-memory] [--json]`
- **Platform support**: claude, opencode, codex (3 platforms)
- **Platform detection**: checks `~/.claude`, `~/.config/opencode`, `~/.codex` dirs exist
- **Installation behavior**: ALWAYS installs ALL platforms (no per-platform choice)
- **Installation scope**: ALWAYS does both project-local AND user-level (no scope choice)
- **Interactive prompts**: NONE - all flag-based, no interactive mode at all
- **Key files**:
  - `src/commands/bootstrap.ts` - CLI entry, flags parsing
  - `src/commands/install.ts` - user-level skill install (all platforms)
  - `src/lib/bootstrap.ts` - core bootstrap orchestration
  - `src/lib/install-assets.ts` - target state classification, file management
  - `src/lib/platform.ts` - platform definitions (3 platforms)
  - `src/assets/` - bundled assets (commands, schemas, skills, memory-init)

### Spec-kit's approach (inspiration)
- **Interactive selection**: `select_with_arrows()` with Rich + readchar
  - Arrow-key navigation, Rich Panel display
  - Non-interactive fallback: default to Copilot
- **Integration selection**: 30+ agents (copilot, claude, cursor, codex, gemini, etc.)
- **Progress visualization**: StepTracker with Rich Live, status icons (●/○)
- **Banner**: ASCII art with colored lines
- **Next Steps panel**: Shows post-init instructions per platform
- **Init options persistence**: `.specify/init-options.json`
- **Key UX patterns**:
  1. Banner → interactive prompts → progress steps → summary → next steps
  2. `--integration <name>` flag for non-interactive mode
  3. Auto-detect installed agents on system
  4. Per-agent setup instructions at the end

### Key Differences (spec-kit vs corgispec)
- Spec-kit: Python (Typer + Rich + readchar)
- Corgispec: TypeScript/Node (Commander.js)
- Spec-kit: single platform selection
- Corgispec: currently installs ALL platforms always
- Spec-kit: project-local only
- Corgispec: both project-local AND user-level

## Open Questions
1. Which additional platforms beyond current 3? (Cursor, Gemini, Windsurf, etc.)
2. Interactive prompt library preference for Node.js?
3. Should global install be default or opt-in?
4. Should the interactive mode be default or require a flag?
5. How to handle multi-platform selection (select one, select many)?
6. What to show in the "Next Steps" panel per platform?

## Scope Boundaries
- INCLUDE: Interactive prompts, platform selection, scope selection, Rich output
- EXCLUDE: (to be confirmed)
