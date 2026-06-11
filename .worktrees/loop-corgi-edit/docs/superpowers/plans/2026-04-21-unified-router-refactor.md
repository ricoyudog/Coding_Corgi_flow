# Unified Router Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the OpenSpec propose/apply/review workflow docs so they share a stable phase contract, use one canonical tracking metadata shape, and separate core work from tracker synchronization without changing the existing command-wrapper plus platform-skill structure.

**Architecture:** Keep the current shallow command wrappers as schema routers. Normalize the propose/apply/review boundary around one canonical local tracking contract, then split apply into `develop`/`closeout` responsibilities and bring GitHub review to the same decomposed shape already present in GitLab review. Preserve explicit human gates and do not introduce a generic workflow engine.

**Tech Stack:** Markdown skill definitions, OpenSpec CLI workflow docs, GitLab/GitHub issue-tracking conventions, git worktree isolation.

---

## File Structure

### Command wrappers to preserve and lightly update

- Modify: `.opencode/commands/corgi-propose.md`
- Modify: `.opencode/commands/corgi-apply.md`
- Modify: `.opencode/commands/corgi-review.md`
- Modify: `.claude/commands/corgi/propose.md`
- Modify: `.claude/commands/corgi/apply.md`
- Modify: `.claude/commands/corgi/review.md`

These should stay as shallow routers and postcondition checkers. Changes here should be minimal and only clarify phase names, handoff expectations, and postconditions.

### Propose skill surfaces

- Modify: `.opencode/skills/corgispec-propose/SKILL.md`
- Modify: `.opencode/skills/corgispec-gh-propose/SKILL.md`
- Modify: `.claude/skills/corgispec-propose/SKILL.md`
- Modify: `.claude/skills/corgispec-gh-propose/SKILL.md`
- Modify: `.opencode/skills/corgispec-propose/references/gitlab-issues.md`
- Modify: `.claude/skills/corgispec-propose/references/gitlab-issues.md`

These are the writer side of the current tracking-shape drift.

### Apply skill surfaces

- Modify: `.opencode/skills/corgispec-apply-change/SKILL.md`
- Modify: `.opencode/skills/corgispec-gh-apply/SKILL.md`
- Modify: `.claude/skills/corgispec-apply-change/SKILL.md`
- Modify: `.claude/skills/corgispec-gh-apply/SKILL.md`
- Modify: `.opencode/skills/corgispec-apply-change/references/issue-sync.md`
- Modify: `.opencode/skills/corgispec-gh-apply/references/issue-sync.md`
- Modify: `.claude/skills/corgispec-apply-change/references/issue-sync.md`
- Modify: `.claude/skills/corgispec-gh-apply/references/issue-sync.md`

These are the reader side of the current drift and the main place where `develop` and `closeout` are still blended.

### Review skill surfaces

- Modify: `.opencode/skills/corgispec-review/SKILL.md`
- Modify: `.opencode/skills/corgispec-gh-review/SKILL.md`
- Modify: `.claude/skills/corgispec-review/SKILL.md`
- Create or modify to match repo reality: `.claude/skills/corgispec-gh-review/SKILL.md`
- Modify: `.opencode/skills/corgispec-review/references/quality-checks.md`
- Modify: `.opencode/skills/corgispec-review/references/review-decisions.md`
- Modify: `.opencode/skills/corgispec-review/references/repair-flow.md`
- Mirror equivalent changes in `.claude/skills/corgispec-review/references/`

These implement the `review -> advance/repair` separation.

### Supporting docs and examples

- Modify: `README.md`
- Modify: `README.zh-TW.md`
- Test fixture / reference example: `openspec/changes/track-stool-color-and-duration/.gitlab.yaml`
- Reference pattern only: `skills/developing-from-issue-card/SKILL.md`
- Reference pattern only: `skills/finishing-issue-phase/SKILL.md`
- Design source: `docs/superpowers/specs/2026-04-21-unified-router-workflow-design.md`

### Deferred / optional cleanup after main refactor

- Modify later: `.codex/skills/corgispec-propose/SKILL.md`
- Modify later: `.codex/skills/corgispec-gh-propose/SKILL.md`
- Modify later: `.codex/skills/corgispec-apply-change/SKILL.md`
- Modify later: `.codex/skills/corgispec-gh-apply/SKILL.md`
- Modify later: `.codex/skills/corgispec-review/SKILL.md`
- Modify later: `.codex/skills/corgispec-gh-review/SKILL.md`

Do not start with `.codex`. First stabilize `.opencode` and `.claude`, then either port or retire `.codex` copies.

## Acceptance Criteria

- All propose writers and apply/review readers describe one canonical tracking shape, with no nested-vs-flat mismatch.
- Apply docs explicitly distinguish `discover`, `develop`, `closeout`, and review handoff responsibilities.
- Review docs explicitly distinguish evidence gathering from human decision and state mutation.
- GitHub review docs are decomposed to the same phase contract as GitLab review.
- Command wrappers remain shallow routers rather than absorbing platform logic.
- README command descriptions and workflow diagram still match the documented behavior.

---

### Task 1: Normalize the canonical tracking metadata contract

**Files:**
- Modify: `.opencode/skills/corgispec-propose/references/gitlab-issues.md`
- Modify: `.claude/skills/corgispec-propose/references/gitlab-issues.md`
- Modify: `.opencode/skills/corgispec-gh-propose/SKILL.md`
- Modify: `.claude/skills/corgispec-gh-propose/SKILL.md`
- Modify: `.opencode/skills/corgispec-apply-change/references/issue-sync.md`
- Modify: `.opencode/skills/corgispec-gh-apply/references/issue-sync.md`
- Modify: `.claude/skills/corgispec-apply-change/references/issue-sync.md`
- Modify: `.claude/skills/corgispec-gh-apply/references/issue-sync.md`
- Test/Reference: `openspec/changes/track-stool-color-and-duration/.gitlab.yaml`

- [ ] **Step 1: Write a short contract block into the plan as the target shape**

Use this exact canonical shape as the target for both platforms, adapted only by key names (`iid` for GitLab, `issue_number` for GitHub):

```yaml
parent:
  iid: 24
  url: https://gitlab.example.com/group/project/-/issues/24
groups:
  - number: 1
    name: "Entry Contract and Validation"
    iid: 25
    url: https://gitlab.example.com/group/project/-/issues/25
```

For GitHub, the same nested structure should be:

```yaml
parent:
  number: 42
  url: https://github.com/org/repo/issues/42
groups:
  - number: 1
    name: "Setup"
    issue_number: 43
    url: https://github.com/org/repo/issues/43
```

- [ ] **Step 2: Update the GitLab propose writer docs to match the canonical nested contract**

In both GitLab propose references, make the saved `.gitlab.yaml` example and all downstream references use:

```yaml
parent:
  iid: 42
  url: https://gitlab.example.com/group/project/-/issues/42
groups:
  - number: 1
    name: "Setup"
    iid: 43
    url: https://gitlab.example.com/group/project/-/issues/43
```

Remove or rewrite any instructions that imply flat keys like `parent_iid` or `children[]`.

- [ ] **Step 3: Update the GitLab apply issue-sync docs to read the nested contract**

Replace the current tracking example in GitLab `issue-sync.md` with:

```yaml
parent:
  iid: 42
groups:
  - number: 1
    name: "Setup database schema"
    iid: 43
```

Then update all textual references so parent lookup means `parent.iid` and child lookup means matching `groups[].number` / `groups[].iid`, not `children[]`.

- [ ] **Step 4: Update the GitHub propose/apply docs to the same nested contract**

In the GitHub propose and apply docs, use:

```yaml
parent:
  number: 42
  url: https://github.com/org/repo/issues/42
groups:
  - number: 1
    name: "Setup database schema"
    issue_number: 43
    url: https://github.com/org/repo/issues/43
```

Rewrite any flat `parent_number`, `children[]`, or `children[].number` examples accordingly.

- [ ] **Step 5: Remove copy-paste platform drift from GitHub docs**

Specifically remove GitLab wording from GitHub apply/review references. Replace any incorrect phrases like these:

```text
Sync GitLab issues
.gitlab.yaml
glab
workflow::review
```

With GitHub-native equivalents:

```text
Sync GitHub issues
.github.yaml
gh
review
```

- [ ] **Step 6: Verify the contract is internally consistent**

Read these files and confirm they all describe the same nested shape:

```text
.opencode/skills/corgispec-propose/references/gitlab-issues.md
.opencode/skills/corgispec-gh-propose/SKILL.md
.opencode/skills/corgispec-apply-change/references/issue-sync.md
.opencode/skills/corgispec-gh-apply/references/issue-sync.md
openspec/changes/track-stool-color-and-duration/.gitlab.yaml
```

Expected: nested `parent` + `groups` in all examples, with no `parent_iid`, `parent_number`, or `children` examples remaining in those files.

---

### Task 2: Keep command wrappers shallow and phase-aware

**Files:**
- Modify: `.opencode/commands/corgi-propose.md`
- Modify: `.opencode/commands/corgi-apply.md`
- Modify: `.opencode/commands/corgi-review.md`
- Modify: `.claude/commands/corgi/propose.md`
- Modify: `.claude/commands/corgi/apply.md`
- Modify: `.claude/commands/corgi/review.md`

- [ ] **Step 1: Update wrapper wording to reference the shared phase contract without moving logic into wrappers**

For each wrapper, add or adjust prose so it clearly says the platform skill is responsible for the internal phase execution, while the wrapper is responsible only for:

```text
- reading openspec/config.yaml
- checking isolation constraints
- dispatching by schema
- verifying postconditions
```

Do not add platform-specific implementation steps here.

- [ ] **Step 2: Make apply wrapper postconditions explicitly align with phase boundaries**

Update apply wrapper expectations so the postconditions read like this in spirit:

```text
- the selected group's tasks are marked [x]
- the skill stopped after one group
- local output changes happened in the correct worktree
- if tracking is enabled, closeout synced the group state
```

Keep it as verification language, not implementation language.

- [ ] **Step 3: Make review wrapper enforce the human gate only**

Keep review wrapper verification focused on exactly two outcomes:

```text
- a review report exists
- the user was explicitly asked to approve, reject, or discuss
```

Do not let wrapper language imply that approval can happen automatically.

- [ ] **Step 4: Verify wrappers remain thin**

Read all 6 wrapper files and confirm they do not absorb GitLab/GitHub issue mutation details.

Expected: wrappers remain short router docs, not platform workflow scripts.

---

### Task 3: Split apply into discover, develop, closeout, and review handoff

**Files:**
- Modify: `.opencode/skills/corgispec-apply-change/SKILL.md`
- Modify: `.opencode/skills/corgispec-gh-apply/SKILL.md`
- Modify: `.claude/skills/corgispec-apply-change/SKILL.md`
- Modify: `.claude/skills/corgispec-gh-apply/SKILL.md`
- Modify as needed: `references/checkpoint-flow.md`, `references/delegation-strategy.md`, `references/issue-sync.md`, `references/worktree-discovery.md`

- [ ] **Step 1: Rewrite apply skill headings to match the phase contract**

Restructure the main headings so they read as:

```text
1. Discover: select change and resolve worktree
2. Discover: get status and apply instructions
3. Discover: parse task group and current context
4. Develop: execute current task group
5. Closeout: generate summary and sync tracker state
6. Closeout: report checkpoint and stop
```

Do not add a second implementation phase after closeout.

- [ ] **Step 2: Keep issue sync out of develop responsibilities**

Rewrite Step 5 / execution language so task execution is strictly about:

```text
- code / docs / file changes
- marking tasks.md checkboxes
- collecting actual outputs/evidence
```

And rewrite closeout so issue sync is explicitly separate:

```text
- generate rich summary
- sync child issue body/comment/labels
- sync parent progress
- prepare review handoff
```

- [ ] **Step 3: Preserve subagent delegation at the correct boundary**

Keep these guidance rules:

```text
- independent implementation tasks may be delegated during develop
- mechanical issue sync should be delegated during closeout
```

Make sure the docs do not suggest issue sync can happen before the group is truly complete.

- [ ] **Step 4: Update apply postconditions to match the split**

Use postconditions that verify both local completion and mirrored closeout, for example:

```text
- all tasks in current group are [x]
- progress reflects the updated group state
- if tracked, child issue is in review state with updated summary
- if tracked, parent progress is updated
- skill stopped after one group
```

- [ ] **Step 5: Verify apply can fail safely at closeout**

Read the edited apply skill and confirm the document clearly implies this retry model:

```text
If execution completed but issue sync fails, rerun closeout/sync rather than rerunning the whole group.
```

That sentence can be explicit or enforced through heading/step boundaries, but the behavior must be clear.

---

### Task 4: Decompose review into evidence, decision gate, mutation, and repair

**Files:**
- Modify: `.opencode/skills/corgispec-review/SKILL.md`
- Modify: `.opencode/skills/corgispec-gh-review/SKILL.md`
- Modify: `.claude/skills/corgispec-review/SKILL.md`
- Create or modify: `.claude/skills/corgispec-gh-review/SKILL.md`
- Modify mirrors in review references

- [ ] **Step 1: Make GitLab review headings phase-explicit**

Restructure GitLab review wording into:

```text
1. Discover: select change and resolve worktree
2. Discover: select task group and verify completion
3. Review: inspect existing reviewer feedback
4. Review: run quality checks and produce review report
5. Human gate: ask for approve / reject / discuss
6. Advance / Repair: execute the user's decision
```

- [ ] **Step 2: Bring GitHub review to the same skeleton**

Rewrite GitHub review so it matches the same conceptual steps as GitLab review. Do not leave quality checks, decision prompt, and mutation all blended together in one block.

Use this target ordering:

```text
discover -> review -> human gate -> advance/repair
```

- [ ] **Step 3: Keep quality checks informational only**

In both GitLab and GitHub review docs, include or preserve language equivalent to:

```text
quality checks inform the decision; they do not decide the outcome
only the user approves or rejects
```

- [ ] **Step 4: Move all state mutation into decision-specific sections**

Ensure that label changes, issue closure, parent progress updates, and repair task generation appear only inside:

```text
- approve path
- reject / repair path
```

They must not happen during evidence collection.

- [ ] **Step 5: Define the repair boundary tightly**

The repair flow must stay limited to:

```text
- collect user feedback
- analyze gaps
- confirm fix plan
- append precise fix tasks to tasks.md
- move issue state back to in-progress
```

It must explicitly not implement the fixes during review.

- [ ] **Step 6: Verify GitHub and GitLab review are now structurally aligned**

Read both edited review skills and confirm they share the same phase order, while still using the correct platform commands and label names.

Expected: same skeleton, different platform details.

---

### Task 5: Align propose closeout with the shared handoff model

**Files:**
- Modify: `.opencode/skills/corgispec-propose/SKILL.md`
- Modify: `.opencode/skills/corgispec-gh-propose/SKILL.md`
- Modify: `.claude/skills/corgispec-propose/SKILL.md`
- Modify: `.claude/skills/corgispec-gh-propose/SKILL.md`

- [ ] **Step 1: Keep the artifact DAG but separate it from tracker creation conceptually**

Preserve the current artifact build order:

```text
proposal -> spec/design -> tasks
```

But rewrite propose wording so tracker creation is part of `closeout`, not part of the primary artifact itself.

- [ ] **Step 2: Add canonical handoff/status language to propose output**

Without inventing a new engine, add wording that the propose result leaves behind a canonical local handoff/status state that apply will consume.

This can be expressed in prose such as:

```text
After artifacts are complete, write or update the canonical local tracking state and then mirror it to the platform tracker.
```

Use the repository's existing `.gitlab.yaml` / `.github.yaml` story as the first version of that canonical state unless you are also documenting a renamed file in the same pass.

- [ ] **Step 3: Keep human approval on package promotion, not artifact generation**

Ensure the docs imply that artifact generation can complete, but promotion to apply-ready still depends on explicit review/approval rather than being inferred from successful file creation alone.

- [ ] **Step 4: Verify propose remains the least invasive refactor**

Read the edited propose docs and confirm they still look like the least-changed flow of the three.

Expected: same DAG, clearer handoff/closeout boundary.

---

### Task 6: Update README and top-level docs to match the new contract

**Files:**
- Modify: `README.md`
- Modify: `README.zh-TW.md`

- [ ] **Step 1: Update command descriptions to match the split**

Refresh the command table descriptions so they reflect the phase contract more precisely, for example:

```text
/corgi-propose: generate planning artifacts, then close out into tracked handoff state
/corgi-apply: execute one Task Group, sync closeout state, then stop for review
/corgi-review: gather evidence, ask for an explicit decision, then apply the approved transition
```

- [ ] **Step 2: Keep the workflow diagram consistent with the new boundaries**

Do not redesign the flow entirely. Keep the same high-level command sequence, but make sure text around it no longer implies that apply or review are monolithic black boxes.

- [ ] **Step 3: Verify README and skill docs agree**

Read the command table plus the updated wrappers/skills and confirm they describe the same command behavior.

Expected: no contradiction between README promises and skill instructions.

---

### Task 7: Regression sweep and cleanup decision for `.codex`

> **Execution note (2026-04-22):** `.codex` copies remain intentionally deferred. `.opencode` and `.claude` were stabilized first per this plan, and `.codex` will be ported or retired only after the unified router contract proves stable in those primary surfaces.

**Files:**
- Inspect: `.opencode/**`
- Inspect: `.claude/**`
- Inspect: `.codex/**`

- [ ] **Step 1: Run a placeholder and drift sweep on updated docs**

Search the edited files for these patterns:

```text
TODO
TBD
parent_iid
parent_number
children:
Sync GitLab issues
workflow::review   # in GitHub docs only
```

Expected: only valid platform-specific terms remain.

- [ ] **Step 2: Decide whether `.codex` is updated now or explicitly deferred**

If time allows, port the same phase contract to `.codex` copies. If not, add a short note in the plan execution log or follow-up task list that `.codex` remains intentionally deferred until `.opencode` and `.claude` stabilize.

Do not half-update `.codex`.

- [ ] **Step 3: Read the final design and plan together for consistency**

Read both files:

```text
docs/superpowers/specs/2026-04-21-unified-router-workflow-design.md
docs/superpowers/plans/2026-04-21-unified-router-refactor.md
```

Expected: every major design point has a corresponding implementation task.

---

## Self-Review

- **Spec coverage:** This plan covers the normalized tracking contract, shallow wrappers, apply split, review split, propose closeout alignment, README alignment, and deferred `.codex` handling.
- **Placeholder scan:** No `TODO`, `TBD`, or "implement later" placeholders should remain after execution.
- **Type consistency:** Use one nested tracking shape consistently: `parent` + `groups`, with platform-specific child keys (`iid` vs `issue_number`).
