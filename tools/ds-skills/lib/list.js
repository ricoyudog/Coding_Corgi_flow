import path from "node:path";
import fs from "node:fs/promises";
import { discoverSkills } from "./loader.js";

export function filterSkills(skills, { tier, platform } = {}) {
  let result = skills;
  if (tier) {
    result = result.filter((s) => s.meta.tier === tier);
  }
  if (platform) {
    result = result.filter((s) => s.meta.platform === platform);
  }
  return result;
}

export function buildSkillTable(skills) {
  const headers = ["Slug", "Tier", "Platform", "Version", "Deps", "Description"];
  const rows = skills.map((s) => [
    s.meta.slug,
    s.meta.tier,
    s.meta.platform,
    s.meta.version,
    s.meta.depends_on.length.toString(),
    s.meta.description.slice(0, 50),
  ]);

  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );

  const sep = widths.map((w) => "-".repeat(w)).join(" | ");
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join(" | ");
  const dataLines = rows.map((r) =>
    r.map((cell, i) => cell.padEnd(widths[i])).join(" | ")
  );

  return [headerLine, sep, ...dataLines].join("\n");
}

export async function runList(rootPath, { tier, platform } = {}) {
  const resolvedPath = path.resolve(rootPath);

  let skillsRoot = resolvedPath;
  const opencodePath = path.join(resolvedPath, ".opencode", "skills");
  try {
    await fs.access(opencodePath);
    skillsRoot = opencodePath;
  } catch {
    // Use rootPath as-is
  }

  const skills = await discoverSkills(skillsRoot);
  const valid = skills.filter((s) => s.meta);
  const filtered = filterSkills(valid, { tier, platform });

  if (filtered.length === 0) {
    console.log("No matching skills found.");
    return;
  }

  console.log(buildSkillTable(filtered));
  console.log(`\n${filtered.length} skill(s) listed.`);
}
