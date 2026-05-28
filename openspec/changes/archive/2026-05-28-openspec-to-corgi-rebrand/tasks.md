<!-- Task Groups (## headings) are checkpoint units. Each group becomes a child GitLab issue. Apply executes one group at a time. -->

## 1. Prerequisites (Phase 0)

- [x] 1.1 Create rollback tag: `git tag pre-rebrand-v0.1.1`
- [x] 1.2 Sync `.codex/skills.backup/` wholesale from `.opencode/skills/` via `cp -r`
- [x] 1.3 Delete `openspec/.opsx-install-report.md` (file name contains deprecated `opsx`, content is regenerable)
- [x] 1.4 Verify sync: diff `.codex/skills.backup/` against `.opencode/skills/` — no meaningful differences in structure

## 2. Atomic Brand Replacement — Commands + Skills + Assets (Phase 1)

- [x] 2.1 Replace `"OPSX: *"` → `"Corgi: *"` in `.claude/commands/corgi/*.md` `name` frontmatter fields (6 files)
- [x] 2.2 Replace `"OpenSpec"` → `"Corgi"` in `.opencode/commands/corgi-*.md` description + body text
- [x] 2.3 Replace `"OpenSpec"` → `"Corgi"` in `.claude/commands/corgi/*.md` description + body text
- [x] 2.4 Replace `"OpenSpec"` → `"Corgi"` in all SKILL.md frontmatter descriptions across `.opencode/skills/`, `.claude/skills/`, `.codex/skills.backup/`
- [x] 2.5 Replace `author: "openspec"` → `author: "corgispec"` in all SKILL.md frontmatter across three platform directories
- [x] 2.6 Replace `"OpenSpec"` → `"Corgi"` in SKILL.md body text across three platform directories
- [x] 2.7 Replace lowercase `opsx` → `corgi` in SKILL.md body text (~30 occurrences across `corgispec-memory-init`, `corgispec-memory-extract`, `corgispec-apply-change`, `corgispec-lint`)
- [x] 2.8 Replace `"OpenSpec"` → `"Corgi"` in `skill.meta.json` description fields (3 files across platforms)
- [x] 2.9 Mirror all above replacements in `packages/corgispec/assets/commands/` (~17 command template files)
- [x] 2.10 Mirror all above replacements in `packages/corgispec/assets/skills/` (~17 skill template files + meta.json)
- [x] 2.11 Verify Phase 1: `grep -rni "OpenSpec\|OPSX\|opsx" .opencode/commands/ .claude/commands/` → zero results
- [x] 2.12 Verify Phase 1: `grep -rni "OpenSpec\|OPSX\|opsx" packages/corgispec/assets/` → zero results
- [x] 2.13 Verify Phase 1: `grep -rn "OpenSpec" --include="SKILL.md" .opencode/skills/ .claude/skills/ .codex/skills.backup/` → zero results
- [x] 2.14 Verify Phase 1: `grep -rni "opsx" --include="SKILL.md" .opencode/skills/ .claude/skills/ .codex/skills.backup/` → zero results
- [x] 2.15 Verify Phase 1: `grep -rni "author:.*openspec" --include="SKILL.md" .opencode/skills/ .claude/skills/` → zero results

## 3. CLI Source + Tests (Phase 2a)

- [x] 3.1 Replace `"OpenSpec"` brand string literals in 8 `.ts` files under `packages/corgispec/src/` (preserve `openspec/` paths and TypeScript identifiers)
- [x] 3.2 Update assertion strings in `packages/corgispec/src/commands/__tests__/init.test.ts` to match new CLI output
- [x] 3.3 Update assertion strings in `packages/corgispec/src/commands/__tests__/doctor.test.ts` to match new CLI output
- [x] 3.4 Verify: `cd packages/corgispec && npm test` → all tests pass
- [x] 3.5 Verify: `grep -rn "OpenSpec" packages/corgispec/src/` → zero results (confirming only `openspec/` paths remain)
- [x] 3.6 Verify: `grep -rn "openspec/" packages/corgispec/src/` → path references still intact

## 4. Documentation, Plugins, README (Phase 2b)

- [x] 4.1 Update 3 plugin marketplace JSON files: `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.agents/plugins/marketplace.json` — replace `displayName` and `description` brand references
- [x] 4.2 Update `README.md` brand references (preserve external attribution to Fission-AI/OpenSpec)
- [x] 4.3 Update `README.zh-TW.md` brand references (preserve external attribution)
- [x] 4.4 Update `AGENTS.md` brand references
- [x] 4.5 Update `INSTALL.md` brand references
- [x] 4.6 Update docs/ files (~12 files) — replace "OpenSpec" self-references, preserve upstream attribution
- [x] 4.7 Update wiki/ files (~8 files) — replace "OpenSpec" self-references
- [x] 4.8 Update `memory/MEMORY.md` project description
- [x] 4.9 Update `tools/ds-skills/tests/fixtures/valid-atom/SKILL.md` brand text
- [x] 4.10 Update `packages/corgispec/package.json`: description "OpenSpec" → "Corgi" + keywords `"openspec"` → `"corgispec"` + `"corgi-workflow"`
- [x] 4.11 Verify: `grep -rni "OpenSpec\|OPSX\|opsx" --include="*.md" --include="*.json" .` (excluding `openspec/` directory paths and preserved external attribution) → zero brand text results

## 5. Final Verification (Phase 3)

- [x] 5.1 Run full 11-point verification checklist from decision document
- [x] 5.2 Confirm `corgispec --help` output contains "Corgi" and not "OpenSpec"
- [x] 5.3 Run `cd packages/corgispec && npm test` → all pass
- [x] 5.4 Confirm `grep -rn "openspec/" packages/corgispec/src/` → directory path references intact (no over-replacement)
- [x] 5.5 Confirm three-platform skill parity: no diff between `.opencode/skills/` and `.claude/skills/` and `.codex/skills.backup/` for brand text
