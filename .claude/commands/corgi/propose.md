---
name: "Corgi: Propose"
description: Build one RFC-first planning package from an accepted Slice or closed maintenance exemption
category: Workflow
tags: [workflow, propose, rfc]
---

**Input**: Require a change name plus exactly one source:

- Feature: `--from RFC-0001-slug/S-01-slug`
- Maintenance: `--maintenance --description "<bounded work>"` and contract references when required

1. Create or reuse the configured delivery worktree before change creation.
2. Run `corgispec propose "<change>" <source flags> --json`. Do not call `gh` or `glab`; the CLI creates or recovers the one Issue, writes `corgi/source.yaml` and initial `corgi/traceability.yaml`, and binds the delivery.
3. Follow **corgispec-propose** with the CLI JSON. Refuse free-form Feature prose without an accepted, merged, unbound RFC Slice.
4. Complete only CLI-authorized planning artifacts and traceability anchors. Use `corgispec ready "<change>" --strict --json` as a diagnostic.
5. Re-run the exact same source command with `--finalize --json`. Only CLI finalize may enforce strict ready, write the managed dashboard, and move the Issue to todo.
6. Report RFC/Slice or exemption, Change, worktree, single Issue/provider-none binding, planning revision, AC coverage, and finalized todo handoff.

## Terminal handoff boundary

- Throughout propose, keep `HEAD` unchanged. Do not install packages, create commits, push branches, open implementation pull requests, or publish at any point. Worktree setup must not commit housekeeping changes.
- Propose is a planning-only workflow and is terminal for the current turn.
- A strict `ready` result confirms planning integrity; it is not user approval to implement.
- An original request phrased as "fix", "implement", or "build" supplies planning intent only and does not authorize implementation after propose.
- After reporting, end the current turn. Do not invoke apply, implementation, review, archive, commit, push, or publish actions.
- Implementation may begin only after a later explicit user request for `/corgi:apply <change>`.
