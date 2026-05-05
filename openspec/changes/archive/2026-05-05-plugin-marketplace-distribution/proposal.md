## Why

CorgiSpec currently requires manual cloning + install scripts to set up in a project. Both Codex and Claude Code now support native Plugin systems with Marketplace distribution — enabling one-click team installation. We should meet users where they are so teams can install CorgiSpec as a plugin with a single command, rather than running bootstrap scripts.

## What Changes

- Create `.claude-plugin/plugin.json` — Claude Code Plugin manifest (auto-discovered skills, commands, agents)
- Create `.codex-plugin/plugin.json` — Codex Plugin manifest with full `interface` block for marketplace display
- Replace `.codex/skills/` physical copies with symlinks pointing to `.claude/skills/` (canonical source) — eliminates sync drift between platforms
- Add `.agents/skills/` symlinks → `.claude/skills/` for Codex's alternative skill discovery path
- Create `.claude-plugin/marketplace.json` — cross-platform marketplace registry (Claude Code + Codex compatible)
- Create `.claude/settings.json` — team auto-install with `enabledPlugins` and `extraKnownMarketplaces`
- Create `setup.sh` — one-click init script that creates symlinks and validates the plugin structure
- Extend `install-skills.sh` to support Codex symlink creation alongside existing OpenCode + Claude Code targets

## Capabilities

### New Capabilities

- `plugin-packaging`: Plugin manifests (`plugin.json`) for both Claude Code and Codex platforms, following each platform's schema rules and validation constraints. Includes directory structure, author metadata, and interface presentation.
- `cross-platform-skill-sync`: Symlink-based skill sharing from a single canonical source (`.claude/skills/`) to `.codex/skills/` and `.agents/skills/`. Respects the Claude Code symlink cache limitation (skill body MUST be in `.claude/skills/`, cannot be symlinked from elsewhere).
- `marketplace-configuration`: Marketplace registry (`marketplace.json`) for team distribution — supports both Claude Code's `/plugin marketplace add` workflow and Codex's repo-scoped marketplace with `git-subdir` source type. Includes team auto-install via `.claude/settings.json`.
- `one-click-setup`: A `setup.sh` script that handles symlink creation and plugin structure validation in one step, usable both in this repo and in target projects after plugin distribution.

### Modified Capabilities

_None — no existing capabilities are changing._

## Impact

- **Affected directories**: `.claude-plugin/` (new), `.codex-plugin/` (new), `.codex/skills/` (symlink migration), `.agents/plugins/` (new)
- **Dependencies**: Requires Claude Code v2.0.12+ and Codex v0.117.0+ for plugin support
- **User-facing changes**: Teams will install via `/plugin install` (Claude Code) or `codex plugin install` (Codex) instead of manual bootstrap
- **No breaking changes** to existing OpenSpec workflow, skill files, or OpenCode integration
- No new external dependencies — uses symlinks (already supported on Linux/macOS; optional `.bat` helper for Windows)

## GitLab Issue

<!-- This section will be filled automatically by the propose skill with the parent issue link. -->
