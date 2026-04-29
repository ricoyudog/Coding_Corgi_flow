---
name: openspec-gh-apply
description: "OpenSpec apply skill for GitHub: manage Task Groups via gh CLI with GitHub issues"
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "2.0"
  generatedBy: "1.3.0"
---

Implement tasks from an OpenSpec change using GitHub Issues — one Task Group at a time, with subagent delegation.

## Preconditions (VERIFY BEFORE STARTING)

- [ ] `openspec/config.yaml` is readable
- [ ] Change name resolved (from input, context, or user prompt)
- [ ] If `isolation.mode` is `worktree` → worktree MUST exist (created by propose). If missing, STOP.
- [ ] `openspec status --change "<name>" --json` does NOT return `state: "blocked"`

## Forbidden Actions

- NEVER auto-continue to the next Task Group after completing one — STOP and report
- NEVER skip worktree resolution when `isolation.mode` is `worktree`
- NEVER fabricate file lists or summaries — only report actual implementation artifacts
- NEVER work in the main checkout when a worktree should be used

---

## Steps

### 1. Discover: Select change and resolve worktree

Read `openspec/config.yaml` for `isolation` settings.

**If `isolation.mode: worktree`**: Changes live inside worktrees, not the main checkout. Read `references/worktree-discovery.md` for the full discovery procedure. Quick summary:
1. `openspec list --json` — if it returns changes, use them
2. If empty (new session from main checkout): scan `<isolation.root>/` directories, verify each with `git worktree list` and check `openspec/changes/<name>/` exists inside
3. Auto-select if one found, prompt if multiple
4. ALL subsequent work uses the worktree as workdir

**If no isolation**: `openspec list --json` directly. Auto-select if one, prompt if multiple.

If name provided by user, use it directly. Announce: `Using change: <name>` (and worktree path if applicable).

### 2. Discover: Get status and apply instructions

```bash
openspec status --change "<name>" --json
openspec instructions apply --change "<name>" --json
```

Handle states: `blocked` → stop. `all_done` → suggest review/archive. Otherwise → proceed.

Read all files listed in `contextFiles`.

### 3. Discover: Parse Task Groups, find current group, and plan delegation

Read `references/checkpoint-flow.md` for: Task Group parsing from `tasks.md`, identifying the current group (first group with pending tasks), and building the group progress table.

Read `references/delegation-strategy.md` for: how to analyze tasks within the current group, decide which to delegate to subagents, and how to structure delegation prompts.

**Quick summary**: Analyze task dependencies within the group. Independent tasks SHOULD be delegated to subagents for cleaner context and potential parallelism. Each subagent gets only the relevant context files and task description — not the full conversation history.

**If tracked**: move the child issue to in-progress before starting Step 4 (read `references/issue-sync.md`).

### 4. Develop: Execute current Task Group

a. Announce: `Group N: <name>` (with issue number if tracked)
b. Execute the group's implementation tasks — either directly or via subagents per Step 3's plan:
   - Show which task is being worked on
   - Make minimal, focused code changes
   - Mark each task complete in `tasks.md`: `- [ ]` → `- [x]`
   - Record the files actually created or modified for closeout
   - Continue until the group is done or a blocker is hit
c. On blocker: report and wait for guidance.

### 5. Closeout: Generate summary, sync, and prepare review handoff

After all tasks in the group are complete, close out the group without doing new implementation work:

1. Generate rich summary (read `references/issue-sync.md` for format)
2. Sync to issue tracker if tracked (child issue body + completion comment + labels)
3. Update parent issue progress if tracked
4. Prepare the group for review handoff

**Issue sync SHOULD be delegated to a subagent** — it is mechanical work that doesn't need main agent context.

If implementation work is complete but closeout fails, retry closeout and sync rather than re-running the group implementation.

### 6. Closeout: Report checkpoint and STOP

```
## Checkpoint: Group N Complete

**Change:** <name>
**Progress:** A/B tasks complete
**Worktree:** <path> or "none"

Run `/opsx-review` to review this group, or `/opsx-apply` to continue.
```

**STOP. Do not auto-continue to the next group.**

---

## Postconditions (VERIFY BEFORE REPORTING DONE)

- [ ] All tasks in the current group are marked `[x]` in `tasks.md`
- [ ] `openspec instructions apply --change "<name>" --json` reflects updated progress
- [ ] If tracked: child issue moved to review label, body updated with rich summary
- [ ] If tracked: parent issue progress updated
- [ ] The skill STOPPED after reporting one completed group
- [ ] If `isolation.mode` is `worktree`: all changes are in the worktree, not main checkout
- [ ] No fabricated file lists — only actually created/modified files reported

**If ANY postcondition fails, STOP and report which one failed. Do not claim completion.**

---

## Guardrails

- Execute ONE Task Group per invocation
- Pause on errors, blockers, or unclear requirements — don't guess
- If implementation reveals design issues, suggest artifact updates
- Rich summaries come from actual implementation, never fabricated
- If `proposal.md` or `specs/` is missing, derive objectives from task descriptions
