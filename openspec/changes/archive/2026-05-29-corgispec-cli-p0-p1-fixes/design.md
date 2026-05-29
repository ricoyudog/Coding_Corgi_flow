## Context

The `corgispec` CLI (v0.1.1) at `packages/corgispec/src/` has completed all 6 Task Groups from its original change. A 4-agent parallel review identified 4 CRITICAL and 6 HIGH/MODERATE issues. This design covers the technical approach for all P0 + P1 fixes (Batch 1 + Batch 2 from the review).

Current state:
- 32 source files, 19 test files in `packages/corgispec/`
- Commander-based CLI with `tsup` build pipeline
- Library functions well-tested; CLI glue layer untested
- Node 18+ declared in `engines` but one Node 21+ API used

## Goals / Non-Goals

**Goals:**
- Fix all 4 CRITICAL issues (C1–C4) to restore spec compliance and portability
- Fix all 6 HIGH/MODERATE issues (H1–H3, M1–M3) to improve robustness
- Maintain backward compatibility for all CLI command interfaces
- Keep changes minimal and surgical per issue

**Non-Goals:**
- Adding CLI integration tests (P2 — separate future change)
- Refactoring architecture or module boundaries
- Changing the public API surface beyond the additive `applyRequires` field
- Addressing brand consistency ("Corgi" vs "OpenSpec" — intentional)

## Unknowns & Investigation

| Unknown | Investigation | Conclusion |
|---------|--------------|------------|
| Which catch blocks are critical vs. non-critical? | Review document lists affected files: `skills.ts`, `hooks.ts`, `bootstrap.ts`, `doctor.ts`, `generate.ts` | Classify: bootstrap/config = critical (set exitCode), optional features = non-critical (log + continue) |
| Does `process.exitCode = 1` work with Commander's exit handling? | Commander respects exitCode — it doesn't call `process.exit()` internally for command actions | Safe to migrate all `process.exit(1)` → `process.exitCode = 1` |
| What template variables exist? | `instructions.ts` uses `{{changeName}}`, `{{outputPath}}`, `{{schemaName}}` based on the context object | Finite set — resolve all known variables, warn on unknown |
| What does molecule tier constraint actually require? | Original spec: molecules depend only on atoms, compounds depend on molecules/atoms | Enforce at validation time in `skills.ts:203-207` where the placeholder comment exists |

## Decisions

### D1: Error handling pattern — structured stderr logging

**Decision**: Replace empty `catch {}` blocks with `console.error(`[${context}] ${err instanceof Error ? err.message : String(err)}`)`.

**Rationale**: Preserves stdout cleanliness for JSON output. stderr logging is the CLI convention. Context prefix enables filtering.

**Alternatives considered**:
- Verbose/debug flag gating → Rejected: adds complexity, errors should always be visible
- Throw and let Commander handle → Rejected: not all catches are in command handlers

### D2: Exit code standardization — process.exitCode only

**Decision**: Replace all `process.exit(1)` with `process.exitCode = 1; return`.

**Rationale**: `process.exit()` skips cleanup, pending I/O, and open handles. `process.exitCode` lets Node drain naturally. Commander doesn't override this.

**Alternatives considered**:
- Keep `process.exit()` in "truly fatal" cases → Rejected: inconsistency breeds confusion, and no case in this CLI is so fatal that cleanup must be skipped

### D3: Node 18 compatibility — fileURLToPath pattern

**Decision**: Replace `import.meta.dirname` (1 occurrence in `doctor.ts:186-187`) with:
```typescript
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
```

**Rationale**: Standard pattern supported from Node 14+. Single occurrence makes the fix trivial.

### D4: Schema shape validation — lightweight inline check

**Decision**: Add a `validateSchemaShape(data: unknown)` function in `changes.ts` that checks for `name` (string), `version` (number), `artifacts` (array). Throws `Error` with descriptive message on failure.

**Rationale**: No external validation library needed for 3-field check. Keeps dependency count low.

**Alternatives considered**:
- Zod/Joi schema → Rejected: new dependency for trivial validation
- JSON Schema validation → Rejected: circular (schema validates schemas)

### D5: Template variable resolution — regex replacement in instructions.ts

**Decision**: Add a `resolveTemplateVars(text: string, vars: Record<string, string>): string` function that replaces `{{key}}` patterns. Unknown keys → empty string + stderr warning.

**Rationale**: Simple regex is sufficient for the known variable set. Warning on unknown prevents silent data loss.

### D6: Tier enforcement — validation-time rejection

**Decision**: In `skills.ts:203-207`, replace the placeholder comment with actual tier-checking logic:
- atom: must have 0 dependencies
- molecule: dependencies must all be tier=atom
- compound: dependencies must all be tier∈{atom, molecule}

**Rationale**: Enforcing at validation time (not runtime load) catches issues early during `corgispec validate`.

## Risks / Trade-offs

| Risk | Impact | Mitigation |
|------|--------|------------|
| C3 fix increases stderr output volume | Low | Only fires when actual errors occur; normal operation remains silent |
| C4 migration may miss edge cases in async flows | Medium | Grep for ALL `process.exit` occurrences; verify each callsite |
| M3 template resolution changes `instructions --json` output | Low | Additive improvement — consumers already expected resolved text; verify no raw `{{}}` consumers exist |
| D6 tier enforcement may flag existing skills as invalid | Medium | Run `corgispec validate` against current skill set before shipping; fix any newly-caught violations |

## Data Model

Not applicable — no data model changes in this change.

## API Contracts

### Modified: `status --json` output

```diff
 {
   "changeName": "...",
   "schemaName": "...",
   "isComplete": false,
+  "applyRequires": ["tasks"],
   "artifacts": [...]
 }
```

This is an **additive** change — existing consumers that don't read `applyRequires` are unaffected.

### Modified: `instructions --json` output

No schema change. The `instruction` and `template` string fields now contain resolved text instead of raw `{{variable}}` syntax. This is the originally-intended behavior per the spec.
