## Context

This repo (`Coding_Corgi_flow`) is a workflow/skills toolkit that turns AI coding assistants into structured engineering workflows. It currently ships skills, schemas, and slash commands but relies on three disconnected mechanisms for installation and management:

1. **Upstream CLI** (`@fission-ai/openspec` v1.3.1) — globally installed, provides `openspec init/list/change/archive/status/instructions` commands
2. **Bash script** (`install-skills.sh`) — copies skill files to user-level directories
3. **Local tool** (`tools/ds-skills`) — validates skill structure and generates dependency graphs

The workflow has diverged from upstream significantly (custom schemas, different skill structure, GitLab/GitHub dual-track). The upstream CLI still works for change management, but the project needs a single cohesive tool that owns the full lifecycle.

**Constraints:**
- Must remain Node.js-based (ecosystem alignment, skill authors use JS/TS)
- Must support Node >= 18
- Skills remain file-based (SKILL.md + skill.meta.json) — no database
- The instruction-generator pattern is preserved: CLI outputs prompts, never calls LLMs directly

## Goals / Non-Goals

**Goals:**
- Single `npm install -g corgispec` replaces all three current mechanisms
- Binary name `corgispec` with `--version` support
- All existing functionality preserved (validate, list, graph, install skills, workflow commands)
- New `doctor` command for environment diagnostics
- TypeScript source with ESM output
- Comprehensive test suite (vitest)
- Publishable to npm as unscoped `corgispec` package

**Non-Goals:**
- GUI or TUI dashboard (text output only)
- LLM integration (the CLI generates instructions, never calls models)
- Plugin/extension system (skills ARE the extension mechanism)
- Monorepo tooling (single package, not a workspace)
- Backward compatibility with `@fission-ai/openspec` config formats (clean break)
- Platform-specific installers (Homebrew, apt, etc.) — npm only for v1

## Unknowns & Investigation

### 1. Where should the package source live?

**Unknown**: Should `corgispec` source live in this repo or a new repo?

**Investigation**: This repo is the skills toolkit. The CLI is the delivery mechanism for these skills. Separating them means coordinating releases across repos. Keeping them together means the repo gains a `packages/corgispec/` directory with build infrastructure.

**Conclusion**: Keep it in this repo under a top-level `packages/corgispec/` directory. The build step copies skills from `.opencode/skills/` into the package's `assets/` before publish. This keeps the single-repo workflow.

### 2. How to bundle skills without duplicating source of truth?

**Unknown**: Skills are authored in `.opencode/skills/`. The package needs them in `assets/skills/`. How to avoid drift?

**Investigation**: Options — (a) symlinks (breaks on npm pack), (b) build-time copy script, (c) reference at runtime via relative path.

**Conclusion**: Build-time copy. A `prepublishOnly` script copies `.opencode/skills/corgispec-*` into `packages/corgispec/assets/skills/`. The `.gitignore` excludes the copied assets. CI validates they match.

### 3. Can the `corgispec` package name be claimed on npm?

**Unknown**: The name `corgispec` may be taken.

**Investigation**: `npm show corgispec` returned 404 (not on registry). The name is available.

**Conclusion**: Claim `corgispec` on npm immediately with a placeholder publish if needed.

### 4. How do workflow commands generate instructions without upstream code?

**Unknown**: The upstream `openspec instructions` command resolves templates, context, and rules. How to replicate?

**Investigation**: The upstream uses a schema registry + template resolver. Our schemas live in `openspec/schemas/`. The `instructions` command reads the active schema, resolves artifact templates, injects project context from `config.yaml`, and outputs JSON.

**Conclusion**: Reimplement the template resolution logic directly. It's a straightforward file-read + YAML-parse + template-fill pipeline. No complex upstream abstractions needed.

## Decisions

### D1: Package location — `packages/corgispec/` in this repo

**Rationale**: Single repo keeps skills and CLI synchronized. No cross-repo release coordination.

**Alternative**: Separate repo — rejected due to release coordination overhead.

### D2: CLI framework — Commander.js

**Rationale**: Already used in `tools/ds-skills`, lightweight, excellent TypeScript types, well-maintained.

**Alternative**: `yargs` — heavier, more opinionated. `oclif` — too much framework for this scope.

### D3: Build system — `tsup` (esbuild-based)

**Rationale**: Fast, zero-config for ESM output, handles TypeScript natively. Single bundled output means fewer files in the package.

**Alternative**: `tsc` only — works but slower and produces many files. `esbuild` directly — less TypeScript integration.

### D4: Instruction generation — Template-literal approach

**Rationale**: Each schema defines artifact templates as Markdown with frontmatter metadata. The CLI reads the template, resolves variables (change name, project context, dependencies), and outputs the enriched instruction JSON. No templating library needed — string interpolation suffices.

**Alternative**: Handlebars/EJS — overkill for simple variable substitution.

### D5: Skill bundling — build-time copy with validation

**Rationale**: The `prepublishOnly` script copies skills and validates they pass schema checks before publishing. Published package always contains validated skills.

**Alternative**: Runtime resolution from repo — only works during development, not after global install.

### D6: Config format — preserve `openspec/config.yaml` structure

**Rationale**: Existing projects already have `config.yaml`. The CLI reads the same format. Migration cost = zero for existing users.

**Alternative**: New config format — unnecessary churn.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| npm name `corgispec` squatted before publish | Publish placeholder immediately after approval |
| Skill bundling drifts from source | CI step validates `assets/skills/` matches `.opencode/skills/` |
| Users have muscle memory for `openspec` command | Document migration, provide clear uninstall/install instructions |
| TypeScript build adds complexity | Use `tsup` for near-zero-config builds |
| Large package size from bundled skills | Skills are small text files (~500KB total), negligible |

## Data Model

Not applicable — no data model changes in this change. The CLI operates on the filesystem (YAML configs, Markdown files, JSON schemas). No database or persistent state beyond the file system.

## API Contracts

Not applicable — no API surface changes in this change. The CLI is a command-line tool; its "API" is the command interface documented in the spec files. No HTTP endpoints or programmatic API is exposed.
