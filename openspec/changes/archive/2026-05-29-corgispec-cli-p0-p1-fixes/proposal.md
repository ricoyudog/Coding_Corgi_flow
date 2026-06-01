## Why

The corgispec-cli v0.1.1 review ([wiki/decisions/2026-05-29/corgispec-cli-v1-review.md](../../../wiki/decisions/2026-05-29/corgispec-cli-v1-review.md)) identified 4 CRITICAL (P0) and 6 HIGH/MODERATE (P1) issues across the `packages/corgispec/` implementation. P0 issues include a spec compliance gap, Node 18 incompatibility, ~15 silent error-swallowing catch blocks, and inconsistent exit code handling. P1 issues include an unimplemented tier constraint, incorrect schema validation target, deferred template resolution, a type bypass, unused dependencies, and missing runtime validation. Total estimated fix effort: ~6.5h for issues that affect correctness, portability, and debuggability.

## What Changes

- Add missing `applyRequires` field to `status --json` output (spec compliance)
- Replace `import.meta.dirname` with Node 18-compatible `fileURLToPath` + `path.dirname` in doctor command
- Replace ~15 empty `catch {}` blocks with structured error logging to stderr
- Standardize on `process.exitCode = 1` across all command files (remove `process.exit(1)` calls)
- Fix `err: any` type annotation to use `unknown` with proper narrowing
- Remove unused `glob` dependency and misplaced `@rollup/rollup-linux-x64-gnu` from package.json
- Add runtime shape validation to `loadWorkflowSchema()` 
- Implement molecule tier dependency constraint (currently placeholder comment)
- Fix doctor schema validation to target JSON Schema files (not YAML)
- Move template variable resolution from consumer to generation time in `instructions.ts`

## Capabilities

### New Capabilities

- `cli-error-handling`: Cross-cutting error handling policy — empty catch block elimination, exit code standardization (`process.exitCode` over `process.exit`), and proper error type narrowing
- `status-json-compliance`: The `status --json` output conforms to its spec contract including the `applyRequires` field
- `doctor-robustness`: Doctor command works on Node 18+ and validates correct schema targets
- `skill-tier-enforcement`: Molecule-layer dependency constraint is enforced at runtime (not just a placeholder comment)
- `template-resolution`: Template variables are resolved at generation time rather than deferred to downstream consumers
- `dependency-hygiene`: Package.json contains only used dependencies; runtime-loaded schemas have shape validation

### Modified Capabilities

_(None — original corgispec-cli specs have not been promoted to `openspec/specs/` yet)_

## Impact

- **Code**: `packages/corgispec/src/` — 10+ command files (exit codes), 5 library files (catch blocks, tier logic, template resolution, schema loading)
- **Dependencies**: `package.json` — remove `glob`, remove `@rollup/rollup-linux-x64-gnu`
- **Runtime**: Node 18 compatibility restored for `doctor` command
- **Output contract**: `status --json` gains `applyRequires` field (additive, non-breaking)
- **Behavior change**: Template variables now resolved in `instructions` output (downstream consumers get final text instead of `{{var}}` placeholders)

## GitLab Issue

<!-- This section will be filled automatically by the propose skill with the parent issue link. -->
