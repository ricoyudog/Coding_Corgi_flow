---
type: wiki
created: 2026-05-06
source_change: fix-skill-architecture-issues
tags: [pattern, discovery, backward-compat, loader]
---

# Tiered Discovery with Flat Fallback

## Context
When restructuring a flat directory of plugins/skills/modules into a tier-based hierarchy, existing consumers expect the flat layout. A two-phase discovery pattern maintains backward compatibility during and after the transition.

## Pattern
1. **Phase 1 (tiered)**: Scan for well-known subdirectories (`atoms/`, `molecules/`, `compounds/`). If found, discover all items within them.
2. **Phase 2 (flat fallback)**: If no tier subdirectories exist, fall back to scanning the root directory directly.
3. **Never mix**: If tier dirs are found, skip flat-root scanning to avoid duplicates.

This allows:
- New installations to use tiered layout immediately
- Legacy installations to continue working until migrated
- A single loader to handle both states without configuration

## When to Use
- Migrating flat plugin/skill directories to hierarchical layout
- Supporting multiple layout versions without version flags
- Any scenario where filesystem structure carries semantic meaning but must evolve

## Example
```javascript
async function discoverSkills(skillsRoot) {
  const tierDirs = ['atoms', 'molecules', 'compounds'];
  let found = [];
  
  for (const tier of tierDirs) {
    const tierPath = path.join(skillsRoot, tier);
    if (await exists(tierPath)) {
      const entries = await readdir(tierPath);
      found.push(...entries.map(e => path.join(tierPath, e)));
    }
  }
  
  // Flat fallback only if no tier dirs found
  if (found.length === 0) {
    const entries = await readdir(skillsRoot);
    found = entries.filter(isSkillDir);
  }
  
  return found;
}
```

## Source
- Extracted from change: [[openspec/changes/fix-skill-architecture-issues/proposal]]
- Implementation: `tools/ds-skills/lib/loader.js`, `packages/corgispec/src/lib/skills.ts`
