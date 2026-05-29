<!-- Task Groups (## headings) are checkpoint units. Each group becomes a child GitLab issue. Apply executes one group at a time. -->

## 1. Status JSON Compliance + Exit Code Standardization (C1, C4)

- [x] 1.1 Add `applyRequires` field to `status --json` output in `src/commands/status.ts` — read from schema's `apply.requires` array
- [x] 1.2 Grep all `process.exit(1)` calls across `src/commands/*.ts` and `src/lib/*.ts`; replace each with `process.exitCode = 1; return`
- [x] 1.3 Verify no `process.exit(1)` remains: `grep -r "process.exit" packages/corgispec/src/` should return zero results
- [x] 1.4 Run existing tests to confirm no regressions: `cd packages/corgispec && npm test`

## 2. Node 18 Compatibility + Doctor Schema Validation (C2, M2)

- [ ] 2.1 In `src/commands/doctor.ts:186-187`, replace `import.meta.dirname` with `dirname(fileURLToPath(import.meta.url))` pattern; add imports for `fileURLToPath` from `node:url` and `dirname` from `node:path`
- [ ] 2.2 Fix doctor's schema validation to target the schema definition file (`openspec/schemas/<name>/schema.yaml`) instead of `config.yaml`; verify it checks for required fields (`name`, `version`, `artifacts`)
- [ ] 2.3 Run `npm test` and verify doctor-related tests pass

## 3. Error Handling Consistency (C3, H1)

- [ ] 3.1 In `src/commands/apply.ts:72`, change `err: any` to proper `unknown` type with `instanceof Error` narrowing
- [ ] 3.2 Identify all empty `catch {}` blocks across: `src/lib/skills.ts`, `src/lib/hooks.ts`, `src/lib/bootstrap.ts`, `src/commands/doctor.ts`, `src/commands/generate.ts` (and any others found via grep)
- [ ] 3.3 Replace each empty catch with `console.error(`[${contextName}] ${err instanceof Error ? err.message : String(err)}`)` — use operation/function name as context
- [ ] 3.4 Classify catches: critical-path errors also set `process.exitCode = 1`, non-critical errors log and continue
- [ ] 3.5 Run `npm test` to confirm no regressions

## 4. Dependency Hygiene + Runtime Schema Validation (H2, H3)

- [ ] 4.1 Remove `glob` from `package.json` dependencies; verify no source file imports it
- [ ] 4.2 Remove `@rollup/rollup-linux-x64-gnu` from `package.json` (build artifact, not a declared dependency)
- [ ] 4.3 Add `validateSchemaShape(data: unknown)` function in `src/lib/changes.ts` that checks for `name` (string), `version` (number), `artifacts` (array); throws descriptive Error on failure
- [ ] 4.4 Call `validateSchemaShape()` in `loadWorkflowSchema()` after parsing YAML/JSON, before returning
- [ ] 4.5 Run `npm test` and `npm install` (verify no missing deps)

## 5. Skill Tier Enforcement + Template Resolution (M1, M3)

- [ ] 5.1 In `src/lib/skills.ts:203-207`, replace placeholder comment with tier enforcement logic: atoms must have 0 deps, molecules can only depend on atoms, compounds can depend on atoms+molecules
- [ ] 5.2 Add descriptive error messages for tier violations (e.g., "Molecule 'X' cannot depend on molecule 'Y' — molecules may only depend on atoms")
- [ ] 5.3 In `src/lib/instructions.ts`, add `resolveTemplateVars(text: string, vars: Record<string, string>): string` that replaces `{{key}}` with values; unknown keys → empty string + stderr warning
- [ ] 5.4 Call `resolveTemplateVars()` on `instruction` and `template` fields before returning from the instructions command
- [ ] 5.5 Run `npm test`; run `corgispec validate --path .` against the project's own skills to verify no false positives from tier enforcement
