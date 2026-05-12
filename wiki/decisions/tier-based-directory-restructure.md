---
type: wiki
updated: 2026-05-12
status: accepted
---

# Decision: Tier-Based Directory Restructure

## Context

Skills were stored in flat directories under each platform dir (`.opencode/skills/`, `.claude/skills/`, etc.). As the skill count grew to 17, the flat layout made it hard to understand dependency relationships and enforce tier constraints (atoms can't depend on molecules).

## Decision

Restructure all skill directories into tier-based subdirectories (`atoms/`, `molecules/`) across all 5 platform directory trees simultaneously. Use a two-phase discovery pattern: scan tier subdirs first, then fall back to flat-root scanning for backward compatibility.

## Rationale

- Tier structure makes dependency constraints visible in the filesystem
- Simultaneous restructure across all dirs prevents sync obligation violations during transition
- Two-phase discovery ensures existing flat-layout user installations continue working
- `installSkillsTo()` discovers from tiered source but installs flat to target (agent platforms expect flat user-level layout)

## Alternatives Considered

- **Flat directories with metadata-only tiers**: Simpler but tier violations invisible in filesystem; rejected because the directory structure should encode the constraint
- **Gradual migration (one dir at a time)**: Lower risk per step but creates temporary sync violations between platform dirs; rejected for consistency

## References

- [[sessions/fix-skill-architecture-issues|Session: fix-skill-architecture-issues]]
- [[patterns/tiered-discovery-with-flat-fallback|Pattern: Tiered Discovery with Flat Fallback]]
