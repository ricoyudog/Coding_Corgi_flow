# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
