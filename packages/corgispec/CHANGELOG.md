# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0-rc.1] - 2026-07-16

### Breaking

- CorgiSpec now requires **Node.js >=20.19.0** and an independently installed **OpenSpec CLI >=1.6.0 <2.0.0**. OpenSpec 1.3–1.5 are no longer supported.
- OpenSpec 1.6 JSON responses are now the source of truth for change roots, artifact DAGs, glob expansion, status, and instructions. Integrations that relied on Corgi guessing `tasks.md`, `specs/`, or `openspec/changes/<name>` must consume the returned `changeRoot` and `artifactPaths` instead.

### Added

- `corgispec update <change> [--store <id>] --json` and the `/corgi:update` skill expose a planning-only reconciliation contract. The CLI itself is read-only; the skill shows and confirms each artifact-scoped diff before editing.
- `corgispec ready <change> [--strict] [--store <id>] --json` and the `/corgi:ready` skill provide a deterministic planning-integrity gate covering OpenSpec strict validation, artifact completeness, task structure, placeholders, open questions, and capability/spec parity.
- `corgispec loop init|inspect|submit|ack-commit|finalize|invalidate|resume` is the only writer for Run Contract v2 state. Runs use locked, CAS-protected snapshots and replayable event logs under `.corgi/loop/<change>/`.
- Evidence v2 binds every verification and review bundle to its run, Task Group, attempt, planning revision, Git revisions, and workspace fingerprint. Human-only review triage uses stable CLI-generated finding fingerprints.
- `corgispec converge <change> --json` and the `/corgi:converge` skill distinguish `converged`, `needs_work`, and `blocked`. Confirmed implementation-only gaps append one Task Group and create a successor run without rewriting prior groups; a durable intent makes interrupted confirmations idempotently resumable with the same confirmation token.
- Custom OpenSpec schemas are first-class. `corgi.tracking.provider` selects `github`, `gitlab`, or `none`, while `corgi.taskArtifactId` identifies the single artifact containing executable Task Groups.
- OpenSpec Stores are supported through authoritative paths returned by OpenSpec and the `--store <id>` selector.
- Planning revisions and canonical path checks protect lifecycle operations from stale artifacts, symlink escapes, and writes outside the resolved change root.

### Changed

- Legacy `github-tracked` and `gitlab-tracked` schemas still infer their matching tracker, but `corgispec doctor` now recommends writing the explicit `corgi.tracking.provider` setting.
- Lifecycle JSON preserves compatibility fields while exposing `planningComplete`, `implementationComplete`, `changeRoot`, and `artifactPaths`. The legacy `isComplete` field means both planning and implementation are complete.
- Loop skills no longer write state, verification, or review files directly. Attempt bundles are committed atomically, durable events precede snapshots, and canonical finalize rejects stale, missing, or tampered evidence.
- Hook integrations for Claude Code, OpenCode, and Codex now pass session identity, stdin, stdout, stderr, and exit codes through the v2 CLI contract.
- `doctor` and bootstrap now probe the real OpenSpec runtime and schema contract before managed writes instead of reporting a fixed prerequisite pass.
- Clean-checkout tests rebuild bundled assets first. The release check now includes build, typecheck, coverage thresholds, and an installable npm tarball smoke test.

### Fixed

- Hardened writable artifact paths, loop locks, attempt bundles, and convergence temporaries against dangling symlinks, replacement races, path traversal, partial initialization, and pre-rename process crashes.
- Convergence now serializes by the canonical external Store target across worktrees, and planning revisions bind to the authoritative change root.
- The loop event budget reserves a durable terminal slot; a session-changing `resume` can be retried idempotently only with the exact original session, CAS token, and normalized arguments.
- OpenCode idle handling now reflects its fire-and-forget event contract and requests interactive continuation through `session.promptAsync`. OpenCode and Codex generated hooks invoke the resolved JavaScript CLI entry through Node directly, avoiding Python and Windows npm `.cmd`/`.bat` shims while preserving stdin, stdout, stderr, and exit status.

### Migration

- Upgrade Node and OpenSpec before installing this RC, add an explicit `corgi` block to `openspec/config.yaml`, then run `corgispec doctor` and `corgispec ready <change> --strict` for each active change. A single legacy v1 loop is migrated automatically; ambiguous, corrupt, or future-version state fails closed, and its current verification/review evidence must be rerun. See the repository README and `INSTALL.md` for examples.

## [2.4.3] - 2026-06-16

### Changed

- **OpenCode hook output is now a TypeScript plugin by default.** OpenCode v1.17.7+ rejects the `hooks` key in `opencode.json` (`additionalProperties: false`), so `corgispec hooks generate --platform opencode` now always produces a TypeScript plugin via `buildOpenCodeDeepPlugin()`, registering all 6 lifecycle hooks: `SessionStart` (`experimental.chat.system.transform`), `PreToolUse` (`tool.execute.before` for pre-write/pre-bash), `PostToolUse` (`tool.execute.after` for post-write), `Stop` (`session.idle` event for stop-check/loop-check), and `PostCompact` (`session.compacted` event). The `--deep` flag is deprecated as a no-op (both paths now produce identical output).

### Fixed

- **`loop-check` output contract regression.** The refactored `processLoopState()` dropped `phase`/`terminal`/`reason` from hook stdout output. Loop orchestration, stop-check composition, and integration tests depend on these fields to distinguish terminal stops from non-terminal blocks. Restored by deriving `phase` from `state.phase` and `terminal` from the active→inactive transition after `processLoopState()`.
- **`experimental.chat.system.transform` plugin signature.** Generated plugin used `async ({ output })`, destructuring the first arg as `{ output }`, but the first arg is actually `{ sessionID, model }`. This made `output.system.push()` a no-op. Fixed to `async (_input, output)`.
- **`tool.execute.after` args location.** Generated plugin used `output.args`, but per `@opencode-ai/plugin` the `args` field is on INPUT for the `.after` hook (output has `title`/`output`/`metadata`). Fixed to `input.args`.
- **`terminal()` reason field.** The `terminal()` helper returned `{ decision: 'proceed' }` without `reason`, but integration tests expect `reason` to contain `'FAIL'` (`verify_failed`) and `'critical'` (`stopped_review_findings`). Restored optional `reason` parameter.

### Added

- `pretest` npm script runs `npm run build` before `vitest`, preventing stale `dist/` bundles from causing spurious test failures when source has been updated.

### Internal

- Removed `.omo/` session artifacts from git tracking and added `.omo/` to `.gitignore`.

## [2.4.2] - 2026-06-12

### Added

- **corgi-loop**: Self-driving fix-retry cycle — runs apply→verify→review bundles automatically per Task Group, with loop-check/stop-check hooks for lifecycle control
- `corgispec hook loop-check` — Evaluates loop state (task completion, verify results, review decisions) and outputs next action for AI agents
- `corgispec hook stop-check` — Detects active loops and defers stop decisions to loop-check pipeline
- Loop state management: `lib/loop-state.ts` — state discovery, transition, and persistence across hook invocations
- Loop types: `lib/loop-types.ts` — TypeScript interfaces for LoopState, VerifyArtifact, ReviewArtifact
- Loop validation: `lib/loop-validation.ts` — spec coverage checks, verify result parsing, review decision extraction
- `corgispec hooks generate` now registers loop-check and stop-check hooks in generated config
- **corgispec-loop** compound skill (`.opencode/skills/compounds/corgispec-loop/`) — end-to-end loop orchestration
- **corgispec-review-loop** molecule skill (`.opencode/skills/molecules/corgispec-review-loop/`) — automated loop review with quality checks
- Worktree discovery in loop pipeline — automatically locates project root from worktree contexts

### Changed

- `stop-check` hook now detects active corgi-loop sessions and defers to loop-check pipeline
- Hook generation output includes loop-check and stop-check entries

### Tests

- 763 lines of loop-check tests (unit + integration)
- 1223 lines of loop-validation tests
- Total: +1986 lines of new test coverage

## [0.1.0] - 2026-05-01

### Added

- Initial release of `corgispec` CLI
- **init** command — scaffold OpenSpec directory structure with `--schema` and `--platform` options
- **doctor** command — diagnose environment (Node version, skill dirs, config, platforms, schemas)
- **propose** command — create a new change and output proposal instructions
- **apply** command — determine next task group and output apply instructions
- **review** command — output review checklist instructions
- **archive** command — check completeness and output archive instructions
- **status** command — display artifact completion state for a change
- **instructions** command — output enriched artifact instructions as JSON
- **install** command — copy bundled skills to user-level platform directories
- **validate** command — validate skill metadata against JSON Schema
- **list** command — list skills with tier/platform/JSON filters; list changes
- **graph** command — output skill dependency graph in Mermaid or DOT format
- Asset bundling with checksum verification (skills, JSON schemas, workflow schemas)
- Node >= 18 version guard with clear error messaging
- Config loading/validation from `openspec/config.yaml`
- Platform detection (Claude Code, OpenCode, Codex)
- 85 tests across 8 test suites
