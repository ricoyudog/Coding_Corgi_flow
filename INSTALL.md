# CorgiSpec 3.0 RC — Agent Bootstrap

Use this file as the entry point when an LLM agent installs or upgrades CorgiSpec in a target project. CorgiSpec and OpenSpec are separate CLIs: install and validate both before bootstrap writes managed files.

## Runtime requirements

- Node.js >=20.19.0
- `corgispec@3.0.0-rc.2`
- `@fission-ai/openspec` >=1.6.0 <2.0.0

OpenSpec 1.3–1.5 are unsupported; do not continue with a compatibility fallback.

```bash
node --version
npm install -g @fission-ai/openspec@^1.6.0
npm install -g corgispec@next
openspec --version
corgispec --version
```

`next` is the npm prerelease channel and currently resolves to `corgispec@3.0.0-rc.2`. Use `npm install -g corgispec@3.0.0-rc.2` when an exact, reproducible version is required. Do not use the unqualified package name for this upgrade: `corgispec` and `corgispec@latest` remain on stable `2.4.3`.

## Fresh bootstrap

1. Ask for the target project path if it was not supplied.
2. Run the environment and OpenSpec contract checks without making project changes:

   ```bash
   corgispec doctor --path /path/to/project
   ```

3. Bootstrap the project:

   ```bash
   corgispec bootstrap --target /path/to/project --mode auto
   ```

   For a bundled workflow, add `--schema github-tracked` or `--schema gitlab-tracked`. For a custom OpenSpec schema, initialize it explicitly and identify its task artifact:

   ```bash
   corgispec init /path/to/project \
     --schema product-delivery \
     --tracking-provider none \
     --task-artifact execution-plan
   ```

4. Read `openspec/.corgi-install-report.md` in the target project and report whether bootstrap succeeded, stopped, or failed. If bootstrap reports a legacy approval gate, ask that exact approval question and rerun only after approval.

## Upgrade from CorgiSpec 2.x

Keep the existing OpenSpec schema, but separate tracker selection from the schema in `openspec/config.yaml`:

```yaml
schema: github-tracked
corgi:
  tracking:
    provider: github       # github | gitlab | none
  taskArtifactId: tasks    # use the schema's executable task artifact id
```

`github-tracked` and `gitlab-tracked` still infer their matching provider for migration, but `corgispec doctor` recommends the explicit setting. An arbitrary custom schema defaults to tracking `none`; if its executable checklist is not the conventional `tasks` artifact, `corgi.taskArtifactId` is required.

Then validate every active change:

```bash
corgispec doctor --path /path/to/project
corgispec ready <change> --path /path/to/project --strict --json
```

Exit code `0` means ready, `1` means the planning contract has blockers, and `2` means an environment or OpenSpec contract error. Resolve blockers before apply or loop.

## Planning updates and OpenSpec Stores

OpenSpec 1.6 JSON is authoritative for `planningHome`, `changeRoot`, artifact DAGs, glob-expanded `artifactPaths`, and `actionContext`. Never reconstruct paths such as `openspec/changes/<name>` or assume `tasks.md`.

```bash
# Read-only reconciliation context
corgispec update <change> --path /path/to/project --json

# Store-backed change (its authoritative root may be outside the repository)
corgispec update <change> --path /path/to/project --store <store-id> --json
corgispec ready <change> --path /path/to/project --store <store-id> --strict --json
```

The `update` CLI does not edit files. Use `/corgi:update <change>` (Claude Code), `/corgi-update <change>` (OpenCode), or `$corgispec-update` (Codex) to reconcile planning artifacts; the skill must show and confirm each artifact-scoped diff. Follow it with the platform's ready skill or `corgispec ready`. `update` returns `1` when an active or recovery-pending loop blocks planning changes and `2` for contract errors.

Evaluate implementation convergence only while planning, Git, and evidence revisions are fresh:

```bash
corgispec converge <change> --path /path/to/project --json
```

The first call is read-only. If it reports an implementation gap, the matching platform skill presents the evidence and a proposed successor Task Group for confirmation. A confirmed operation appends only that new group and can be resumed idempotently with its `confirmationToken`; it never rewrites old groups.

## Optional lifecycle hooks

The hook CLI has two entry points: generate platform configuration with `corgispec hooks generate --platform <claude|opencode|codex>`, and invoke a generated bridge with `corgispec hook <name>`. Codex generation writes TOML plus Node `.cjs` wrappers; it does not require Python. Generated stop handling includes both `stop-check` and `loop-check`.

OpenCode 1.18.x has no awaited stop hook. Its TypeScript plugin observes `session.idle`, preserves hook stdout/stderr, and uses `session.promptAsync` to re-enter an interactive session when canonical work remains. Treat `corgispec ready` and `corgispec loop ...` as the hard gates. For one-shot `opencode run` automation, inspect those CLI results explicitly because process teardown can race the asynchronous re-entry.

## Clean source and package verification

When validating this repository or preparing the RC release, start from a clean checkout and run:

```bash
cd packages/corgispec
npm ci
npm run release:check
npm pack
```

The release check rebuilds bundled assets, builds and typechecks the package, runs the complete test and coverage gates, creates a temporary npm tarball, installs it into a temporary project, and smoke-tests the packaged CLI and asset checksums. The optional final `npm pack` writes `corgispec-3.0.0-rc.2.tgz` for release verification or offline installation; normal consumers install the prerelease from npm with `corgispec@next`.

## Rules

- Do not bypass failed Node, OpenSpec runtime, schema, ready, test, coverage, or package-smoke checks.
- Do not infer change or artifact paths when OpenSpec JSON provides authoritative paths.
- Do not run separate user-level and project-level install steps unless bootstrap explicitly reports a missing component.
- Do not silently overwrite local managed-file changes or approve a legacy migration on the user's behalf.
