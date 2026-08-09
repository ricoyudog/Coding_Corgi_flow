# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.1] - 2026-08-09

### Changed

- `corgi-apply` is now the sole user-facing implementation workflow after propose. It drives the existing Run Contract v2 loop engine across every Task Group through implementation, verification, review evidence, a dedicated commit, optional tracker checkpoint, and finalization.
- Every approved Task Group must have its own clean, matching commit acknowledged by Run Contract v2 before tracker synchronization or the next group can begin.
- The hidden `corgispec apply` read-only query and `corgispec loop ...` state-machine API remain callable for internal lifecycle compatibility but are not user workflow entries.

### Removed

- Removed `/corgi-loop`, `/corgi:loop`, and `corgispec-loop` from packaged user commands and skills.
- The provider-specific `corgispec-apply-change` and `corgispec-gh-apply` skills remain retired.
- Managed bootstrap updates remove only signature-proven retired loop commands and Corgi-identified retired skills; custom same-path content remains a conflict and is never silently deleted.

### Migration

- Install `corgispec@3.0.1`, then run `corgispec bootstrap --mode update` for each managed project and selected user platform. Start or resume implementation with the matching `corgi-apply` command or skill.

## [3.0.0] - 2026-08-06

### Added

- Stable release of the RC.1–RC.8 delivery: OpenSpec 1.6-aware planning and stores, deterministic `update`/`ready`/`converge` commands, and the durable Run Contract v2 loop.
- Safe managed-install bootstrap and migration for Claude Code, OpenCode, and Codex, including manifest v2, conflict backups, transaction rollback, and opt-in hook migration.
- Explicit, retry-safe GitHub and GitLab tracker checkpoints for each committed Task Group; tracker writes stay explicit and hooks only report the required next action.

### Security

- Updated the production `js-yaml` dependency to 5.2.2 to clear the high-severity audit finding reported for the RC8 lockfile.

### Breaking

- Node.js >=20.19.0 and OpenSpec CLI >=1.6.0 <2.0.0 are required.
- GitHub- and GitLab-tracked changes use one Issue per change. Replace the former `parent`/`groups` tracker structure with the documented `issue` object before continuing a tracked change.

### Migration

- Upgrade the runtime, install `corgispec@3.0.0`, then run `corgispec doctor` and `corgispec ready <change> --strict` for every active change.
- Active RC7 Run Contract state is not migrated. Start a new loop run rather than attempting to replay prior RC7 Task Group progress.

## [3.0.0-rc.8] - 2026-08-04

### Added

- `corgispec loop sync-tracker` records an explicit, retryable GitHub or GitLab checkpoint for the committed Task Group. It updates only the tracker-managed dashboard region and adds a stable checkpoint marker so an interrupted successful remote write is detected without duplicating the comment.

### Changed

- A new loop run now enters `awaiting_tracker_sync` after `ack-commit` for a configured GitHub or GitLab change. The next Task Group becomes available only after the explicit tracker checkpoint succeeds; trackerless and unbound changes retain the local-only flow.
- Loop hooks report the required `sync_tracker` action but never write to GitHub or GitLab. Codex, Claude Code, and OpenCode require an explicit loop invocation, so ordinary skills, manual task edits, and host idle/Stop hooks cannot create tracker updates.
- Active loops reserve tracker writes for their own change until they reach a terminal state, preventing lifecycle skills from creating duplicate checkpoint updates.

### Security

- Updated the production lockfile resolution of transitive `fast-uri` to 3.1.5 within AJV's existing compatible version range.

### Migration

- Active RC7 Run Contract state is not migrated. Start a new RC8 loop run after upgrading; CorgiSpec does not attempt to replay or synchronize prior RC7 Task Group progress.

## [3.0.0-rc.7] - 2026-07-31

### Breaking

- GitHub- and GitLab-tracked changes now use exactly one Issue per change. New `.github.yaml` and `.gitlab.yaml` files store a single `issue` object; the former `parent`/`groups` tracker format is rejected and must be converted manually. Existing remote child issues are never migrated or modified automatically.

### Changed

- The authoritative task artifact is mirrored into a managed Task Dashboard in the single Issue body. Apply and review refresh dashboard state, while verification, review evidence, Human QA, blockers, and archive summaries are appended as Group-scoped comments on that same Issue.

### Migration

- For an existing tracked change, keep the former parent as the one change Issue, rewrite `.github.yaml` as `issue: { number: <parent-number>, url: <parent-url> }` or `.gitlab.yaml` as `issue: { iid: <parent-iid>, url: <parent-url> }`, and manually close or retain the former child issues. CorgiSpec deliberately performs no automatic migration or remote child-Issue mutation.

### Tests

- Added single-Issue contract coverage for GitHub/GitLab lifecycle skills, workflow schemas and templates, public documentation, Claude mirrors, and bundled package assets.

## [3.0.0-rc.6] - 2026-07-16

### Fixed

- Propose workflows are terminal planning-only handoffs again: strict readiness confirms artifact integrity but does not authorize implementation, and an original request phrased as a fix or build does not permit the agent to continue into apply or loop.
- GitHub, GitLab, and trackerless propose skills plus their OpenCode and Claude command wrappers now preserve `HEAD`, prohibit package installation and commits throughout propose, end the current turn after reporting, and require a later explicit apply or loop request. Codex receives the same canonical skill contract from the packaged assets.

### Tests

- Added provider parity, command-wrapper boundary, mirrored skill, bundled asset, and installable package assertions for the propose/apply handoff.
- Exercised the packed candidate through separate propose and apply invocations in OpenCode, Claude Code, and Codex fixtures without creating remote tracker state.

## [3.0.0-rc.5] - 2026-07-16

### Fixed

- `hook loop-check` now treats exactly one valid inactive legacy v1 run as historical state and returns `proceed` / `idle` without requiring an archived OpenSpec change to remain present or migrating the legacy files.
- Active, ambiguous, corrupt, future-schema, symlinked, and non-regular legacy state continues to fail closed. Canonical run discovery now rejects visible non-directory or symlink entries instead of silently hiding canonical corruption behind inactive legacy state.

### Tests

- Added Claude and OpenCode inactive-legacy fixtures, missing-change coverage, multiple historical changes, cross-platform ambiguity, active/corrupt/future failure cases, canonical precedence, path-safety checks, and a real-project regression gate against New_symphony's unchanged legacy state.

## [3.0.0-rc.4] - 2026-07-16

### Added

- `bootstrap --mode auto|update` now builds one migration plan for the complete selected Corgi-managed surface before writing. Project commands/schema/config/manifest, existing hooks, user-level skills, and Claude/OpenCode user commands are classified as current, missing, outdated, locally modified, obsolete, or ambiguous.
- Install manifest v2 preserves the original `installedAt`, records the package version, project hashes, per-platform hook ownership/generator format, and a structured migration summary. Canonical JSON, v1 JSON, and legacy YAML manifests are read safely and converge on `openspec/.corgi-install.json`.
- Project and user-level conflict backups use deterministic timestamped roots, and a filesystem transaction restores every touched managed path if a later write fails.

### Changed

- Bootstrap defaults to `both` scopes, synchronizes all 29 bundled skills for Claude Code, OpenCode, and Codex, and installs all bundled Claude/OpenCode user commands. `--platform` restricts both discovery and repair while retaining unselected manifest ownership records.
- Existing Claude Code, OpenCode, and Codex hooks are migrated through the same pure generators used by `hooks generate`. Projects that never installed Corgi hooks remain hookless and opt-in.
- `doctor` reports hook health independently for all three platforms instead of treating the first healthy configuration as authoritative.

### Fixed

- Missing managed files are repaired instead of being mistaken for local modifications. Real hash mismatches, malformed structured files, and ambiguous ownership are backed up and stop before either local or global managed assets are changed.
- Signature-proven legacy manifests, hook files, and project-local skill trees are removed safely without deleting unrelated settings, plugins, MCP configuration, approval policy, features, or custom hooks.

### Tests

- Added RC.1 migration fixtures, v1/YAML manifest upgrades, hookless preservation, three-platform hook migration, platform/scope isolation, concurrent preflight conflicts, idempotency, rollback, Windows/WSL command paths, package-smoke, and doctor regression coverage.

## [3.0.0-rc.3] - 2026-07-16

### Fixed

- Generated OpenCode plugins now capture the Node executable while CorgiSpec generates the plugin. OpenCode's standalone runtime exposes `opencode.exe` as `process.execPath`; using that host path as Node caused idle `loop-check` calls to print OpenCode help, exit with code 1, and inject a false CorgiSpec continuation prompt.
- Idle checks with no active Run Contract once again complete silently, while active loop decisions, hook output forwarding, session isolation, and `session.promptAsync` continuation remain unchanged.

### Tests

- Added a regression harness that replaces the plugin host's runtime `process.execPath` with a nonexistent OpenCode executable and verifies hooks still run through the captured Node path.

## [3.0.0-rc.2] - 2026-07-16

### Changed

- Hook enforcement is now scoped to active Corgi invocations instead of applying worktree-write and Task Group Stop guards to unrelated sessions. Claude Code uses skill-scoped lifecycle hooks, OpenCode tracks activation per session and resets it on each user message, and Codex omits generic write/stop enforcement where no documented skill lifecycle signal exists.
- `stop-check` now permits the required checkpoint stop after a completed Task Group when the next group is untouched, while continuing to block a stop when the current group is partially completed.

### Fixed

- Normal Claude Code, OpenCode, and Codex sessions can write in the main checkout without being redirected to a Corgi worktree merely because project hooks are installed.
- Concurrent OpenCode sessions no longer share Corgi hook activation state, and a later ordinary prompt no longer inherits enforcement from an earlier Corgi command or skill invocation.

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
