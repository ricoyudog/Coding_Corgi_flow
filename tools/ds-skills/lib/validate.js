import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import Ajv from "ajv/dist/2020.js";
import { discoverSkills } from "./loader.js";

export async function validateSkill(skill, schemaPath) {
  const errors = [];

  if (skill.error === "missing-meta") {
    errors.push(`${path.basename(skill.dir)}: missing skill.meta.json`);
    return errors;
  }
  if (skill.error === "missing-skill-md") {
    errors.push(`${path.basename(skill.dir)}: missing SKILL.md`);
    return errors;
  }
  if (skill.error === "invalid-meta-json") {
    errors.push(`${path.basename(skill.dir)}: invalid JSON in skill.meta.json`);
    return errors;
  }

  const schemaContent = await fs.readFile(schemaPath, "utf-8");
  const schema = JSON.parse(schemaContent);
  const ajv = new Ajv({ allErrors: true });
  const validate = ajv.compile(schema);
  const valid = validate(skill.meta);

  if (!valid) {
    for (const err of validate.errors) {
      errors.push(`${skill.meta.slug}: schema error at ${err.instancePath || "/"}: ${err.message}`);
    }
  }

  if (skill.frontmatter && skill.meta) {
    if (skill.frontmatter.name !== skill.meta.slug) {
      errors.push(
        `Slug mismatch in '${path.basename(skill.dir)}': ` +
          `skill.meta.json slug='${skill.meta.slug}' != SKILL.md name='${skill.frontmatter.name}'`
      );
    }
  }

  return errors;
}

export function validateConstraints(skills) {
  const errors = [];
  const bySlug = new Map();
  for (const s of skills) {
    bySlug.set(s.meta.slug, s);
  }

  for (const skill of skills) {
    const { slug, tier, depends_on = [], platform } = skill.meta;

    if (tier === "atom" && depends_on.length > 0) {
      errors.push(`ERROR: Atom '${slug}' must not have dependencies (has: ${depends_on.join(", ")})`);
    }

    for (const dep of depends_on) {
      const depSkill = bySlug.get(dep);
      if (!depSkill) {
        errors.push(`ERROR: '${slug}' depends on unknown skill '${dep}'`);
        continue;
      }

      if (tier === "molecule" && depSkill.meta.tier !== "atom") {
        errors.push(`ERROR: Molecule '${slug}' depends on non-atom '${dep}' (tier: ${depSkill.meta.tier})`);
      }
      if (tier === "compound" && depSkill.meta.tier !== "molecule") {
        errors.push(`ERROR: Compound '${slug}' depends on non-molecule '${dep}' (tier: ${depSkill.meta.tier})`);
      }

      if (platform === "gitlab" && depSkill.meta.platform === "github") {
        errors.push(`ERROR: '${slug}' (gitlab) depends on '${dep}' (github)`);
      }
      if (platform === "github" && depSkill.meta.platform === "gitlab") {
        errors.push(`ERROR: '${slug}' (github) depends on '${dep}' (gitlab)`);
      }
    }
  }

  const cycleErrors = detectCycles(skills);
  errors.push(...cycleErrors);

  return errors;
}

function detectCycles(skills) {
  const errors = [];
  const inDegree = new Map();
  const adj = new Map();

  for (const s of skills) {
    const slug = s.meta.slug;
    if (!inDegree.has(slug)) inDegree.set(slug, 0);
    if (!adj.has(slug)) adj.set(slug, []);
  }

  for (const s of skills) {
    const dependsOn = s.meta.depends_on || [];
    for (const dep of dependsOn) {
      if (!adj.has(dep)) continue;
      adj.get(dep).push(s.meta.slug);
      inDegree.set(s.meta.slug, (inDegree.get(s.meta.slug) || 0) + 1);
    }
  }

  const queue = [];
  for (const [slug, degree] of inDegree) {
    if (degree === 0) queue.push(slug);
  }

  let visited = 0;
  while (queue.length > 0) {
    const slug = queue.shift();
    visited++;
    for (const neighbor of adj.get(slug) || []) {
      const newDegree = inDegree.get(neighbor) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (visited < skills.length) {
    const cycled = skills
      .filter((s) => inDegree.get(s.meta.slug) > 0)
      .map((s) => s.meta.slug);
    errors.push(`ERROR: Circular dependency detected involving: ${cycled.join(", ")}`);
  }

  return errors;
}

export async function runValidate(rootPath) {
  const resolvedPath = path.resolve(rootPath);

  let skillsRoot = resolvedPath;
  const opencodePath = path.join(resolvedPath, ".opencode", "skills");
  try {
    await fs.access(opencodePath);
    skillsRoot = opencodePath;
  } catch {
    // Use rootPath as-is
  }

  const schemaPath = findSchemaPath(resolvedPath);

  console.log(`Scanning: ${skillsRoot}`);
  const skills = await discoverSkills(skillsRoot);

  if (skills.length === 0) {
    console.log("No skills found.");
    return 1;
  }

  console.log(`Found ${skills.length} skill(s)\n`);

  let allErrors = [];

  for (const skill of skills) {
    const errors = await validateSkill(skill, schemaPath);
    if (errors.length > 0) {
      allErrors.push(...errors);
    }
  }

  const validSkills = skills.filter((s) => s.meta && !validateSkillMetaShape(s.meta));
  const constraintErrors = validateConstraints(validSkills);
  allErrors.push(...constraintErrors);

  if (allErrors.length === 0) {
    console.log("✓ All validations passed.");
    return 0;
  }

  console.log(`Found ${allErrors.length} error(s):\n`);
  for (const err of allErrors) {
    console.log(`  ${err}`);
  }
  return 1;
}

function findSchemaPath(rootPath) {
  const candidates = [
    path.join(rootPath, "schemas", "skill-meta.schema.json"),
    path.resolve(rootPath, "..", "schemas", "skill-meta.schema.json"),
    path.resolve(rootPath, "..", "..", "schemas", "skill-meta.schema.json"),
    path.resolve(rootPath, "..", "..", "..", "schemas", "skill-meta.schema.json"),
    path.resolve(rootPath, "..", "..", "..", "..", "schemas", "skill-meta.schema.json"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function validateSkillMetaShape(meta) {
  return !Array.isArray(meta.depends_on) || typeof meta.slug !== "string" || typeof meta.tier !== "string";
}
