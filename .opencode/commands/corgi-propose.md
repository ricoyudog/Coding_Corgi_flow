---
description: Create a complete CorgiSpec planning package and optional tracker handoff
---

**Input**: Accept a change name or a description from which to derive one.

1. **Context Gate**: If session context already contains `isolation.mode`, active changes with worktree paths, and the current branch, reuse it. Otherwise read isolation configuration. Create or reuse the required worktree before change creation and run subsequent commands there.
2. Run `corgispec propose "<change>" --json`, then `corgispec status "<change>" --json`.
3. Require `changeRoot`, `artifactPaths`, `contextFiles`, `taskArtifactId`, `trackingProvider`, and `trackingProviderSource`. If absent, stop and request a CLI upgrade.
4. Route only by normalized `trackingProvider`:
   - `github`: follow **corgispec-gh-propose**.
   - `gitlab` or `none`: follow **corgispec-propose**; skip tracker closeout for none.
5. Pass the CLI JSON and user intent through unchanged. Never route by `schemaName` or reconstruct a planning path.
6. Verify strict readiness, authoritative `changeRoot`, artifact completion, tracker result, and worktree before reporting completion.

## Terminal handoff boundary

- Throughout propose, keep `HEAD` unchanged. Do not install packages, create commits, push branches, open implementation pull requests, or publish at any point. Worktree setup must not commit housekeeping changes.
- Propose is a planning-only workflow and is terminal for the current turn.
- A strict `ready` result confirms planning integrity; it is not user approval to implement.
- An original request phrased as "fix", "implement", or "build" supplies planning intent only and does not authorize implementation after propose.
- After reporting, end the current turn. Do not invoke apply, implementation, review, archive, commit, push, or publish actions.
- Implementation may begin only after a later explicit user request for `/corgi-apply <change>`.
