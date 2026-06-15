# Task 17 Decisions

## Decision: Use local dist CLI instead of rebuilding/publishing global
- Global `corgispec` is v2.3.2 (missing loop-check)
- Dist bundle at `packages/corgispec/dist/corgispec.js` is v2.4.1 (has loop-check)
- Used `node packages/corgispec/dist/corgispec.js` directly for tests
- Reason: avoids unnecessary global install mutation and npm publishing
