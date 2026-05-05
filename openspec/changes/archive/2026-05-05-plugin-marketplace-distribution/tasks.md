<!-- Task Groups (## headings) are checkpoint units. Each group becomes a child GitLab issue. Apply executes one group at a time. -->

## 1. Plugin Manifests

- [x] 1.1 Create `.claude-plugin/` directory
- [x] 1.2 Write `.claude-plugin/plugin.json` with `name`, `version`, `description`, `author` (object), `license`, `keywords` (array), and `repositories` — following Claude Code's strict format rules
- [x] 1.3 Create `.codex-plugin/` directory
- [x] 1.4 Write `.codex-plugin/plugin.json` with full `interface` block (`displayName`, `shortDescription`, `longDescription`, `developerName`, `category`, `capabilities`, `brandColor`) plus explicit `skills`, `repository`, `license`, and `keywords` fields
- [x] 1.5 Validate both plugin.json files are parseable JSON with correct field types (author=object, version=string, keywords=array)

## 2. Cross-Platform Skill Symlinks

- [x] 2.1 Create `.agents/` directory structure (`skills/` and `plugins/` subdirs)
- [x] 2.2 Replace `.codex/skills/` physical copies with per-skill symlinks pointing to `.claude/skills/<skill-name>/` — back up existing physical copies first
- [x] 2.3 Create `.agents/skills/` per-skill symlinks pointing to `.claude/skills/<skill-name>/`
- [x] 2.4 Verify all 17 skills resolve correctly from `.codex/skills/` and `.agents/skills/` paths
- [x] 2.5 Verify Claude Code can still load all skills from `.claude/skills/` without issues

## 3. Marketplace & Team Auto-Install Configuration

- [x] 3.1 Write `.claude-plugin/marketplace.json` with cross-platform registry (plugin entry with `source` using git tag ref, `category: "Workflow"`)
- [x] 3.2 Write `.claude/settings.json` with `extraKnownMarketplaces` and `enabledPlugins` for team auto-install
- [x] 3.3 Write `.agents/plugins/marketplace.json` for Codex repo-scoped marketplace with `policy.installation: INSTALLED_BY_DEFAULT` and `git-subdir` source type
- [x] 3.4 Verify marketplace.json is valid for both platforms (Claude Code `/plugin marketplace add` format + Codex priority-3 read)

## 4. Setup & Install Scripts

- [x] 4.1 Write `setup.sh` — one-command symlink initialization with `--help`, `--dry-run`, idempotent re-run, backup detection for physical copies, and post-setup validation (count skills, verify resolve, check plugin.json parse)
- [x] 4.2 Extend `install-skills.sh` with `--codex` flag to optionally create Codex symlinks during user-level installation, preserving backward compatibility
- [x] 4.3 Run `./setup.sh --dry-run` to preview, then `./setup.sh` to execute, verifying all symlinks and passing validation
- [x] 4.4 Run `install-skills.sh --dry-run` and `install-skills.sh --codex --dry-run` to verify both modes report correctly without making changes
