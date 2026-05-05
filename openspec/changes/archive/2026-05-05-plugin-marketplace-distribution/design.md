## Context

CorgiSpec currently distributes skills via `install-skills.sh`, which copies `.opencode/skills/` (canonical) to Claude Code and OpenCode user-level directories. Physical copies of all 17 skills also exist in `.codex/skills/` — introducing sync drift risk.

Both Codex (v0.117.0+) and Claude Code (v2.0.12+) now support a native Plugin system with Marketplace distribution (see `wiki/research/codex-claude-plugin-distribution-research.md`). This change adds the Plugin packaging layer on top of the existing skill files — it does not modify the skills themselves.

**Constraint**: `.opencode/skills/` is the source of truth per AGENTS.md convention. The existing `skill.meta.json` files already declare `installation.targets: ["opencode", "claude", "codex"]`.

## Goals / Non-Goals

**Goals:**
- Teams can install CorgiSpec on Claude Code with `/plugin install corgispec`
- Teams can install CorgiSpec on Codex with `codex plugin install corgispec`
- The repo itself is a valid Codex Plugin (detected when opened in Codex)
- Skills stay in a single canonical location — no duplication across platform directories
- Marketplace.json serves both Claude Code and Codex (cross-platform compatibility)

**Non-Goals:**
- Publishing to Codex Public Plugin Directory (not yet open to third-party submissions as of v0.117.0)
- Creating a separate marketplace repo (future Phase 3 work)
- Modifying the skill content or the OpenSpec workflow pipeline
- Windows symlink support via `setup.bat` (deferred; `.bat` template mentioned but not implemented)

## Unknowns & Investigation

| Unknown | Investigation | Conclusion |
|---------|--------------|------------|
| Can platforms share one plugin.json? | Reviewed both platform schemas: Claude Code auto-discovers skills/agents/commands; Codex requires explicit `"skills"` field. Codex also requires `interface` block for marketplace display. | **No** — two separate `plugin.json` files needed per platform directory |
| Does Codex read `.claude-plugin/marketplace.json`? | Confirmed in Codex docs: marketplace priority list includes `$REPO_ROOT/.claude-plugin/marketplace.json` at priority 3. | **Yes** — single marketplace file can serve both platforms |
| Symlink direction: which side is canonical? | Qiita real-world test confirms Claude Code `/plugin install` caches symlinks but does NOT follow them — resulting in empty cached skills. Codex explicitly supports symlinks. | **`.claude/skills/` MUST be canonical source**. Codex symlinks point to it. Never the reverse. |
| Does Codex need `.codex/skills/` or `.agents/skills/`? | Codex supports both discovery paths. `.agents/` is the newer, more generic path. | **Both** — `.codex/skills/` for backward compatibility; `.agents/skills/` for forward compatibility. Both are symlinks. |

## Decisions

### D1: Two separate plugin.json files per platform directory

**Decision**: `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` as separate files with platform-specific schemas.

**Rationale**: Claude Code's plugin.json is minimal (auto-discovers skills/agents/commands). Codex's plugin.json requires explicit `"skills"` path and an `"interface"` block with display metadata. Attempting to unify would require lowest-common-denominator fields and lose platform-specific features.

**Alternatives considered**: Single `plugin.json` in repo root with conditional fields — rejected because both platforms expect their plugin.json at specific paths (`.claude-plugin/` and `.codex-plugin/`), and field divergence is too high.

### D2: `.claude/skills/` is the canonical source; Codex symlinks in

**Decision**: Skill body stays in `.claude/skills/`. `.codex/skills/` and `.agents/skills/` become symlinks pointing to `.claude/skills/`.

**Rationale**: Claude Code's `/plugin install` caches symlinks without following them → empty cached skills → silent failure if the body lives elsewhere. Codex explicitly supports and follows symlinks. Therefore the body MUST be on the Claude Code side.

**Alternatives considered**: 
- Keep physical copies and use sync tool → rejected (adds dependency, still has drift risk)
- Make `.opencode/skills/` canonical and symlink from both → rejected (Claude Code symlink cache trap still applies when body is not in `.claude/skills/`)

### D3: Single marketplace.json shared between platforms

**Decision**: `.claude-plugin/marketplace.json` serves as the single marketplace registry.

**Rationale**: Codex's marketplace read priority explicitly includes `.claude-plugin/marketplace.json` at priority 3. Codex also supports `git-subdir` source type for remote Git installation. A single file avoids duplication and ensures both platforms reference the same plugin entry.

**Alternatives considered**: Separate marketplace files — rejected because Codex reads Claude's format natively, making duplication unnecessary.

### D4: setup.sh creates symlinks + validates, install-skills.sh extended

**Decision**: `setup.sh` handles one-click symlink creation and validation. `install-skills.sh` is extended (not replaced) to optionally create Codex symlinks during its existing flow.

**Rationale**: `install-skills.sh` already handles user-level installation for OpenCode and Claude Code. Extending it avoids breaking existing workflows. `setup.sh` is the new entry point for developers who want a single command to set up plugin-ready symlinks in the repo.

## Risks / Trade-offs

- [**Windows symlink permission**] → `mklink /D` requires admin rights on Windows. Mitigation: document workaround (enable Developer Mode) or provide `.bat` fallback that copies files. Low priority — CorgiSpec's primary audience is on Linux/macOS.
- [**Codex discovers skills twice**] → Both `.codex/skills/` and `.agents/skills/` exist as symlinks to the same target. Risk: Codex may discover each skill twice. Mitigation: test before finalizing; if duplicate detection, keep only `.agents/skills/` (newer path).
- [**Claude Code cache on symlink change**] → If symlinks are created after Claude Code has already cached the plugin, users must re-install. Mitigation: document `claude plugin update` or re-install step in setup instructions.
- [**install-skills.sh silently breaks if `.codex/skills/` is symlink**] → The existing script may try to copy files into a symlinked directory. Mitigation: make the extension aware of existing symlinks and skip/update instead of overwriting.

## Data Model (if applicable)

Not applicable — no data model or persistence changes in this change.

## API Contracts (if applicable)

Not applicable — no API surface changes in this change. The change adds Plugin metadata files and filesystem symlinks only.
