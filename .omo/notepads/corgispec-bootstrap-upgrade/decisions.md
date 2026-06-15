
## TDD RED Tests for --platform option (Task 5)

**Added 4 tests to `packages/corgispec/test/bootstrap.test.ts`:**
1. `rejects an invalid platform before running bootstrap` — CLI test, expects exit code 1 + "Invalid platform" → **FAILS** (--platform not recognized)
2. `shows --platform option in bootstrap help output` — CLI test, expects "--platform" in help → **FAILS** (not in commander options yet)
3. `passes platforms option through to runBootstrap` — library test with `platforms: ["claude", "opencode"]` → PASSES (extra property silently ignored by TS)
4. `defaults to all platforms when not specified` — library test without `platforms` → PASSES (same as existing tests)

**Key insight:** TypeScript structural typing allows extra properties on object literals passed to functions, so library tests 3 & 4 pass even without `platforms` in `BootstrapOptions`. The real TDD signal comes from CLI tests 1 & 2 which fail because `--platform` isn't in the commander command yet.

**Platform type:** `Platform = "claude" | "opencode" | "codex"` from `src/lib/platform.ts`

## Task 6: Add platforms/scope to BootstrapOptions and runBootstrap

### Scope semantics (decided)
- `undefined` → current behavior: install user skills + sync project files
- `"both"` → same as undefined: do everything
- `"global"` → skip project-local sync (syncManagedProjectFiles), only install user skills
- `"local"` → skip user-level skill install (installUserSkills), only sync project files

### Platform filtering approach
- `installUserSkills()` receives `platforms?: string[]` param
- Filters `allPlatforms: Platform[]` using `platforms.includes(p)`
- When undefined, uses all platforms (current behavior)
- Platform type cast is safe because bootstrap.ts command layer already validates against VALID_PLATFORMS

### Scope guard pattern
- Used simple `if (scope !== "local")` / `if (scope !== "global")` guards at call sites in runBootstrap()
- No changes to syncManagedProjectFiles() signature — scope logic stays in runBootstrap()
- This keeps the function pure and testable

## Task: Interactive prompts for platform/scope in bootstrap

**Date**: 2026-06-06

### Decision: Use node:readline/promises for interactive prompts

- Imported createInterface from node:readline/promises for async stdin reading
- Added promptInput() helper that creates readline, asks question, closes, returns trimmed input or default
- Interactive prompts only fire when --json and --yes are both absent (non-automation mode)
- Platform default: "claude,opencode,codex" (all platforms)
- Scope default: "global"
- When flags are provided, prompts are skipped entirely (non-interactive mode preserved)
- Prompts only added in CLI layer (bootstrap.ts), not in the library function (bootstrap.ts lib)
- No new npm dependencies added
- Validation logic unchanged

### Rationale
- node:readline/promises is built-in (Node 18+), no external deps needed
- Separating prompt logic from validation keeps the code modular
- --json and --yes flags serve as automation gates, consistent with existing patterns

## Scope TDD Tests (RED phase)
- Added 4 scope tests to `packages/corgispec/test/bootstrap.test.ts`
- CLI invalid scope validation: RED (needs implementation in `src/commands/bootstrap.ts`)
- `--scope` in help output: already GREEN (option registered in CLI)
- `scope` field in `runBootstrap()`: already GREEN (BootstrapOptions has `scope?: string`)
- Default scope behavior: already GREEN (no-scope call succeeds)
- Pre-existing CLI validation failures (schema, mode, platform) share same `err.status === undefined` bug — unrelated to scope work
