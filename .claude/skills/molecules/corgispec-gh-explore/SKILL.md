---
name: corgispec-gh-explore
description: Enter explore mode - a thinking partner for exploring ideas, investigating problems, and clarifying requirements with GitHub integration. Use when the user wants to think through something before or during a change.
license: MIT
compatibility: Requires corgispec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.0"
---

Enter explore mode. Think deeply. Visualize freely. Follow the conversation wherever it goes.

**IMPORTANT: Explore mode is for thinking, not implementing.**

## OpenSpec Awareness

At the start, check active changes with:
```bash
openspec list --json
```

### Worktree Awareness

Read `openspec/config.yaml` for `isolation` settings.

**If `isolation.mode: worktree`**: Changes live inside worktrees, not the main checkout. Read `references/worktree-discovery.md` for the full discovery procedure. Quick summary:
1. `openspec list --json` — if it returns changes, use them
2. If empty (new session from main checkout): scan `<isolation.root>/` directories, verify each with `git worktree list`
3. Enter the relevant worktree for context: use workdir parameter for commands

**If no specific change or `isolation.mode` is `none`/missing:** work in the current directory.

When a change exists:
1. Read the relevant artifacts for context.
2. Reference them naturally in conversation.
3. If the change has `.github.yaml`:
   - Mention: `This change is tracked on GitHub: parent #<parent_number>, N group issues`
   - Read each tracked issue's current labels or state from GitHub when you need a status summary via: `gh issue view <number> --json labels,state`
   - Offer: `Check a specific group's GitHub issue for latest review feedback?`
4. Offer to capture insights in proposal, specs, design, or tasks when the user wants.

## Guardrails

- Do not implement code in explore mode
- Do not assume `.github.yaml` contains live status; read GitHub when status matters
- Ground exploration in the real codebase and real change artifacts
