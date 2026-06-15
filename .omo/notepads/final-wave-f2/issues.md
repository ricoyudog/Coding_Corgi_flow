# F2 Code Quality Review Issues

## Build: 3 real type errors in loop-check.ts
- Line 134: `Argument of type 'string | null' is not assignable to parameter of type 'string'`
- Line 145: same
- Line 152: same

These are from `getLoopStatePath()` returning `string | null` being passed to functions expecting `string`. Need null checks or non-null assertions at the call sites.

## Pre-existing @types/node noise (8 errors, IGNORED)
8 TS2591 errors about 'node:fs', 'node:path', 'process' — these are pre-existing across the codebase (missing @types/node). Not new loop errors. Ignored per task instructions.

## Clean areas
- All 176 tests pass (25 + 126 + 5 + 14 + 6)
- Zero `as any` casts
- Zero `@ts-ignore` suppressions
- Zero TODO/FIXME/HACK
- Zero console.log
- Zero LSP errors on all 4 loop files
