---
type: wiki
updated: 2026-05-12
status: accepted
---

# Decision: Bootstrap-Install Consolidation

## Context

Multiple installation paths existed for onboarding new projects: manual `install-skills.sh`, explicit `/corgi-install` with mode flags, and ad-hoc copy instructions. Users had to choose between paths and understand the differences, creating friction.

## Decision

Collapse installation onboarding onto a single entry point: `corgispec bootstrap` plus a fetchable `.opencode/INSTALL.md`. README quick starts are reduced to the bootstrap-first path. The legacy manual install flow is preserved but demoted to reference documentation.

## Rationale

- Single entry point eliminates decision fatigue for new users
- Agent-friendly: paste one URL prompt and the agent handles everything
- `INSTALL.md` is fetchable from any branch/tag, making it version-aware
- Bootstrap reports (`openspec/.corgi-install-report.md`) provide verification without manual checking
- Legacy path preserved for users who need explicit control

## Alternatives Considered

- **Keep multiple paths as equal options**: Familiar but confusing; users don't know which to choose; rejected for simplicity
- **Remove legacy install entirely**: Cleaner but breaks existing documentation and power-user workflows; rejected for backward compatibility

## References

- `wiki/hot.md` Recently Shipped section — bootstrap-install entry
