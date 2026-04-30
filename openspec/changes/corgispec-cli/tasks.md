<!-- Task Groups (## headings) are checkpoint units. Each group becomes a child GitLab issue. Apply executes one group at a time. -->

## 1. Package Scaffold & Build System

- [x] 1.1 Create `packages/corgispec/` directory with `package.json` (name: "corgispec", type: "module", bin: { corgispec: "./dist/bin/corgispec.js" }, engines: { node: ">=18" })
- [x] 1.2 Add `tsconfig.json` with ESM target, strict mode, outDir: "./dist"
- [x] 1.3 Add `tsup` config for bundling TypeScript to ESM
- [x] 1.4 Create `src/bin/corgispec.ts` entry point with commander setup, `--version`, `--help`, `--no-color`
- [x] 1.5 Add Node version guard (exit with error if < 18)
- [x] 1.6 Add `vitest.config.ts` and verify `npm test` runs
- [x] 1.7 Add `prepublishOnly` script that builds and copies skills from `../../.opencode/skills/openspec-*` into `assets/skills/`
- [x] 1.8 Verify `npm pack` produces a working tarball and `npx corgispec --version` works from it

## 2. Config & Schema Infrastructure

- [x] 2.1 Create `src/lib/config.ts` — reads and validates `openspec/config.yaml` (schema field required, isolation/context/rules optional)
- [x] 2.2 Create `src/lib/schemas.ts` — loads JSON schemas from bundled `assets/schemas/`, validates with ajv
- [x] 2.3 Create `src/lib/platform.ts` — detects available AI platforms (Claude Code, OpenCode, Codex) by checking directory existence
- [x] 2.4 Write unit tests for config parsing (valid, invalid, missing file cases)
- [x] 2.5 Write unit tests for schema loading and validation

## 3. Skill Management Commands (install, validate, list, graph)

- [ ] 3.1 Create `src/lib/skills.ts` — discover skills from a directory, parse `skill.meta.json`, validate against schema
- [ ] 3.2 Implement `src/commands/install.ts` — copy bundled skills to user-level dirs (`~/.claude/skills/`, `~/.config/opencode/skill/`), support `--platform`, `--dry-run`
- [ ] 3.3 Implement `src/commands/validate.ts` — validate all skills (meta schema, SKILL.md exists, slug match, tier constraints), support `--path`
- [ ] 3.4 Implement `src/commands/list.ts` — list skills with `--tier`, `--platform`, `--json` filters; default lists changes
- [ ] 3.5 Implement `src/commands/graph.ts` — output dependency graph in mermaid (default) or dot format, support `--tier` filter
- [ ] 3.6 Write integration tests for install (mock filesystem), validate, list, and graph commands

## 4. Workflow Instruction Commands (propose, apply, review, archive, status, instructions)

- [ ] 4.1 Create `src/lib/changes.ts` — discover changes in `openspec/changes/`, read artifact status, determine pipeline state
- [ ] 4.2 Create `src/lib/instructions.ts` — template resolver that reads schema artifact definitions, resolves templates, injects context/rules, outputs JSON
- [ ] 4.3 Implement `src/commands/status.ts` — display artifact completion state, support `--json`, auto-select single change
- [ ] 4.4 Implement `src/commands/instructions.ts` — output enriched artifact instructions as JSON, check blocked state
- [ ] 4.5 Implement `src/commands/propose.ts` — create change directory, output proposal instructions
- [ ] 4.6 Implement `src/commands/apply.ts` — determine next task group, output apply instructions
- [ ] 4.7 Implement `src/commands/review.ts` — output review checklist instructions
- [ ] 4.8 Implement `src/commands/archive.ts` — check completeness, output archive instructions
- [ ] 4.9 Write unit tests for change discovery and instruction resolution
- [ ] 4.10 Write integration tests for all workflow commands (propose, apply, review, archive, status)

## 5. Init & Doctor Commands

- [ ] 5.1 Implement `src/commands/init.ts` — scaffold openspec directory structure, support `--schema`, `--platform`, skip if exists
- [ ] 5.2 Create init templates (config.yaml with comments, schema directory structure)
- [ ] 5.3 Implement `src/commands/doctor.ts` — run all checks (Node version, skill dirs, config, platforms, schemas), report pass/fail with suggestions
- [ ] 5.4 Write integration tests for init (fresh dir, existing dir, with flags)
- [ ] 5.5 Write integration tests for doctor (mock environment states)

## 6. Asset Bundling & Publish Readiness

- [ ] 6.1 Create `scripts/bundle-assets.ts` — copies `.opencode/skills/openspec-*` and `schemas/` into `packages/corgispec/assets/`
- [ ] 6.2 Add `.gitignore` entry for `packages/corgispec/assets/` (generated at build time)
- [ ] 6.3 Validate that bundled skills match source (checksum or content compare)
- [ ] 6.4 Add `CHANGELOG.md` with initial entry
- [ ] 6.5 Test full publish flow: `npm pack`, extract, `npx corgispec --version`, `npx corgispec doctor`
- [ ] 6.6 Update root `AGENTS.md` and `README.md` with new install/usage instructions referencing `corgispec`
