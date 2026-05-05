---
name: corgispec-install
description: Use when installing, updating, or verifying this repo's project-local OpenSpec GitFlow assets in a target project.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.0"
---

Install, update, or verify project-local OpenSpec GitFlow assets.

## Overview

Use this skill to set up or maintain the repo-managed OpenSpec workflow files inside a target project.

This installer manages:
- **Project-local** command dispatch files and bundled schemas (per-repo)
- **User-level** command dispatch files (global, so `/corgi-*` commands work in every repo)

`corgispec-*` skills must already be installed at user level before this skill runs.

## When to Use

- Fresh install into a project that already ran `openspec init`
- Managed update when the target project already has an installer manifest
- Legacy install migration when managed files exist but no installer manifest exists
- Verify-only when the user wants a report without mutating files

Do not use this skill to create feature artifacts, review implementation work, or archive a change.

## Core Pattern

1. Inspect the target project and classify state:
   - Fresh install
   - Managed update
   - Legacy install
   - Verify-only
2. Ask for required choices:
   - target project path
   - schema: `gitlab-tracked` or `github-tracked`
   - whether to enable worktree isolation
3. Sync project-local managed fileset for OpenCode, Claude, and bundled schemas.
4. **Sync user-level commands** — copy `corgi-*.md` dispatch files to:
   - OpenCode: `~/.config/opencode/commands/corgi-*.md`
   - Claude Code: `~/.claude/commands/corgi/*.md`
5. Record runtime artifacts:
   - `openspec/.corgi-install.json`
   - `openspec/.corgi-install-report.md`
   - `openspec/.corgi-backups/<timestamp>/` when backup is needed
6. Stop instead of overwriting locally modified managed files (both project-local and user-level).

Do not overwrite locally modified managed files — stop with a diff and let the user decide.

> **Why user-level commands?** Without them, `/corgi-*` commands only exist in repos where you've run the installer. User-level install makes them available in every repo after a single installation.

## Quick Reference

| Mode | Mutates Files | Expected Output |
|---|---|---|
| Fresh install | Yes | managed files + manifest + report |
| Managed update | Yes | updated managed files + refreshed manifest + report |
| Legacy install | Maybe | backup prompt, then manifest + report if approved |
| Verify-only | Report only | report + checks, no managed-file or config mutations |

Managed fileset (project-local):
- `.opencode/commands/corgi-*.md`
- `.claude/commands/corgi/*.md`
- `openspec/schemas/{selected-schema}/**`

Managed fileset (user-level):
- `~/.config/opencode/commands/corgi-*.md`
- `~/.claude/commands/corgi/*.md`

Required user-level skills:
- Claude Code: `~/.claude/skills/corgispec-*`
- OpenCode: `~/.config/opencode/skill/corgispec-*`

Runtime artifacts:
- Manifest: `openspec/.corgi-install.json`
- Report: `openspec/.corgi-install-report.md`
- Backups: `openspec/.corgi-backups/<timestamp>/`

## Implementation

- Target projects must already contain `openspec/config.yaml`.
- Only patch installer-owned fields in `openspec/config.yaml`:
  - `schema`
  - `isolation.mode`
  - `isolation.root`
  - `isolation.branch_prefix`
- Prompt before enabling worktree isolation.
- Treat missing manifest + existing managed files as a legacy install.
- Verify-only must never write files or create backups.
- Managed update must stop if a managed file differs from the last recorded manifest hash.
- Treat missing user-level `corgispec-*` skills as a prerequisite failure.
- **User-level commands are installed unconditionally** — they are not tracked in the project manifest. On update, always refresh user-level commands from source.
- **Project-local commands override user-level commands** — if a project has a custom `.opencode/commands/corgi-propose.md`, it takes precedence over the user-level one. OpenCode and Claude resolve project-local before user-level.

## Prerequisites Check

Before any mode runs, verify the required tools are available:

```bash
openspec --version
```

If the user is working with a github-tracked schema:
```bash
gh auth status
```

If the user is working with a gitlab-tracked schema:
```bash
glab auth status
```

Verify the required user-level skills are already installed:

- Claude Code skills under `~/.claude/skills/corgispec-*`
- OpenCode skills under `~/.config/opencode/skill/corgispec-*`

If any required tool is missing, unauthenticated, or the required user-level skills are absent, stop and report the failure in the report before proceeding. Tell the user to run the repo's global installer script before retrying.

## Mode Steps

### Fresh Install

Use when the target project has no managed fileset and no manifest.

1. **Validate prerequisites**
   - Run `openspec --version` — stop if not found
   - Run `gh auth status` or `glab auth status` depending on intended schema — stop if unauthenticated
   - Verify `~/.claude/skills/corgispec-*` and `~/.config/opencode/skill/corgispec-*` exist — stop if missing
   - Confirm `openspec/config.yaml` exists in the target project — stop if missing

2. **Ask for target project path**
   - Prompt: "What is the path to the target project?"
   - Resolve to an absolute path
   - Verify the directory exists and contains `openspec/config.yaml`

3. **Ask for schema choice**
   - Prompt: "Which schema? `gitlab-tracked` or `github-tracked`"
   - Record the choice — it determines which schema directory to copy and which CLI to verify

4. **Ask whether to enable worktree isolation**
   - Prompt: "Enable worktree isolation? (yes/no — default: no)"
   - If yes: ask for `isolation.root` (default: `.worktrees`) and `isolation.branch_prefix` (default: `feat/`)
   - Do NOT auto-enable worktree isolation without asking

4b. **Ask whether to initialize memory structure**
   - Prompt: "Initialize memory structure for cross-session continuity? (yes/no — default: yes)"
   - If user passes `--no-memory` flag: skip this prompt and do not initialize memory
   - Record the choice for Step 10

5. **Copy project-local managed fileset from source repo to target**

   Copy each of the following from the source repo (this repo) to the target project:

    - `.opencode/commands/corgi-*.md` → target `.opencode/commands/corgi-*.md`
    - `.claude/commands/corgi/*.md` → target `.claude/commands/corgi/*.md`
    - `openspec/schemas/{selected-schema}/**` → target `openspec/schemas/{selected-schema}/**`

   Create destination directories as needed. Do not delete any unmanaged files in the target.

5b. **Install user-level commands (global, all repos)**

    Copy the same `corgi-*.md` command dispatch files to user-level directories so they are available in every repo:

    - `.opencode/commands/corgi-*.md` → `~/.config/opencode/commands/corgi-*.md`
    - `.claude/commands/corgi/*.md` → `~/.claude/commands/corgi/*.md`

    Create destination directories as needed.

    > **Why both project-local and user-level?** Project-local files let individual repos override commands. User-level files provide the default so every repo has `/corgi-*` even without running the installer.

6. **Patch `openspec/config.yaml`**

   Read the existing `openspec/config.yaml` in the target project. Update only these keys:
   - `schema` — set to the chosen schema
   - `isolation.mode` — set to `worktree` or `none` based on user choice
   - `isolation.root` — set if worktree enabled
   - `isolation.branch_prefix` — set if worktree enabled

   Do NOT replace the whole file. Preserve all other keys (e.g., `context`, `rules`).

7. **Compute SHA-256 hashes for project-local files**

   For each file copied in step 5 (project-local only), compute its SHA-256 hash:
   ```bash
   sha256sum <file>
   ```
   
   User-level commands are not hashed in the manifest — they are refreshed on every update.

8. **Write `openspec/.corgi-install.json` manifest**

   Write the manifest with all copied file paths and their hashes. See [Manifest Format](#manifest-format).

9. **Generate `openspec/.corgi-install-report.md`**

   Write the report with mode, timestamp, source repo, target project, and per-check status. See [Verification Report](#verification-report).

10. **Initialize memory structure (unless opted out)**

    If the user chose to initialize memory in Step 4b (or did not pass `--no-memory`):
    - Invoke the **corgispec-memory-init** skill against the target project
    - This creates `memory/` and `wiki/` directories with template files
    - It also injects the Session Memory Protocol into the project's agent config file
    - If memory-init reports files skipped (already exist), include that in the install report
    - If `--no-memory` was specified or user declined: skip this step entirely

---

### Managed Update

Use when the target project already has `openspec/.corgi-install.json`.

1. **Validate prerequisites**
   - Run `openspec --version` — stop if not found
   - Run `gh auth status` or `glab auth status` as appropriate — stop if unauthenticated
   - Verify `~/.claude/skills/corgispec-*` and `~/.config/opencode/skill/corgispec-*` exist — stop if missing

2. **Read existing `openspec/.corgi-install.json`**
   - Parse the manifest to get the list of managed files and their recorded SHA-256 hashes
   - Note the schema and isolation settings from the manifest

3. **For each managed file: compare current hash vs manifest hash**
   - Compute the current SHA-256 of each managed file in the target project
   - Compare against the hash stored in the manifest

4. **If ANY managed file differs from its manifest hash → abort**
   - Print a diff of the changed file(s):
     ```bash
     diff <source-file> <target-file>
     ```
   - Do not overwrite locally modified managed files
   - Write a FAIL status to `openspec/.corgi-install-report.md`
   - Stop. Tell the user which files have local modifications and ask them to resolve the conflict manually before re-running

5. **If all managed files are clean → proceed with update**
   - Copy updated project-local files from source repo to target (same fileset as fresh install step 5)
   - **Copy updated user-level commands** (same fileset as fresh install step 5b) — always refresh unconditionally
   - Recompute SHA-256 hashes for all project-local files
   - Refresh `openspec/.corgi-install.json` with new hashes and updated `updatedAt` timestamp
   - Write updated `openspec/.corgi-install-report.md`

---

### Legacy Install

Use when managed files exist in the target project but no `openspec/.corgi-install.json` is present.

1. **Detect legacy state**
    - Managed files exist (e.g., `.opencode/commands/corgi-propose.md` is present)
    - `openspec/.corgi-install.json` does NOT exist
    - Classify as legacy install and display this classification to the user

2. **Display legacy classification to user**
   - Announce: "This project has OpenSpec managed files but no installer manifest. This looks like a legacy install."
   - List the managed files found

3. **Create backup**
   - Create a timestamped backup directory: `openspec/.corgi-backups/<timestamp>/`
   - Copy all currently present managed files into the backup directory, preserving relative paths

4. **Ask user for explicit approval before migration**
   - Prompt: "Proceed with legacy migration? This will overwrite managed files with the current source versions. A backup has been created at `openspec/.corgi-backups/<timestamp>/`. (yes/no)"
   - Wait for explicit user response — do NOT auto-proceed

5. **If approved → proceed as fresh install, then write manifest**
   - Follow fresh install steps 2–9 (ask for schema, worktree preference, copy files, patch config, write manifest and report)

6. **If declined → abort, write report only**
   - Write `openspec/.corgi-install-report.md` with mode `legacy-install`, status `aborted`, and a note that the user declined migration
   - Do not modify any files

---

### Verify-only

Use when the user wants a health check without any file mutations.

1. **Check prerequisites**
   - Run `openspec --version` — record PASS or FAIL
   - Run `gh auth status` or `glab auth status` as appropriate — record PASS, FAIL, or SKIP
   - Verify `~/.claude/skills/corgispec-*` and `~/.config/opencode/skill/corgispec-*` exist — record PASS or FAIL

2. **Check project-local managed fileset presence and integrity**
   - For each file in the managed fileset, check whether it exists in the target project
   - If `openspec/.corgi-install.json` exists: also compare current SHA-256 hashes against manifest hashes
   - Record PASS if all present and matching, FAIL if any missing or mismatched

2b. **Check user-level commands presence**
    - Check whether `~/.config/opencode/commands/corgi-*.md` and `~/.claude/commands/corgi/*.md` exist
    - Record PASS if all present, FAIL if any missing (WARN if user-level commands are missing but project-local ones exist — project-local will still work, but other repos won't have them)

3. **Check `openspec/config.yaml` has required fields**
   - Verify `schema` field is present and set to a known value
   - Record PASS or FAIL

4. **Check schema directory exists**
   - Verify `openspec/schemas/{schema}/` exists and contains `schema.yaml`
   - Record PASS or FAIL

   5. **Write report with PASS/FAIL per check**
    - Write `openspec/.corgi-install-report.md` with all check results
    - See [Verification Report](#verification-report) for format

    **NO managed-file mutations. NO backups. NO config changes. This mode may write the verification report only.**

---

## Verification Report

The report at `openspec/.corgi-install-report.md` uses this format:

### Header
- Mode: [fresh-install | managed-update | legacy-install | verify-only]
- Timestamp: ISO 8601
- Source repo: path
- Target project: path

### Checks
| Check | Status | Detail |
|---|---|---|---|
| openspec CLI | PASS/FAIL | version or error |
| gh/glab CLI | PASS/FAIL/SKIP | version or error |
| User-level skills | PASS/FAIL | Claude/OpenCode skill paths checked |
| User-level commands | PASS/FAIL/WARN | OpenCode/Claude command paths checked |
| Schema directory | PASS/FAIL | path checked |
| Config file | PASS/FAIL | fields present |
| Managed files | PASS/FAIL | N/M project-local files synced |

### Summary
- Overall: PASS or FAIL
- Actions taken: [list of mutations, or "none (verify-only)"]

For end-to-end validation scenarios covering fresh install, managed update, local modifications, verify-only, legacy install, and the worktree prompt, see `.sisyphus/plans/corgi-install-smoke-matrix.md`.

---

## Manifest Format

The manifest at `openspec/.corgi-install.json`:

```json
{
  "version": 1,
  "installedAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "sourceRepo": "/path/to/ds-internal-skills",
  "schema": "gitlab-tracked",
  "isolation": { "mode": "none" },
  "files": {
    ".opencode/commands/corgi-propose.md": { "sha256": "abc123..." },
    ".opencode/commands/corgi-install.md": { "sha256": "def456..." },
    ".claude/commands/corgi/propose.md": { "sha256": "ghi789..." },
    "openspec/schemas/gitlab-tracked/schema.yaml": { "sha256": "jkl012..." }
  }
}
```

- `installedAt` — set on first write, never changed on update
- `updatedAt` — refreshed on every managed update
- `files` — keyed by path relative to the target project root; value is the SHA-256 of the file as installed
- **User-level commands are NOT tracked in the manifest** — they are refreshed unconditionally on every install/update

---

## Common Mistakes

- Overwriting locally modified managed files instead of stopping with a diff
- Writing schemas or config to user-home directories (those stay project-local)
- Auto-enabling worktree isolation without asking
- Replacing the whole `openspec/config.yaml` instead of patching only managed keys
- Running verify-only in a mutating mode
- Skipping the backup step before legacy migration
- Forgetting to check `gh auth status` or `glab auth status` before a write operation
- Forgetting that `corgispec-*` skills are user-level prerequisites, not project-local managed files
- Running memory-init when `--no-memory` was specified
- Auto-initializing memory without asking the user first (unless default-yes prompt is used)
- Installing user-level commands but **not** installing project-local ones (project-local overrides won't work)
- Forgetting to refresh user-level commands on update — user-level commands are NOT hash-tracked, always refresh them
