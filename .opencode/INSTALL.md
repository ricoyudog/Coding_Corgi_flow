Use this file only as a dispatcher for project bootstrap.

1. If the target project path is missing, ask for it first.
2. Run `corgispec bootstrap --target /path/to/project --mode auto`.
3. If the user already provided a schema, include `--schema <schema>`.
4. If the user wants specific platforms, include `--platform <platforms>` (comma-separated: claude, opencode, codex). Default: all platforms.
5. If the user wants a specific scope, include `--scope <scope>` (global, local, both). Default: global.
6. Do not reconstruct the install workflow from README files.
7. Do not run separate user-level and project-level install steps unless bootstrap explicitly fails and tells you what is missing.
8. Read `openspec/.opsx-install-report.md` and summarize whether bootstrap succeeded, stopped, or failed.
9. If bootstrap reports a legacy approval gate, ask that exact approval question and rerun after the user answers.

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
| `global` | System-level install only (default) |
| `local` | Project-level install only |
| `both` | Both global and local |

**Default:** `global`

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
