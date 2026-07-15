# Cross-artifact semantic checks

Apply only checks relevant to the artifact roles present in the schema. Infer roles from content and CLI metadata; do not require conventional artifact IDs.

## Intent and scope

- Confirm that each stated goal is represented by at least one normative requirement or explicit non-goal.
- Flag behavior introduced by requirements, design, or tasks that contradicts the declared intent or scope.
- Flag unresolved questions, placeholders, TODO markers, and mutually incompatible decisions.

## Requirements and scenarios

- Confirm that every normative requirement has observable acceptance behavior.
- Confirm that scenarios cover success, failure, boundary, authorization, and recovery behavior when those cases apply.
- Flag duplicate requirement names with different meanings and equivalent behavior expressed with conflicting rules.
- Confirm that capability/spec additions, modifications, and removals agree across all spec-like artifacts.

## Design and constraints

- Confirm that design decisions cover every cross-cutting requirement, external interface, persistence change, migration, and compatibility promise.
- Confirm that stated constraints and rejected alternatives do not conflict with the chosen design.
- Flag a design choice that silently narrows a requirement or adds an unplanned public contract.

## Tasks and execution order

- Use the CLI-provided `taskArtifactId`; do not locate tasks by filename.
- Confirm that every implementation-relevant requirement and scenario maps to at least one concrete task.
- Confirm that every task maps back to planned behavior and does not add unrelated implementation scope.
- Confirm that task groups respect dependency order and include verification for public behavior, failures, migrations, and compatibility.
- Flag vague tasks that cannot produce verifiable evidence or that combine unrelated outcomes.

## Finding format

Record each finding with:

- a stable code prefixed with `SEMANTIC_`;
- severity: error, warning, or info;
- artifact IDs and concrete paths;
- the conflicting or missing concepts;
- a minimal follow-up that names the artifact to revise without editing it.
