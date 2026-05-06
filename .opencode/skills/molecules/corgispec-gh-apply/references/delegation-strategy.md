# Delegation Strategy for Task Execution

## When to Delegate

Subagent delegation SHOULD be used when:

- The Task Group has 3+ independent tasks
- Tasks involve different files/modules (low coupling)
- Mechanical work like issue sync, summary generation

Subagent delegation may be SKIPPED when:

- Task Group has only 1-2 simple tasks
- Tasks are tightly coupled (each depends on the previous)
- The task requires deep conversation context that would be expensive to transfer

## How to Analyze Dependencies

Before executing, scan the current group's tasks:

1. **Independent tasks**: Touch different files/modules, can run in parallel
2. **Sequential tasks**: Output of one is input to the next (e.g., "create schema" → "add migration")
3. **Shared-state tasks**: Modify the same file, must run sequentially

Build a simple dependency graph:
```
Task 4.1: Create user model         → independent
Task 4.2: Add migration for users   → depends on 4.1
Task 4.3: Create API endpoint       → depends on 4.1
Task 4.4: Add unit tests            → depends on 4.1, 4.3
```

In this example: 4.1 first, then 4.2 and 4.3 in parallel, then 4.4.

## Delegation Prompt Structure

When spawning a subagent for a task, provide:

```
1. TASK: Implement task N.M: "<task description>"
2. EXPECTED OUTCOME: <specific files to create/modify, expected behavior>
3. CONTEXT:
   - Change: <name>, workdir: <worktree path or project root>
   - Design decisions: <relevant excerpt from design.md>
   - Existing patterns: <relevant codebase conventions>
   - Related files: <specific file paths the task touches>
4. MUST DO:
   - Follow existing code patterns in the project
   - Keep changes minimal and focused on this task only
   - Run linting/type checks after changes
5. MUST NOT DO:
   - Modify files outside this task's scope
   - Refactor existing code
   - Add dependencies without explicit approval
   - Mark tasks complete in tasks.md (main agent does this)
```

## Category Selection for Subagents

| Task Type | Recommended Category | Skills to Load |
|-----------|---------------------|----------------|
| Frontend component | `visual-engineering` | `frontend-ui-ux` |
| Backend logic | `unspecified-high` or `deep` | (project-specific) |
| Simple file edit | `quick` | — |
| Test writing | `unspecified-high` | — |
| Complex algorithm | `ultrabrain` | — |

## Result Collection

After each subagent completes:

1. Verify the changes are in the correct location (worktree if applicable)
2. Run `lsp_diagnostics` on modified files
3. If subagent failed, use `session_id` to continue with fix instructions
4. Mark the task complete in `tasks.md` only after verification passes
5. Record which files were actually created/modified for the rich summary

## Issue Sync Delegation

During closeout, after all tasks in a group are complete, the issue sync work SHOULD be delegated:

```
category: "quick"
prompt: |
  1. TASK: Sync GitHub issues during closeout for completed Task Group N of change "<name>"
  2. EXPECTED OUTCOME: Child issue updated with rich summary, label changed from in-progress to review. Parent issue progress updated.
  3. CONTEXT:
     - .github.yaml path: <path>
     - Child issue number: <issue_number>
     - Parent issue number: <number>
     - Completed tasks: <list>
     - Modified files: <list with descriptions>
     - Objectives: <from proposal.md>
  4. MUST DO:
     - Follow the exact rich summary format from references/issue-sync.md
     - Use gh CLI for all issue operations
     - GitHub labels are flat (no prefix). The exact label names are:
       backlog, todo, in-progress, review, done
     - Use: gh issue edit <number> --remove-label in-progress --add-label review
     - Before changing labels, verify current labels with: gh issue view <number> --json labels --jq '.labels[].name'
  5. MUST NOT DO:
     - Modify any code files. Only update GitHub issues.
     - Invent new label names or add prefixes — use the exact labels listed above
```

This keeps the main agent's context clean for the next invocation.
