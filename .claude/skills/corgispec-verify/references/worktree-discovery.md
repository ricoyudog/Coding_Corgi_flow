# Worktree Discovery

When `isolation.mode` is `worktree`, changes live inside worktrees — NOT in the main checkout. A new session starting from the main checkout cannot see them via `openspec list`.

## Discovery Procedure

When resolving a change with worktree isolation:

### 1. Try normal resolution first

```bash
openspec list --json
```

If this returns changes, use them directly. (This works when already inside a worktree.)

### 2. If empty — scan worktree directories

Read `isolation.root` from `openspec/config.yaml` (default: `.worktrees`).

```bash
ls <isolation.root>/
```

Each subdirectory name is a potential change name. For each:
- Verify the worktree is registered: check `git worktree list` includes this path
- Verify change exists inside: check `<isolation.root>/<name>/openspec/changes/<name>/` is a directory

### 3. Build discovered change list

For each valid worktree change found:
```
Change: <name>
  Worktree: <isolation.root>/<name>
  Branch: <isolation.branch_prefix><name>
```

### 4. Select change

- If user specified a name: use it, verify it's in the list
- If only one change found: auto-select
- If multiple found: present the list and ask the user

### 5. Switch to worktree

Once selected, ALL subsequent commands run with workdir set to the absolute worktree path:
```
<project-root>/<isolation.root>/<name>
```

## Example

```
# Main checkout: /home/user/myproject
# Config: isolation.root: .worktrees, branch_prefix: feat/

$ ls .worktrees/
add-user-auth    fix-login-bug

# Verify:
$ git worktree list
/home/user/myproject                          abc1234 [main]
/home/user/myproject/.worktrees/add-user-auth def5678 [feat/add-user-auth]
/home/user/myproject/.worktrees/fix-login-bug ghi9012 [feat/fix-login-bug]

# Check changes exist:
$ ls .worktrees/add-user-auth/openspec/changes/
add-user-auth/

# → Valid change: "add-user-auth" at .worktrees/add-user-auth
```

## When This Applies

This discovery is needed by:
- **apply** — to find which change to implement
- **verify** — to find which change to verify
- **review** — to find which change to review
- **archive** — to find which change to archive
- **explore** — to investigate a change's context

Always use this procedure when `isolation.mode: worktree` and starting from the main checkout.
