---
name: openspec-install
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

This installer manages only project-local command dispatch files and bundled schemas.

`openspec-*` skills must already be installed at user level before this skill runs.

All writes stay project-local.

Never write into user-home directories or global tool configuration paths.

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
3. Sync only the project-local managed fileset for OpenCode, Claude, and bundled schemas.
4. Record runtime artifacts:
   - `openspec/.opsx-install.json`
   - `openspec/.opsx-install-report.md`
   - `openspec/.opsx-backups/<timestamp>/` when backup is needed
5. Stop instead of overwriting locally modified managed files.

Do not overwrite locally modified managed files — stop with a diff and let the user decide.

## Quick Reference

| Mode | Mutates Files | Expected Output |
|---|---|---|
| Fresh install | Yes | managed files + manifest + report |
| Managed update | Yes | updated managed files + refreshed manifest + report |
| Legacy install | Maybe | backup prompt, then manifest + report if approved |
| Verify-only | Report only | report + checks, no managed-file or config mutations |

Managed fileset:
- `.opencode/commands/opsx-*.md`
- `.claude/commands/opsx/*.md`
- `openspec/schemas/{selected-schema}/**`

Required user-level skills:
- Claude Code: `~/.claude/skills/openspec-*`
- OpenCode: `~/.config/opencode/skill/openspec-*`

Runtime artifacts:
- Manifest: `openspec/.opsx-install.json`
- Report: `openspec/.opsx-install-report.md`
- Backups: `openspec/.opsx-backups/<timestamp>/`

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
- Treat missing user-level `openspec-*` skills as a prerequisite failure.

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

- Claude Code skills under `~/.claude/skills/openspec-*`
- OpenCode skills under `~/.config/opencode/skill/openspec-*`

If any required tool is missing, unauthenticated, or the required user-level skills are absent, stop and report the failure in the report before proceeding. Tell the user to run the repo's global installer script before retrying.

## Mode Steps

### Fresh Install

Use when the target project has no managed fileset and no manifest.

1. **Validate prerequisites**
   - Run `openspec --version` — stop if not found
   - Run `gh auth status` or `glab auth status` depending on intended schema — stop if unauthenticated
   - Verify `~/.claude/skills/openspec-*` and `~/.config/opencode/skill/openspec-*` exist — stop if missing
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

5. **Copy managed fileset from source repo to target**

   Copy each of the following from the source repo (this repo) to the target project:

    - `.opencode/commands/opsx-*.md` → target `.opencode/commands/opsx-*.md`
    - `.claude/commands/opsx/*.md` → target `.claude/commands/opsx/*.md`
    - `openspec/schemas/{selected-schema}/**` → target `openspec/schemas/{selected-schema}/**`

   Create destination directories as needed. Do not delete any unmanaged files in the target.

6. **Patch `openspec/config.yaml`**

   Read the existing `openspec/config.yaml` in the target project. Update only these keys:
   - `schema` — set to the chosen schema
   - `isolation.mode` — set to `worktree` or `none` based on user choice
   - `isolation.root` — set if worktree enabled
   - `isolation.branch_prefix` — set if worktree enabled

   Do NOT replace the whole file. Preserve all other keys (e.g., `context`, `rules`).

7. **Compute SHA-256 hashes for all copied files**

   For each file copied in step 5, compute its SHA-256 hash:
   ```bash
   sha256sum <file>
   ```

8. **Write `openspec/.opsx-install.json` manifest**

   Write the manifest with all copied file paths and their hashes. See [Manifest Format](#manifest-format).

9. **Generate `openspec/.opsx-install-report.md`**

   Write the report with mode, timestamp, source repo, target project, and per-check status. See [Verification Report](#verification-report).

10. **Initialize memory structure (unless opted out)**

    If the user chose to initialize memory in Step 4b (or did not pass `--no-memory`):
    - Invoke the **openspec-memory-init** skill against the target project
    - This creates `memory/` and `wiki/` directories with template files
    - It also injects the Session Memory Protocol into the project's agent config file
    - If memory-init reports files skipped (already exist), include that in the install report
    - If `--no-memory` was specified or user declined: skip this step entirely

---

### Managed Update

Use when the target project already has `openspec/.opsx-install.json`.

1. **Validate prerequisites**
   - Run `openspec --version` — stop if not found
   - Run `gh auth status` or `glab auth status` as appropriate — stop if unauthenticated
   - Verify `~/.claude/skills/openspec-*` and `~/.config/opencode/skill/openspec-*` exist — stop if missing

2. **Read existing `openspec/.opsx-install.json`**
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
   - Write a FAIL status to `openspec/.opsx-install-report.md`
   - Stop. Tell the user which files have local modifications and ask them to resolve the conflict manually before re-running

5. **If all managed files are clean → proceed with update**
   - Copy updated files from source repo to target (same fileset as fresh install step 5)
   - Recompute SHA-256 hashes for all copied files
   - Refresh `openspec/.opsx-install.json` with new hashes and updated `updatedAt` timestamp
   - Write updated `openspec/.opsx-install-report.md`

---

### Legacy Install

Use when managed files exist in the target project but no `openspec/.opsx-install.json` is present.

1. **Detect legacy state**
    - Managed files exist (e.g., `.opencode/commands/opsx-propose.md` is present)
    - `openspec/.opsx-install.json` does NOT exist
    - Classify as legacy install and display this classification to the user

2. **Display legacy classification to user**
   - Announce: "This project has OpenSpec managed files but no installer manifest. This looks like a legacy install."
   - List the managed files found

3. **Create backup**
   - Create a timestamped backup directory: `openspec/.opsx-backups/<timestamp>/`
   - Copy all currently present managed files into the backup directory, preserving relative paths

4. **Ask user for explicit approval before migration**
   - Prompt: "Proceed with legacy migration? This will overwrite managed files with the current source versions. A backup has been created at `openspec/.opsx-backups/<timestamp>/`. (yes/no)"
   - Wait for explicit user response — do NOT auto-proceed

5. **If approved → proceed as fresh install, then write manifest**
   - Follow fresh install steps 2–9 (ask for schema, worktree preference, copy files, patch config, write manifest and report)

6. **If declined → abort, write report only**
   - Write `openspec/.opsx-install-report.md` with mode `legacy-install`, status `aborted`, and a note that the user declined migration
   - Do not modify any files

---

### Verify-only

Use when the user wants a health check without any file mutations.

1. **Check prerequisites**
   - Run `openspec --version` — record PASS or FAIL
   - Run `gh auth status` or `glab auth status` as appropriate — record PASS, FAIL, or SKIP
   - Verify `~/.claude/skills/openspec-*` and `~/.config/opencode/skill/openspec-*` exist — record PASS or FAIL

2. **Check project-local managed fileset presence and integrity**
   - For each file in the managed fileset, check whether it exists in the target project
   - If `openspec/.opsx-install.json` exists: also compare current SHA-256 hashes against manifest hashes
   - Record PASS if all present and matching, FAIL if any missing or mismatched

3. **Check `openspec/config.yaml` has required fields**
   - Verify `schema` field is present and set to a known value
   - Record PASS or FAIL

4. **Check schema directory exists**
   - Verify `openspec/schemas/{schema}/` exists and contains `schema.yaml`
   - Record PASS or FAIL

   5. **Write report with PASS/FAIL per check**
    - Write `openspec/.opsx-install-report.md` with all check results
    - See [Verification Report](#verification-report) for format

    **NO managed-file mutations. NO backups. NO config changes. This mode may write the verification report only.**

---

## Verification Report

The report at `openspec/.opsx-install-report.md` uses this format:

### Header
- Mode: [fresh-install | managed-update | legacy-install | verify-only]
- Timestamp: ISO 8601
- Source repo: path
- Target project: path

### Checks
| Check | Status | Detail |
|---|---|---|
| openspec CLI | PASS/FAIL | version or error |
| gh/glab CLI | PASS/FAIL/SKIP | version or error |
| User-level skills | PASS/FAIL | Claude/OpenCode skill paths checked |
| Schema directory | PASS/FAIL | path checked |
| Config file | PASS/FAIL | fields present |
| Managed files | PASS/FAIL | N/M project-local files synced |

### Summary
- Overall: PASS or FAIL
- Actions taken: [list of mutations, or "none (verify-only)"]

For end-to-end validation scenarios covering fresh install, managed update, local modifications, verify-only, legacy install, and the worktree prompt, see `.sisyphus/plans/opsx-install-smoke-matrix.md`.

---

## Manifest Format

The manifest at `openspec/.opsx-install.json`:

```json
{
  "version": 1,
  "installedAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "sourceRepo": "/path/to/ds-internal-skills",
  "schema": "gitlab-tracked",
  "isolation": { "mode": "none" },
  "files": {
    ".opencode/commands/opsx-propose.md": { "sha256": "abc123..." },
    ".opencode/commands/opsx-install.md": { "sha256": "def456..." },
    ".claude/commands/opsx/propose.md": { "sha256": "ghi789..." },
    "openspec/schemas/gitlab-tracked/schema.yaml": { "sha256": "jkl012..." }
  }
}
```

- `installedAt` — set on first write, never changed on update
- `updatedAt` — refreshed on every managed update
- `files` — keyed by path relative to the target project root; value is the SHA-256 of the file as installed

---

## Common Mistakes

- Overwriting locally modified managed files instead of stopping with a diff
- Writing to global tool config paths instead of the target project
- Auto-enabling worktree isolation without asking
- Replacing the whole `openspec/config.yaml` instead of patching only managed keys
- Running verify-only in a mutating mode
- Skipping the backup step before legacy migration
- Forgetting to check `gh auth status` or `glab auth status` before a write operation
- Forgetting that `openspec-*` skills are user-level prerequisites, not project-local managed files
- Running memory-init when `--no-memory` was specified
- Auto-initializing memory without asking the user first (unless default-yes prompt is used)
