# Planning reconciliation rules

## Reconcile in both directions

- Propagate revised intent downstream into requirements, scenarios, design, and tasks.
- Propagate a discovered downstream constraint upstream when it changes scope or acceptance behavior.
- Resolve contradictions explicitly; do not preserve two incompatible statements for historical context.
- Keep intentional non-goals and rejected alternatives when they still explain the current boundary.

## Preserve identifiers and history

- Preserve requirement, scenario, decision, task, and Task Group identifiers when their semantics remain stable.
- Allocate a new identifier for genuinely new behavior; do not recycle a removed identifier for different behavior.
- Delete obsolete planning text only when the artifact-scoped diff makes the removal explicit.
- Avoid formatting-only rewrites that obscure the semantic diff.

## Preserve task identity, not checkbox completion

- Preserve task and Task Group IDs when semantics remain stable.
- Planning checkboxes are not execution state. Never mark, reset, or infer `[x]` during reconciliation.
- Run Contract v3 is the lifecycle authority; the CLI-managed Issue dashboard is the tracker view. A semantic planning change invalidates the planning revision and follows the repair/adoption path, not a checkbox rewrite.

## Handle glob artifacts

- Treat the artifact ID as the planning unit and its concrete files as members.
- Present additions, edits, renames, and removals together in that artifact's confirmation.
- Require a candidate concrete path to match the returned glob and remain under `changeRoot` after normalization and realpath checks.
- Reject a path that targets an implementation, tracker, QA, memory, schema, or run-state area even if a malformed glob appears to include it.

## Confirm safely

- Show semantic changes and any Task Group/evidence invalidation before requesting approval.
- Offer approve, skip, or stop for the current artifact.
- Preserve a skipped artifact unchanged and include the resulting inconsistency in the final readiness report.
- Request a new confirmation when a validation failure requires a materially different diff.
