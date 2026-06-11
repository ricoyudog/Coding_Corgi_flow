# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
