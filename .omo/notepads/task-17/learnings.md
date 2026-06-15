# Task 17 Learnings: loop-check hook smoke test

## Key Findings

1. **loop-check is in source and dist but NOT globally installed**
   - Source: `packages/corgispec/src/commands/hooks/loop-check.ts` (registered in index.ts)
   - Dist bundle: `packages/corgispec/dist/corgispec.js` at v2.4.1 HAS loop-check
   - Global install: v2.3.2 does NOT have loop-check
   - Must use local CLI: `node packages/corgispec/dist/corgispec.js hook loop-check ...`

2. **Full 2-group loop lifecycle works correctly (.claude/ path)**
   - Invocation 1 (no artifacts): block → "awaiting apply+verify+review"
   - Invocation 2 (Group 1 PASS): block → advance to Group 2
   - Invocation 3 (Group 2 PASS): block → awaiting_finalize
   - Invocation 4 (finalize): proceed → done, terminal=true, active=false

3. **stop-check defers to loop-check correctly**
   - When `.claude/corgi-loop/*/state.json` has `active: true`, stop-check exits 0
   - When no active loop and no changes, stop-check also exits 0
   - This prevents stop-check from interfering with active loop runs

4. **OpenCode platform path (.opencode/corgi-loop/) works identically**
   - loop-check scans both `.claude/corgi-loop/` and `.opencode/corgi-loop/`
   - Behavior is identical regardless of platform directory
   - State transitions verified: await → advance → finalize → done

## CLI Pattern
```bash
echo '{"hook_event_name":"Stop","stop_hook_active":false}' | node packages/corgispec/dist/corgispec.js hook loop-check --path $TMPDIR
```
