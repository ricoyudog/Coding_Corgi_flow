Use this file only as a dispatcher for project bootstrap.

1. If the target project path is missing, ask for it first.
2. Require Node.js >=20.19.0 and OpenSpec CLI >=1.6.0 <2.0.0. OpenSpec 1.3–1.5 are not a supported fallback.
3. Install the prerelease with `npm install -g corgispec@next`; `next` currently resolves to `3.0.0-rc.4`. Use `npm install -g corgispec@3.0.0-rc.4` for an exact pin. The unqualified package and `latest` remain on stable `2.4.3`.
4. Install or upgrade OpenSpec separately with `npm install -g @fission-ai/openspec@^1.6.0`, then run `corgispec doctor --path /path/to/project` before bootstrap writes managed files.
5. Run `corgispec bootstrap --target /path/to/project --mode auto`.
6. If the user already provided a schema, include `--schema <schema>`.
7. If the user wants specific platforms, include `--platform <platforms>` (comma-separated: claude, opencode, codex). Default: all platforms.
8. If the user wants a specific scope, include `--scope <scope>` (global, local, both). Default: both.
9. Do not reconstruct the install workflow from README files.
10. Do not run separate user-level and project-level install steps unless bootstrap explicitly fails and tells you what is missing.
11. Read `openspec/.corgi-install-report.md` and summarize whether bootstrap succeeded, stopped, or failed.
12. If bootstrap stops on a modified, malformed, or ambiguously owned asset, report its backup path and require manual resolution; do not force the update.
13. Rerun `corgispec doctor --path /path/to/project` after bootstrap and report Claude Code, OpenCode, and Codex results independently.
14. If a hookless project requests lifecycle hooks, generate the OpenCode TypeScript plugin with `corgispec hooks generate --platform opencode --output /path/to/project/.opencode/plugins/corgispec.ts`; use `--force` only after preserving or approving an existing file. Bootstrap migrates existing Corgi hooks but does not opt in a hookless project.
15. OpenCode 1.18.x has no awaited stop hook. The generated plugin observes `session.idle`, preserves hook stdout/stderr, and uses `session.promptAsync` to re-enter an interactive session when `stop-check` or `loop-check` says work remains. Canonical `corgispec ready` and `corgispec loop ...` state are the hard gates. A one-shot `opencode run` can tear down before asynchronous re-entry, so inspect those CLI results explicitly.

---

## Bootstrap Options

The `corgispec bootstrap` command accepts optional flags to control which platforms and scopes get installed.

### `--platform <platforms>`

Comma-separated list of target platforms. Valid values: `claude`, `opencode`, `codex`.

**Default:** all platforms (claude, opencode, codex)

When this flag is provided, only the specified platforms are bootstrapped. Platforms not listed are skipped entirely.

### `--scope <scope>`

Controls where assets are installed.

| Value | Effect |
|-------|--------|
| `global` | System-level install only |
| `local` | Project-level install only |
| `both` | Both global and local (default) |

**Default:** `both`

### Managed update and repair behavior

In `--mode auto` or `--mode update`, bootstrap preflights the complete Corgi-managed surface selected by `--scope` and `--platform` before it writes:

- `local` covers project commands, schema, config, manifest, and existing hooks.
- `global` covers user-level skills for the selected platforms plus Claude Code and OpenCode user commands.
- `both` preflights and updates the local and global surfaces together.

Bootstrap automatically restores missing managed files and updates recognized outdated or legacy Corgi assets. A supplied `--platform` restricts detection, repair, and hook migration to exactly those platforms. Files with local modifications, malformed structured configuration, or ambiguous ownership are backed up and stop the operation instead of being overwritten. Project backups use `openspec/.corgi-backups/<timestamp>/project/`; user-level backups use `~/.corgispec/backups/<timestamp>/<platform>/`.

Existing hooks are migrated safely, but a hookless project remains opt-in. Claude Code migration preserves permissions, custom settings, and non-Corgi hooks; OpenCode consolidates recognized legacy Corgi plugins while preserving unrelated plugins; Codex migrates legacy hook JSON to TOML plus Node `.cjs` wrappers while preserving MCP, approval, feature, and non-Corgi hook settings. `corgispec doctor` verifies all three platforms independently after the update.

### Interactive Prompts

When `--platform` or `--scope` is not specified and a TTY is available, the bootstrap command prompts interactively:

- Platform selection: choose which platforms to install
- Scope selection: choose global, local, or both

Prompts are skipped when:
- Running in JSON mode (`--json`)
- Running with auto-approve (`--yes`)
- No TTY is available (piped input, CI)

### Examples

```bash
# Install for specific platforms only
node packages/corgispec/dist/bin.js bootstrap --target /path/to/project --platform claude,opencode

# Install to local (project) scope only
node packages/corgispec/dist/bin.js bootstrap --target /path/to/project --scope local

# Combined: specific platforms, local scope
node packages/corgispec/dist/bin.js bootstrap --target /path/to/project --platform opencode --scope local

# All platforms, both scopes, no prompts
node packages/corgispec/dist/bin.js bootstrap --target /path/to/project --platform claude,opencode,codex --scope both --yes
```
