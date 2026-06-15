
## Bootstrap Platform+Scope Integration Tests

### Scope semantics (from bootstrap.ts lines 168-174)
- `scope="global"`: Only installs user skills, skips project-local sync (`syncManagedProjectFiles`)
- `scope="local"`: Only syncs project files, skips user skill install (`installUserSkills`)
- `scope="both"` or undefined: Does both user skills + project sync

### Platform filtering (from bootstrap.ts line 329-339)
- `installUserSkills` filters target platforms: if `platforms` provided, only those are installed
- `syncManagedProjectFiles` syncs to all platforms in the asset set regardless of platform filter

### Test patterns
- Library test: `runBootstrap({...})` with `platforms` and `scope` options
- CLI test: `execSync` with `--platform` (comma-separated) and `--scope` flags
- File existence assertions: `existsSync(resolve(targetDir, ".opencode/commands/corgi-propose.md"))` for project-local, `existsSync(resolve(userSkillRoot, "claude/corgispec-install"))` for user-level

### Worktree isolation note
- When `openspec/config.yaml` has `isolation.mode: worktree`, the write/edit tools are blocked
- Workaround: use bash heredoc + tee to append to files
