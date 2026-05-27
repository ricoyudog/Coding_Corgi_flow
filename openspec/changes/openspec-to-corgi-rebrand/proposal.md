## Why

The CLI, slash commands, and skill directories already use `corgispec`/`/corgi-*` naming, but ~90-95 files still contain the old "OpenSpec" brand text in descriptions, help output, skill frontmatter, and install asset templates. This causes visible inconsistency in every user touchpoint: command panels show "OpenSpec", `corgispec --help` outputs "OpenSpec", and — most critically — `corgispec install` re-writes "OpenSpec" text into target projects, undoing any partial fixes.

## What Changes

- Replace brand text `"OpenSpec"` → `"Corgi"` in all description, frontmatter, CLI output, and documentation (case-sensitive; only uppercase O+S matches)
- Replace `"OPSX: *"` Claude command name fields → `"Corgi: *"` (6 files + matching asset templates)
- Replace lowercase `opsx` flow-noun references in skill bodies → `corgi` (~30 occurrences across 4 skills)
- Replace `metadata.author: "openspec"` frontmatter values → `"corgispec"`
- Replace `"CorgiSpec"` plugin `displayName` → `"Corgi"` in 3 marketplace JSON files
- Update `packages/corgispec/assets/` install templates (the source of truth for `corgispec install`) to reflect all the above — **BREAKING if skipped**: without this, every install re-introduces stale brand text
- Update CLI string literals in 8 `.ts` source files and sync 2 test assertion files atomically
- Sync `.codex/skills.backup/` from `.opencode/skills/` via `cp -r` (backup contains stale CLI references unfit for incremental edit)
- Delete `openspec/.opsx-install-report.md` (file name contains deprecated `opsx`, content is regenerable)
- Update `tools/ds-skills/tests/fixtures/valid-atom/SKILL.md` test fixture brand text
- Preserve: `openspec/` directory paths, TypeScript identifiers (`OpenSpecConfig`, `initializeOpenSpec()`), all external attribution references to Fission-AI/OpenSpec, file names such as `openspec-llm-memory.md`

## Capabilities

### New Capabilities

- `corgi-brand-consistency`: All user-visible text across commands, skill descriptions, CLI output, install asset templates, plugin manifests, and documentation uses "Corgi" consistently — no "OpenSpec" brand text visible to end users or injected into target projects by `corgispec install`

### Modified Capabilities

<!-- No existing spec-level behavioral requirements are changing — this is a brand text update, not a functional change -->

## Impact

- **~90–95 files** modified across: `.opencode/skills/`, `.claude/skills/`, `.codex/skills.backup/`, `.opencode/commands/`, `.claude/commands/`, `packages/corgispec/assets/`, `packages/corgispec/src/`, plugin JSON manifests, docs, wiki, AGENTS.md, INSTALL.md, memory/MEMORY.md
- **`packages/corgispec/` test suite** must be updated atomically with CLI source changes
- **No API or behavioral changes** — only string literals, frontmatter values, and documentation prose
- **No schema changes** — `openspec/` directory structure and `openspec/config.yaml` paths are untouched

## GitLab Issue

<!-- This section will be filled automatically by the propose skill with the parent issue link. -->
