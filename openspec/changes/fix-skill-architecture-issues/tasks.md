<!-- Task Groups (## headings) are checkpoint units. Each group becomes a child GitLab issue. Apply executes one group at a time. -->

## 1. Fix implicit cross-skill dependency (Issue 1)

- [x] 1.1 Copy `worktree-discovery.md` from `.opencode/skills/corgispec-review/references/` to `.opencode/skills/corgispec-verify/references/`
- [x] 1.2 Update `corgispec-verify/SKILL.md` line 38: replace cross-skill reference with local path (`Read "references/worktree-discovery.md"` — remove "from the review skill")
- [x] 1.3 Update the consumer list inside the copied `worktree-discovery.md` to include "verify"
- [x] 1.4 Mirror changes to `.claude/skills/corgispec-verify/` and `.codex/skills/corgispec-verify/`
- [x] 1.5 Run `node tools/ds-skills/bin/ds-skills.js validate --path .` — confirm no dependency violations

## 2. Add corgispec-verify to package assets (Issue 2)

- [x] 2.1 Copy `corgispec-verify/` (SKILL.md + skill.meta.json + references/) from `.opencode/skills/` to `packages/corgispec/assets/skills/corgispec-verify/`
- [x] 2.2 Verify `packages/corgispec/assets/skills/` now contains 17 skill directories
- [x] 2.3 Run `cd packages/corgispec && npm test` — confirm no test regressions

## 3. Restructure directories into tier-based layout (Issue 3)

- [x] 3.1 Create `atoms/` and `molecules/` subdirectories in `.opencode/skills/`
- [x] 3.2 Move 2 atom skills (`corgispec-memory-extract`, `corgispec-memory-init`) into `.opencode/skills/atoms/`
- [x] 3.3 Move 15 molecule skills into `.opencode/skills/molecules/`
- [x] 3.4 Update all 17 `skill.meta.json` files: change `base_path` from `"<slug>"` to `"<tier>/<slug>"`
- [x] 3.5 Mirror the same tier structure to `.claude/skills/` (create `atoms/`, `molecules/`, move skills)
- [x] 3.6 Regenerate `.codex/skills/` symlinks to point to new `.claude/skills/<tier>/<slug>/` paths
- [x] 3.7 Restructure `packages/corgispec/assets/skills/` with same tier layout (including newly added corgispec-verify)
- [x] 3.8 Run `node tools/ds-skills/bin/ds-skills.js validate --path .` — confirm loader discovers all 17 skills via tier directories
- [x] 3.9 Run `cd packages/corgispec && npm test` — confirm no test regressions
- [x] 3.10 Restructure `.codex/skills/` into tier subdirectories: create `atoms/` and `molecules/` inside `.codex/skills/`, place symlinks at `.codex/skills/<tier>/<slug>` → `../../../.claude/skills/<tier>/<slug>` (per spec scenario: "Codex reads `atoms/corgispec-memory-init/SKILL.md` via `.codex/skills/`")
- [x] 3.11 Update `bundle-assets.js` to output skills into `assets/skills/<tier>/<slug>/` (not flat `assets/skills/<slug>/`) — matching spec requirement that tier layout applies to `packages/corgispec/assets/skills/`
- [x] 3.12 Restructure `.agents/skills/` with same tier-based symlink layout (currently broken flat symlinks)
- [x] 3.13 Run `node tools/ds-skills/bin/ds-skills.js validate --path .` and `cd packages/corgispec && npm test` — confirm no regressions after tier restructuring

## 4. Reconcile blueprint spec (Issue 4)

- [ ] 4.1 Edit `docs/superpowers/specs/2026-04-27-composable-skill-hierarchy-design.md`: update the SKILL.md frontmatter example to remove `type` field and show actual format (`name`, `description`, `license`, `compatibility`, `metadata`)
- [ ] 4.2 Add a note in the spec explaining that tier information is conveyed via `skill.meta.json`'s `tier` field (not SKILL.md frontmatter)
- [ ] 4.3 Verify no other documentation references `type: capability | composite | playbook` as a current requirement
