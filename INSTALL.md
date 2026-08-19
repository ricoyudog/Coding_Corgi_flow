# CorgiSpec 4.0 — RFC-first Bootstrap

Use this entry point to install or migrate a project to the single CorgiSpec v4 workflow.

## Requirements

- Node.js >=20.19.0
- `corgispec@4.0.0-rc2`
- `@fission-ai/openspec` >=1.6.0 <2.0.0
- `gh` or `glab` only when the configured tracker provider is enabled

```bash
npm install -g @fission-ai/openspec@^1.6.0
npm install -g corgispec@4.0.0-rc2
corgispec doctor --path /path/to/project
```

## Fresh Bootstrap

```bash
corgispec bootstrap --target /path/to/project --mode auto
```

Bootstrap is the sole transactional writer for configuration, managed assets, RFC scaffolding, mandatory Memory/Wiki, and the Session Memory Protocol. There is no Memory/Wiki opt-out.

The generated contract includes:

```yaml
corgi:
  contract: rfc-v1
  rfcRoot: rfcs
  foundation: RFC-0001-project-foundation
  governance:
    integrationBranch: main
```

Read `openspec/.corgi-install-report.md` and report created, preserved, backed-up, and conflicted files. Rerun doctor after bootstrap.

## Explicit v3 Cutover

v4 does not resume active v3 Changes or nonterminal v2 runs. Finish, archive, or withdraw them first, then run:

```bash
corgispec bootstrap --target /path/to/project --migrate-v4 --dry-run
corgispec bootstrap --target /path/to/project --migrate-v4
```

Migration preserves unrelated dirty files and all user knowledge. Existing `wiki/sessions/` and `wiki/log.md` remain byte-for-byte legacy read-only data. Old documents may inform the Foundation RFC, but nothing is auto-accepted.

Review `RFC-0001-project-foundation`, validate it, and let a human accept it interactively. Commit and merge the accepted RFC into the configured integration branch before Propose.

## RFC-first Delivery

```bash
# Human-authored governance
corgispec rfc new data-export
corgispec rfc validate RFC-0002-data-export
corgispec rfc accept RFC-0002-data-export --approver <human-id>

# After the accepted RFC commit is merged
corgispec propose data-export --from RFC-0002-data-export/S-01-data-export --json
# Complete planning + traceability, then finalize the same source command
corgispec propose data-export --from RFC-0002-data-export/S-01-data-export --finalize --json

# Quality chain
/corgi-apply data-export
/corgi-verify data-export
/corgi-review data-export
/corgi-human-qa data-export
/corgi-archive data-export
```

The CLI creates or recovers one Issue per Slice and owns tracker mutations. Skills never invoke provider CLIs directly and Task Groups never become Issues.

Apply uses Run Contract v3, gives each Task Group one checked commit, and stops at `awaiting_verify`. Verify covers the whole Change and all ACs; Human Review records approve/reject/amendment; Human QA verifies real user paths; Archive materializes canonical evidence and performs delivery/knowledge/tracker closeout.

## Managed Updates and Hooks

`bootstrap --mode auto|update` preflights the selected local/global surfaces, preserves user modifications, and backs up conflicts before stopping. Use `--platform <claude|opencode|codex>` and `--scope <local|global|both>` to restrict the managed surface.

Hookless projects remain opt-in. Generate hooks explicitly:

```bash
corgispec hooks generate --platform <claude|opencode|codex>
```

SessionStart/PostCompact emit the fixed startup order `session-bridge → MEMORY → hot`, synthesize live Run Contract state, and report bridge drift.

## Release Verification

```bash
cd packages/corgispec
npm ci
npm run release:check
npm pack
```

The release gate must validate canonical/mirror/bundled skills, all mandatory templates, fresh and migrated package smoke, tests, coverage, typecheck, and the packed asset manifest. The RC tarball is `corgispec-4.0.0-rc2.tgz`.

Never bypass a stopped migration, contract blocker, failed evidence gate, or package check.
