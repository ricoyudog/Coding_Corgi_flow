---
name: corgispec-propose
description: Propose a new change with all artifacts generated in one step. Use when the user wants to quickly describe what they want to build and get a complete proposal with design, specs, and tasks ready for implementation.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "2.0"
  generatedBy: "1.3.0"
---

Propose a new change — create the change and generate all artifacts in one step.

## Preconditions (VERIFY BEFORE STARTING)

- [ ] `openspec/config.yaml` is readable
- [ ] Change name derived (kebab-case) from user input
- [ ] If `isolation.mode` is `worktree` → worktree MUST be created in Step 2 before ANY other work

## Forbidden Actions

- NEVER skip worktree creation when `isolation.mode` is `worktree`
- NEVER work in the main checkout when a worktree should exist
- NEVER copy `context`, `rules`, or `project_context` blocks into artifact files

---

## Steps

### 1. Discover: Get change name

If user provided a clear name or description, derive a kebab-case name (e.g., "add user auth" → `add-user-auth`). If unclear, ask the user what they want to build.

### 2. Discover: Resolve isolation and create worktree

Read `openspec/config.yaml` and check `isolation.mode`:

**If `isolation.mode` is `worktree`:**
```bash
git worktree add <isolation.root>/<name> -b <isolation.branch_prefix><name>
```
- Default root: `.worktrees`, default prefix: `feat/`
- If worktree already exists, reuse it
- Announce: `Worktree created at <path> (branch: <branch>)`
- **ALL subsequent steps use this worktree as workdir**

**If `isolation.mode` is `none` or `isolation` section is missing:**
- Work in the current directory. Skip worktree steps.

### 3. Develop: Create change directory and build artifacts in dependency order

```bash
openspec new change "<name>"
```
If `openspec/changes/<name>/` already exists, reuse it.

```bash
openspec status --change "<name>" --json
```
Loop through artifacts until all `applyRequires` are `done`. For each `ready` artifact:
```bash
openspec instructions <artifact-id> --change "<name>" --json
```
Use the `template` as structure, `instruction` as guidance. `context` and `rules` are constraints for YOU — never include them in output files.

Read `references/artifact-creation.md` for detailed artifact creation procedure.

The primary output of propose is the completed planning artifact package: `proposal -> {spec, design} -> tasks`.

### 4. Closeout: Show final status and prepare handoff state

```bash
openspec status --change "<name>"
```

After the artifacts are complete, prepare the local handoff state that later phases consume. The planning artifact package remains the primary output; tracker setup and worktree metadata are closeout work layered on top of it.

### 5. Closeout: Create issue tracking

Read `references/gitlab-issues.md` for the full GitLab issue creation procedure.

Skip if `.gitlab.yaml` already exists or `glab` is unavailable.

If created, `.gitlab.yaml` is the canonical local tracking state for GitLab-tracked handoff. Later phases should consume that local state and mirror it to the platform tracker rather than treating issue creation as part of the artifact package itself.

### 6. Closeout: Save worktree metadata (if isolation active)

If worktree was created in Step 2, write `.worktree.yaml` in the change directory:
```yaml
path: <isolation.root>/<name>
branch: <isolation.branch_prefix><name>
created: <ISO-8601-timestamp>
```

---

## Output

Summarize:
- Change name and location
- Artifacts created
- Handoff status: local artifact package complete
- GitLab tracking status (created or skipped)
- Worktree status: path and branch, or "none"
- Next step: "Review the proposal/spec/design/tasks package, then run `/corgi-apply` to start implementation."

---

## Postconditions (VERIFY BEFORE REPORTING DONE)

- [ ] All `applyRequires` artifacts exist and have content
- [ ] `openspec status --change "<name>" --json` shows all required artifacts as `done`
- [ ] If `isolation.mode` is `worktree`: run `git worktree list` — the change worktree MUST appear
- [ ] If `isolation.mode` is `worktree`: `openspec/changes/<name>/.worktree.yaml` exists
- [ ] If glab available: `openspec/changes/<name>/.gitlab.yaml` exists
- [ ] No `<context>`, `<rules>`, or `<project_context>` blocks appear in any artifact file

Meeting these postconditions means artifact generation and closeout are complete. It does not replace explicit human review of the proposal/spec/design/tasks package before implementation begins.

**If ANY postcondition fails, STOP and report which one failed. Do not claim completion.**
