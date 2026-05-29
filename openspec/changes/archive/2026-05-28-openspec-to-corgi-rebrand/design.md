## Context

The project's CLI (`corgispec`), slash commands (`/corgi-*`), and skill directory names (`corgispec-*`) have been migrated to "Corgi" naming. However, ~90-95 source files still contain the old "OpenSpec" brand text in user-visible positions: command descriptions, skill frontmatter, CLI help output, and — most critically — the `packages/corgispec/assets/` install templates that `corgispec install` copies into target projects on every run.

The three-platform sync obligation (`.opencode/skills/`, `.claude/skills/`, `.codex/skills/`) and the asset template dependency make this a cross-cutting change requiring careful ordering.

Current state:
- `corgispec --help` outputs "Unified CLI for OpenSpec workflow"
- `/corgi-install` command description reads "Install OpenSpec GitFlow assets"
- Claude Code command name fields read `"OPSX: Install"` (OpenSpec X abbreviation)
- SKILL.md bodies contain `## Active opsx Change`, `每 10 个 opsx 会话` (~30 occurrences across 4 skills)
- `packages/corgispec/assets/` templates are the authoritative source for `corgispec install` — any unfixed brand text here will be written into every newly bootstrapped project

## Goals / Non-Goals

**Goals:**
- All user-visible text uses "Corgi" brand exclusively — no "OpenSpec" visible in command panels, CLI output, skill execution, or installed files
- `corgispec install` produces output that contains zero "OpenSpec" / "OPSX" / "opsx" brand text
- Three-platform sync obligation maintained after changes
- Git rollback path preserved via a `pre-rebrand` tag

**Non-Goals:**
- Renaming `openspec/` directory structure (200+ file impact, separate migration, compatibility risk)
- Refactoring TypeScript identifiers (`OpenSpecConfig`, `initializeOpenSpec()`) — code names, not brand text
- Removing external attribution to Fission-AI/OpenSpec (legitimate upstream credits)
- Renaming historical file names like `openspec-llm-memory.md`

## Unknowns & Investigation

**Unknown 1: Are `.codex/skills.backup/` contents safe to incrementally edit?**
Investigation: Diff of `.codex/skills.backup/` vs `.opencode/skills/` reveals backup contains older skill versions that reference `openspec list --json` (deprecated CLI command) and lack the Context Gate pattern. Incremental brand replacement on the backup would leave stale CLI references intact.
Conclusion: Replace `.codex/skills.backup/` wholesale via `cp -r .opencode/skills .codex/skills.backup` before any brand text edits.

**Unknown 2: Does `package.json` keywords `"openspec"` need changing?**
Investigation: The keywords field affects npm discoverability. Removing `"openspec"` may reduce search hits from users familiar with the old name; keeping it leaves a brand artifact.
Conclusion: Replace with `"corgispec"` + `"corgi-workflow"` as a separate package.json keywords change (not part of the Phase 1 atomic unit, classified low-risk in Phase 2b).

**Unknown 3: Is case-insensitive grep sufficient to find all occurrences?**
Investigation: The `opsx` flow-noun references (e.g., `## Active opsx Change`) are lowercase and will be missed by `grep "OpenSpec"`. The `metadata.author: "openspec"` frontmatter value is also lowercase.
Conclusion: Three separate search patterns are required:
- `grep -rn "OpenSpec"` — uppercase brand text
- `grep -rni "OPSX\|opsx"` — OPSX command names + lowercase flow nouns
- `grep -rni "author:.*openspec"` — lowercase author fields

**No deep unknowns remain** — the wiki decision document captured complete agent review findings.

## Decisions

### 1. Phase 1 must be a single atomic commit

**Decision:** All of the following must land in one commit: command dispatch files, SKILL.md files (all three platforms), lowercase `opsx` replacements in SKILL bodies, asset templates in `packages/corgispec/assets/`.

**Rationale:** Command files, skill files, and asset templates are mirrored — if any subset is replaced without the others, a call to `corgispec install` during the window between partial commits will copy a mixture of "OpenSpec" and "Corgi" branded files into the target project.

**Alternative rejected:** Separate commits per file category (commands first, then skills, then assets). Rejected because the interlock is tight — `corgispec install` reads from assets at any time.

### 2. `.codex/skills.backup/` replaced wholesale before Phase 1 edits

**Decision:** Run `cp -r .opencode/skills .codex/skills.backup` as Phase 0 step, before any text-level edits.

**Rationale:** The backup directory is already out of sync with `.opencode/skills/` in two ways: brand text AND deprecated CLI references (`openspec list --json`). Incremental editing would leave a partially-correct backup. Wholesale replacement from the authoritative source addresses both.

### 3. CLI source + test assertions updated in one atomic commit

**Decision:** The 8 `.ts` source files and the 2 test files (`init.test.ts`, `doctor.test.ts`) that assert on CLI output strings must be updated together in a single commit.

**Rationale:** If source is updated without tests, `npm test` fails. If tests are updated without source, tests pass against stale output. Either order creates a broken intermediate state — they must be atomic.

### 4. External attribution references to Fission-AI/OpenSpec preserved verbatim

**Decision:** Distinguish by referent. If "OpenSpec" refers to the Fission-AI upstream project → keep. If it refers to this project's workflow → replace.

**Rationale:** The README's "community extension of OpenSpec" and attribution links are factual statements about upstream provenance. Altering them would be inaccurate.

### 5. Rollback tag created before any edits

**Decision:** Create `git tag pre-rebrand-v0.1.1` as the first Phase 0 action.

**Rationale:** With ~90-95 files affected across multiple commit boundaries, a named tag makes `git revert` to a clean state reliable without manual trawling of commit history.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| `openspec/` paths accidentally replaced by an overly broad sed/find command | Use case-sensitive match `"OpenSpec"` (capital O+S); validate after each phase with `grep -rn "openspec/" packages/corgispec/src/` to confirm paths intact |
| `packages/corgispec/assets/` missed → install re-introduces brand text | Phase 1 atomic unit explicitly includes all ~35 asset files; post-Phase-1 verification runs `corgispec install --mode fresh --path /tmp/test-rebrand` and greps output |
| Lowercase `opsx` occurrences missed | Use separate case-insensitive search `grep -rni "opsx"` in addition to case-sensitive "OpenSpec" |
| Lowercase `author: openspec` missed | Use separate `grep -rni "author:.*openspec"` |
| Three-platform skill sync broken | Phase 1 processes all three directories simultaneously; post-phase grep verifies all three |
| CLI tests fail after string changes | Source + test assertions updated in same atomic commit; `npm test` run as verification gate |
| Accidental edit of external attribution | README changes applied with per-line human judgment, preserving Fission-AI/OpenSpec URLs and context |

## Data Model (if applicable)

Not applicable — no data model changes in this change.

## API Contracts (if applicable)

Not applicable — no API surface changes in this change. All changes are to string literals, frontmatter values, and documentation prose.

## Migration Plan

**Phase 0 — Prerequisites**
1. `git tag pre-rebrand-v0.1.1` (rollback anchor)
2. `cp -r .opencode/skills/. .codex/skills.backup/` (sync backup wholesale)
3. Decide `package.json` keywords strategy (recommendation: replace `"openspec"` with `"corgispec"` + `"corgi-workflow"`)

**Phase 1 — Atomic unit (must be single commit)**
- 1a: Command dispatch files (`.opencode/commands/`, `.claude/commands/`) — `"OPSX: *"` → `"Corgi: *"` + description prose
- 1b: SKILL.md + skill.meta.json (three platforms: `.opencode/skills/`, `.claude/skills/`, `.codex/skills.backup/`) — frontmatter description + `author: openspec` → `corgispec`
- 1c: Lowercase `opsx` in SKILL body text (~30 occurrences, 4 skills)
- 1d: Asset templates `packages/corgispec/assets/` — mirror all 1a/1b/1c changes

Phase 1 verification before committing:
- `grep -rni "OpenSpec|OPSX|opsx" .opencode/commands/ .claude/commands/` → zero results
- `grep -rni "OpenSpec|OPSX|opsx" packages/corgispec/assets/` → zero results
- `grep -rn "OpenSpec" --include="SKILL.md" .opencode/skills/ .claude/skills/ .codex/skills.backup/` → zero results

**Phase 2a — CLI source + tests (one commit)**
- 8 `.ts` files: replace string literals only, leave identifiers and `openspec/` paths untouched
- `init.test.ts`, `doctor.test.ts`: update assertion strings to match
- Verify: `cd packages/corgispec && npm test` → all pass

**Phase 2b — Docs, plugins, README (independent)**
- Plugin marketplace JSONs (3): `displayName` + `description`
- README files (2): prose references, preserve external attribution
- Docs (~22): `docs/`, `wiki/`, `AGENTS.md`, `INSTALL.md`
- `memory/MEMORY.md`, `tools/ds-skills/tests/fixtures/valid-atom/SKILL.md`
- Delete `openspec/.opsx-install-report.md`
- `package.json` keywords update

**Phase 3 — Final verification (11-point checklist from decision doc)**

**Rollback:** `git revert <phase-1-commit-hash>` or `git reset --hard pre-rebrand-v0.1.1`

## Open Questions

- ~~`package.json` keywords strategy~~ — resolved: replace `"openspec"` with `"corgispec"` + `"corgi-workflow"`
- Whether `packages/corgispec/CHANGELOG.md` entry and semver bump (0.1.x → 0.2.0) should be part of Phase 2b or a separate commit — recommendation: include in Phase 2b as documentation alongside README changes
