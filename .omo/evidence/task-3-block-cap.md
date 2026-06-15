# Task 3 Evidence: Consecutive Block Guard

**Date**: 2026-06-10T08:35:00Z  
**Verdict**: ✅ **PASS** — Block cap confirmed; Claude overrides after ~9 consecutive blocks

## Test Setup
- Claude Code v2.1.168
- Stop hook: always returns `{"decision":"block","reason":"Block #N - testing consecutive block cap"}` via exit 0

## Results

### Block Count Log
9 hook invocations occurred (18 lines in log file):

| Invocation | Timestamp | stop_hook_active |
|-----------|----------|------------------|
| 1 | 08:35:12 | false |
| 2 | 08:35:19 | true |
| 3 | 08:35:26 | true |
| 4 | 08:35:32 | true |
| 5 | 08:35:37 | true |
| 6 | 08:35:41 | true |
| 7 | 08:35:49 | true |
| 8 | 08:35:52 | true |
| 9 | 08:35:57 | true |

### Claude Code Override
After 9 consecutive blocks, Claude Code displayed:
```
CLAUDE_CODE_STOP_HOOK_BLOCK_CAP to raise this limit.
Cooked for 1m 7s
```
Claude overrode the hook and terminated the session.

### Key Findings
1. **Block cap EXISTS**: ✅ Claude Code DOES override after consecutive blocks
2. **Threshold**: ~9 blocks observed (documented as 8; version 2.1.168 may have minor variation)
3. **Safety margin**: Using `maxBlocks=6` (well under cap) provides safe margin
4. **Env var**: `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` is referenced in the override message

## Conclusion
Risk 2 (Anti-Infinite-Loop Guard) from `wiki/research/loop-implementation-comparison.md:939-955` is verified.
Setting `maxBlocks=6` in our state machine provides a 3-block safety margin below the override threshold.
