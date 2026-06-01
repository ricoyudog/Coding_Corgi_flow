---
type: wiki
created: 2026-05-29
source_change: corgispec-cli-p0-p1-fixes
tags: [pattern, typescript, runtime-validation]
---

# Validate Before Cast

## Context
TypeScript CLI tools commonly load external YAML/JSON files and cast the parsed output directly (`yaml.load(raw) as MyType`). This skips runtime validation — malformed files produce confusing downstream errors instead of clear schema violations at the loading boundary.

## Pattern
Insert a lightweight shape-validation function between parsing and casting:

```typescript
function validateSchemaShape(data: unknown): void {
  if (!data || typeof data !== "object") {
    throw new Error("File is not a valid YAML/JSON object");
  }
  const obj = data as Record<string, unknown>;
  if (!obj.name || typeof obj.name !== "string") {
    throw new Error("Missing required 'name' field (must be a string)");
  }
  // ... check each required field
}

const parsed = yaml.load(raw);
validateSchemaShape(parsed);
const schema = parsed as WorkflowSchema;
```

## When to Use
- Loading external config/schema files (YAML, JSON, TOML)
- The type has 2+ required fields that must be validated at the boundary
- Full schema validation (Zod, AJV) is overkill for the context

## Example
Applied in `packages/corgispec/src/lib/changes.ts:loadWorkflowSchema()` — validates `name` (string), `version` (number), `artifacts` (array) before casting to `WorkflowSchema`.

## Source
- Extracted from change: [[openspec/changes/corgispec-cli-p0-p1-fixes/proposal]]
