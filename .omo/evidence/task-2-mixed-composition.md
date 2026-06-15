# Task 2 Evidence: Mixed Stop Hook Composition

**Date**: 2026-06-10T08:33:00Z  
**Verdict**: ✅ **PASS** — Hook composition is safe; JSON block takes precedence

## Test Setup
- Claude Code v2.1.168
- Hook A (stop-check-stub): exit 2 with stderr "still working - stop-check blocking"
- Hook B (loop-check-stub): exit 0 with `{"decision":"block","reason":"loop continues - next group bundle"}`

## Results

### All Stop events fire BOTH hooks

| Round | stop-check-stub | loop-check-stub | stop_hook_active |
|-------|----------------|-----------------|------------------|
| 1 | ✅ executed | ✅ executed | false |
| 2 | ✅ executed | ✅ executed | true |
| 3 | ✅ executed | ✅ executed | true |
| 4 | ✅ executed | ✅ executed | true |

### Key Findings

1. **Parallel execution confirmed**: Both hooks execute on every Stop event (verified via log timestamps)
2. **JSON block takes precedence**: Despite stop-check exiting 2 (would normally stop session), the JSON `decision:block` prevents the stop
3. **Order independence**: Hooks ran in configured order (stop-check first, loop-check second), both executed regardless
4. **Both outputs visible**: Claude Code screen shows both stderr messages:
   - `Stop hook error: [stop-check-stub]: still working - stop-check blocking`
   - `Stop hook error: loop continues - next group bundle`
5. **Continuation instruction**: Claude received and responded to the JSON `reason` field, acknowledging loop continuation

### Screen Output (Claude Code)
```
Stop hook error: [/tmp/corgi-loop-probe/hooks/stop-check-stub.sh]:
[stop-check-stub] logged invocation at 2026-06-10T08:33:44Z
still working - stop-check blocking

Stop hook error: loop continues - next group bundle
```

## Conclusion
Risk 3 (Stop-Check Hook Composition) from `wiki/research/loop-implementation-comparison.md:909-959` is verified SAFE.
Existing stop-check (exit 2) and new loop-check (JSON block) coexist without issues.
