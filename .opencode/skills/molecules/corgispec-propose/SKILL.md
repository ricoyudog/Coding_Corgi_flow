---
name: corgispec-propose
description: Create or complete a CorgiSpec planning package and optionally synchronize GitLab issues. Use when proposing a new change or finishing an existing change whose normalized tracking provider is GitLab or none.
hooks:
  PreToolUse:
    - matcher: "Edit|Write"
      hooks:
        - type: command
          command: "corgispec hook pre-write"
---

# Propose a change

Create every artifact required for implementation through the OpenSpec-backed CLI. Never infer a planning path or artifact role from a conventional filename.

## Preconditions

**Context Gate**: If session context already contains ALL of: `isolation.mode`, active changes with worktree paths, current branch, reuse it; otherwise read configuration and discover worktrees.

1. Resolve a kebab-case change name and the user's intent.
2. Read only isolation settings from project configuration. If worktree isolation is enabled, create or reuse the configured worktree before creating the change, then run every command from that worktree.
3. Run:

   ```bash
   corgispec propose "<change>" --json
   corgispec status "<change>" --json
   ```

4. Require status JSON to expose `changeRoot`, `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. If a field is absent, stop and request a CorgiSpec CLI upgrade.
5. Accept `trackingProvider: "gitlab"` or `"none"`. Route `"github"` to `corgispec-gh-propose`; never derive the provider from `schemaName`.
6. Treat `changeRoot` as authoritative even when it is outside the current working directory. Never prepend the repository path.

## Create the artifact graph

Before writing the first artifact, create and maintain a visible planning checklist with the host's available planning or TODO mechanism when one is available and permitted. Do not hard-code a platform-specific tool name.

Read [references/artifact-creation.md](references/artifact-creation.md), then repeat:

1. Read `status.artifacts` and the implementation prerequisites reported by the CLI.
2. For each ready artifact, run:

   ```bash
   corgispec instructions "<artifact-id>" --change "<change>" --json
   ```

3. Require the instructions response to retain the same `changeRoot` and expose its authorized `artifactPaths` and `contextFiles`.
4. Read only returned dependency paths and context files. Use `template`, `instruction`, `context`, and `rules` as guidance; never copy constraint blocks into output.
5. Write only the concrete target authorized by the instructions response. Do not expand a path pattern or invent an artifact filename.
6. Re-run status after every artifact. Stop when every CLI-reported implementation prerequisite is complete.

## Close out

- When `trackingProvider` is `gitlab`, read [references/gitlab-issues.md](references/gitlab-issues.md). Locate tracker state relative to `changeRoot`, use `taskArtifactId` for Task Groups, and use returned planning paths for issue context.
- When `trackingProvider` is `none`, skip all tracker commands and tracker-state writes.
- If isolation is active, write `.worktree.yaml` directly under the authoritative `changeRoot` and verify the worktree with `git worktree list`.
- Run `corgispec ready "<change>" --strict --json`. Do not claim handoff readiness unless it returns ready.
- Report the change name, `changeRoot`, created artifact IDs and concrete paths, readiness, tracking result, worktree result, and the matching platform command the user may invoke later for apply or loop. For Codex, explicitly report `$corgispec-apply-change <change>` or `$corgispec-loop <change>`.

## Terminal handoff boundary

- Do not hardcode the planning home, change directory, artifact names, or artifact layout.
- Do not create duplicate tracker issues when tracker state already exists under `changeRoot`.
- Do not write outside `changeRoot` except for the configured worktree and remote issue operations.
- Throughout propose, keep `HEAD` unchanged. Do not install packages, create commits, push branches, open implementation pull requests, or publish at any point. Worktree setup must not commit housekeeping changes.
- Propose is a planning-only workflow and is terminal for the current turn.
- A strict `ready` result confirms planning integrity; it is not user approval to implement.
- An original request phrased as "fix", "implement", or "build" supplies planning intent only and does not authorize implementation after propose.
- After reporting, end the current turn. Do not invoke apply, loop, implementation, review, archive, commit, push, or publish actions.
- Implementation may begin only after a later explicit user request for the matching apply or loop workflow.
