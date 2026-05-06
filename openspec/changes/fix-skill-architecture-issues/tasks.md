<!-- Task Groups (## headings) are checkpoint units. Each group becomes a child GitLab issue. Apply executes one group at a time. -->

## 1. Fix implicit cross-skill dependency (Issue 1)

- [x] 1.1 Copy `worktree-discovery.md` from `.opencode/skills/corgispec-review/references/` to `.opencode/skills/corgispec-verify/references/`
- [x] 1.2 Update `corgispec-verify/SKILL.md` line 38: replace cross-skill reference with local path (`Read "references/worktree-discovery.md"` — remove "from the review skill")
- [x] 1.3 Update the consumer list inside the copied `worktree-discovery.md` to include "verify"
- [x] 1.4 Mirror changes to `.claude/skills/corgispec-verify/` and `.codex/skills/corgispec-verify/`
- [x] 1.5 Run `node tools/ds-skills/bin/ds-skills.js validate --path .` — confirm no dependency violations

## 2. Add corgispec-verify to package assets (Issue 2)

- [ ] 2.1 Copy `corgispec-verify/` (SKILL.md + skill.meta.json + references/) from `.opencode/skills/` to `packages/corgispec/assets/skills/corgispec-verify/`
- [ ] 2.2 Verify `packages/corgispec/assets/skills/` now contains 17 skill directories
- [ ] 2.3 Run `cd packages/corgispec && npm test` — confirm no test regressions

## 3. Restructure directories into tier-based layout (Issue 3)

- [ ] 3.1 Create `atoms/` and `molecules/` subdirectories in `.opencode/skills/`
- [ ] 3.2 Move 2 atom skills (`corgispec-memory-extract`, `corgispec-memory-init`) into `.opencode/skills/atoms/`
- [ ] 3.3 Move 15 molecule skills into `.opencode/skills/molecules/`
- [ ] 3.4 Update all 17 `skill.meta.json` files: change `base_path` from `"<slug>"` to `"<tier>/<slug>"`
- [ ] 3.5 Mirror the same tier structure to `.claude/skills/` (create `atoms/`, `molecules/`, move skills)
- [ ] 3.6 Regenerate `.codex/skills/` symlinks to point to new `.claude/skills/<tier>/<slug>/` paths
- [ ] 3.7 Restructure `packages/corgispec/assets/skills/` with same tier layout (including newly added corgispec-verify)
- [ ] 3.8 Run `node tools/ds-skills/bin/ds-skills.js validate --path .` — confirm loader discovers all 17 skills via tier directories
- [ ] 3.9 Run `cd packages/corgispec && npm test` — confirm no test regressions

## 4. Reconcile blueprint spec (Issue 4)

- [ ] 4.1 Edit `docs/superpowers/specs/2026-04-27-composable-skill-hierarchy-design.md`: update the SKILL.md frontmatter example to remove `type` field and show actual format (`name`, `description`, `license`, `compatibility`, `metadata`)
- [ ] 4.2 Add a note in the spec explaining that tier information is conveyed via `skill.meta.json`'s `tier` field (not SKILL.md frontmatter)
- [ ] 4.3 Verify no other documentation references `type: capability | composite | playbook` as a current requirement
