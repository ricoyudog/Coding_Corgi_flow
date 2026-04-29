import fs from "node:fs/promises";
import path from "node:path";

export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const result = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export async function loadSkill(skillDir) {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const metaPath = path.join(skillDir, "skill.meta.json");
  let frontmatter = null;
  try {
    const content = await fs.readFile(skillMdPath, "utf-8");
    frontmatter = parseFrontmatter(content);
  } catch {
    return { dir: skillDir, frontmatter: null, error: "missing-skill-md" };
  }
  let meta = null;
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    meta = JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") {
      return { dir: skillDir, frontmatter, error: "missing-meta" };
    }
    return { dir: skillDir, frontmatter, error: "invalid-meta-json" };
  }
  return { dir: skillDir, meta, frontmatter };
}

export async function discoverSkills(rootDir) {
  const skills = [];
  const tierDirs = ["atoms", "molecules", "compounds"];
  for (const tier of tierDirs) {
    const tierPath = path.join(rootDir, tier);
    try {
      const entries = await fs.readdir(tierPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillDir = path.join(tierPath, entry.name);
        if (await hasSkillMd(skillDir)) {
          skills.push(await loadSkill(skillDir));
        }
      }
    } catch { /* tier dir doesn't exist */ }
  }
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (tierDirs.includes(entry.name)) continue;
      const skillDir = path.join(rootDir, entry.name);
      if (await hasSkillMd(skillDir)) {
        skills.push(await loadSkill(skillDir));
      }
    }
  } catch { /* root doesn't exist */ }
  return skills;
}

async function hasSkillMd(dir) {
  try {
    await fs.access(path.join(dir, "SKILL.md"));
    return true;
  } catch {
    return false;
  }
}
