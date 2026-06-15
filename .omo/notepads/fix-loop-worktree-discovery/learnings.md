# Learnings - Fix Loop Worktree Discovery

## T6: Update 18 Molecule Files

- Successfully inserted `- **loop** — to find which change to loop over` after the `explore` line in all 18 molecule worktree-discovery.md files
- Used sed with pattern matching: `/explore/a - **loop** — to find which change to loop over`
- The `.claude` compound (`corgispec-loop`) does NOT have a `references/` directory (only `.opencode` compound has it)
- Total count: 18 molecules + 1 compound = 19 files with "loop" (not 20 as expected in task verification)
- Insertion point was consistent across all files: after line 79 (`explore`), before `Always use this procedure`

## T2: Copy to .claude mirror
- Created `.claude/skills/compounds/corgispec-loop/references/` directory
- Copied `worktree-discovery.md` from `.opencode/` mirror — 82 lines, byte-identical via diff
