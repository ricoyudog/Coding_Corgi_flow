import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createSchemaRegistry, type ValidationResult } from "./schemas.js";

/**
 * Skill tiers in hierarchy order.
 */
export type SkillTier = "atom" | "molecule" | "compound";

/**
 * Platform scope for a skill.
 */
export type SkillPlatform = "universal" | "github" | "gitlab";

/**
 * Installation target platforms.
 */
export type InstallTarget = "opencode" | "claude" | "codex";

/**
 * Parsed skill metadata from skill.meta.json.
 */
export interface SkillMeta {
  slug: string;
  tier: SkillTier;
  version: string;
  description: string;
  depends_on: string[];
  platform: SkillPlatform;
  tags?: string[];
  installation: {
    targets: InstallTarget[];
    base_path: string;
  };
}

/**
 * A discovered skill with its directory path and parsed metadata.
 */
export interface DiscoveredSkill {
  slug: string;
  dir: string;
  meta: SkillMeta;
  hasSkillMd: boolean;
}

/**
 * Validation issue for a single skill.
 */
export interface SkillValidationIssue {
  slug: string;
  dir: string;
  issues: string[];
}

/**
 * Discover all skills in a directory.
 * Skills are directories containing skill.meta.json.
 * Supports tiered layout (atoms/, molecules/, compounds/) with flat-root fallback.
 */
export function discoverSkills(skillsDir: string): DiscoveredSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const tierDirs = ["atoms", "molecules", "compounds"];
  const skills: DiscoveredSkill[] = [];

  function loadEntry(dir: string, name: string): void {
    const skillDir = resolve(dir, name);
    const metaPath = resolve(skillDir, "skill.meta.json");

    if (!existsSync(metaPath)) return;

    try {
      const metaContent = readFileSync(metaPath, "utf-8");
      const meta = JSON.parse(metaContent) as SkillMeta;
      const hasSkillMd = existsSync(resolve(skillDir, "SKILL.md"));

      skills.push({ slug: name, dir: skillDir, meta, hasSkillMd });
    } catch (err: unknown) {
      console.error(`[skills] Failed to parse ${metaPath}: ${err instanceof Error ? err.message : String(err)}`);
      skills.push({
        slug: name,
        dir: skillDir,
        meta: {
          slug: name,
          tier: "atom",
          version: "0.0.0",
          description: "(parse error)",
          depends_on: [],
          platform: "universal",
          installation: { targets: [], base_path: "" },
        },
        hasSkillMd: existsSync(resolve(skillDir, "SKILL.md")),
      });
    }
  }

  // Phase 1: scan tier subdirectories
  for (const tier of tierDirs) {
    const tierPath = resolve(skillsDir, tier);
    if (!existsSync(tierPath)) continue;
    try {
      const entries = readdirSync(tierPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) loadEntry(tierPath, entry.name);
      }
    } catch (err: unknown) {
      console.error(`[skills] Cannot read tier directory ${tierPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Phase 2: scan root for flat skills (backward compat)
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (tierDirs.includes(entry.name)) continue;
      loadEntry(skillsDir, entry.name);
    }
  } catch (err: unknown) {
    console.error(`[skills] Cannot read skills directory ${skillsDir}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return skills;
}

/**
 * Discover skills from the default locations in a repo.
 * Searches: .opencode/skills/, .claude/skills/, .codex/skills/
 */
export function discoverSkillsFromRepo(repoRoot: string): DiscoveredSkill[] {
  const searchPaths = [
    resolve(repoRoot, ".opencode/skills"),
    resolve(repoRoot, ".claude/skills"),
    resolve(repoRoot, ".codex/skills"),
  ];

  // Use the first one that has skills (canonical is .opencode/skills)
  for (const searchPath of searchPaths) {
    const skills = discoverSkills(searchPath);
    if (skills.length > 0) {
      return skills;
    }
  }

  return [];
}

/**
 * Validate a single skill against all constraints.
 * Returns a list of issues (empty = valid).
 */
export function validateSkill(
  skill: DiscoveredSkill,
  allSkills: Map<string, SkillTier>,
  schemasDir?: string
): string[] {
  const issues: string[] = [];
  // Discovery deliberately retains malformed metadata so validation can report
  // every problem. Never trust collection fields until the schema has passed:
  // older Corgi releases used an object-shaped `dependencies` field and a
  // validator must diagnose that input instead of crashing on `.length` or
  // iteration.
  const dependencies = Array.isArray(skill.meta.depends_on)
    ? skill.meta.depends_on.filter((dependency): dependency is string =>
        typeof dependency === "string"
      )
    : [];

  // 1. SKILL.md exists
  if (!skill.hasSkillMd) {
    issues.push("Missing SKILL.md");
  }

  // 2. Slug matches directory name
  if (skill.meta.slug !== skill.slug) {
    issues.push(
      `Slug mismatch: directory '${skill.slug}' vs meta '${skill.meta.slug}'`
    );
  }

  // 3. Validate meta against JSON Schema
  try {
    const registry = createSchemaRegistry(schemasDir);
    const result: ValidationResult = registry.validate(
      "skill-meta.schema.json",
      skill.meta
    );
    if (!result.valid && result.errors) {
      for (const err of result.errors) {
        issues.push(`Schema: ${err.instancePath || "/"} ${err.message}`);
      }
    }
  } catch (err) {
    issues.push(
      `Schema validation failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 4. Tier constraints
  if (skill.meta.tier === "atom" && dependencies.length > 0) {
    issues.push("Atom skills must not have dependencies");
  }

  // 5. Dependencies exist
  for (const dep of dependencies) {
    if (!allSkills.has(dep)) {
      issues.push(`Dependency '${dep}' not found`);
    }
  }

  // 6. Tier hierarchy: molecules only depend on atoms, compounds on molecules/atoms
  if (skill.meta.tier === "molecule") {
    for (const dep of dependencies) {
      const depTier = allSkills.get(dep);
      if (depTier && depTier !== "atom") {
        issues.push(
          `Molecule '${skill.slug}' cannot depend on ${depTier}-tier '${dep}' (only atoms allowed)`
        );
      }
    }
  }

  return issues;
}

/**
 * Validate all skills in a directory.
 */
export function validateAllSkills(
  skillsDir: string,
  schemasDir?: string
): SkillValidationIssue[] {
  const skills = discoverSkills(skillsDir);
  const allSkills = new Map<string, SkillTier>(
    skills.map((s) => [s.slug, s.meta.tier])
  );
  const results: SkillValidationIssue[] = [];

  for (const skill of skills) {
    const issues = validateSkill(skill, allSkills, schemasDir);
    if (issues.length > 0) {
      results.push({ slug: skill.slug, dir: skill.dir, issues });
    }
  }

  return results;
}

/**
 * Filter skills by tier and/or platform.
 */
export function filterSkills(
  skills: DiscoveredSkill[],
  options: { tier?: SkillTier; platform?: SkillPlatform }
): DiscoveredSkill[] {
  let filtered = skills;

  if (options.tier) {
    filtered = filtered.filter((s) => s.meta.tier === options.tier);
  }

  if (options.platform) {
    filtered = filtered.filter((s) => s.meta.platform === options.platform);
  }

  return filtered;
}
